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
  const [showPw, setShowPw] = useState(false)
  const [showPw2, setShowPw2] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  // Sarah 2026-05-22: @supabase/ssr 0.3.x nutzt PKCE-Flow. Recovery-Link redirected
  // mit ?code=<auth_code> — den müssen wir explizit gegen eine Session tauschen,
  // sonst bleibt der User unauthenticated und updateUser failed mit "Session abgelaufen".
  // Eingeloggte User (regulärer Passwort-Ändern-Pfad) haben kein ?code — dort wird der
  // Exchange übersprungen und die bestehende Session genutzt.
  useEffect(() => {
    let cancelled = false
    async function exchangeIfRecovery() {
      if (typeof window === 'undefined') return
      const url = new URL(window.location.href)
      const code = url.searchParams.get('code')
      if (!code) return
      const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code)
      if (cancelled) return
      if (exchangeErr) {
        setError('Der Reset-Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.')
        return
      }
      // ?code aus URL entfernen damit Reload nicht erneut tauscht (Token ist single-use)
      url.searchParams.delete('code')
      window.history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash)
    }
    exchangeIfRecovery()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        // User ist jetzt authenticated via recovery — der Exchange oben hat schon geklappt
      }
    })
    return () => { cancelled = true; subscription.unsubscribe() }
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
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} className="field-input pr-12" value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Mindestens 8 Zeichen" />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-yoga-text/40 hover:text-yoga-text/70 transition-colors"
                  aria-label={showPw ? 'Passwort verbergen' : 'Passwort anzeigen'}>
                  <i className={`ti ${showPw ? 'ti-eye-off' : 'ti-eye'} text-xl`} />
                </button>
              </div>
            </div>
            <div>
              <label className="field-label">Passwort bestätigen</label>
              <div className="relative">
                <input type={showPw2 ? 'text' : 'password'} className="field-input pr-12" value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Passwort wiederholen"
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
                <button type="button" onClick={() => setShowPw2(!showPw2)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-yoga-text/40 hover:text-yoga-text/70 transition-colors"
                  aria-label={showPw2 ? 'Passwort verbergen' : 'Passwort anzeigen'}>
                  <i className={`ti ${showPw2 ? 'ti-eye-off' : 'ti-eye'} text-xl`} />
                </button>
              </div>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button onClick={handleSubmit} disabled={loading}
              className="btn-primary w-full disabled:opacity-40">
              {loading ? 'Wird gespeichert...' : 'Passwort speichern'}
            </button>
            <button onClick={() => router.push('/profil')} disabled={loading}
              className="btn-secondary w-full">
              Abbrechen
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
