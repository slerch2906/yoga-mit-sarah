-- Zeitzonen-Welle 2 (Sarah 2026-06-02): CURRENT_DATE (= UTC) -> Berlin-Datum.
-- fn_check_yogi_birthdays und fn_check_courses_ending_soon verglichen gegen
-- CURRENT_DATE, das in der DB-Zeitzone (UTC) ausgewertet wird. Kurz nach
-- Mitternacht Berlin (= noch Vortag in UTC) konnte der Geburtstag/das 14-Tage-
-- Kursende am falschen Kalendertag erkannt werden. Jetzt durchgaengig
-- (now() AT TIME ZONE 'Europe/Berlin')::date — Sommer-/Winterzeit automatisch.
-- Logik sonst UNVERAENDERT.

CREATE OR REPLACE FUNCTION public.fn_check_courses_ending_soon()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_today date := (now() AT TIME ZONE 'Europe/Berlin')::date;
BEGIN
  -- Kurse die GENAU in 14 Tagen enden (date_end = heute(Berlin) + 14)
  FOR r IN
    SELECT id, name, date_end
    FROM courses
    WHERE is_active = true
      AND date_end = (v_today + INTERVAL '14 days')::date
  LOOP
    IF EXISTS (
      SELECT 1 FROM admin_notifications
      WHERE type = 'course_ending_soon'
        AND (details->>'course_id') = r.id::text
        AND read = false
    ) THEN CONTINUE; END IF;

    INSERT INTO admin_notifications (type, message, details, read)
    VALUES (
      'course_ending_soon',
      'Kurs "' || r.name || '" endet in 14 Tagen ('
        || to_char(r.date_end, 'DD.MM.') || ') — Folgekurs anlegen?',
      jsonb_build_object('course_id', r.id, 'course_name', r.name, 'end_date', r.date_end),
      false
    );
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_check_yogi_birthdays()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_age int;
  v_today date := (now() AT TIME ZONE 'Europe/Berlin')::date;
BEGIN
  FOR r IN
    SELECT id, first_name, last_name, birthdate
    FROM profiles
    WHERE birthdate IS NOT NULL
      AND is_admin = false
      AND is_dummy = false
      AND first_name <> 'Gelöschter'
      AND EXTRACT(MONTH FROM birthdate) = EXTRACT(MONTH FROM v_today)
      AND EXTRACT(DAY FROM birthdate)   = EXTRACT(DAY FROM v_today)
  LOOP
    -- Dedup: nicht doppelt am gleichen Berlin-Tag
    IF EXISTS (
      SELECT 1 FROM admin_notifications
      WHERE type = 'yogi_birthday'
        AND (details->>'user_id') = r.id::text
        AND (created_at AT TIME ZONE 'Europe/Berlin')::date = v_today
    ) THEN CONTINUE; END IF;

    v_age := EXTRACT(YEAR FROM age(r.birthdate))::int;
    INSERT INTO admin_notifications (type, message, details, read)
    VALUES (
      'yogi_birthday',
      r.first_name || ' ' || r.last_name || ' hat heute Geburtstag 🎂 (wird ' || v_age || ')',
      jsonb_build_object('user_id', r.id, 'name', r.first_name || ' ' || r.last_name, 'age', v_age),
      false
    );
  END LOOP;
END;
$function$;
