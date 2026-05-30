-- Security-Fix #2 — Teil B (Sarah 2026-05-30): Yogi-Schreibrecht auf credits/enrollments entziehen.
-- ----------------------------------------------------------------------------
-- ERST ANWENDEN, NACHDEM die Register-Seite auf consume_invitation_enrollment
-- umgestellt und deployt ist (sonst bricht die alte Register-Auto-Einbuchung).
--
-- Schließt:
--   #2 Credit-Selbstgutschrift  — Policy „Credits bearbeiten" (ALL, user_id=auth.uid()) entfernt.
--   #4 Self-Enroll              — Policy „Eigene Einbuchung anlegen" (INSERT) entfernt.
--
-- Es bleiben erhalten:
--   - SELECT-eigene (Yogi sieht seine Credits/Einschreibungen): „Credits lesen",
--     „Eigene Einbuchungen lesen".
--   - Admin-Vollzugriff: „Admin verwaltet Credits/Einbuchungen" (is_admin()).
--   - Account-Löschung darf eigene Zeilen löschen → neue DELETE-eigene-Policies.
--   - Register-Auto-Einbuchung läuft jetzt über die SECURITY-DEFINER-RPC
--     consume_invitation_enrollment (umgeht RLS server-validiert).

-- credits: ALL-Self-Policy raus, DELETE-eigene rein
DROP POLICY IF EXISTS "Credits bearbeiten" ON public.credits;
CREATE POLICY "Yogi loescht eigene Credits" ON public.credits
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- enrollments: Self-INSERT raus, DELETE-eigene rein
DROP POLICY IF EXISTS "Eigene Einbuchung anlegen" ON public.enrollments;
CREATE POLICY "Yogi loescht eigene Einbuchung" ON public.enrollments
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
