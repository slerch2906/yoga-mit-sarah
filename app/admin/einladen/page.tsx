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
  // Sarah-Wunsch 2026-05-23: Einladungs-Liste hier (aufklappbar) integrieren
  const [invitations, setInvitations] = useState<any[]>([])
  const [showOpen, setShowOpen] = useState(false)
  const [showAccepted, setShowAccepted] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [sendingReminder, setSendingReminder] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => { loadCourses(); loadInvitations() }, [])

  async function loadCourses() {
    // Welle 1 (Sarah 2026-05-26): SYS-Container-Kurse sind nicht einladbar.
    const { data } = await supabase.from('courses')
      .select('id, name, weekday, total_units, date_start, date_end, is_single, sessions(id, date, is_cancelled)')
      .eq('is_active', true)
      .eq('is_system_container', false)
      .order('name')
    setCourses(data || [])
  }

  async function loadInvitations() {
    // Soft-deleted Einladungen (expires_at < now & nicht akzeptiert) ausblenden
    const nowIso = new Date().toISOString()
    const { data } = await supabase.from('invitations')
      .select('*, course:courses(name)')
      .order('created_at', { ascending: false })
    const visible = (data || []).filter((inv: any) => {
      if (!inv.accepted_at && inv.expires_at && inv.expires_at < nowIso) return false
      return true
    })
    setInvitations(visible)
  }

  async function deleteInvitation(id: string) {
    if (!confirm('Einladung löschen? Der Link wird sofort ungültig.')) return
    await supabase.from('invitations').update({ expires_at: new Date().toISOString() }).eq('id', id)
    loadInvitations()
  }

  async function sendReminder(inv: any) {
    setSendingReminder(inv.id)
    try {
      const link = `${window.location.origin}/register?token=${inv.token}`
      await Email.invitationReminder({
        email: inv.email, firstName: inv.first_name || 'Yogi',
        courseName: inv.course?.name || undefined, inviteLink: link,
      })
      alert('Erinnerung gesendet an ' + inv.email)
    } catch (e) { alert('Netzwerkfehler: ' + String(e)) }
    setSendingReminder(null)
  }

  async function copyExistingLink(token: string, id: string) {
    const link = `${window.location.origin}/register?token=${token}`
    try { await navigator.clipboard.writeText(link) } catch {
      const el = document.createElement('textarea'); el.value = link
      document.body.appendChild(el); el.select(); document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopiedId(id); setTimeout(() => setCopiedId(null), 2000)
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
                  {c.name}{c.weekday ? ` · ${c.weekday}` : ''}{c.date_start ? `, ab ${new Date(c.date_start).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''} – {getRemainingUnits(c)} Credits
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Wird erstellt...' : 'Einladungslink erstellen'}
          </button>
        </form>

        {/* Sarah-Wunsch 2026-05-23: Einladungs-Liste hier integriert (aufklappbar) */}
        {(() => {
          const open = invitations.filter(i => !i.used && new Date(i.expires_at) > new Date())
          const accepted = invitations.filter(i => i.used)
          return (
            <div className="mt-8 space-y-4">
              {open.length > 0 && (
                <div>
                  <button onClick={() => setShowOpen(!showOpen)}
                    className="w-full flex items-center justify-between py-2 px-1 text-sm font-semibold text-yoga-text/70 bg-transparent border-0 cursor-pointer">
                    <span>Ausstehende Einladungen ({open.length})</span>
                    <i className={`ti ti-chevron-${showOpen ? 'up' : 'down'}`} />
                  </button>
                  {showOpen && (
                    <div className="space-y-2 mt-1">
                      {open.map(inv => (
                        <div key={inv.id} className="card">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold">{inv.first_name} {inv.last_name}</div>
                              <div className="text-xs text-yoga-text/50 truncate">{inv.email}</div>
                              {inv.course && (
                                <div className="text-xs text-yoga-text/40 mt-0.5">
                                  <i className="ti ti-calendar mr-1" />{inv.course.name} · {inv.credits_to_assign} Credits
                                </div>
                              )}
                              <div className="text-xs text-yoga-text/40 mt-0.5">
                                Gültig bis {new Date(inv.expires_at).toLocaleDateString('de-DE')}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-1.5 flex-wrap">
                            <button onClick={() => copyExistingLink(inv.token, inv.id)}
                              className="text-xs bg-yoga-gray rounded-full px-2.5 py-1 font-semibold border-0 cursor-pointer">
                              <i className={`ti ${copiedId === inv.id ? 'ti-check' : 'ti-copy'} mr-1`} />
                              {copiedId === inv.id ? 'Kopiert' : 'Link kopieren'}
                            </button>
                            <button onClick={() => sendReminder(inv)} disabled={sendingReminder === inv.id}
                              className="text-xs bg-yoga-gray rounded-full px-2.5 py-1 font-semibold border-0 cursor-pointer">
                              <i className="ti ti-mail mr-1" />
                              {sendingReminder === inv.id ? '...' : 'Erinnerung'}
                            </button>
                            <button onClick={() => deleteInvitation(inv.id)}
                              className="text-xs bg-yoga-red-bg text-yoga-red-text rounded-full px-2.5 py-1 font-semibold border-0 cursor-pointer">
                              Löschen
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {accepted.length > 0 && (
                <div>
                  <button onClick={() => setShowAccepted(!showAccepted)}
                    className="w-full flex items-center justify-between py-2 px-1 text-sm font-semibold text-yoga-text/70 bg-transparent border-0 cursor-pointer">
                    <span>Angenommene Einladungen ({accepted.length})</span>
                    <i className={`ti ti-chevron-${showAccepted ? 'up' : 'down'}`} />
                  </button>
                  {showAccepted && (
                    <div className="space-y-2 mt-1">
                      {accepted.map(inv => (
                        <div key={inv.id} className="card opacity-75">
                          <div className="text-sm font-semibold">{inv.first_name} {inv.last_name}</div>
                          <div className="text-xs text-yoga-text/50 truncate">{inv.email}</div>
                          {inv.accepted_at && (
                            <div className="text-xs text-yoga-green-text mt-1">
                              <i className="ti ti-check mr-0.5" />
                              Angenommen am {new Date(inv.accepted_at).toLocaleDateString('de-DE')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })()}
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
