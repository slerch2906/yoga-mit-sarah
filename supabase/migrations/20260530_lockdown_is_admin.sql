-- Security-Fix (Sarah 2026-05-30, Pre-Go-Live-Audit): Privilege-Escalation schließen.
-- ----------------------------------------------------------------------------
-- BEFUND: Die profiles-UPDATE-RLS-Policy erlaubt die EIGENE Zeile
--   (auth.uid() = id). RLS ist aber zeilen-, NICHT spaltenbasiert. Da 'authenticated'
--   Spalten-UPDATE auf profiles.is_admin hat und KEIN schützender Trigger existierte,
--   konnte sich JEDER eingeloggte Yogi selbst zum Admin machen:
--       supabase.from('profiles').update({ is_admin: true }).eq('id', <eigene_id>)
--   → vollständige Admin-Übernahme, unabhängig vom clientseitigen UI-Guard.
--
-- KEIN App-Pfad schreibt is_admin clientseitig (verifiziert per Code-Scan); Admins
-- werden ausschließlich serverseitig (service_role / SQL) gesetzt. Der Entzug des
-- Spalten-Schreibrechts ist daher gefahrlos.
--
-- FIX (zwei Schichten):
--   1) Spalten-Schreibrecht auf is_admin für authenticated + anon entziehen.
--   2) Defense-in-Depth: BEFORE-UPDATE-Trigger, der eine is_admin-Änderung durch
--      einen eingeloggten Nicht-Admin hart blockt (greift auch, falls Grants driften).
--      service_role / serverseitige Pfade (auth.uid() IS NULL) bleiben erlaubt,
--      ebenso ein bereits eingeloggter Admin.

-- 1) Grant-Ebene: tabellenweites UPDATE entziehen und alle Spalten AUSSER is_admin
--    neu granten. (Ein reines `REVOKE UPDATE (is_admin)` greift NICHT, solange das
--    tabellenweite UPDATE-Grant existiert — letzteres deckt alle Spalten ab.)
REVOKE UPDATE (is_admin) ON public.profiles FROM authenticated, anon;
REVOKE UPDATE ON public.profiles FROM authenticated;
DO $do$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ')
    INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name <> 'is_admin';
  EXECUTE format('GRANT UPDATE (%s) ON public.profiles TO authenticated', cols);
END
$do$;

-- 2) Schutz-Trigger
CREATE OR REPLACE FUNCTION public.prevent_self_admin_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    -- Serverseitige Pfade ohne User-JWT (service_role, Cron, Setup-Skripte) erlaubt.
    IF auth.uid() IS NULL THEN
      RETURN NEW;
    END IF;
    -- Nur ein bereits eingeloggter Admin darf Admin-Rechte ändern.
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Nicht erlaubt: is_admin kann nicht selbst gesetzt werden.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prevent_self_admin_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_self_admin_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_admin_escalation();
