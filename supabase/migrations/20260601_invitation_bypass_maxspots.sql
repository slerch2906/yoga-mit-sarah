-- Sarah 2026-06-01: Einladung in vollen Kurs schlug fehl — der eingeladene Yogi
-- wurde beim Registrieren NICHT eingebucht (Credit/Enrollment/Bookings rollten
-- zurück), weil der max_spots-Trigger über auth.uid() den registrierenden Yogi
-- (nicht den Admin) sah und am vollen Kurs blockierte.
--
-- Fix: Die Einladungs-Einbuchung ist eine ADMIN-Aktion und darf überbuchen.
-- handle_invitation_enrollment setzt ein transaktionslokales Flag
-- (app.bypass_max_spots = 'on'), das enforce_session_max_spots respektiert.
-- Greift NUR während der Einladungs-Registrierung; normale Yogi-Selbstbuchungen
-- bleiben am vollen Kurs blockiert.
--
-- Bereits auf Prod (jcczvyablgdijeiyymhc) und Staging (bbzfcidmyyiodirtbowq)
-- via apply_migration eingespielt; diese Datei ist die versionierte Quelle.

SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.enforce_session_max_spots()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_max_spots integer;
  v_current_active integer;
  v_caller_is_admin boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  -- Sarah 2026-06-01: Einladungs-Einbuchung (Admin-Aktion) darf ueberbuchen.
  -- handle_invitation_enrollment setzt dieses transaktionslokale Flag.
  IF current_setting('app.bypass_max_spots', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_caller_is_admin
  FROM profiles WHERE id = auth.uid();
  IF v_caller_is_admin THEN
    RETURN NEW;
  END IF;

  -- Welle 2.11: session.max_spots Vorrang (Events/Einzelstunden), Fallback course.
  SELECT COALESCE(s.max_spots, c.max_spots) INTO v_max_spots
  FROM sessions s
  LEFT JOIN courses c ON c.id = s.course_id
  WHERE s.id = NEW.session_id;

  IF v_max_spots IS NULL OR v_max_spots = 0 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_current_active
  FROM bookings
  WHERE session_id = NEW.session_id
    AND status = 'active';

  IF v_current_active >= v_max_spots THEN
    RAISE EXCEPTION 'Session ist ausgebucht (max_spots=%, aktiv=%)', v_max_spots, v_current_active
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_invitation_enrollment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inv RECORD;
  invitation_token TEXT;
  last_session_date DATE;
  expiry_date TIMESTAMPTZ;
  actual_session_count INT;
  new_credit_id UUID;
BEGIN
  SELECT raw_user_meta_data->>'invitation_token' INTO invitation_token
  FROM auth.users WHERE id = NEW.id;

  IF invitation_token IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO inv FROM invitations
  WHERE token = invitation_token
    AND course_id IS NOT NULL
    AND used = true;

  IF inv.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Sarah 2026-06-01: Einladung ist eine Admin-Aktion -> Ueberbuchung erlauben.
  -- Flag wird vom max_spots-Trigger geprueft (transaktionslokal, nur diese Registrierung).
  PERFORM set_config('app.bypass_max_spots', 'on', true);

  SELECT COUNT(*) INTO actual_session_count
  FROM sessions
  WHERE course_id = inv.course_id
    AND date >= CURRENT_DATE
    AND is_cancelled = false;

  IF actual_session_count = 0 THEN
    RETURN NEW;
  END IF;

  SELECT MAX(date) INTO last_session_date
  FROM sessions WHERE course_id = inv.course_id AND is_cancelled = false;
  expiry_date := COALESCE((last_session_date + INTERVAL '8 days')::TIMESTAMPTZ, NOW() + INTERVAL '90 days');

  INSERT INTO credits (user_id, course_id, model, total, used, expires_at)
  VALUES (NEW.id, inv.course_id, 'course', actual_session_count, actual_session_count, expiry_date)
  RETURNING id INTO new_credit_id;

  INSERT INTO enrollments (user_id, course_id, enrolled_from_unit)
  VALUES (NEW.id, inv.course_id, 1)
  ON CONFLICT (user_id, course_id) DO NOTHING;

  INSERT INTO bookings (user_id, session_id, credit_id, type, status)
  SELECT NEW.id, s.id, new_credit_id, 'course', 'active'
  FROM sessions s
  WHERE s.course_id = inv.course_id
    AND s.date >= CURRENT_DATE
    AND s.is_cancelled = false
  ON CONFLICT (user_id, session_id) DO NOTHING;

  RETURN NEW;
END;
$function$;
