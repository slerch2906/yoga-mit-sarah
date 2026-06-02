-- Sarah 2026-06-02: Geburtstags-Banner-Dismiss geraeteuebergreifend + logout-fest.
-- Vorher wurde das Wegklicken nur in localStorage gemerkt -> bei localStorage.clear()
-- (Logout) oder auf anderem Geraet/Browser kam das Banner wieder. Jetzt pro
-- Kalenderwoche in der DB persistiert. Admin-only.

CREATE TABLE IF NOT EXISTS public.admin_banner_dismissals (
  banner text NOT NULL,
  week date NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (banner, week)
);

ALTER TABLE public.admin_banner_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin read banner dismissals" ON public.admin_banner_dismissals;
CREATE POLICY "admin read banner dismissals"
  ON public.admin_banner_dismissals FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin insert banner dismissals" ON public.admin_banner_dismissals;
CREATE POLICY "admin insert banner dismissals"
  ON public.admin_banner_dismissals FOR INSERT
  WITH CHECK (public.is_admin());
