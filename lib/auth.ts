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

    const timeoutPromise = new Promise<null>((resolve) => 
      setTimeout(() => resolve(null), 5000)
    )

    const result = await Promise.race([profilePromise, timeoutPromise])
    
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
