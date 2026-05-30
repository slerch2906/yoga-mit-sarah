-- Security-Fix #3 (Sarah 2026-05-30): 3-Std-Stornofrist auch DB-seitig erzwingen.
-- ----------------------------------------------------------------------------
-- BEFUND: Die 3-Stunden-Frist für Kurs-/Einzelstunden war NUR im Client geprüft
--   (app/kurse/[id]/page.tsx setzt cancel_late). Ein technisch versierter Yogi
--   konnte per Direktaufruf `bookings.update({status:'cancelled', cancel_late:false})`
--   eine Spät-Abmeldung als pünktlich ausgeben und sich so den Credit unrechtmäßig
--   zurückholen (nur event_paid hatte bereits einen DB-Trigger).
--
-- FIX: BEFORE-UPDATE-Trigger, der bei einer NICHT-Admin-Selbst-Abmeldung
--   (auth.uid() vorhanden und kein Admin) von course_session/single das
--   cancel_late-Flag AUTORITATIV aus der Stundenzeit (Europe/Berlin) berechnet —
--   exakt nach derselben Regel wie der Client:
--       late = (now > Stundenstart − 3h) UND NICHT 60-Min-Nachrück-Gnadenfrist
--   Admin- und serverseitige Pfade (service_role, auth.uid() IS NULL) sowie
--   Events (event_free/event_paid: eigene Logik bzw. 7-Tage-Trigger) bleiben
--   unangetastet. Für den legitimen Client-Pfad ergibt sich derselbe Wert →
--   keine Verhaltensänderung, nur Manipulationsschutz.

CREATE OR REPLACE FUNCTION public.enforce_self_cancel_late_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_type  text;
  v_start timestamptz;
BEGIN
  -- Nur beim Übergang active -> cancelled
  IF NOT (OLD.status = 'active' AND NEW.status = 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Admin + serverseitige Pfade (service_role / kein User-JWT) setzen cancel_late
  -- bewusst selbst -> nicht überschreiben.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  SELECT s.session_type,
         (s.date::timestamp + s.time_start) AT TIME ZONE 'Europe/Berlin'
    INTO v_type, v_start
  FROM public.sessions s
  WHERE s.id = NEW.session_id;

  -- Nur Kurs-/Einzelstunden. Events haben eigene Storno-Logik
  -- (event_free jederzeit frei; event_paid via enforce_event_paid_7d_cancel_block).
  IF v_type IS DISTINCT FROM 'course_session' AND v_type IS DISTINCT FROM 'single' THEN
    RETURN NEW;
  END IF;

  -- Autoritative Neuberechnung (identisch zur Client-Regel)
  IF NEW.promoted_at IS NOT NULL AND (now() - NEW.promoted_at) < interval '60 minutes' THEN
    NEW.cancel_late := false;                         -- 60-Min-Nachrück-Gnadenfrist
  ELSIF now() > (v_start - interval '3 hours') THEN
    NEW.cancel_late := true;                          -- innerhalb 3-Std-Frist -> Credit verfällt
  ELSE
    NEW.cancel_late := false;                         -- rechtzeitig -> Credit zurück
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_self_cancel_late_flag ON public.bookings;
CREATE TRIGGER trg_enforce_self_cancel_late_flag
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_self_cancel_late_flag();
