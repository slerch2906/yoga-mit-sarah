'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function PasswortResetPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  // Supabase setzt den Access-Token via URL-Fragment beim Redirect
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'PASSWORD_RECOVERY') {
        // User ist jetzt authenticated via recovery token - ok
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit() {
    if (password.length < 8) { setError('Passwort muss mindestens 8 Zeichen haben.'); return }
    if (password !== confirm) { setError('Passwörter stimmen nicht überein.'); return }
    setLoading(true); setError('')

    // updateUser funktioniert sowohl für eingeloggte User als auch nach Reset-Link
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) {
      // Wenn Session ungültig: Reset-Link nötig
      if (err.message?.includes('session') || err.message?.includes('token') || err.status === 401) {
        setError('Sitzung abgelaufen. Bitte melde dich erneut an oder nutze den Passwort-Reset-Link.')
      } else {
        setError(err.message)
      }
      setLoading(false)
      return
    }
    setDone(true)
    setTimeout(() => router.replace('/profil'), 2000)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="https://yogamitsarah.me/wp-content/uploads/2025/09/Logo-300x300.png"
            alt="Yoga mit Sarah" className="w-20 h-20 object-contain mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-yoga-text mb-1">Neues Passwort</h1>
          <p className="text-sm text-yoga-text/50">Bitte gib dein neues Passwort ein.</p>
        </div>

        {done ? (
          <div className="card text-center">
            <div className="text-4xl mb-3"></div>
            <p className="font-semibold">Passwort geändert!</p>
            <p className="text-sm text-yoga-text/50 mt-1">Du wirst weitergeleitet...</p>
          </div>
        ) : (
          <div className="card space-y-4">
            <div>
              <label className="field-label">Neues Passwort</label>
              <input type="password" className="field-input" value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mindestens 8 Zeichen" />
            </div>
            <div>
              <label className="field-label">Passwort bestätigen</label>
              <input type="password" className="field-input" value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Passwort wiederholen"
                onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button onClick={handleSubmit} disabled={loading}
              className="btn-primary w-full disabled:opacity-40">
              {loading ? 'Wird gespeichert...' : 'Passwort speichern'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
