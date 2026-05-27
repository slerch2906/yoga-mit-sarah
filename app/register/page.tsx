'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Email } from '@/lib/email'

function RegisterInner() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [birthdate, setBirthdate] = useState('') // YYYY-MM-DD (date-input format)
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

      // Welle S1/H2 (Sarah 2026-05-27): Invitation via SECURITY DEFINER RPC laden,
      // statt anon-REST-Read auf invitations-Tabelle. RPC validiert token + expires_at
      // serverseitig und liefert nur die Felder die der Yogi sehen darf
      // (inkl. course_name). Damit kann die invitations-RLS auf Service-Role-only
      // verschaerft werden (Schritt am Ende von Sarah).
      const { data, error: rpcErr } = await supabase.rpc('read_invitation_by_token', {
        p_token: token,
      })
      // RPC kann entweder ein Array oder ein Einzel-Objekt liefern — beide Faelle
      // tolerieren, damit Refactor robust bleibt.
      const row = Array.isArray(data) ? (data[0] || null) : (data || null)

      if (rpcErr || !row) {
        setError('Einladung ist abgelaufen oder ungültig. Bitte wende dich an Sarah.')
        setChecking(false)
        return
      }
      if (row.used) {
        setError('Dieser Einladungslink wurde bereits verwendet.')
        setChecking(false)
        return
      }
      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        // Sarah-Regel 2026-05-22: Admin kann Einladung "zurueckziehen" indem er sie loescht
        // (soft-delete via expires_at = now). Dieser Pfad faengt beide Faelle ab.
        setError('Einladung ist abgelaufen. Bitte wende dich an Sarah.')
        setChecking(false)
        return
      }

      // course-Feld wie vorher als Sub-Objekt {name, total_units} bereitstellen,
      // damit der bestehende UI-Code (invitation?.course?.name) ohne Umbau passt.
      const invitationShape = {
        ...row,
        course: row.course_name ? { name: row.course_name, total_units: row.course_total_units } : null,
      }
      setInvitation(invitationShape)
      setEmail(row.email || '')
      if (row.first_name) setFirstName(row.first_name)
      if (row.last_name) setLastName(row.last_name)
      setChecking(false)
    }

    loadInvitation()
  }, [token])

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName.trim()) { setError('Bitte gib deinen Vornamen ein.'); return }
    if (!lastName.trim()) { setError('Bitte gib deinen Nachnamen ein.'); return }
    // Welle S2/M8 (Sarah 2026-05-27): Passwort-Policy clientseitig.
    const { validatePassword } = await import('@/lib/password-policy')
    const pwError = validatePassword(password)
    if (pwError) { setError(pwError); return }
    // Sarah-Wunsch 2026-05-23: Geburtsdatum Pflicht bei Registrierung
    if (!birthdate) { setError('Bitte gib dein Geburtsdatum ein.'); return }
    const bd = new Date(birthdate)
    if (isNaN(bd.getTime())) { setError('Geburtsdatum ist ungültig.'); return }
    const today = new Date()
    if (bd > today) { setError('Geburtsdatum darf nicht in der Zukunft liegen.'); return }
    // Plausibilitäts-Check: min. 14 Jahre (sonst Tippfehler oder Kinder ohne
    // Einverständnis der Eltern — vor allem fürs Recht)
    const age = (today.getTime() - bd.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    if (age < 14) { setError('Du musst mindestens 14 Jahre alt sein, um dich anzumelden.'); return }
    if (age > 120) { setError('Geburtsdatum scheint nicht zu stimmen.'); return }
    setLoading(true)
    setError('')

    const supabase = createClient()

    // Falls noch eingeloggt → zuerst ausloggen
    const { data: { session } } = await supabase.auth.getSession()
    if (session) await supabase.auth.signOut()

    // Welle 6 (Sarah 2026-05-27): Bug-Fix — Button blieb bei "Konto wird
    // registriert" hängen wenn ein nachfolgender Schritt einen unerwarteten
    // Fehler warf (z.B. Email-Send timeout, RLS, etc.). Wir umschließen jetzt
    // die kompletten Folge-Schritte mit try/catch und entfernen Loading-Lock
    // im finally — egal was passiert, der Button reagiert wieder.
    let authData: any = null
    let userId: string = ''
    try {
      const signUp = await supabase.auth.signUp({
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
      const signUpError = signUp.error
      authData = signUp.data

      if (signUpError || !authData?.user) {
        setError(signUpError?.message || 'Fehler beim Erstellen des Kontos.')
        setLoading(false)
        return
      }

      userId = authData.user.id

      await supabase.from('profiles').upsert({
        id: userId,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        birthdate, // YYYY-MM-DD
      })

      // Welle S1/H3 (Sarah 2026-05-27): Invitation via SECURITY DEFINER RPC
      // konsumieren — statt direktem UPDATE auf invitations-Tabelle. Damit kann
      // die invitations-RLS auf Service-Role-only verschaerft werden.
      try {
        await supabase.rpc('consume_invitation_by_token', { p_token: token! })
      } catch (e) { console.error('consume_invitation_by_token:', e) }

      // Welcome Email senden — Fehler hier nicht fatal
      try {
        await Email.welcome({
          email: email.trim(),
          firstName: firstName.trim(),
          courseName: invitation?.course?.name,
        })
      } catch (e) { console.error('welcome email:', e) }

      // Admin informieren — Fehler hier nicht fatal
      try {
        await Email.adminNewYogi({
          fullName: `${firstName.trim()} ${lastName.trim()}`,
          email: email.trim(),
          courseName: invitation?.course?.name,
        })
      } catch (e) { console.error('adminNewYogi email:', e) }

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
    } catch (e: any) {
      console.error('Registrierungs-Fehler nach signUp:', e)
      setError('Es gab ein Problem nach der Konto-Erstellung. Versuche dich einzuloggen oder wende dich an Sarah.')
      setLoading(false)
    }
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
              <label className="field-label">Geburtsdatum *</label>
              <input className="field-input" type="date" value={birthdate}
                onChange={e => setBirthdate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                required />
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
              {loading ? 'Konto wird registriert…' : 'Konto erstellen & loslegen'}
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
