'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fullLogout } from '@/lib/logout'
import { Email } from '@/lib/email'

const ADMIN_EMAIL = 'slerch2906@gmail.com'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const supabase = createClient()

  // Beim Laden der Login-Seite immer alte Session komplett löschen
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.signOut({ scope: 'global' }).catch(() => {})
    // Alle Supabase Cookies löschen
    document.cookie.split(';').forEach(c => {
      const key = c.trim().split('=')[0]
      if (key.includes('supabase') || key.includes('sb-')) {
        document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
      }
    })
    localStorage.clear()
    sessionStorage.clear()
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('E-Mail oder Passwort falsch. Bitte nochmal versuchen.')
      setLoading(false)
      return
    }

    // Weiterleitung – loading bleibt true während Redirect
    if (data.user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      window.location.replace('/admin/dashboard')
    } else {
      window.location.replace('/kurse')
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await Email.passwordResetRequest({ email })
    setResetSent(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="https://yogamitsarah.me/wp-content/uploads/2025/09/Logo-300x300.png" alt="Yoga mit Sarah"
            className="w-24 h-24 object-contain mx-auto mb-4"
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'https://yogamitsarah.me/wp-content/uploads/2025/09/Logo-300x300.png'
            }} />
          <h1 className="text-2xl font-bold text-yoga-text mb-1">Yoga mit Sarah</h1>
          <p className="text-sm text-yoga-text/50">
            {showReset ? 'Passwort zurücksetzen' : 'Melde dich an'}
          </p>
        </div>

        {!showReset ? (
          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label className="field-label">E-Mail-Adresse</label>
              <input className="field-input" type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="deine@email.de" required
                disabled={loading} />
            </div>
            <div>
              <label className="field-label">Passwort</label>
              <div className="relative">
                <input className="field-input pr-12"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" required
                  disabled={loading} />
                <button type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-yoga-text/40 hover:text-yoga-text/70 transition-colors">
                  <i className={`ti ${showPassword ? 'ti-eye-off' : 'ti-eye'} text-xl`} />
                </button>
              </div>
            </div>
            {error && (
              <div className="bg-yoga-red-bg text-yoga-red-text text-sm p-3 rounded-yoga">{error}</div>
            )}
            <button type="submit" className="btn-primary mt-2"
              disabled={loading}>
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <i className="ti ti-loader-2 animate-spin" /> Wird angemeldet...
                </span>
              ) : 'Anmelden'}
            </button>
            {!loading && (
              <button type="button" onClick={() => setShowReset(true)}
                className="w-full text-center text-sm text-yoga-text/50 mt-2 hover:opacity-80">
                Passwort vergessen?
              </button>
            )}
          </form>
        ) : (
          <form onSubmit={handleReset} className="space-y-3">
            {resetSent ? (
              <div className="bg-yoga-green-bg text-yoga-green-text text-sm p-4 rounded-yoga text-center">
                 Reset-Link wurde geschickt. Bitte prüfe deine E-Mails.
              </div>
            ) : (
              <>
                <div>
                  <label className="field-label">Deine E-Mail-Adresse</label>
                  <input className="field-input" type="email" value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="deine@email.de" required />
                </div>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Wird gesendet...' : 'Reset-Link senden'}
                </button>
              </>
            )}
            <button type="button"
              onClick={() => { setShowReset(false); setResetSent(false) }}
              className="w-full text-center text-sm text-yoga-text/50 hover:opacity-80">
              ← Zurück zum Login
            </button>
          </form>
        )}

        <p className="text-center text-sm text-yoga-text/40 mt-8 leading-relaxed">
          Noch kein Konto? Du benötigst einen<br />persönlichen Einladungslink von Sarah.
        </p>
      </div>
    </div>
  )
}
