import { createClient } from './supabase/client'

export async function getCurrentUser() {
  if (typeof window === 'undefined') return null
  const supabase = createClient()

  try {
    // getUser() fragt den Server – verhindert dass gecachte Sessions nach Logout genutzt werden
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      // Lokalen Cache auch leeren
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      return null
    }
    const session = { user }

    const profilePromise = supabase
      .from('profiles')
      .select('id, first_name')
      .eq('id', session.user.id)
      .single()

    // Welle S3/N8 (Sarah 2026-05-27): Timeout-Helper rumte vorher 5s lang
    // im Hintergrund weiter, auch wenn die echte Query schon zurueck war.
    // Jetzt: clearTimeout sobald die Profile-Query auf Tour ist.
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const profileRaced = profilePromise.then((v) => {
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }
      return v
    })
    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), 5000)
    })

    const result = await Promise.race([profileRaced, timeoutPromise])
    
    if (result === null) return session.user

    const { data: profile } = result as any
    if (!profile) {
      // Profil fehlt → sofort ausloggen
      await supabase.auth.signOut({ scope: 'global' }).catch(() => {})
      localStorage.clear()
      sessionStorage.clear()
      window.location.replace('/login')
      return null
    }

    // Anonymisiertes DSGVO-Profil → sofort ausloggen (verhindert Rückkehr nach Löschung)
    if (profile.first_name === 'Gelöschter') {
      await supabase.auth.signOut({ scope: 'global' }).catch(() => {})
      localStorage.clear()
      sessionStorage.clear()
      window.location.replace('/login')
      return null
    }

    return user
  } catch (e) {
    // Bei jedem Fehler: kein Zugang gewähren
    return null
  }
}
