-- ============================================================================
-- Krankheits-Guthaben: 10-Monats-Hard-Delete  —  (Sarah 2026-05-30)
-- ============================================================================
-- Strikte Trennung der Guthaben-Pfade:
--   A) KRANKHEIT (source = 'illness'): laeuft 10 Monate nach Attest-Datum HART ab
--      und wird danach AUTOMATISCH UND ERSATZLOS GELOESCHT (kein Geld, keine
--      Auszahlung). Diese Funktion + Cron erledigen das. 4 Wochen vorher sieht
--      der Yogi im Kalender einen Hinweis (YogiCreditExpiryBanner).
--   B) KURSABBRUCH (source = 'cancellation_choice'): 2 Jahre gueltig; bei Ablauf
--      NICHT loeschen, sondern automatische Auszahlung + Mail
--      (fn_check_guthaben_2y_expiry, bereits vorhanden).
--
-- SICHERHEIT: Default p_dry_run = true (Trockenlauf, loescht NICHTS, schreibt nur
-- eine Admin-Meldung). Der woechentliche/taegliche Cron ruft den Trockenlauf.
-- Scharfschalten = Cron-Aufruf auf fn_check_illness_credit_expiry(false) aendern.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_check_illness_credit_expiry(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row        record;
  v_deleted    integer := 0;
  v_candidates integer := 0;
BEGIN
  -- ── TROCKENLAUF: nur melden, NICHT loeschen ───────────────────────────────
  IF p_dry_run THEN
    SELECT count(*) INTO v_candidates
      FROM credits
     WHERE source = 'illness' AND expires_at <= now();
    INSERT INTO admin_notifications (type, message, details, read)
    VALUES (
      'illness_cleanup_dryrun',
      format('Trockenlauf Krankheits-Guthaben: %s abgelaufene Guthaben (10 Monate) wuerden geloescht.', v_candidates),
      jsonb_build_object('candidate_count', v_candidates, 'dry_run', true),
      false
    );
    RETURN jsonb_build_object('dry_run', true, 'candidates', v_candidates);
  END IF;

  -- ── SCHARF: abgelaufene Krankheits-Guthaben ersatzlos loeschen ────────────
  FOR v_row IN
    SELECT id, user_id, (total - used) AS unused
      FROM credits
     WHERE source = 'illness' AND expires_at <= now()
  LOOP
    INSERT INTO audit_log (user_id, action, details)
    VALUES (
      v_row.user_id,
      'illness_credit_expired',
      jsonb_build_object('credit_id', v_row.id, 'unused_credits', v_row.unused)
    );
    DELETE FROM credits WHERE id = v_row.id;
    v_deleted := v_deleted + 1;
  END LOOP;

  RETURN jsonb_build_object('dry_run', false, 'deleted', v_deleted);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_check_illness_credit_expiry(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_check_illness_credit_expiry(boolean) TO service_role;

-- Taeglicher Cron (05:00) — ruft den TROCKENLAUF. Scharfschalten: (false) statt (true).
SELECT cron.schedule(
  'check-illness-credit-expiry',
  '0 5 * * *',
  $cron$ SELECT public.fn_check_illness_credit_expiry(true); $cron$
);
