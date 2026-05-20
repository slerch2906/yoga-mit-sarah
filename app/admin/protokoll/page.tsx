'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  booking_created:          { label: 'Stunde gebucht',          color: 'text-yoga-green-text' },
  booking_cancelled:        { label: 'Stunde storniert',         color: 'text-yoga-amber-text' },
  credit_assigned:          { label: 'Credits vergeben',         color: 'text-yoga-green-text' },
  session_cancelled:        { label: 'Stunde abgesagt (Admin)',  color: 'text-yoga-red-text' },
  yogi_enrolled_by_admin:   { label: 'In Kurs eingetragen',      color: 'text-yoga-green-text' },
  yogi_removed_from_course: { label: 'Aus Kurs ausgetragen',     color: 'text-yoga-red-text' },
  yogi_deleted:             { label: 'User gelöscht',            color: 'text-yoga-red-text' },
  legal_accepted:           { label: 'AGB bestätigt',            color: 'text-yoga-green-text' },
  waitlist_joined:          { label: 'Warteliste eingetragen',   color: 'text-yoga-amber-text' },
  waitlist_promoted:        { label: 'Warteliste nachgerückt',   color: 'text-yoga-green-text' },
}

function formatDetails(action: string, details: any): string[] {
  if (!details) return []
  const lines: string[] = []
  if (details.session_date) lines.push(`Datum: ${new Date(details.session_date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short', year:'numeric' })}`)
  if (details.session_time) lines.push(`Uhrzeit: ${details.session_time?.slice(0,5)} Uhr`)
  if (details.course_name) lines.push(`Kurs: ${details.course_name}`)
  if (details.affected_yogis) lines.push(`Betroffene Yogis: ${details.affected_yogis}`)
  if (details.replacement_date) lines.push(`Ersatztermin: ${new Date(details.replacement_date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short' })}`)
  if (details.amount) lines.push(`Credits: ${details.amount}`)
  if (details.model) lines.push(`Modell: ${details.model}`)
  if (details.late !== undefined) lines.push(details.late ? 'Spät storniert (kein Credit zurück)' : 'Rechtzeitig storniert')
  if (details.email) lines.push(`User: ${details.email}`)
  if (details.type) lines.push(`Typ: ${details.type}`)
  return lines
}

export default function ProtokolPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [profiles, setProfiles] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data: logData } = await supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)

    const logs = logData || []
    setLogs(logs)

    // Profile für alle user_ids laden
    const userIds = [...new Set(logs.map(l => l.user_id).filter(Boolean))]
    if (userIds.length > 0) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, email')
        .in('id', userIds)
      const profileMap: Record<string, any> = {}
      for (const p of profileData || []) profileMap[p.id] = p
      setProfiles(profileMap)
    }

    setLoading(false)
  }

  function formatTime(ts: string) {
    const d = new Date(ts)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === today.toDateString())
      return `Heute · ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
    if (d.toDateString() === yesterday.toDateString())
      return `Gestern · ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
    return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ` · ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
  }

  const filtered = logs.filter(log => {
    if (!search) return true
    const q = search.toLowerCase()
    const actor = profiles[log.user_id]
    const actorName = actor ? `${actor.first_name || ''} ${actor.last_name || ''} ${actor.email || ''}`.toLowerCase() : ''
    const action = (ACTION_LABELS[log.action]?.label || log.action).toLowerCase()
    const details = JSON.stringify(log.details || {}).toLowerCase()
    return actorName.includes(q) || action.includes(q) || details.includes(q)
  })

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" />
    </div>
  )

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Protokoll" isAdmin />
      <div className="px-4 py-4">
        <input
          className="field-input mb-4"
          placeholder="Suche nach Yogi, Aktion, Kurs..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <p className="section-label">{filtered.length} Einträge</p>
        {filtered.length === 0 ? (
          <p className="text-center text-yoga-text/40 text-sm py-8">Keine Einträge gefunden</p>
        ) : (
          <div className="space-y-2">
            {filtered.map(log => {
              const meta = ACTION_LABELS[log.action]
              const actor = profiles[log.user_id]
              const actorName = actor
                ? `${actor.first_name || ''} ${actor.last_name || ''}`.trim() || actor.email
                : log.details?.email || 'System'
              const details = formatDetails(log.action, log.details)

              return (
                <div key={log.id} className="card py-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className={`text-sm font-bold ${meta?.color || 'text-yoga-text'}`}>
                      {meta?.label || log.action}
                    </span>
                    <span className="text-xs text-yoga-text/40 flex-shrink-0">{formatTime(log.created_at)}</span>
                  </div>
                  <p className="text-xs text-yoga-text/60 mb-1">
                    <i className="ti ti-user mr-1" />{actorName}
                  </p>
                  {details.map((d, i) => (
                    <p key={i} className="text-xs text-yoga-text/50">{d}</p>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <BottomNav isAdmin />
    </div>
  )
}
