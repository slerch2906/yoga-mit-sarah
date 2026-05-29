-- Migration (Sarah 2026-05-29): RLS-Kontext-Fix für Wartelisten-Nachrücken/Spätangebot
-- bei Yogi-Selbst-Abmeldung (Stundenseite ≤90 Min) UND Yogi-Account-Löschung.
--
-- HINTERGRUND / BUG:
--   lib/waitlist-promote.ts (promoteWaitlistOrOfferLate) lief CLIENT-SEITIG mit dem
--   Supabase-Client des abmeldenden Yogis. Unter RLS darf ein normaler Yogi NUR die
--   EIGENEN waitlist-Zeilen und die EIGENE profiles.email lesen. Beim Selbst-Abmelden
--   sah die Funktion deshalb eine LEERE Warteliste → erstellte keine waitlist_offers,
--   verschickte kein Spätangebot. (Sarah-Repro 2026-05-29: Absage 9:56, Start 11:20,
--   mail@ bekam nichts.) Dasselbe RLS-Problem traf die Account-Löschung in
--   app/profil/page.tsx (>90 UND ≤90).
--
-- FIX:
--   Die gesamte privilegierte DB-Arbeit (Auto-Promote >90, Spätangebot ≤90,
--   Notify-Empfänger ermitteln) läuft jetzt server-seitig in einer SECURITY-DEFINER-RPC
--   (umgeht RLS) — exakt nach dem Muster der bereits funktionierenden >90-RPC
--   process_cancellation_with_waitlist. Die RPC repliziert die bisherige Helper-Logik
--   1:1 (Kurs-Credit-Vorrang, "von anderen Wartelisten entfernen wenn letzter Credit
--   weg", Notify-Löschung erst bei erfolgreichem Mailversand → über separate RPC), damit
--   KEIN bestehender (Admin-)Workflow regressiert. Mailversand bleibt im TS-Client.
--
-- TYP-UNABHÄNGIG: deckt Events (free/paid), Einzelstunden UND Kurse ab.

-- ──────────────────────────────────────────────────────────────────────────────
-- process_cancellation_full: entscheidet selbst >90 vs ≤90 anhand der Startzeit und
-- gibt eine kontrollierte Empfängerliste zurück. Der TS-Client verschickt nur noch
-- die Mails aus diesen Daten.
--
-- Rückgabe (jsonb):
--   { mode: 'auto-promoted' | 'late-offer' | 'notify-only' | 'noop',
--     promoted: {user_id,email,first_name,course_name,session_type,date,time_start} | null,
--     removed_elsewhere: [{email,first_name,course_name,date,time_start}],
--     offers: [{user_id,email,first_name,token,course_name,date,time_start,session_type}],
--     notify_users: [{user_id,email,first_name,course_name,date,time_start,session_id}] }
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_cancellation_full(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_has_booking boolean;
  v_session record;
  v_is_event boolean;
  v_promote_without_credit boolean;
  v_display_name text;
  v_start timestamptz;
  v_now timestamptz := now();
  v_within90 boolean;
  v_waitlist record;
  v_credit record;
  v_still_free int;
  v_other record;
  v_token text;
  v_winner_exists boolean;
  v_promoted jsonb := null;
  v_removed_elsewhere jsonb := '[]'::jsonb;
  v_offers jsonb := '[]'::jsonb;
  v_notify jsonb := '[]'::jsonb;
  v_mode text;
BEGIN
  -- Auth-Check: NUR für eingeloggte Yogis. v_caller IS NULL bedeutet Service-Role
  -- (Tests, Crons, server-seitige Trigger) — vertrauenswürdig, da EXECUTE für anon
  -- explizit entzogen ist (siehe REVOKE unten). Eingeloggte Yogis müssen Admin sein
  -- ODER eine (auch bereits stornierte) Buchung in dieser Session haben.
  IF v_caller IS NOT NULL THEN
    SELECT COALESCE(is_admin, false) INTO v_is_admin FROM profiles WHERE id = v_caller;
    SELECT EXISTS(SELECT 1 FROM bookings WHERE user_id = v_caller AND session_id = p_session_id)
      INTO v_has_booking;
    IF NOT v_is_admin AND NOT v_has_booking THEN
      RAISE EXCEPTION 'Nicht berechtigt für diese Session';
    END IF;
  END IF;

  SELECT s.id, s.date, s.time_start, s.session_type, s.name AS session_name,
         s.course_id, s.is_cancelled, c.name AS course_name,
         COALESCE(c.is_free, false) AS is_free
    INTO v_session
  FROM sessions s
  LEFT JOIN courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF v_session.id IS NULL OR v_session.is_cancelled THEN
    RETURN jsonb_build_object('mode', 'noop');
  END IF;

  -- Startzeitpunkt als Berlin-Wandzeit (wie im restlichen App-Code: new Date(`${date}T${time}`)).
  v_start := (v_session.date + v_session.time_start) AT TIME ZONE 'Europe/Berlin';
  IF v_start <= v_now THEN
    RETURN jsonb_build_object('mode', 'noop'); -- Stunde hat bereits begonnen
  END IF;

  v_is_event := v_session.session_type IN ('event_free', 'event_paid');
  -- Events (free+paid) + Charity-Kurse (is_free) rücken OHNE Credit nach.
  v_promote_without_credit := v_is_event OR v_session.is_free;
  -- Anzeige-/Mail-Name: Events + Einzelstunden nutzen session.name, sonst Kursname.
  v_display_name := CASE
    WHEN (v_is_event OR v_session.session_type = 'single')
         AND COALESCE(v_session.session_name, '') <> '' THEN v_session.session_name
    ELSE v_session.course_name
  END;

  v_within90 := (v_start - v_now) <= interval '90 minutes';

  IF NOT v_within90 THEN
    -- ════════════════════════════════════════════════════════════════════════
    -- > 90 Min: AUTO-PROMOTE (repliziert lib/waitlist-promote.ts tryAutoPromoteOne[Free])
    -- ════════════════════════════════════════════════════════════════════════
    FOR v_waitlist IN
      SELECT w.id AS waitlist_id, w.user_id, p.email, p.first_name
      FROM waitlist w
      JOIN profiles p ON p.id = w.user_id
      WHERE w.session_id = p_session_id AND w.type = 'waitlist'
      ORDER BY w.created_at ASC
    LOOP
      IF v_promote_without_credit THEN
        -- Events/Charity: ersten Yogi OHNE Credit einbuchen.
        INSERT INTO bookings (user_id, session_id, credit_id, type, status, cancelled_at, cancel_late, promoted_at)
        VALUES (v_waitlist.user_id, p_session_id, NULL, 'single', 'active', NULL, false, now())
        ON CONFLICT (user_id, session_id) DO UPDATE
          SET status = 'active', credit_id = NULL, cancelled_at = NULL, cancel_late = false, promoted_at = now();
        DELETE FROM waitlist WHERE id = v_waitlist.waitlist_id;
        v_promoted := jsonb_build_object(
          'user_id', v_waitlist.user_id, 'email', v_waitlist.email, 'first_name', v_waitlist.first_name,
          'course_name', v_display_name, 'session_type', v_session.session_type,
          'date', v_session.date, 'time_start', v_session.time_start);
        EXIT;
      ELSE
        -- Kurs/Einzelstunde: freien Credit suchen (Kurs-Credit des eigenen Kurses bevorzugt).
        SELECT id, course_id, model INTO v_credit
        FROM credits
        WHERE user_id = v_waitlist.user_id
          AND total > used
          AND expires_at > now()
          AND model <> 'guthaben'
        ORDER BY (CASE WHEN model = 'course' AND v_session.course_id IS NOT NULL
                            AND course_id = v_session.course_id THEN 0 ELSE 1 END),
                 expires_at ASC
        LIMIT 1;
        IF v_credit.id IS NULL THEN
          CONTINUE; -- kein Credit → diesen Yogi überspringen, auf Warteliste lassen
        END IF;
        INSERT INTO bookings (user_id, session_id, credit_id, type, status, cancelled_at, cancel_late, promoted_at)
        VALUES (v_waitlist.user_id, p_session_id, v_credit.id, 'single', 'active', NULL, false, now())
        ON CONFLICT (user_id, session_id) DO UPDATE
          SET status = 'active', credit_id = v_credit.id, cancelled_at = NULL, cancel_late = false, promoted_at = now();
        DELETE FROM waitlist WHERE id = v_waitlist.waitlist_id;
        v_promoted := jsonb_build_object(
          'user_id', v_waitlist.user_id, 'email', v_waitlist.email, 'first_name', v_waitlist.first_name,
          'course_name', v_display_name, 'session_type', v_session.session_type,
          'date', v_session.date, 'time_start', v_session.time_start);

        -- Letzten freien Credit aufgebraucht? → von allen anderen Wartelisten entfernen
        -- (Sarah-Wunsch 2026-05-24) + pro entfernter Warteliste eine Hinweis-Mail.
        SELECT count(*) INTO v_still_free
        FROM credits
        WHERE user_id = v_waitlist.user_id
          AND total > used AND expires_at > now() AND model <> 'guthaben';
        IF v_still_free = 0 THEN
          FOR v_other IN
            SELECT s2.date, s2.time_start, c2.name AS course_name
            FROM waitlist w
            JOIN sessions s2 ON s2.id = w.session_id
            LEFT JOIN courses c2 ON c2.id = s2.course_id
            WHERE w.user_id = v_waitlist.user_id AND w.type = 'waitlist'
          LOOP
            v_removed_elsewhere := v_removed_elsewhere || jsonb_build_object(
              'email', v_waitlist.email, 'first_name', v_waitlist.first_name,
              'course_name', v_other.course_name, 'date', v_other.date, 'time_start', v_other.time_start);
          END LOOP;
          DELETE FROM waitlist WHERE user_id = v_waitlist.user_id AND type = 'waitlist';
        END IF;
        EXIT;
      END IF;
    END LOOP;

    IF v_promoted IS NULL THEN
      -- Niemand nachgerückt (leere Warteliste oder kein Credit) → Notify-Subscriber.
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'user_id', w.user_id, 'email', p.email, 'first_name', p.first_name,
        'course_name', v_display_name, 'date', v_session.date,
        'time_start', v_session.time_start, 'session_id', p_session_id)), '[]'::jsonb)
        INTO v_notify
      FROM waitlist w JOIN profiles p ON p.id = w.user_id
      WHERE w.session_id = p_session_id AND w.type = 'notify';
      v_mode := 'notify-only';
    ELSE
      v_mode := 'auto-promoted';
    END IF;

  ELSE
    -- ════════════════════════════════════════════════════════════════════════
    -- ≤ 90 Min: SPÄTANGEBOT an ALLE Warteliste-Yogis (wer zuerst zusagt, gewinnt)
    -- ════════════════════════════════════════════════════════════════════════
    -- Ist für diese Session bereits ein Winner resolved? Dann keine neuen Offers.
    SELECT EXISTS(SELECT 1 FROM waitlist_offers
      WHERE session_id = p_session_id AND resolved_winner_user_id IS NOT NULL)
      INTO v_winner_exists;
    IF v_winner_exists THEN
      RETURN jsonb_build_object('mode', 'noop');
    END IF;

    IF EXISTS(SELECT 1 FROM waitlist WHERE session_id = p_session_id AND type = 'waitlist') THEN
      FOR v_waitlist IN
        SELECT w.user_id, p.email, p.first_name
        FROM waitlist w JOIN profiles p ON p.id = w.user_id
        WHERE w.session_id = p_session_id AND w.type = 'waitlist'
        ORDER BY w.created_at ASC
      LOOP
        IF v_waitlist.email IS NULL THEN CONTINUE; END IF;
        INSERT INTO waitlist_offers (session_id, user_id, expires_at, claimed_at, resolved_winner_user_id)
        VALUES (p_session_id, v_waitlist.user_id, v_start, NULL, NULL)
        ON CONFLICT (session_id, user_id) DO UPDATE
          SET expires_at = EXCLUDED.expires_at, claimed_at = NULL, resolved_winner_user_id = NULL
        RETURNING token INTO v_token;
        IF v_token IS NULL THEN CONTINUE; END IF;
        v_offers := v_offers || jsonb_build_object(
          'user_id', v_waitlist.user_id, 'email', v_waitlist.email, 'first_name', v_waitlist.first_name,
          'token', v_token, 'course_name', v_display_name,
          'date', v_session.date, 'time_start', v_session.time_start, 'session_type', v_session.session_type);
      END LOOP;
      v_mode := 'late-offer';
    ELSE
      -- Keine Warteliste → Platz frei → Notify-Subscriber.
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'user_id', w.user_id, 'email', p.email, 'first_name', p.first_name,
        'course_name', v_display_name, 'date', v_session.date,
        'time_start', v_session.time_start, 'session_id', p_session_id)), '[]'::jsonb)
        INTO v_notify
      FROM waitlist w JOIN profiles p ON p.id = w.user_id
      WHERE w.session_id = p_session_id AND w.type = 'notify';
      v_mode := 'notify-only';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'mode', v_mode,
    'promoted', v_promoted,
    'removed_elsewhere', v_removed_elsewhere,
    'offers', v_offers,
    'notify_users', v_notify
  );
END;
$function$;

-- ──────────────────────────────────────────────────────────────────────────────
-- delete_notify_subscribers: löscht NUR die notify-Einträge, deren Mail erfolgreich
-- rausging (TS ruft das nach erfolgreichem notifyPlaceFree-Versand auf). Erhält die
-- Welle-S2/M4-Garantie "bei Brevo-Down bleibt die Subscription bestehen".
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_notify_subscribers(p_session_id uuid, p_user_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_has_booking boolean;
BEGIN
  -- Auth-Check wie in process_cancellation_full (Service-Role = NULL caller erlaubt).
  IF v_caller IS NOT NULL THEN
    SELECT COALESCE(is_admin, false) INTO v_is_admin FROM profiles WHERE id = v_caller;
    SELECT EXISTS(SELECT 1 FROM bookings WHERE user_id = v_caller AND session_id = p_session_id)
      INTO v_has_booking;
    IF NOT v_is_admin AND NOT v_has_booking THEN
      RAISE EXCEPTION 'Nicht berechtigt für diese Session';
    END IF;
  END IF;
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM waitlist
  WHERE session_id = p_session_id AND type = 'notify' AND user_id = ANY(p_user_ids);
END;
$function$;

-- Sicherheit: EXECUTE für PUBLIC/anon entziehen (sonst dürften anon-Clients mit
-- NULL-Caller den Auth-Check umgehen). Nur eingeloggte Yogis + Service-Role.
REVOKE ALL ON FUNCTION public.process_cancellation_full(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_notify_subscribers(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_cancellation_full(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_notify_subscribers(uuid, uuid[]) TO authenticated, service_role;
