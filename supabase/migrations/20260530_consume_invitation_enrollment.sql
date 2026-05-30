-- Security-Fix #2 (Sarah 2026-05-30, Pre-Go-Live-Audit): Credit-Selbstgutschrift schließen.
-- ----------------------------------------------------------------------------
-- BEFUND: Die credits-Policy „Credits bearbeiten" (ALL, user_id = auth.uid())
--   erlaubte jedem Yogi, sich SELBST Credits gutzuschreiben (Gratis-Stunden):
--       supabase.from('credits').insert({ user_id:<eigen>, total:100, ... })
--   Gebraucht wurde diese Policy nur vom Register-Auto-Einbuchungs-Pfad, der die
--   Credit-Menge CLIENTSEITIG bestimmte (manipulierbar).
--
-- FIX-TEIL A (diese Migration, additiv & sicher):
--   SECURITY-DEFINER-RPC, die Enrollment + Kurs-Credit + Buchungen SERVERSEITIG
--   anlegt — mit total = invitation.credits_to_assign (server-kontrolliert) statt
--   aus dem Client. Validiert Token, Caller (auth.uid) und E-Mail-Übereinstimmung.
--   Der RLS-Lockdown (Entzug des Yogi-Schreibrechts auf credits/enrollments) folgt
--   in einer separaten Migration, NACHDEM die Register-Seite auf diese RPC umgestellt
--   und deployt ist.

CREATE OR REPLACE FUNCTION public.consume_invitation_enrollment(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_inv          public.invitations%ROWTYPE;
  v_user_email   text;
  v_credit_id    uuid;
  v_expires      timestamptz;
  v_last_date    date;
  v_booking_cnt  int := 0;
  v_sid          uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_inv FROM public.invitations WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN
    RAISE EXCEPTION 'invitation expired' USING ERRCODE = 'check_violation';
  END IF;

  -- Keine Kurs-Einladung → nichts zu tun (z.B. reine Account-Einladung).
  IF v_inv.course_id IS NULL OR v_inv.credits_to_assign IS NULL THEN
    RETURN jsonb_build_object('enrolled', false, 'reason', 'no_course');
  END IF;

  -- Anti-Abuse: nur die eingeladene Person (gleiche E-Mail) darf einlösen.
  SELECT email INTO v_user_email FROM public.profiles WHERE id = v_uid;
  IF lower(coalesce(v_user_email, '')) <> lower(coalesce(v_inv.email, '')) THEN
    RAISE EXCEPTION 'email mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotenz: schon in diesem Kurs eingeschrieben → nichts doppelt anlegen.
  IF EXISTS (SELECT 1 FROM public.enrollments WHERE user_id = v_uid AND course_id = v_inv.course_id) THEN
    RETURN jsonb_build_object('enrolled', true, 'already', true);
  END IF;

  -- 1) Enrollment
  INSERT INTO public.enrollments (user_id, course_id) VALUES (v_uid, v_inv.course_id);

  -- 2) Ablaufdatum = 8 Tage nach letzter aktiver zukünftiger Stunde (sonst Quartalsende).
  SELECT max(date) INTO v_last_date
  FROM public.sessions
  WHERE course_id = v_inv.course_id AND is_cancelled = false AND date >= current_date;

  IF v_last_date IS NOT NULL THEN
    v_expires := (v_last_date + interval '8 days');
  ELSE
    v_expires := date_trunc('quarter', now()) + interval '3 months' - interval '1 second';
  END IF;

  -- 3) Kurs-Credit (total SERVER-kontrolliert = invitation.credits_to_assign)
  INSERT INTO public.credits (user_id, total, used, expires_at, course_id, model)
  VALUES (v_uid, v_inv.credits_to_assign, 0, v_expires, v_inv.course_id, 'course')
  RETURNING id INTO v_credit_id;

  -- 4) Buchungen für alle aktiven zukünftigen Stunden
  FOR v_sid IN
    SELECT id FROM public.sessions
    WHERE course_id = v_inv.course_id AND is_cancelled = false AND date >= current_date
  LOOP
    INSERT INTO public.bookings (user_id, session_id, credit_id, type, status)
    VALUES (v_uid, v_sid, v_credit_id, 'course', 'active');
    v_booking_cnt := v_booking_cnt + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'enrolled', true,
    'credit_id', v_credit_id,
    'credits_total', v_inv.credits_to_assign,
    'bookings', v_booking_cnt
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_invitation_enrollment(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_invitation_enrollment(text) TO authenticated, service_role;
