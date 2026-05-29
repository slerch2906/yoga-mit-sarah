-- Migration (Sarah 2026-05-29, Fall 3): Protokoll-Lücken bei der Warteliste schließen.
--
-- HINTERGRUND:
--   Automatisches Nachrücken von der Warteliste UND das automatische Entfernen von
--   ANDEREN Wartelisten (wenn der nachgerückte Yogi seinen letzten freien Credit
--   aufbraucht) liefen bisher OHNE Protokoll-Eintrag. Im zentralen Protokoll und in
--   der Yogi-Historie tauchte nur die Buchung auf, nicht WIE sie zustande kam.
--
-- FIX (rein additiv — keine Logik-Änderung an Promote/Offer/Notify):
--   Beide SECURITY-DEFINER-RPCs, die auto-nachrücken, schreiben jetzt audit_log:
--     • waitlist_promoted     (user_id = nachgerückter Yogi) — Name+Titel+Datum/Zeit
--     • waitlist_auto_removed  (user_id = entfernter Yogi)   — pro anderer Warteliste
--   Der Warteliste-BEITRITT (waitlist_joined) wird client-seitig in
--   app/kurse/[id]/page.tsx geschrieben (user_id = self, RLS-konform).
--
--   Jeder audit_log-INSERT ist in ein eigenes EXCEPTION-Sub-Block gekapselt: ein
--   evtl. Audit-Fehler darf das (kritische) Nachrücken NIEMALS abbrechen.
--
--   Funktionskörper sonst 1:1 wie deployed (process_cancellation_full aus
--   20260529_process_cancellation_full.sql; process_cancellation_with_waitlist aus
--   der Live-DB übernommen) — damit KEIN bestehender Workflow regressiert.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1) process_cancellation_full — ≤90/>90-Allrounder (lib/waitlist-promote.ts)
-- ══════════════════════════════════════════════════════════════════════════════
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

  v_start := (v_session.date + v_session.time_start) AT TIME ZONE 'Europe/Berlin';
  IF v_start <= v_now THEN
    RETURN jsonb_build_object('mode', 'noop');
  END IF;

  v_is_event := v_session.session_type IN ('event_free', 'event_paid');
  v_promote_without_credit := v_is_event OR v_session.is_free;
  v_display_name := CASE
    WHEN (v_is_event OR v_session.session_type = 'single')
         AND COALESCE(v_session.session_name, '') <> '' THEN v_session.session_name
    ELSE v_session.course_name
  END;

  v_within90 := (v_start - v_now) <= interval '90 minutes';

  IF NOT v_within90 THEN
    FOR v_waitlist IN
      SELECT w.id AS waitlist_id, w.user_id, p.email, p.first_name
      FROM waitlist w
      JOIN profiles p ON p.id = w.user_id
      WHERE w.session_id = p_session_id AND w.type = 'waitlist'
      ORDER BY w.created_at ASC
    LOOP
      IF v_promote_without_credit THEN
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
          CONTINUE;
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
            -- Fall 3 (Sarah 2026-05-29): Protokoll-Eintrag pro auto-entfernter Warteliste.
            BEGIN
              INSERT INTO audit_log (user_id, action, details)
              VALUES (v_waitlist.user_id, 'waitlist_auto_removed', jsonb_build_object(
                'course_name', v_other.course_name,
                'session_date', v_other.date, 'session_time', v_other.time_start,
                'first_name', v_waitlist.first_name, 'reason', 'last_credit_used'));
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
          END LOOP;
          DELETE FROM waitlist WHERE user_id = v_waitlist.user_id AND type = 'waitlist';
        END IF;
        EXIT;
      END IF;
    END LOOP;

    -- Fall 3 (Sarah 2026-05-29): Protokoll-Eintrag für automatisches Nachrücken.
    IF v_promoted IS NOT NULL THEN
      BEGIN
        INSERT INTO audit_log (user_id, action, details)
        VALUES ((v_promoted->>'user_id')::uuid, 'waitlist_promoted', jsonb_build_object(
          'session_id', p_session_id,
          'course_name', v_promoted->>'course_name',
          'session_date', v_promoted->>'date', 'session_time', v_promoted->>'time_start',
          'session_type', v_promoted->>'session_type',
          'first_name', v_promoted->>'first_name'));
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;

    IF v_promoted IS NULL THEN
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

-- ══════════════════════════════════════════════════════════════════════════════
-- 2) process_cancellation_with_waitlist — >90-Pfad (app/kurse/[id]/page.tsx)
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.process_cancellation_with_waitlist(p_session_id uuid)
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
  v_waitlist record;
  v_credit record;
  v_is_event boolean;
  v_display_name text;
  v_promoted jsonb := null;
  v_notify_users jsonb := '[]'::jsonb;
  v_skipped_no_credit jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Nicht authentifiziert';
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin FROM profiles WHERE id = v_caller;

  SELECT EXISTS(SELECT 1 FROM bookings WHERE user_id = v_caller AND session_id = p_session_id)
    INTO v_has_booking;

  IF NOT v_is_admin AND NOT v_has_booking THEN
    RAISE EXCEPTION 'Nicht berechtigt für diese Session';
  END IF;

  SELECT s.id, s.date, s.time_start, s.session_type, s.name AS session_name, c.name AS course_name
    INTO v_session
  FROM sessions s
  LEFT JOIN courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  v_is_event := v_session.session_type IN ('event_free', 'event_paid');
  v_display_name := CASE
    WHEN v_is_event AND COALESCE(v_session.session_name, '') <> '' THEN v_session.session_name
    ELSE v_session.course_name
  END;

  IF v_is_event THEN
    FOR v_waitlist IN
      SELECT w.id AS waitlist_id, w.user_id, w.position, p.email, p.first_name
      FROM waitlist w
      JOIN profiles p ON p.id = w.user_id
      WHERE w.session_id = p_session_id AND w.type = 'waitlist'
      ORDER BY w.position ASC NULLS LAST, w.created_at ASC
      LIMIT 1
    LOOP
      INSERT INTO bookings (user_id, session_id, credit_id, type, status, cancelled_at, cancel_late, promoted_at)
      VALUES (v_waitlist.user_id, p_session_id, NULL, 'single', 'active', NULL, false, now())
      ON CONFLICT (user_id, session_id) DO UPDATE
        SET status = 'active', credit_id = NULL, cancelled_at = NULL, cancel_late = false, promoted_at = now();

      v_promoted := jsonb_build_object(
        'user_id', v_waitlist.user_id,
        'email', v_waitlist.email,
        'first_name', v_waitlist.first_name,
        'course_name', v_display_name,
        'session_type', v_session.session_type,
        'date', v_session.date,
        'time_start', v_session.time_start
      );

      DELETE FROM waitlist WHERE id = v_waitlist.waitlist_id;
    END LOOP;
  ELSE
    FOR v_waitlist IN
      SELECT w.id AS waitlist_id, w.user_id, w.position, p.email, p.first_name
      FROM waitlist w
      JOIN profiles p ON p.id = w.user_id
      WHERE w.session_id = p_session_id AND w.type = 'waitlist'
      ORDER BY w.position ASC NULLS LAST, w.created_at ASC
    LOOP
      SELECT id, used, total INTO v_credit
      FROM credits
      WHERE user_id = v_waitlist.user_id
        AND total > used
        AND expires_at > now()
        AND model <> 'guthaben'
      ORDER BY expires_at ASC
      LIMIT 1;

      IF v_credit.id IS NOT NULL THEN
        INSERT INTO bookings (user_id, session_id, credit_id, type, status, cancelled_at, cancel_late, promoted_at)
        VALUES (v_waitlist.user_id, p_session_id, v_credit.id, 'single', 'active', NULL, false, now())
        ON CONFLICT (user_id, session_id) DO UPDATE
          SET status = 'active', credit_id = v_credit.id, cancelled_at = NULL, cancel_late = false, promoted_at = now();

        v_promoted := jsonb_build_object(
          'user_id', v_waitlist.user_id,
          'email', v_waitlist.email,
          'first_name', v_waitlist.first_name,
          'course_name', v_display_name,
          'session_type', v_session.session_type,
          'date', v_session.date,
          'time_start', v_session.time_start
        );

        DELETE FROM waitlist WHERE id = v_waitlist.waitlist_id;
        EXIT;
      ELSE
        v_skipped_no_credit := v_skipped_no_credit || jsonb_build_object(
          'user_id', v_waitlist.user_id,
          'email', v_waitlist.email,
          'first_name', v_waitlist.first_name,
          'course_name', v_display_name,
          'date', v_session.date,
          'time_start', v_session.time_start
        );
        DELETE FROM waitlist WHERE id = v_waitlist.waitlist_id;
      END IF;
    END LOOP;
  END IF;

  -- Fall 3 (Sarah 2026-05-29): Protokoll-Eintrag für automatisches Nachrücken.
  IF v_promoted IS NOT NULL THEN
    BEGIN
      INSERT INTO audit_log (user_id, action, details)
      VALUES ((v_promoted->>'user_id')::uuid, 'waitlist_promoted', jsonb_build_object(
        'session_id', p_session_id,
        'course_name', v_promoted->>'course_name',
        'session_date', v_promoted->>'date', 'session_time', v_promoted->>'time_start',
        'session_type', v_promoted->>'session_type',
        'first_name', v_promoted->>'first_name'));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  IF v_promoted IS NULL THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'user_id', w.user_id,
        'email', p.email,
        'first_name', p.first_name,
        'course_name', v_display_name,
        'date', v_session.date,
        'time_start', v_session.time_start,
        'session_id', p_session_id
      )
    ), '[]'::jsonb) INTO v_notify_users
    FROM waitlist w
    JOIN profiles p ON p.id = w.user_id
    WHERE w.session_id = p_session_id AND w.type = 'notify';

    DELETE FROM waitlist WHERE session_id = p_session_id AND type = 'notify';
  END IF;

  RETURN jsonb_build_object(
    'promoted', v_promoted,
    'notify_users', v_notify_users,
    'skipped_no_credit', v_skipped_no_credit
  );
END;
$function$;
