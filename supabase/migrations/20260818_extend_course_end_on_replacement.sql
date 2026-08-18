-- ============================================================================
-- Bugfix (Sarah 2026-08-18): Kursende + Credit-Nachholfrist bei Ersatzstunde
-- ============================================================================
-- Problem: Wird eine abgesagte Kursstunde durch einen Ersatztermin ANS ENDE
-- des Kurses gehängt (z.B. Kurs endete bisher am 13.8., Ersatztermin liegt
-- am 20.8.), blieb courses.date_end unveraendert auf dem alten Datum stehen.
-- Folgen:
--   1) Der Kurs zeigte ueberall (Kursuebersicht, Rollover-Hinweis, "beendet"-
--      Status) faelschlich das alte, zu fruehe Enddatum.
--   2) Die 8-Tage-Nachholfrist der Kurs-Credits wird in zwei Schichten
--      geprueft: zuerst ein HARTER Stichtag credits.expires_at (bei der
--      Credit-Vergabe einmalig aus dem damaligen Kursende + 8 Tage berechnet
--      und seitdem eingefroren), danach erst die eigentliche Fenster-Pruefung
--      in tryCourseCredit() (lib/credit-selector.ts), die date_end zwar LIVE
--      neu liest -- aber die erste Schicht (expires_at) blockte bereits vorher
--      hart ab, weil der Yogi ja WEITERHIN einen "eingefrorenen" Ablauf-
--      Stichtag auf Basis des alten (zu fruehen) Kursendes hatte. Die neue
--      Ersatzstunde war dadurch fuer bereits eingeschriebene Yogis nicht mehr
--      nachholbar, obwohl der Kurs "offiziell" gerade deswegen verlaengert
--      werden sollte.
--
-- Fix: Trigger auf sessions (AFTER UPDATE OF replacement_session_id). Sobald
-- eine Session GERADE FRISCH mit einem Ersatztermin verlinkt wird (das
-- passiert in allen 4 "Ersatztermin anlegen"-Codepfaden per UPDATE, NACHDEM
-- die neue Session per INSERT angelegt wurde), wird courses.date_end auf das
-- Datum der Ersatzstunde angehoben -- sofern das spaeter ist als bisher --
-- und alle bereits vergebenen Kurs-Credits dieses Kurses, deren expires_at
-- noch VOR der neuen 8-Tage-Nachholfrist lag, werden im selben Zug
-- automatisch mitverlaengert.
--
-- Bewusst an replacement_session_id (nicht an jedem Session-INSERT) geankert:
-- ein erster Entwurf reagierte auf JEDEN neu eingefuegten aktiven
-- course_session mit spaeterem Datum -- das loeste faelschlich auch bei
-- Test-/Analyse-Szenarien aus, die einfach nur eine Session zu einem
-- bestimmten Datum in einen bestehenden Kurs einfuegen, OHNE dass es sich
-- um einen echten, verlinkten Ersatztermin handelt (siehe
-- tests/e2e/44-credit-kurs-zuordnung.spec.ts, "9 Tage nach Kursende ->
-- blockiert"). Die Verlinkung ueber replacement_session_id ist das exakte,
-- eindeutige Signal fuer "hier wurde wirklich ein Ersatztermin angelegt".
--
-- Bewusst NUR verlaengern, NIE verkuerzen: ein Kursabbruch o.ae. darf
-- date_end/expires_at nicht rueckwirkend verkleinern (das wuerde andere,
-- unabhaengige Ablaeufe wie Kursabbruch-Erstattung beeinflussen).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_extend_course_end_on_replacement_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_repl_date         date;
  v_repl_is_cancelled boolean;
  v_repl_type         text;
  v_old_date_end      date;
  v_new_expiry        timestamptz;
  v_extended          jsonb;
BEGIN
  -- Nur wenn GERADE FRISCH ein Ersatztermin verlinkt wurde (NULL -> gesetzt).
  IF NEW.replacement_session_id IS NULL OR OLD.replacement_session_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT date, is_cancelled, session_type
    INTO v_repl_date, v_repl_is_cancelled, v_repl_type
    FROM sessions WHERE id = NEW.replacement_session_id;

  -- Verlinkte Session muss eine echte, aktive Kursstunde sein.
  IF v_repl_date IS NULL OR v_repl_is_cancelled OR v_repl_type IS DISTINCT FROM 'course_session' THEN
    RETURN NEW;
  END IF;

  SELECT date_end INTO v_old_date_end FROM courses WHERE id = NEW.course_id;

  -- Nur verlaengern, nie verkuerzen (v_old_date_end NULL = kein festes
  -- Kursende, z.B. SYS-Container -- ebenfalls nicht anfassen).
  IF v_old_date_end IS NULL OR v_repl_date <= v_old_date_end THEN
    RETURN NEW;
  END IF;

  UPDATE courses SET date_end = v_repl_date WHERE id = NEW.course_id;

  -- Neue Nachhol-Frist: Ende des neuen letzten Kurstags (23:59:59, Berlin) + 8 Tage.
  -- Analog zur Fenster-Berechnung in lib/credit-selector.ts (tryCourseCredit).
  v_new_expiry := ((v_repl_date::timestamp + interval '8 days 23:59:59') AT TIME ZONE 'Europe/Berlin');

  WITH extended AS (
    UPDATE credits
       SET expires_at = v_new_expiry
     WHERE course_id = NEW.course_id
       AND model = 'course'
       AND expires_at < v_new_expiry
    RETURNING id, user_id
  )
  SELECT jsonb_agg(jsonb_build_object('credit_id', id, 'user_id', user_id)) INTO v_extended FROM extended;

  IF v_extended IS NOT NULL THEN
    INSERT INTO audit_log (action, details)
    VALUES (
      'course_date_end_and_credits_extended',
      jsonb_build_object(
        'course_id', NEW.course_id,
        'old_date_end', v_old_date_end,
        'new_date_end', v_repl_date,
        'new_credit_expiry', v_new_expiry,
        'original_session_id', NEW.id,
        'replacement_session_id', NEW.replacement_session_id,
        'extended_credits', v_extended
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_extend_course_end_on_replacement_link ON public.sessions;
CREATE TRIGGER trg_extend_course_end_on_replacement_link
  AFTER UPDATE OF replacement_session_id ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.fn_extend_course_end_on_replacement_link();
