'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Email } from '@/lib/email'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

function EinladenInner() {
  const [courses, setCourses] = useState<any[]>([])
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [courseId, setCourseId] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)
  const supabase = createClient()

  useEffect(() => { loadCourses() }, [])

  async function loadCourses() {
    const { data } = await supabase.from('courses')
      .select('id, name, total_units, date_start, date_end, is_single, sessions(id, date, is_cancelled)')
      .eq('is_active', true).order('name')
    setCourses(data || [])
  }

  function getRemainingUnits(course: any) {
    if (course.is_single) return 1
    // Immer echte zukünftige Sessions zählen
    const today = new Date().toISOString().split('T')[0]
    const futureSessions = (course.sessions || []).filter(
      (s: any) => s.date >= today && !s.is_cancelled
    )
    return Math.max(1, futureSessions.length)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      alert('Bitte alle Pflichtfelder ausfüllen.')
      return
    }
    setLoading(true)

    const selectedCourse = courses.find(c => c.id === courseId)
    const creditsToAssign = selectedCourse ? getRemainingUnits(selectedCourse) : null

    // Prüfen ob bereits eine offene Einladung für diese E-Mail existiert
    const { data: existing } = await supabase.from('invitations')
      .select('id').eq('email', email.trim()).eq('used', false)
      .gt('expires_at', new Date().toISOString()).single()
    if (existing) {
      if (!confirm(`Es gibt bereits eine offene Einladung für ${email}. Trotzdem neue erstellen?`)) {
        setLoading(false)
        return
      }
    }

    const { data, error } = await supabase.from('invitations').insert({
      email: email.trim(),
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      course_id: courseId || null,
      credits_to_assign: creditsToAssign,
    }).select('token').single()

    if (error || !data) {
      alert('Fehler beim Erstellen der Einladung. Bitte nochmal versuchen.')
      setLoading(false)
      return
    }

    const link = `${window.location.origin}/register?token=${data.token}`
    setInviteLink(link)
    setSuccess(true)
    setLoading(false)
  }

  async function sendPerEmail() {
    try {
      const course = courses.find((c: any) => c.id === courseId)
      await Email.invitationSent({
        email,
        firstName,
        inviteLink,
        courseName: course?.name,
      })
      alert('Einladungs-E-Mail wurde an ' + email + ' gesendet!')
    } catch(e) {
      console.error('sendPerEmail error:', e)
      alert('Fehler beim Senden der E-Mail.')
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback für ältere Browser
      const el = document.createElement('textarea')
      el.value = inviteLink
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function reset() {
    setSuccess(false)
    setFirstName('')
    setLastName('')
    setEmail('')
    setCourseId('')
    setInviteLink('')
    setCopied(false)
  }

  if (success) return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Einladung erstellt" isAdmin />
      <div className="px-4 py-8 text-center">
        <div className="w-14 h-14 rounded-full bg-yoga-green-bg flex items-center justify-center mx-auto mb-4">
          <i className="ti ti-check text-2xl text-yoga-green-text" />
        </div>
        <h2 className="text-lg font-bold mb-2">Einladung erstellt!</h2>
        <p className="text-sm text-yoga-text/60 mb-6">
          Schicke den Link an {firstName} {lastName}
        </p>
        <div className="card mb-4 text-left">
          <p className="text-xs text-yoga-text/50 mb-2 font-semibold">EINLADUNGSLINK</p>
          <p className="text-sm text-yoga-text break-all leading-relaxed">{inviteLink}</p>
        </div>
        <button onClick={copyLink} className="btn-primary mb-3">
          <i className={`ti ${copied ? 'ti-check' : 'ti-copy'} mr-2`} />
          {copied ? 'Link kopiert!' : 'Link kopieren'}
        </button>
        <button onClick={sendPerEmail} className="btn-secondary mb-3">
          <i className="ti ti-mail mr-2" />
          Per E-Mail versenden
        </button>
        <button onClick={reset} className="btn-ghost">
          Weitere Einladung erstellen
        </button>
      </div>
      <BottomNav isAdmin />
    </div>
  )

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Einladen" isAdmin />
      <div className="px-4 py-4">
        <div className="card mb-4" style={{ background: '#fdf3e7', borderColor: 'rgba(107,79,26,0.2)' }}>
          <p className="text-sm leading-relaxed" style={{ color: '#6b4f1a' }}>
            <i className="ti ti-bolt mr-1" />
            Wenn du einen Kurs auswählst, berechnet die App automatisch die verbleibenden Stunden und gibt dem Yogi genau diese Credits.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Vorname *</label>
              <input className="field-input" value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="Anna" required />
            </div>
            <div>
              <label className="field-label">Nachname *</label>
              <input className="field-input" value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder="Müller" required />
            </div>
          </div>
          <div>
            <label className="field-label">E-Mail *</label>
            <input className="field-input" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="anna@beispiel.de" required />
          </div>
          <div>
            <label className="field-label">Kurs (optional – Credits werden automatisch berechnet)</label>
            <select className="field-input" value={courseId}
              onChange={e => setCourseId(e.target.value)}>
              <option value="">Nur Registrierung – kein Kurs</option>
              {courses.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} → {getRemainingUnits(c)} Credits
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Wird erstellt...' : 'Einladungslink erstellen'}
          </button>
        </form>
      </div>
      <BottomNav isAdmin />
    </div>
  )
}

export default function EinladenPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-yoga-text/50 text-sm">Wird geladen...</p></div>}>
      <EinladenInner />
    </Suspense>
  )
}
