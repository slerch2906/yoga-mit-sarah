import { createClient } from './supabase/client'

/**
 * Sauberer Logout:
 * - Beendet alle Sessions server-seitig
 * - Leert lokalen Auth-State
 * - Macht hard redirect zur Login-Seite
 *
 * Der Schutz gegen Zurück-Wischen läuft über das middleware.ts,
 * das jeden authentifizierten Pfad ohne gültige Session direkt
 * auf /login umleitet. Das ist die saubere Lösung.
 */
export async function fullLogout() {
  const supabase = createClient()

  // 1) Alle Sessions auf Server beenden
  await supabase.auth.signOut({ scope: 'global' }).catch(() => {})

  // 2) Browser-State leeren
  try { localStorage.clear() } catch {}
  try { sessionStorage.clear() } catch {}

  // 3) Supabase-Cookies löschen
  document.cookie.split(';').forEach(c => {
    const key = c.trim().split('=')[0]
    if (key.includes('supabase') || key.includes('sb-')) {
      document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
      document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname}`
    }
  })

  // 4) Hard redirect (Browser baut Page komplett neu auf, middleware prüft Session)
  window.location.href = '/login'
}
