'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    // Recovery-Token aus Supabase Redirect erkennen und korrekt weiterleiten.
    // Fragment-Beispiel: #access_token=...&refresh_token=...&type=recovery
    if (typeof window !== 'undefined' && window.location.hash.includes('type=recovery')) {
      window.location.replace('/profil/passwort' + window.location.hash)
      return
    }
    router.replace('/kurse')
  }, [router])

  return null
}
