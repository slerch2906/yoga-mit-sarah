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
  const [sessionReady, setSessionReady] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  // Sarah 2026-05-22 (v3): robustes Bootstrapping für ALLE Recovery-Flow-Typen.
  //   - NEUER Pfad: ?token_hash=...&type=recovery → verifyOtp (cross-device + Brevo-safe)
  //   - PKCE-Flow: ?code=... in der URL → exchangeCodeForSession
  //   - Implicit-Flow: #access_token=...&refresh_token=... im URL-Hash → setSession
  //   - Bereits eingeloggt (regulärer "Passwort ändern" Pfad): existing session nutzen
  // Plus: sessionReady-Flag verhindert dass updateUser zu früh feuert (Race-Condition).
  //
  // Warum verifyOtp besser ist als action_link von Supabase:
  // - action_link nutzt PKCE → braucht code_verifier auf demselben Gerät/Browser, das den
  //   Reset ANGEFORDERT hat. Yogi fordert auf dem Handy an, klickt Link am Desktop → kaputt.
  // - verifyOtp mit token_hash als Query-Param: keine client-side state nötig, funktioniert
  //   geräteübergreifend, und Query-Params überleben Brevo-Click-Tracking-Redirects.
  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      if (typeof window === 'undefined') return
      const url = new URL(window.location.href)

      // 1) Reguläre Session schon da? (z.B. Yogi ändert Passwort über Profil)
      const { data: { session: existing } } = await supabase.auth.getSession()
      if (existing && !cancelled) { setSessionReady(true); return }

      // 2) NEUER Pfad: ?token_hash=...&type=recovery (verifyOtp)
      const tokenHash = url.searchParams.get('token_hash')
      const otpType = url.searchParams.get('type')
      if (tokenHash && otpType) {
        const { error: verifyErr } = await supabase.auth.verifyOtp({
          token_hash: tokenHash, type: otpType as any,
        })
        if (cancelled) return
        if (verifyErr) {
          setError('Der Reset-Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.')
          return
        }
        url.searchParams.delete('token_hash')
        url.searchParams.delete('type')
        const newSearch = url.searchParams.toString()
        window.history.replaceState(null, '', url.pathname + (newSearch ? '?' + newSearch : ''))
        setSessionReady(true)
        return
      }

      // 3) PKCE-Flow: ?code=... (Fallback für alte Links)
      const code = url.searchParams.get('code')
      if (code) {
        const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code)
        if (cancelled) return
        if (exchangeErr) {
          setError('Der Reset-Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.')
          return
        }
        url.searchParams.delete('code')
        window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash)
        setSessionReady(true)
        return
      }

      // 4) Implicit-Flow / Hash-Tokens: #access_token=...&refresh_token=...
      // (Supabase Recovery-Links können je nach Server-Config in diesem Format kommen)
      const rawHash = window.location.hash.startsWith('#')
        ? window.location.hash.substring(1) : ''
      if (rawHash) {
        const hashParams = new URLSearchParams(rawHash)
        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')
        const tokenType = hashParams.get('type')
        if (accessToken && refreshToken) {
          const { error: setErr } = await supabase.auth.setSession({
            access_token: accessToken, refresh_token: refreshToken,
          })
          if (cancelled) return
          if (setErr) {
            setError('Der Reset-Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.')
            return
          }
          // Hash aus URL entfernen
          window.history.replaceState(null, '', url.pathname + (url.search || ''))
          setSessionReady(true)
          return
        }
        // Fehler-Hash: ?error=...&error_description=...
        const errDesc = hashParams.get('error_description')
        if (errDesc) {
          setError(decodeURIComponent(errDesc.replace(/\+/g, ' ')))
          return
        }
      }

      // 5) Keine Session und kein Recovery-Token → User muss Link erneut anfordern
      setError('Bitte öffne diese Seite über den Link in deiner Reset-Email oder logge dich erneut ein.')
    }
    bootstrap()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setSessionReady(true)
      }
    })
    return () => { cancelled = true; subscription.unsubscribe() }
  }, [])

  async function handleSubmit() {
    // Welle S2/M8 (Sarah 2026-05-27): zentrale Passwort-Policy (Länge + Common-Block).
    const { validatePassword } = await import('@/lib/password-policy')
    const pwError = validatePassword(password)
    if (pwError) { setError(pwError); return }
    if (password !== confirm) { setError('Passwörter stimmen nicht überein.'); return }
    setLoading(true); setError('')

    // Defensiv: nochmal Session checken, falls Bootstrap noch nicht durch war.
    // Verhindert Race-Condition wo updateUser ohne Session-Context feuert.
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setError('Keine aktive Sitzung. Bitte klicke nochmal auf den Link in deiner Reset-Email.')
      setLoading(false)
      return
    }

    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) {
      if (err.message?.includes('session') || err.message?.includes('token') || err.status === 401) {
        setError('Sitzung abgelaufen. Bitte fordere einen neuen Reset-Link an.')
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
