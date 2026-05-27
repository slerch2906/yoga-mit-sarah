'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

// Welle 3 (Sarah 2026-05-26): Vollständige Action-Map inkl. der neuen
// Welle-2-Actions (Events / Einzelstunden / Container-Sessions). Vorher
// fielen viele Aktionen durch zum Roh-String — Sarah konnte nicht lesen
// was passiert ist.
const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  booking_created:                { label: 'Stunde gebucht',                 color: 'text-yoga-green-text' },
  booking_cancelled:              { label: 'Stunde storniert',               color: 'text-yoga-amber-text' },
  // Welle 5 (Sarah 2026-05-26): Admin-Storno einer Yogi-Buchung — wird in dashboard/kurse/sessions geschrieben
  booking_cancelled_by_admin:     { label: 'Yogi-Buchung storniert (Admin)', color: 'text-yoga-red-text' },
  credit_assigned:                { label: 'Credits vergeben',               color: 'text-yoga-green-text' },
  credit_adjusted:                { label: 'Credit angepasst',               color: 'text-yoga-amber-text' },
  credit_deleted:                 { label: 'Credit gelöscht',                color: 'text-yoga-red-text' },
  session_cancelled:              { label: 'Stunde abgesagt (Admin)',        color: 'text-yoga-red-text' },
  yogi_enrolled_by_admin:         { label: 'In Kurs eingetragen',            color: 'text-yoga-green-text' },
  yogi_removed_from_course:       { label: 'Aus Kurs ausgetragen',           color: 'text-yoga-red-text' },
  yogi_deleted:                   { label: 'User gelöscht',                  color: 'text-yoga-red-text' },
  yogi_anonymized_dsgvo:          { label: 'Yogi anonymisiert (DSGVO)',      color: 'text-yoga-red-text' },
  legal_accepted:                 { label: 'AGB bestätigt',                  color: 'text-yoga-green-text' },
  waitlist_joined:                { label: 'Warteliste eingetragen',         color: 'text-yoga-amber-text' },
  waitlist_promoted:              { label: 'Warteliste nachgerückt',         color: 'text-yoga-green-text' },
  waitlist_offer_late_accepted:   { label: 'Warteliste — Spät-Angebot angenommen', color: 'text-yoga-green-text' },
  // ── Welle 2: Events / Einzelstunden / Container-Sessions ─────────────
  single_session_created:         { label: 'Einzelstunde angelegt',          color: 'text-yoga-green-text' },
  single_session_updated:         { label: 'Einzelstunde bearbeitet',        color: 'text-yoga-amber-text' },
  event_created:                  { label: 'Event angelegt',                 color: 'text-yoga-green-text' },
  event_updated:                  { label: 'Event bearbeitet',               color: 'text-yoga-amber-text' },
  single_or_event_deleted:        { label: 'Einzelstunde / Event gelöscht',  color: 'text-yoga-red-text' },
  single_or_event_updated:        { label: 'Einzelstunde / Event geändert',  color: 'text-yoga-amber-text' },
  external_participants_changed:  { label: 'Externe Teilnehmer geändert',    color: 'text-yoga-amber-text' },
  admin_added_yogi_to_event:      { label: 'Yogi zu Event hinzugefügt',      color: 'text-yoga-green-text' },
  admin_added_yogi_to_session:    { label: 'Yogi zu Stunde hinzugefügt',     color: 'text-yoga-green-text' },
  admin_promoted_waitlist_yogi:   { label: 'Waitlist-Yogi nachgerückt (Admin)', color: 'text-yoga-green-text' },
  session_open_toggled:           { label: 'Stunde/Event freigegeben/gesperrt', color: 'text-yoga-amber-text' },
  // ── Welle 1: Ersatzstunden / Kursabbruch ─────────────────────────────
  replacement_session_added:      { label: 'Ersatzstunde angelegt',          color: 'text-yoga-green-text' },
  cascade_replacement_cancelled:  { label: 'Ersatzstunde (Cascade) abgesagt',color: 'text-yoga-red-text' },
  course_cancelled:               { label: 'Kurs abgebrochen',               color: 'text-yoga-red-text' },
  course_rollover:                { label: 'Folgekurs angelegt (Rollover)',  color: 'text-yoga-green-text' },
  yogi_course_cancellation_choice:{ label: 'Yogi-Wahl bei Kursabbruch',      color: 'text-yoga-amber-text' },
  token_expired_auto_refund:      { label: 'Token abgelaufen — Auto-Refund', color: 'text-yoga-amber-text' },
  guthaben_2y_auto_refund:        { label: 'Guthaben 2J abgelaufen — Refund',color: 'text-yoga-amber-text' },
  admin_illness_credit:           { label: 'Krankheits-Guthaben vergeben',   color: 'text-yoga-green-text' },
  admin_bulk_mail:                { label: 'Bulk-Mail versendet',            color: 'text-yoga-amber-text' },
  admin_dsgvo_deletion:           { label: 'DSGVO-Löschung durch Admin',     color: 'text-yoga-red-text' },
  // ── Welle 4.7 (2026-05-26): Kurs-Mutationen Audit-Trail ─────────────
  course_created:                 { label: 'Kurs angelegt',                  color: 'text-yoga-green-text' },
  course_updated:                 { label: 'Kurs bearbeitet',                color: 'text-yoga-amber-text' },
  course_archived:                { label: 'Kurs archiviert',                color: 'text-yoga-amber-text' },
  course_deleted:                 { label: 'Kurs gelöscht',                  color: 'text-yoga-red-text' },
  course_open_toggled:            { label: 'Kurs freigegeben/gesperrt',      color: 'text-yoga-amber-text' },
  // ── Welle S2/S3 (Sarah 2026-05-27): Folge-Audits aus Sicherheits-/Logik-Fixes ─
  replacement_credit_invalid:     { label: 'Ersatztermin — Credit ungültig (nicht umgebucht)', color: 'text-yoga-amber-text' },
  kursabbruch_token_reclicked:    { label: 'Kursabbruch-Token erneut geklickt', color: 'text-yoga-amber-text' },
  apply_cancellation_refund_failed: { label: 'Erstattungs-RPC fehlgeschlagen', color: 'text-yoga-red-text' },
  profile_email_update_failed:    { label: 'Profil-Email-Update fehlgeschlagen', color: 'text-yoga-red-text' },
  waitlist_offer_rollback:        { label: 'Warteliste-Angebot zurückgerollt', color: 'text-yoga-amber-text' },
  course_credits_auto_expired:    { label: '8d-Cleanup: Kurs + Credits gelöscht', color: 'text-yoga-amber-text' },
}

const SESSION_TYPE_LABEL: Record<string, string> = {
  course_session: 'Kursstunde',
  single:         'Einzelstunde',
  event_free:     'Event (kostenlos)',
  event_paid:     'Event (bezahlt)',
  event_credit:   'Event (Credit)',
}

function formatDetails(action: string, details: any): string[] {
  if (!details) return []
  const lines: string[] = []
  if (details.session_date) lines.push(`Datum: ${new Date(details.session_date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short', year:'numeric' })}`)
  if (details.date && !details.session_date) lines.push(`Datum: ${new Date(details.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short', year:'numeric' })}`)
  if (details.session_time) lines.push(`Uhrzeit: ${details.session_time?.slice(0,5)} Uhr`)
  if (details.time && !details.session_time) lines.push(`Uhrzeit: ${String(details.time).slice(0,5)} Uhr`)
  if (details.course_name) lines.push(`Kurs: ${details.course_name}`)
  // Welle 3: Name der Einzelstunde/des Events
  if (details.name && !details.course_name) lines.push(`Name: ${details.name}`)
  if (details.session_type) lines.push(`Typ: ${SESSION_TYPE_LABEL[details.session_type] || details.session_type}`)
  if (details.payment_type) lines.push(`Bezahlung: ${details.payment_type === 'free' ? 'Kostenlos' : 'Extern (PayPal/Bar)'}`)
  if (details.price_eur != null) lines.push(`Preis: ${details.price_eur} €`)
  if (details.max_spots) lines.push(`Max. Teilnehmer: ${details.max_spots}`)
  if (details.affected_yogis) lines.push(`Betroffene Yogis: ${details.affected_yogis}`)
  if (details.replacement_date) lines.push(`Ersatztermin: ${new Date(details.replacement_date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short' })}`)
  if (details.amount) lines.push(`Credits: ${details.amount}`)
  if (details.model) lines.push(`Modell: ${details.model}`)
  if (details.credit_used === false) lines.push('Kein Credit verbraucht')
  if (details.late !== undefined) lines.push(details.late ? 'Spät storniert (kein Credit zurück)' : 'Rechtzeitig storniert')
  if (details.email) lines.push(`User: ${details.email}`)
  if (details.type && !details.session_type) lines.push(`Typ: ${details.type}`)
  if (details.old_count != null && details.new_count != null) lines.push(`Externe Teilnehmer: ${details.old_count} → ${details.new_count}`)
  if (details.is_open !== undefined) lines.push(details.is_open ? 'Status: Freigegeben' : 'Status: Gesperrt')
  return lines
}

export default function ProtokolPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [profiles, setProfiles] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const supabase = createClient()
  const router = useRouter()

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

  // Welle S3/M18 (Sarah 2026-05-27): teurer .filter mit JSON.stringify pro Log
  // — bei 200 Eintraegen + jedem Tastendruck im Suchfeld wurde das pro Render
  // neu berechnet (inkl. JSON.stringify). useMemo skipt das wenn sich logs/
  // profiles/search nicht aendern.
  const filtered = useMemo(() => {
    return logs.filter(log => {
      if (!search) return true
      const q = search.toLowerCase()
      const actor = profiles[log.user_id]
      const actorName = actor ? `${actor.first_name || ''} ${actor.last_name || ''} ${actor.email || ''}`.toLowerCase() : ''
      const action = (ACTION_LABELS[log.action]?.label || log.action).toLowerCase()
      const details = JSON.stringify(log.details || {}).toLowerCase()
      return actorName.includes(q) || action.includes(q) || details.includes(q)
    })
  }, [logs, profiles, search])

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
          placeholder="Suche nach Yogi, Aktion, Stunde, Event..."
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
                  {/* Sarah-Wunsch: Actor klickbar → Yogi-Profil (wenn user_id vorhanden) */}
                  {log.user_id && actor ? (
                    <button
                      onClick={() => router.push(`/admin/yogis/${log.user_id}`)}
                      className="text-xs text-yoga-text/60 mb-1 bg-transparent border-0 p-0 cursor-pointer hover:opacity-70 transition-opacity text-left">
                      <i className="ti ti-user mr-1" />{actorName}
                    </button>
                  ) : (
                    <p className="text-xs text-yoga-text/60 mb-1">
                      <i className="ti ti-user mr-1" />{actorName}
                    </p>
                  )}
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
