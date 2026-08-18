-- ============================================================================
-- Bugfix (Sarah 2026-08-18): Verwaiste Wartelisten-Einträge nach Stundenbeginn
-- ============================================================================
-- Problem: Wenn ein Yogi auf der Warteliste (type='waitlist') steht und die
-- Stunde beginnt, ohne dass er nachrückt (kein Platz frei geworden), blieb der
-- Wartelisten-Eintrag für immer bestehen. Es gibt bislang KEINEN Cleanup dafür
-- (anders als bei Promotion/Late-Offer, die den Eintrag selbst entfernen).
--
-- Folge: checkWaitlistConflicts() (app/kurse/[id]/page.tsx) zählt ALLE
-- waitlist-Einträge eines Yogis, auch längst vergangene, gegen seine freien
-- Credits — dadurch bekam der Yogi beim Versuch, sich anderswo auf eine
-- Warteliste einzutragen, fälschlich den "Wartelisten-Konflikt"-Hinweis für
-- eine Stunde, die schon vorbei war.
--
-- Fix: Cron räumt alle 15 Minuten (analog send-session-reminders) waitlist-
-- Einträge auf, deren Stunde bereits begonnen hat. Zusätzlich filtert der
-- Frontend-Code (checkWaitlistConflicts) bereits gestartete Stunden direkt
-- heraus, damit die Lücke bis zum nächsten Cron-Lauf nicht erneut zuschlägt.
--
-- p_dry_run (Default true, wie bei den anderen Cleanup-Funktionen dieser App):
-- true  -> nur zählen/melden, nichts löschen (admin_notifications-Eintrag)
-- false -> tatsächlich löschen + audit_log pro Eintrag
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cleanup_stale_waitlist_entries(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row       record;
  v_deleted   integer := 0;
  v_candidates integer := 0;
  v_details   jsonb;
BEGIN
  IF p_dry_run THEN
    SELECT count(*) INTO v_candidates
      FROM waitlist w
      JOIN sessions s ON s.id = w.session_id
     WHERE w.type = 'waitlist'
       AND ((s.date::timestamp + s.time_start) AT TIME ZONE 'Europe/Berlin') < now();

    SELECT jsonb_agg(jsonb_build_object(
             'waitlist_id', x.id,
             'user_id', x.user_id,
             'session_id', x.session_id,
             'session_date', x.date,
             'session_time', x.time_start
           ) ORDER BY x.date, x.time_start)
      INTO v_details
      FROM (
        SELECT w.id, w.user_id, w.session_id, s.date, s.time_start
          FROM waitlist w
          JOIN sessions s ON s.id = w.session_id
         WHERE w.type = 'waitlist'
           AND ((s.date::timestamp + s.time_start) AT TIME ZONE 'Europe/Berlin') < now()
      ) x;

    INSERT INTO admin_notifications (type, message, details, read)
    VALUES (
      'waitlist_stale_cleanup_dryrun',
      format('Trockenlauf Warteliste-Bereinigung: %s verwaiste Wartelisten-Eintraege (Stunde bereits gestartet) wuerden entfernt.', v_candidates),
      jsonb_build_object('candidate_count', v_candidates, 'dry_run', true, 'entries', COALESCE(v_details, '[]'::jsonb)),
      false
    );
    RETURN jsonb_build_object('dry_run', true, 'candidates', v_candidates, 'entries', COALESCE(v_details, '[]'::jsonb));
  END IF;

  FOR v_row IN
    SELECT w.id, w.user_id, w.session_id
      FROM waitlist w
      JOIN sessions s ON s.id = w.session_id
     WHERE w.type = 'waitlist'
       AND ((s.date::timestamp + s.time_start) AT TIME ZONE 'Europe/Berlin') < now()
  LOOP
    INSERT INTO audit_log (user_id, action, details)
    VALUES (
      v_row.user_id,
      'waitlist_stale_entry_removed',
      jsonb_build_object('waitlist_id', v_row.id, 'session_id', v_row.session_id, 'reason', 'session_started_not_promoted')
    );
    DELETE FROM waitlist WHERE id = v_row.id;
    v_deleted := v_deleted + 1;
  END LOOP;

  RETURN jsonb_build_object('dry_run', false, 'deleted', v_deleted);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_cleanup_stale_waitlist_entries(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cleanup_stale_waitlist_entries(boolean) TO service_role;

-- Alle 15 Minuten (gleiche Frequenz wie send-session-reminders) scharf (false).
-- Anders als beim Krankheits-Guthaben-Cron ist das Loeschen eines verwaisten
-- Wartelisten-Eintrags risikolos/nicht-finanziell -- daher kein manuelles
-- Scharfschalten noetig, direkt live.
SELECT cron.schedule(
  'cleanup-stale-waitlist-entries',
  '*/15 * * * *',
  $cron$ SELECT public.fn_cleanup_stale_waitlist_entries(false); $cron$
);
