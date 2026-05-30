-- ============================================================================
-- Automatische Löschung inaktiver Konten (24 Monate)  —  Phase 2 (2026-05-30)
-- ============================================================================
-- Sarah-Wunsch 2026-05-30: DSGVO-Härtung + App "lean" halten.
-- Konzept siehe SYSTEM_DOCUMENTATION.md, Abschnitt 7.
--
-- SICHERHEIT / LEITPLANKEN:
--   * find_inactive_accounts() ist READ-ONLY und schließt ADMINS HART AUS
--     (is_admin = false) sowie bereits anonymisierte Profile ('Gelöschter').
--   * Konten mit offenen Credits/Guthaben ODER zukünftigen aktiven Buchungen
--     werden NIEMALS gelöscht.
--   * cleanup_inactive_accounts() läuft per Default als TROCKENLAUF
--     (p_dry_run = true): es wird NICHTS gelöscht, nur eine Admin-Meldung +
--     Audit-Eintrag geschrieben. Der wöchentliche Cron ruft NUR den Trockenlauf.
--   * Scharfes Löschen passiert ausschließlich bei explizitem Aufruf mit
--     p_dry_run = false. Defense-in-Depth: im Lösch-Loop wird pro Konto erneut
--     is_admin geprüft; ein Fehler bei einem Konto bricht den Batch nicht ab.
-- ============================================================================

-- 1) Lese-Funktion: Lösch-Kandidaten ermitteln (admin-sicher, read-only)
CREATE OR REPLACE FUNCTION public.find_inactive_accounts(p_months integer DEFAULT 24)
RETURNS TABLE(user_id uuid, last_sign_in_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.last_sign_in_at
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE COALESCE(p.is_admin, false) = false
    AND p.first_name IS DISTINCT FROM 'Gelöschter'
    AND u.last_sign_in_at IS NOT NULL
    AND u.last_sign_in_at < now() - make_interval(months => GREATEST(p_months, 1))
    AND NOT EXISTS (
      SELECT 1 FROM public.credits c
      WHERE c.user_id = u.id AND c.total > c.used AND c.expires_at > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.sessions s ON s.id = b.session_id
      WHERE b.user_id = u.id AND b.status = 'active' AND s.date >= current_date
    );
$$;

-- 2) Cleanup-Funktion: Default = Trockenlauf (löscht NICHTS)
CREATE OR REPLACE FUNCTION public.cleanup_inactive_accounts(
  p_dry_run boolean DEFAULT true,
  p_limit   integer DEFAULT 50,
  p_months  integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids      uuid[];
  v_id       uuid;
  v_deleted  integer := 0;
  v_failed   integer := 0;
  v_is_admin boolean;
BEGIN
  SELECT array_agg(t.user_id) INTO v_ids
  FROM (
    SELECT user_id FROM public.find_inactive_accounts(p_months)
    LIMIT GREATEST(p_limit, 0)
  ) t;
  v_ids := COALESCE(v_ids, ARRAY[]::uuid[]);

  -- ── TROCKENLAUF: nur melden, NICHT löschen ────────────────────────────────
  IF p_dry_run THEN
    INSERT INTO public.admin_notifications(type, message, details)
    VALUES (
      'inactivity_cleanup_dryrun',
      format('Trockenlauf Inaktivitäts-Löschung: %s Konto(en) wären löschbar (>= %s Monate inaktiv).',
             COALESCE(array_length(v_ids, 1), 0), p_months),
      jsonb_build_object('candidate_count', COALESCE(array_length(v_ids, 1), 0),
                         'months', p_months, 'dry_run', true)
    );
    INSERT INTO public.audit_log(action, details)
    VALUES ('inactivity_cleanup_dryrun',
            jsonb_build_object('candidate_count', COALESCE(array_length(v_ids, 1), 0), 'months', p_months));
    RETURN jsonb_build_object('dry_run', true, 'candidates', COALESCE(array_length(v_ids, 1), 0));
  END IF;

  -- ── SCHARF: tatsächlich löschen (nur bei explizitem p_dry_run = false) ─────
  FOREACH v_id IN ARRAY v_ids LOOP
    BEGIN
      -- Defense-in-Depth: niemals einen Admin (oder ein fehlendes Profil) löschen
      SELECT COALESCE(is_admin, false) INTO v_is_admin FROM public.profiles WHERE id = v_id;
      IF COALESCE(v_is_admin, true) THEN
        CONTINUE;
      END IF;

      -- a) PII aus audit_log.details entfernen, Trail strukturell behalten
      UPDATE public.audit_log SET details = details
        - 'email' - 'user_email' - 'yogi_email' - 'yogi_name'
        - 'full_name' - 'first_name' - 'last_name' - 'ip_address' - 'user_agent'
      WHERE user_id = v_id;
      -- b) Audit-Zeilen vom User entkoppeln (kein FK-Block beim Auth-Delete)
      UPDATE public.audit_log SET user_id = NULL WHERE user_id = v_id;

      -- c) abhängige Daten hart löschen
      DELETE FROM public.waitlist                      WHERE user_id = v_id;
      DELETE FROM public.waitlist_offers               WHERE user_id = v_id OR resolved_winner_user_id = v_id;
      DELETE FROM public.bookings                       WHERE user_id = v_id;
      DELETE FROM public.credits                        WHERE user_id = v_id;
      DELETE FROM public.enrollments                    WHERE user_id = v_id;
      DELETE FROM public.notification_log               WHERE user_id = v_id;
      DELETE FROM public.course_cancellation_responses  WHERE user_id = v_id;
      DELETE FROM public.legal_acceptances              WHERE user_id = v_id;
      DELETE FROM public.yogi_notifications             WHERE user_id = v_id;

      -- d) Audit der Auto-Löschung (ohne personenbezogene Daten)
      INSERT INTO public.audit_log(action, details)
      VALUES ('yogi_auto_deleted_inactive', jsonb_build_object('months_inactive', p_months));

      -- e) Profil + Auth-User entfernen
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
$$;

-- 3) Rechte: nur service_role (+ Owner). Kein PUBLIC / anon / authenticated.
REVOKE ALL ON FUNCTION public.find_inactive_accounts(integer)                     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_inactive_accounts(boolean, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_inactive_accounts(integer)                     TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_inactive_accounts(boolean, integer, integer) TO service_role;

-- 4) Wöchentlicher Cron (Montag 03:00 UTC) — ruft den TROCKENLAUF.
--    Scharfschalten später durch Ändern des Aufrufs auf (false, 50, 24).
--    Hinweis: cron.schedule ist idempotent pro Jobname (Update bei Wiederholung).
SELECT cron.schedule(
  'cleanup-inactive-accounts',
  '0 3 * * 1',
  $cron$ SELECT public.cleanup_inactive_accounts(true, 50, 24); $cron$
);
