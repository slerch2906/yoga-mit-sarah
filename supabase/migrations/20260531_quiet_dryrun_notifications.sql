-- ============================================================================
-- Trockenlauf-Cronjobs: Dashboard-Meldung NUR bei Treffer  —  (Sarah 2026-05-31)
-- ============================================================================
-- Sarah moechte ueber die "Trockenlauf"-Cronjobs nur dann eine Benachrichtigung
-- im Admin-Dashboard sehen, wenn auch wirklich etwas anliegt (Kandidaten > 0).
-- Vorher schrieben beide Funktionen IMMER eine admin_notification, auch bei 0
-- (z. B. "Trockenlauf Krankheits-Guthaben: 0 abgelaufene Guthaben ...").
--
-- Aenderung (minimal, sonst 1:1 wie zuvor):
--   A) fn_check_illness_credit_expiry: Dashboard-Meldung nur bei v_candidates > 0.
--   B) cleanup_inactive_accounts:       Dashboard-Meldung nur bei Kandidaten > 0.
--      Der audit_log-Eintrag ('inactivity_cleanup_dryrun') BLEIBT als stiller
--      "Cron lief"-Nachweis im Protokoll erhalten.
--
-- Unberuehrt: fn_check_guthaben_2y_expiry (meldet ohnehin nur bei echtem Ablauf).
-- ============================================================================

-- ── A) Krankheits-Guthaben (10-Monats-Trockenlauf) ──────────────────────────
CREATE OR REPLACE FUNCTION public.fn_check_illness_credit_expiry(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row        record;
  v_deleted    integer := 0;
  v_candidates integer := 0;
BEGIN
  IF p_dry_run THEN
    SELECT count(*) INTO v_candidates
      FROM credits
     WHERE source = 'illness' AND expires_at <= now();
    -- Nur melden, wenn wirklich etwas anliegt (Sarah 2026-05-31)
    IF v_candidates > 0 THEN
      INSERT INTO admin_notifications (type, message, details, read)
      VALUES (
        'illness_cleanup_dryrun',
        format('Trockenlauf Krankheits-Guthaben: %s abgelaufene Guthaben (10 Monate) wuerden geloescht.', v_candidates),
        jsonb_build_object('candidate_count', v_candidates, 'dry_run', true),
        false
      );
    END IF;
    RETURN jsonb_build_object('dry_run', true, 'candidates', v_candidates);
  END IF;

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

-- ── B) Inaktivitaets-Loeschung (24-Monats-Trockenlauf) ──────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_inactive_accounts(p_dry_run boolean DEFAULT true, p_limit integer DEFAULT 50, p_months integer DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids      uuid[];
  v_id       uuid;
  v_deleted  integer := 0;
  v_failed   integer := 0;
  v_is_admin boolean;
  v_count    integer := 0;
BEGIN
  SELECT array_agg(t.user_id) INTO v_ids
  FROM (
    SELECT user_id FROM public.find_inactive_accounts(p_months)
    LIMIT GREATEST(p_limit, 0)
  ) t;
  v_ids := COALESCE(v_ids, ARRAY[]::uuid[]);
  v_count := COALESCE(array_length(v_ids, 1), 0);

  IF p_dry_run THEN
    -- Dashboard-Meldung nur, wenn wirklich Konten loeschbar waeren (Sarah 2026-05-31)
    IF v_count > 0 THEN
      INSERT INTO public.admin_notifications(type, message, details)
      VALUES (
        'inactivity_cleanup_dryrun',
        format('Trockenlauf Inaktivitäts-Löschung: %s Konto(en) wären löschbar (>= %s Monate inaktiv).',
               v_count, p_months),
        jsonb_build_object('candidate_count', v_count, 'months', p_months, 'dry_run', true)
      );
    END IF;
    -- audit_log bleibt IMMER (stiller "Cron lief"-Nachweis im Protokoll)
    INSERT INTO public.audit_log(action, details)
    VALUES ('inactivity_cleanup_dryrun',
            jsonb_build_object('candidate_count', v_count, 'months', p_months));
    RETURN jsonb_build_object('dry_run', true, 'candidates', v_count);
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    BEGIN
      SELECT COALESCE(is_admin, false) INTO v_is_admin FROM public.profiles WHERE id = v_id;
      IF COALESCE(v_is_admin, true) THEN
        CONTINUE;
      END IF;

      UPDATE public.audit_log SET details = details
        - 'email' - 'user_email' - 'yogi_email' - 'yogi_name'
        - 'full_name' - 'first_name' - 'last_name' - 'ip_address' - 'user_agent'
      WHERE user_id = v_id;
      UPDATE public.audit_log SET user_id = NULL WHERE user_id = v_id;

      DELETE FROM public.waitlist                      WHERE user_id = v_id;
      DELETE FROM public.waitlist_offers               WHERE user_id = v_id OR resolved_winner_user_id = v_id;
      DELETE FROM public.bookings                       WHERE user_id = v_id;
      DELETE FROM public.credits                        WHERE user_id = v_id;
      DELETE FROM public.enrollments                    WHERE user_id = v_id;
      DELETE FROM public.notification_log               WHERE user_id = v_id;
      DELETE FROM public.course_cancellation_responses  WHERE user_id = v_id;
      DELETE FROM public.legal_acceptances              WHERE user_id = v_id;
      DELETE FROM public.yogi_notifications             WHERE user_id = v_id;

      INSERT INTO public.audit_log(action, details)
      VALUES ('yogi_auto_deleted_inactive', jsonb_build_object('months_inactive', p_months));

      DELETE FROM public.profiles WHERE id = v_id;
      DELETE FROM auth.users      WHERE id = v_id;

      v_deleted := v_deleted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      INSERT INTO public.audit_log(action, details)
      VALUES ('inactivity_cleanup_error', jsonb_build_object('error', SQLERRM));
    END;
  END LOOP;

  INSERT INTO public.admin_notifications(type, message, details)
  VALUES (
    'inactivity_cleanup',
    format('Inaktivitäts-Löschung ausgeführt: %s Konto(en) gelöscht, %s Fehler.', v_deleted, v_failed),
    jsonb_build_object('deleted', v_deleted, 'failed', v_failed, 'months', p_months, 'dry_run', false)
  );

  RETURN jsonb_build_object('dry_run', false, 'deleted', v_deleted, 'failed', v_failed);
END;
$function$;
