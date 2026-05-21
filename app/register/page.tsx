'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Email } from '@/lib/email'

function RegisterInner() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [invitation, setInvitation] = useState<any>(null)
  const [checking, setChecking] = useState(true)
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  useEffect(() => {
    if (!token) { router.push('/login'); return }

    async function loadInvitation() {
      const supabase = createClient()

      // Direkt via REST laden - umgeht Auth-State-Probleme
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      const res = await fetch(
        `${supabaseUrl}/rest/v1/invitations?token=eq.${token}&select=*,course:courses(name,total_units)`,
        { headers: { 'apikey': supabaseKey!, 'Authorization': `Bearer ${supabaseKey}` } }
      )
      const rows = await res.json()
      const data = Array.isArray(rows) && rows.length > 0 ? rows[0] : null
      const fetchError = !res.ok

      if (fetchError || !data) {
        setError('Einladungslink ungültig. Bitte wende dich an Sarah.')
        setChecking(false)
        return
      }
      if (data.used) {
        setError('Dieser Einladungslink wurde bereits verwendet.')
        setChecking(false)
        return
      }
      if (new Date(data.expires_at) < new Date()) {
        setError('Einladungslink abgelaufen. Bitte wende dich an Sarah.')
        setChecking(false)
        return
      }

      setInvitation(data)
      setEmail(data.email || '')
      if (data.first_name) setFirstName(data.first_name)
      if (data.last_name) setLastName(data.last_name)
      setChecking(false)
    }

    loadInvitation()
  }, [token])

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName.trim()) { setError('Bitte gib deinen Vornamen ein.'); return }
    if (!lastName.trim()) { setError('Bitte gib deinen Nachnamen ein.'); return }
    setLoading(true)
    setError('')

    const supabase = createClient()

    // Falls noch eingeloggt → zuerst ausloggen
    const { data: { session } } = await supabase.auth.getSession()
    if (session) await supabase.auth.signOut()

    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          invitation_token: token
        }
      }
    })

    if (signUpError || !authData.user) {
      setError(signUpError?.message || 'Fehler beim Erstellen des Kontos.')
      setLoading(false)
      return
    }

    const userId = authData.user.id

    await supabase.from('profiles').upsert({
      id: userId,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
    })

    await supabase.from('invitations').update({ used: true, accepted_at: new Date().toISOString() }).eq('token', token!)

    // Welcome Email senden
    await Email.welcome({
      email: email.trim(),
      firstName: firstName.trim(),
      courseName: invitation?.course?.name,
    })

    // Admin informieren
    await Email.adminNewYogi({
      fullName: `${firstName.trim()} ${lastName.trim()}`,
      email: email.trim(),
      courseName: invitation?.course?.name,
    })

    if (invitation?.course_id && invitation?.credits_to_assign) {
      // 1) Enrollment anlegen
      await supabase.from('enrollments').insert({
        user_id: userId,
        course_id: invitation.course_id,
      })

      // 2) Credits anlegen
      // Nur AKTIVE zukünftige Sessions laden (excluded/cancelled raus –
      // sonst würde der prevent_booking_cancelled_session Trigger feuern
      // und der Yogi bekäme falsche Anzahl Credits).
      const { data: sessions } = await supabase
        .from('sessions')
        .select('id, date')
        .eq('course_id', invitation.course_id)
        .eq('is_cancelled', false)
        .gte('date', new Date().toISOString().split('T')[0])
        .order('date', { ascending: false })

      // Ablaufdatum: 8 Tage nach letzter Session des Kurses
      let expiresAt: Date
      if (sessions && sessions.length > 0) {
        const lastSession = new Date(sessions[0].date)
        expiresAt = new Date(lastSession.getTime() + 8 * 24 * 60 * 60 * 1000)
      } else {
        // Fallback: Quartalsende
        const now = new Date()
        expiresAt = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0, 23, 59, 59)
      }

      const { data: creditData } = await supabase.from('credits').insert({
        user_id: userId,
        total: invitation.credits_to_assign,
        used: 0,
        expires_at: expiresAt.toISOString(),
        course_id: invitation.course_id,
        model: 'course',
      }).select('id').single()

      // Automatisch in alle zukünftigen Sessions einbuchen
      if (sessions && sessions.length > 0 && creditData?.id) {
        const bookings = sessions.map((s: any) => ({
          user_id: userId,
          session_id: s.id,
          credit_id: creditData.id,
          type: 'course',
          status: 'active',
        }))
        await supabase.from('bookings').insert(bookings)
        // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
      }

      await supabase.from('admin_notifications').insert({
        type: 'new_yogi_registered',
        message: `${firstName.trim()} ${lastName.trim()} hat sich angemeldet und ist jetzt in "${invitation.course?.name}" eingetragen (${invitation.credits_to_assign} Credits, ${sessions?.length || 0} Stunden gebucht).`,
        read: false,
      })
    } else {
      await supabase.from('admin_notifications').insert({
        type: 'new_yogi_registered',
        message: `${firstName.trim()} ${lastName.trim()} (${email}) hat sich erfolgreich registriert.`,
        read: false,
      })
    }

    window.location.href = '/rechtliches'
  }

  if (checking) return (
    <div className="min-h-screen flex items-center justify-center">
      <i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" />
    </div>
  )

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <img src="https://yogamitsarah.me/wp-content/uploads/2025/09/Logo-300x300.png" alt="Logo"
            className="w-20 h-20 object-contain mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-1">Willkommen!</h1>
          <p className="text-sm text-yoga-text/50">Sarah hat dich eingeladen.</p>
          {invitation?.course && (
            <div className="mt-3 bg-yoga-green-bg text-yoga-green-text text-sm px-3 py-2 rounded-yoga">
              Du wirst direkt in <strong>{invitation.course.name}</strong> eingebucht
              ({invitation.credits_to_assign} Credits)
            </div>
          )}
        </div>

        {error && !invitation && (
          <div className="bg-yoga-red-bg text-yoga-red-text text-sm p-3 rounded-yoga mb-4 text-center">
            {error}
          </div>
        )}

        {invitation && (
          <form onSubmit={handleRegister} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label">Vorname *</label>
                <input className="field-input" value={firstName}
                  onChange={e => setFirstName(e.target.value)} placeholder="Anna" required />
              </div>
              <div>
                <label className="field-label">Nachname *</label>
                <input className="field-input" value={lastName}
                  onChange={e => setLastName(e.target.value)} placeholder="Müller" required />
              </div>
            </div>
            <div>
              <label className="field-label">E-Mail *</label>
              <input className="field-input" type="email" value={email}
                onChange={e => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="field-label">Passwort wählen *</label>
              <div className="relative">
                <input className="field-input pr-12"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Mindestens 8 Zeichen" minLength={8} required />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-yoga-text/40 hover:text-yoga-text/70">
                  <i className={`ti ${showPassword ? 'ti-eye-off' : 'ti-eye'} text-xl`} />
                </button>
              </div>
            </div>
            <p className="text-xs text-yoga-text/40">* Pflichtfelder</p>
            {error && (
              <div className="bg-yoga-red-bg text-yoga-red-text text-sm p-3 rounded-yoga">{error}</div>
            )}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Konto wird erstellt...' : 'Konto erstellen & loslegen'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" />
      </div>
    }>
      <RegisterInner />
    </Suspense>
  )
}
