import { useEffect } from 'react'
import { createClient } from './supabase/client'
import { getCurrentUser } from './auth'

export function useLegalCheck() {
  useEffect(() => {
    async function check() {
      const user = await getCurrentUser()
      if (!user) { window.location.href = '/login'; return }
      const supabase = createClient()
      const { data: prof } = await supabase
        .from('profiles').select('legal_accepted_at').eq('id', user.id).single()
      if (prof && !prof.legal_accepted_at) {
        window.location.href = '/rechtliches'
      }
    }
    check()
  }, [])
}
