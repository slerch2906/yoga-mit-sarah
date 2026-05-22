'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Email } from '@/lib/email'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

export default function EinladungenPage() {
  const [invitations, setInvitations] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [sendingReminder, setSendingReminder] = useState<string | null>(null)
  const [reminderSent, setReminderSent] = useState<Set<string>>(new Set())
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    // Sarah-Regel 2026-05-22: gelöschte Einladungen werden via expires_at < now
    // soft-gelöscht (statt physical DELETE), damit der Link in /register sofort
    // ungültig wird. Wir blenden diese hier aus, damit die Admin-Liste sauber bleibt.
    const nowIso = new Date().toISOString()
    const { data } = await supabase
      .from('invitations')
      .select('*, course:courses(name)')
      .order('created_at', { ascending: false })
    const visible = (data || []).filter((inv: any) => {
      // Nicht-akzeptierte abgelaufene = "wurde zurückgezogen" → ausblenden
      if (!inv.accepted_at && inv.expires_at && inv.expires_at < nowIso) return false
      return true
    })
    setInvitations(visible)
    setLoading(false)
  }

  async function deleteInvitation(id: string) {
    if (!confirm('Einladung löschen? Der Link wird sofort ungültig — falls der Yogi noch nicht registriert ist, kann er sich damit nicht mehr anmelden.')) return
    // Soft-delete: expires_at auf jetzt setzen → Link in /register wirft sofort
    // "Einladung abgelaufen". Bewahrt Audit-Trail, kein FK-Cascade-Risiko.
    await supabase.from('invitations').update({ expires_at: new Date().toISOString() }).eq('id', id)
    loadData()
  }

  async function sendReminder(inv: any) {
    setSendingReminder(inv.id)
    try {
      const link = `${window.location.origin}/register?token=${inv.token}`
      // Über lib/email.ts → setzt korrekt x-function-secret + anon Bearer
      await Email.invitationReminder({
        email: inv.email,
        firstName: inv.first_name || 'Yogi',
        courseName: inv.course?.name || undefined,
        inviteLink: link,
      })
      setReminderSent(prev => new Set([...prev, inv.id]))
    } catch (e) {
      alert('Netzwerkfehler: ' + String(e))
    }
    setSendingReminder(null)
  }

  async function copyLink(token: string, id: string) {
    const link = `${window.location.origin}/register?token=${token}`
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      const el = document.createElement('textarea')
      el.value = link
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const open = invitations.filter(i => !i.used && new Date(i.expires_at) > new Date())
  const accepted = invitations.filter(i => i.used)
  const expired = invitations.filter(i => !i.used && new Date(i.expires_at) <= new Date())

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Einladungen" subtitle={`${invitations.length} gesamt`} isAdmin />
      <div className="px-4 py-4">

        {/* Offen */}
        {open.length > 0 && (
          <div className="mb-6">
            <p className="section-label">Ausstehend ({open.length})</p>
            {open.map(inv => (
              <div key={inv.id} className="card mb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{inv.first_name} {inv.last_name}</div>
                    <div className="text-xs text-yoga-text/50">{inv.email}</div>
                    {inv.course && <div className="text-xs text-yoga-text/40 mt-0.5"><i className="ti ti-calendar mr-1" />{inv.course.name} · {inv.credits_to_assign} Credits</div>}
                    <div className="text-xs text-yoga-text/40 mt-0.5">
                      Läuft ab: {new Date(inv.expires_at).toLocaleDateString('de-DE')}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="badge badge-wait">Ausstehend</span>
                    <button onClick={() => copyLink(inv.token, inv.id)}
                      className="text-xs border border-yoga-border2 rounded-full px-2 py-1 cursor-pointer hover:opacity-80 bg-transparent"
                      style={{ color: 'var(--yoga-text)' }}>
                      <i className={`ti ${copiedId === inv.id ? 'ti-check' : 'ti-copy'} mr-1`} />
                      {copiedId === inv.id ? 'Kopiert!' : 'Link kopieren'}
                    </button>
                    <button onClick={() => sendReminder(inv)}
                      disabled={!!sendingReminder || reminderSent.has(inv.id)}
                      className="text-xs border border-yoga-border2 rounded-full px-2 py-1 cursor-pointer hover:opacity-80 bg-transparent disabled:opacity-40"
                      style={{ color: 'var(--yoga-text)' }}>
                      <i className="ti ti-bell-ringing mr-1" />
                      {reminderSent.has(inv.id) ? 'Gesendet' : sendingReminder === inv.id ? '...' : 'Erinnerung'}
                    </button>
                    <button onClick={() => deleteInvitation(inv.id)}
                      className="text-xs text-yoga-red-text border-0 bg-transparent cursor-pointer opacity-60 hover:opacity-100">
                      <i className="ti ti-trash" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Angenommen */}
        {accepted.length > 0 && (
          <div className="mb-6">
            <p className="section-label">Angenommen ({accepted.length})</p>
            {accepted.map(inv => (
              <div key={inv.id} className="card mb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{inv.first_name} {inv.last_name}</div>
                    <div className="text-xs text-yoga-text/50">{inv.email}</div>
                    {inv.course && <div className="text-xs text-yoga-text/40 mt-0.5"><i className="ti ti-calendar mr-1" />{inv.course.name} · {inv.credits_to_assign} Credits</div>}
                    <div className="text-xs text-yoga-text/40 mt-0.5">
                      Eingeladen: {new Date(inv.created_at).toLocaleDateString('de-DE')}
                    </div>
                    {inv.accepted_at && (
                      <div className="text-xs text-yoga-green-text mt-0.5 font-semibold">
                        Registriert: {new Date(inv.accepted_at).toLocaleDateString('de-DE', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })} Uhr
                      </div>
                    )}
                  </div>
                  <span className="badge badge-done flex-shrink-0">Erfolgreich</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Abgelaufen */}
        {expired.length > 0 && (
          <div className="mb-6">
            <p className="section-label">Abgelaufen ({expired.length})</p>
            {expired.map(inv => (
              <div key={inv.id} className="card mb-2 opacity-50">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{inv.first_name} {inv.last_name}</div>
                    <div className="text-xs text-yoga-text/50">{inv.email}</div>
                    <div className="text-xs text-yoga-text/40 mt-0.5">
                      Abgelaufen: {new Date(inv.expires_at).toLocaleDateString('de-DE')}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="badge badge-left">Abgelaufen</span>
                    <button onClick={() => deleteInvitation(inv.id)}
                      className="text-xs text-yoga-red-text border-0 bg-transparent cursor-pointer opacity-60 hover:opacity-100">
                      <i className="ti ti-trash" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {invitations.length === 0 && (
          <div className="text-center py-12 text-yoga-text/40">
            <i className="ti ti-mail text-3xl block mb-3" />
            <p className="text-sm">Noch keine Einladungen</p>
          </div>
        )}
      </div>
      <BottomNav isAdmin />
    </div>
  )
}
