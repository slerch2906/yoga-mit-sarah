-- Robustheits-Fix (Sarah/ChatGPT 2026-05-30): Inaktivität nicht nur an last_sign_in_at messen.
-- ----------------------------------------------------------------------------
-- BEFUND: find_inactive_accounts() stufte Konten allein nach
--   auth.users.last_sign_in_at ein. Ein aktiver PWA-Nutzer mit langlebiger Session,
--   der die App regelmäßig benutzt aber nie NEU einloggt, hätte ein altes
--   last_sign_in_at — und sähe fälschlich „inaktiv" aus.
--   (Mildernd griffen bereits: kein ungenutztes Guthaben + keine aktive Zukunfts-
--   buchung als zusätzliche Ausschlüsse. Aber das Signal selbst blieb schwach.)
--
-- FIX: „Aktiv-bis" = GREATEST(last_sign_in_at, letzte protokollierte Yogi-Aktion).
--   Das audit_log erfasst JEDE Buchung/Storno/Warteliste/Credit-Aktion des Yogis
--   (Akteur = audit_log.user_id bzw. details->>'user_id') → robustes Aktivitäts-
--   signal OHNE neue Spalte. Der Cron bleibt unverändert im Trockenlauf.
--   (Stufe B — passives Browsen via profiles.last_activity_at — bewusst separat.)

CREATE OR REPLACE FUNCTION public.find_inactive_accounts(p_months integer DEFAULT 24)
 RETURNS TABLE(user_id uuid, last_sign_in_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT u.id, u.last_sign_in_at
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE COALESCE(p.is_admin, false) = false
    AND p.first_name IS DISTINCT FROM 'Gelöschter'
    AND u.last_sign_in_at IS NOT NULL
    -- Robustes Aktivitätssignal: spätester Zeitpunkt aus Login UND letzter Aktion.
    AND GREATEST(
          u.last_sign_in_at,
          COALESCE((
            SELECT max(a.created_at)
            FROM public.audit_log a
            WHERE a.user_id = u.id
               OR a.details->>'user_id' = u.id::text
          ), u.last_sign_in_at)
        ) < now() - make_interval(months => GREATEST(p_months, 1))
    -- Schutz (unverändert): kein ungenutztes gültiges Guthaben ...
    AND NOT EXISTS (
      SELECT 1 FROM public.credits c
      WHERE c.user_id = u.id AND c.total > c.used AND c.expires_at > now()
    )
    -- ... und keine aktive zukünftige Buchung.
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.sessions s ON s.id = b.session_id
      WHERE b.user_id = u.id AND b.status = 'active' AND s.date >= current_date
    );
$function$;
