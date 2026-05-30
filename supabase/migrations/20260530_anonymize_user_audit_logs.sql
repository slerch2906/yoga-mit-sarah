-- ============================================================================
-- anonymize_user_audit_logs  —  Versionierung der LIVE-Funktion (Phase 2)
-- ============================================================================
-- Sarah Phase 2 (2026-05-30): Diese RPC existierte bisher nur in der Live-
-- Supabase-Datenbank und war NICHT im Repo versioniert. Sie wird hier 1:1
-- (unveraendert) aus der Live-DB abgebildet, damit sie sauber unter
-- Versionskontrolle steht.
--
-- WICHTIG / KEINE FUNKTIONALE AENDERUNG:
--   * Der Funktionskoerper ist exakt der aus der Live-DB ausgelesene
--     (pg_get_functiondef). Es wird NICHTS am Verhalten geaendert.
--   * CREATE OR REPLACE + die GRANTs entsprechen exakt dem aktuellen Live-Stand
--     (ACL: postgres=X, service_role=X). Ein erneutes Anwenden dieser Migration
--     ist daher ein No-Op.
--   * Aufgerufen wird die Funktion bei der DSGVO-Selbstloeschung
--     (app/profil/page.tsx → handleDeleteAccount) sowie im Admin-Loeschpfad,
--     um personenbezogene Felder aus audit_log.details (JSONB) zu entfernen,
--     ohne den strukturellen Audit-Trail zu zerstoeren.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.anonymize_user_audit_logs(target_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_is_admin boolean;
  v_count integer := 0;
BEGIN
  -- Nur Admin oder der User selbst (für /profil-Self-Delete) darf aufrufen
  SELECT COALESCE(is_admin, false) INTO v_caller_is_admin
  FROM profiles WHERE id = auth.uid();

  IF NOT v_caller_is_admin AND auth.uid() <> target_user_id THEN
    RAISE EXCEPTION 'Nicht berechtigt';
  END IF;

  -- Sensible Felder aus details JSONB entfernen
  UPDATE audit_log
  SET details = details
    - 'email'
    - 'user_email'
    - 'yogi_email'
    - 'yogi_name'
    - 'full_name'
    - 'first_name'
    - 'last_name'
    - 'ip_address'
    - 'user_agent'
  WHERE user_id = target_user_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Rechte exakt wie im Live-Stand (ACL: postgres=X/postgres, service_role=X/postgres).
-- SECURITY DEFINER laeuft mit den Rechten des Owners (postgres); ausfuehren darf
-- es die service_role (server-/edge-seitig) bzw. der Owner.
REVOKE ALL ON FUNCTION public.anonymize_user_audit_logs(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.anonymize_user_audit_logs(uuid) TO service_role;
