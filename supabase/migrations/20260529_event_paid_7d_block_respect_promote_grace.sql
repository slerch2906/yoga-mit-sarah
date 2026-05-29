-- Migration (Sarah 2026-05-29): 60-Min-Nachrück-Gnadenfrist auch bei bezahlten Events.
--
-- HINTERGRUND:
--   Der Trigger enforce_event_paid_7d_cancel_block sperrt die Selbst-Abmeldung von
--   bezahlten Events innerhalb der 7-Tage-Stornofrist HART (RAISE EXCEPTION). Er kannte
--   bisher die promoted_at-basierte 60-Min-Gnadenfrist nicht. Damit wurde die App-Logik
--   (app/kurse/[id]/page.tsx, inPromoteGrace) auf DB-Ebene blockiert: Wer unfreiwillig
--   von der Warteliste in ein bezahltes Event nachgerückt ist, konnte sich nicht mehr
--   kostenlos wieder abmelden, obwohl App + Mails + AGB ihm 60 Minuten zusagen.
--
-- FIX:
--   Vor der 7-Tage-Frist-Prüfung wird die Gnadenfrist berücksichtigt: Ist die Buchung
--   per Auto-Promote nachgerückt (promoted_at gesetzt) und liegt das weniger als
--   60 Minuten zurück, ist die Selbst-Abmeldung kostenfrei möglich. Sonst greift die
--   7-Tage-Sperre unverändert. Admin (is_admin) bleibt jederzeit frei.

CREATE OR REPLACE FUNCTION public.enforce_event_paid_7d_cancel_block()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session_type text;
  v_session_start timestamptz;
  v_caller_is_admin boolean;
BEGIN
  -- Nur wenn status sich von active -> cancelled aendert
  IF NOT (OLD.status = 'active' AND NEW.status = 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Admin (im Profil) darf jederzeit austragen -- keine Frist
  SELECT COALESCE(is_admin, false) INTO v_caller_is_admin
  FROM profiles WHERE id = auth.uid();
  IF v_caller_is_admin THEN
    RETURN NEW;
  END IF;

  -- session_type + Startzeit der Session laden
  SELECT s.session_type,
         (s.date::timestamp + s.time_start) AT TIME ZONE 'Europe/Berlin'
    INTO v_session_type, v_session_start
  FROM sessions s
  WHERE s.id = NEW.session_id;

  -- Nur event_paid betroffen
  IF v_session_type IS DISTINCT FROM 'event_paid' THEN
    RETURN NEW;
  END IF;

  -- 60-Min-Gnadenfrist nach Auto-Promote (Nachruecken von der Warteliste):
  -- Wer gerade erst nachgerueckt ist, darf sich innerhalb von 60 Minuten noch
  -- kostenlos wieder abmelden -- auch innerhalb der 7-Tage-Frist.
  IF NEW.promoted_at IS NOT NULL AND (now() - NEW.promoted_at) < interval '60 minutes' THEN
    RETURN NEW;
  END IF;

  -- 7-Tage-Frist
  IF v_session_start - now() < interval '7 days' THEN
    RAISE EXCEPTION 'Selbst-Abmeldung von bezahlten Events ist innerhalb der 7-Tage-Stornofrist nicht moeglich. Wende dich bitte an Sarah (Ersatzkandidat).'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;
