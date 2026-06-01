-- Sarah 2026-06-01 (KORREKTUR): Einladung in vollen Kurs buchte den Yogi weiterhin
-- NICHT ein — weil die echte Einbuchung NICHT der Trigger handle_invitation_enrollment
-- macht (der feuert beim Profil-Insert, wenn die Einladung noch used=false ist → no-op),
-- sondern die RPC consume_invitation_enrollment, die der Register-Flow danach aufruft.
-- Diese RPC läuft als der registrierende Yogi (auth.uid()), nicht als Admin → der
-- max_spots-Trigger blockierte sie am vollen Kurs. Der Fehler wurde im App-Code als
-- "Best-Effort" verschluckt → Yogi registriert, aber nicht im Kurs.
--
-- Fix: consume_invitation_enrollment setzt vor den Buchungen app.bypass_max_spots='on'
-- (transaktionslokal), das enforce_session_max_spots respektiert. Einladung darf damit
-- immer überbuchen. (Der frühere Trigger-Fix bleibt bestehen, ist aber für den echten
-- Ablauf wirkungslos.)
--
-- Auf Prod (jcczvyablgdijeiyymhc) + Staging (bbzfcidmyyiodirtbowq) via apply_migration
-- eingespielt und über den echten RPC-Pfad (user-authentifiziert) verifiziert.

SET check_function_bodies = off;

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

  IF v_inv.course_id IS NULL OR v_inv.credits_to_assign IS NULL THEN
    RETURN jsonb_build_object('enrolled', false, 'reason', 'no_course');
  END IF;

  SELECT email INTO v_user_email FROM public.profiles WHERE id = v_uid;
  IF lower(coalesce(v_user_email, '')) <> lower(coalesce(v_inv.email, '')) THEN
    RAISE EXCEPTION 'email mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM public.enrollments WHERE user_id = v_uid AND course_id = v_inv.course_id) THEN
    RETURN jsonb_build_object('enrolled', true, 'already', true);
  END IF;

  -- Sarah 2026-06-01: Einladung ist eine Admin-Aktion -> Ueberbuchung erlauben.
  -- Flag wird vom max_spots-Trigger (enforce_session_max_spots) respektiert.
  PERFORM set_config('app.bypass_max_spots', 'on', true);

  INSERT INTO public.enrollments (user_id, course_id) VALUES (v_uid, v_inv.course_id);

  SELECT max(date) INTO v_last_date
  FROM public.sessions
  WHERE course_id = v_inv.course_id AND is_cancelled = false AND date >= current_date;

  IF v_last_date IS NOT NULL THEN
    v_expires := (v_last_date + interval '8 days');
  ELSE
    v_expires := date_trunc('quarter', now()) + interval '3 months' - interval '1 second';
  END IF;

  INSERT INTO public.credits (user_id, total, used, expires_at, course_id, model)
  VALUES (v_uid, v_inv.credits_to_assign, 0, v_expires, v_inv.course_id, 'course')
  RETURNING id INTO v_credit_id;

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
