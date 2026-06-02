-- Sarah 2026-06-02: FEHLENDE Tabellen-Rechte nachziehen. Beim Anlegen von
-- user_dismissals wurden die GRANTs fuer die authenticated-Rolle nicht gesetzt.
-- Folge: Postgres blockte JEDEN Client-Zugriff bereits auf GRANT-Ebene (vor der
-- RLS-Policy) -> Wegklicken von Hinweisen wurde nie gespeichert oder gelesen
-- (Banner kamen immer wieder). RLS bleibt aktiv und begrenzt weiter auf die
-- eigenen Zeilen (auth.uid() = user_id).
grant select, insert on public.user_dismissals to authenticated;
