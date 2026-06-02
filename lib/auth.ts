import { createClient } from './supabase/client'

/**
 * Sarah 2026-06-02: Session-Stabilität. Vorher loggte diese Funktion bei jedem
 * kleinen Hänger aus (teils global über alle Geräte) — Yogis UND Admin flogen
 * ständig raus. Neu:
 *  - getSession() statt getUser(): refresht den Access-Token automatisch
 *    (getUser() refresht NICHT → nach ~1h Token-Ablauf gab es Logout).
 *  - Ausloggen NUR bei eindeutigem Befund (Profil existiert wirklich nicht, oder
 *    DSGVO-gelöschtes Konto). Transiente Fehler (Netz/Timeout/Server-Blip) lassen
 *    die Session UNANGETASTET.
 *  - Kein automatischer scope:'global' mehr (außer beim DSGVO-Konto). Automatische
 *    Checks beenden höchstens die lokale Session.
 * Sessions bleiben damit stabil bis zum manuellen Logout.
 */
export async function getCurrentUser() {
  if (typeof window === 'undefined') return null
  const supabase = createClient()

  try {
    // getSession() liest die Session und refresht den Token bei Bedarf automatisch.
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return null
    const user = session.user

    // Profil prüfen — mit 5s-Timeout, damit eine hängende Query die Seite nicht blockt.
    const profilePromise = supabase
      .from('profiles')
      .select('id, first_name')
      .eq('id', user.id)
      .maybeSingle()

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timeoutId = setTimeout(() => resolve('timeout'), 5000)
    })
    const raced = await Promise.race([
      profilePromise.then((v) => { if (timeoutId) { clearTimeout(timeoutId); timeoutId = null } return v }),
      timeoutPromise,
    ])

    // Timeout → Session behalten, NICHT ausloggen.
    if (raced === 'timeout') return user

    const { data: profile, error } = raced as any

    // Transienter Fehler (Netz/Timeout/RLS-Blip) → Session behalten, NICHT ausloggen.
    if (error) return user

    // maybeSingle ohne Fehler und data=null → Profil existiert wirklich nicht (abnormal).
    if (!profile) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      try { localStorage.clear() } catch {}
      try { sessionStorage.clear() } catch {}
      window.location.replace('/login')
      return null
    }

    // DSGVO-anonymisiertes Konto → global ausloggen (verhindert Rückkehr nach Löschung).
    if (profile.first_name === 'Gelöschter') {
      await supabase.auth.signOut({ scope: 'global' }).catch(() => {})
      try { localStorage.clear() } catch {}
      try { sessionStorage.clear() } catch {}
      window.location.replace('/login')
      return null
    }

    return user
  } catch (e) {
    // Unerwarteter Fehler: Session NICHT zerstören (kein signOut/clear). Nur keinen
    // Zugriff gewähren — beim nächsten Versuch ist die gültige Session wieder da.
    return null
  }
}
