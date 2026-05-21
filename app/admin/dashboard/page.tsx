'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Email } from '@/lib/email'
import { useSwipe } from '@/lib/useSwipe'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

const WEEKDAYS = ['So','Mo','Di','Mi','Do','Fr','Sa']
const MONTHS = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']

function getMonday(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  return d
}
function addDays(date: Date, days: number) {
  const d = new Date(date); d.setDate(d.getDate() + days); return d
}
function fmt(d: Date) {
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`
}
function formatWeekRange(start: Date): string {
  const end = new Date(start); end.setDate(end.getDate() + 6)
  const sm = MONTHS[start.getMonth()], em = MONTHS[end.getMonth()]
  if (start.getMonth() === end.getMonth()) return `${start.getDate()}. – ${end.getDate()}. ${sm}`
  return `${start.getDate()}. ${sm} – ${end.getDate()}. ${em}`
}

export default function AdminDashboard() {
  const [weekOffset, setWeekOffset] = useState(0)
  const [sessions, setSessions] = useState<any[]>([])
  const [selectedSession, setSelectedSession] = useState<any>(null)
  const [sessionBookings, setSessionBookings] = useState<any[]>([])
  const [showDashAddYogi, setShowDashAddYogi] = useState(false)
  const [dashYogiSearch, setDashYogiSearch] = useState('')
  const [dashYogiResults, setDashYogiResults] = useState<any[]>([])
  const [dashAddingYogi, setDashAddingYogi] = useState(false)
  const [stats, setStats] = useState({ bookings: 0, cancellations: 0, waitlist: 0 })
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] = useState<any[]>([])
  const [showCancelForm, setShowCancelForm] = useState(false)
  const [replacementDate, setReplacementDate] = useState('')
  const [replacementTime, setReplacementTime] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { loadData() }, [weekOffset])

  async function loadData() {
    setLoading(true)
    const monday = getMonday(new Date())
    const weekStart = addDays(monday, weekOffset * 7)
    const weekEnd = addDays(weekStart, 6)

    // Weekly sessions
    const { data: sessionData } = await supabase
      .from('sessions')
      .select('*, course:courses(name, max_spots, is_active), bookings!bookings_session_id_fkey(id, status, user_id, profile:profiles(first_name, last_name))')
      .gte('date', weekStart.toISOString().split('T')[0])
      .lte('date', weekEnd.toISOString().split('T')[0])
      .order('date').order('time_start')

    // Weekly stats
    const { count: bookCount } = await supabase.from('audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'booking_created')
      .gte('created_at', weekStart.toISOString())
      .lte('created_at', weekEnd.toISOString())

    const { count: cancelCount } = await supabase.from('audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'booking_cancelled')
      .gte('created_at', weekStart.toISOString())
      .lte('created_at', weekEnd.toISOString())

    const { count: waitCount } = await supabase.from('waitlist')
      .select('*', { count: 'exact', head: true })

    setSessions((sessionData || [])
      .filter((s: any) => s.course?.is_active !== false)
      // Excluded Stunden (Setup-Ausschlüsse beim Kurs-Anlegen) NIE in der Wochenliste
      // anzeigen — die sind nur Platzhalter im Edit-Form, keine echten Termine.
      .filter((s: any) => !(s.is_cancelled && s.cancel_reason === 'excluded'))
      .map((s: any) => ({
        ...s,
        active_count: s.bookings.filter((b: any) => b.status === 'active').length,
        cancelled_count: s.bookings.filter((b: any) => b.status === 'cancelled').length,
      })))
    setStats({ bookings: bookCount || 0, cancellations: cancelCount || 0, waitlist: waitCount || 0 })

    // Ungelesene Benachrichtigungen laden
    const { data: notifs } = await supabase.from('admin_notifications')
      .select('*').eq('read', false).order('created_at', { ascending: false }).limit(10)
    setNotifications(notifs || [])
    setLoading(false)
  }

  async function cancelBookingForYogi(bookingId: string, creditId: string | null, sessionId: string) {
    if (!confirm('Yogi aus dieser Stunde austragen und Credit zurückgeben?')) return

    await supabase.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false
    }).eq('id', bookingId)

    // credit.used wird automatisch durch trg_sync_credit_used aktualisiert

    await supabase.from('audit_log').insert({
      action: 'booking_cancelled_by_admin',
      details: { booking_id: bookingId, session_id: sessionId }
    })

    // Session-Infos für Emails laden
    const { data: sess } = await supabase
      .from('sessions').select('date, time_start, course:courses(name)')
      .eq('id', sessionId).single()

    // Warteliste: ersten nachrücken lassen + Email senden
    const { data: waitlistFirst } = await supabase.from('waitlist')
      .select('*, profile:profiles(email, first_name)')
      .eq('session_id', sessionId).eq('type', 'waitlist')
      .order('position').limit(1).single()

    if (waitlistFirst) {
      const { data: allWaitCredits } = await supabase.from('credits')
        .select('*').eq('user_id', waitlistFirst.user_id)
        .gt('expires_at', new Date().toISOString())
      const availableCredits = (allWaitCredits || []).filter((c: any) => c.total > c.used)
      const credit = availableCredits.sort((a: any, b: any) => 
        new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())[0] || null
      if (credit && (credit.total - credit.used) > 0) {
        await supabase.from('bookings').insert({
          user_id: waitlistFirst.user_id, session_id: sessionId, type: 'single', status: 'active',
          credit_id: credit.id
        })
        // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
      }
      if (waitlistFirst.profile && !waitlistFirst.profile.is_dummy) {
        await Email.waitlistPromoted({
          email: waitlistFirst.profile.email,
          firstName: waitlistFirst.profile.first_name || 'Yogi',
          courseName: sess?.course?.name || '',
          date: sess?.date || '',
          timeStart: sess?.time_start || '',
        })
      }
      await supabase.from('waitlist').delete().eq('id', waitlistFirst.id)
    }

    // Notify-User informieren
    const { data: notifyUsers } = await supabase.from('waitlist')
      .select('*, profile:profiles(email, first_name)')
      .eq('session_id', sessionId).eq('type', 'notify')
    if (notifyUsers && notifyUsers.length > 0) {
      for (const nu of notifyUsers) {
        if (nu.profile) {
          await Email.notifyPlaceFree({
            email: nu.profile.email,
            firstName: nu.profile.first_name || 'Yogi',
            courseName: sess?.course?.name || '',
            date: sess?.date || '',
            timeStart: sess?.time_start || '',
            sessionId,
          })
        }
      }
      await supabase.from('waitlist').delete().eq('session_id', sessionId).eq('type', 'notify')
    }

    // Reload session detail
    if (selectedSession) loadSessionDetail(selectedSession)
  }

  async function loadSessionDetail(session: any) {
    const { data: bookings } = await supabase
      .from('bookings')
      .select('*, profile:profiles(first_name, last_name, email, is_dummy)')
      .eq('session_id', session.id)
      .order('created_at')
    
    const { data: waitlist } = await supabase
      .from('waitlist')
      .select('*, profile:profiles(first_name, last_name, email, is_dummy)')
      .eq('session_id', session.id)
      .order('position')

    setSessionBookings([
      ...(bookings || []).map((b: any) => ({ ...b, _type: 'booking' })),
      ...(waitlist || []).map((w: any) => ({ ...w, _type: 'waitlist' })),
    ])
    setSelectedSession(session)
  }

  async function searchDashYogis(q: string) {
    setDashYogiSearch(q)
    if (q.length < 2) { setDashYogiResults([]); return }
    const { data } = await supabase.from('profiles')
      .select('id, first_name, last_name, email, is_dummy, credits(*)')
      .eq('is_admin', false)
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(8)
    const bookedIds = sessionBookings.filter(b => b._type === 'booking' && b.status === 'active').map((b: any) => b.user_id || b.profile?.id)
    setDashYogiResults((data || []).filter((y: any) => !bookedIds.includes(y.id)))
  }

  async function addYogiToSession(yogi: any) {
    if (!selectedSession) return
    setDashAddingYogi(true)
    // Find free credit
    const now = new Date().toISOString()
    const freeCredit = (yogi.credits || []).find((cr: any) =>
      new Date(cr.expires_at) > new Date() && (cr.total - cr.used) > 0
    )
    let creditId = freeCredit?.id || null
    if (!creditId) {
      // Quick credit vergeben
      const expiry = new Date(); expiry.setFullYear(expiry.getFullYear() + 1)
      const { data: nc } = await supabase.from('credits').insert({
        user_id: yogi.id, total: 1, used: 1, expires_at: expiry.toISOString(), model: 'single', course_id: null
      }).select('id').single()
      creditId = nc?.id || null
    }
    // credit.used wird durch trg_sync_credit_used aktualisiert (außer bei frisch erstelltem
    // Quick-Credit oben, der mit used=1 direkt initialisiert wird)
    await supabase.from('bookings').insert({
      user_id: yogi.id, session_id: selectedSession.id, credit_id: creditId, type: 'single', status: 'active'
    })
    setDashAddingYogi(false)
    setShowDashAddYogi(false)
    setDashYogiSearch('')
    setDashYogiResults([])
    loadSessionDetail(selectedSession)
  }

  async function cancelSession() {
    if (!selectedSession) return
    setCancelling(true)

    // Stunde absagen
    await supabase.from('sessions').update({
      is_cancelled: true,
      cancel_reason: replacementDate ? `Ersatztermin: ${replacementDate}` : 'Abgesagt'
    }).eq('id', selectedSession.id)

    // Credits für alle aktiven Buchungen freigeben
    const activeBookings = sessionBookings.filter(b => b._type === 'booking' && b.status === 'active')
    for (const b of activeBookings) {
      await supabase.from('bookings').update({
        status: 'cancelled', cancelled_at: new Date().toISOString()
      }).eq('id', b.id)
      // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
    }

    // Ersatztermin anlegen?
    if (replacementDate && replacementTime) {
      const { data: newSession } = await supabase.from('sessions').insert({
        course_id: selectedSession.course_id,
        date: replacementDate,
        time_start: replacementTime + ':00',
        duration_min: selectedSession.duration_min,
      }).select().single()

      if (newSession) {
        // Ersatztermin mit Original verknüpfen
        await supabase.from('sessions').update({
          replacement_session_id: newSession.id
        }).eq('id', selectedSession.id)

        // Credits wieder verbuchen für aktive Buchungen
        for (const b of activeBookings) {
          // Neue Buchung für Ersatztermin
          await supabase.from('bookings').insert({
            user_id: b.user_id, session_id: newSession.id,
            credit_id: b.credit_id, type: b.type, status: 'active'
          })
          // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
        }
      }
    }

    // Emails an alle betroffenen Yogis
    for (const b of activeBookings) {
      const userEmail = b.profile?.email || b.email
      const firstName = b.profile?.first_name || b.first_name || 'Yogi'
      if (userEmail) {
        await Email.sessionCancelled({
          email: userEmail,
          firstName,
          courseName: selectedSession.course?.name || '',
          date: selectedSession.date || '',
          timeStart: selectedSession.time_start || '',
          replacementDate: replacementDate || undefined,
          replacementTime: replacementTime || undefined,
        })
        if (replacementDate && replacementTime) {
          await Email.bookingConfirmed({
            email: userEmail,
            firstName,
            courseName: selectedSession.course?.name || '',
            date: replacementDate,
            timeStart: replacementTime,
            durationMin: selectedSession.duration_min || 75,
          })
        }
      }
    }

    await supabase.from('audit_log').insert({
      action: 'session_cancelled',
      details: {
        session_id: selectedSession.id,
        replacement_date: replacementDate || null,
        affected_yogis: activeBookings.length
      }
    })

    setShowCancelForm(false)
    setSelectedSession(null)
    setReplacementDate('')
    setReplacementTime('')
    setCancelling(false)
    loadData()
  }

  const monday = getMonday(new Date())
  const weekStart = addDays(monday, weekOffset * 7)
  const weekLabel = weekOffset === 0 ? 'Diese Woche'
    : weekOffset === 1 ? 'Nächste Woche'
    : weekOffset === -1 ? 'Vorherige Woche'
    : formatWeekRange(weekStart)

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>

  // Swipe-Navigation für Wochenansicht: links→nächste, rechts→vorherige
  const swipeHandlers = useSwipe({
    onSwipeLeft: () => setWeekOffset(o => o + 1),
    onSwipeRight: () => setWeekOffset(o => o - 1),
  })

  return (
    <div className="max-w-md mx-auto min-h-screen" {...swipeHandlers}>
      <AppHeader title="Admin Dashboard" isAdmin />
      <div className="px-4 py-4">

        {/* Session Detail Modal */}
        {selectedSession && !showCancelForm && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end">
            <div className="bg-yoga-bg w-full max-w-md mx-auto rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold">{selectedSession.course?.name}</h3>
                  <p className="text-sm text-yoga-text/55">{new Date(selectedSession.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'long' })} · {selectedSession.time_start?.slice(0,5)} Uhr</p>
                </div>
                <button onClick={() => setSelectedSession(null)} className="text-yoga-text/40 text-2xl border-0 bg-transparent cursor-pointer">
                  <i className="ti ti-x" />
                </button>
              </div>

              {/* Yogi hinzufügen */}
              {!selectedSession.is_cancelled && (
                <button onClick={() => { setShowDashAddYogi(true); setDashYogiSearch(''); setDashYogiResults([]) }}
                  className="w-full btn-secondary text-sm mb-3 flex items-center justify-center gap-2">
                  <i className="ti ti-user-plus" />Yogi hinzufügen
                </button>
              )}

              {/* Angemeldete Yogis */}
              <p className="section-label">Angemeldet ({sessionBookings.filter(b => b._type === 'booking' && b.status === 'active').length})</p>
              {sessionBookings.filter(b => b._type === 'booking' && b.status === 'active').map(b => (
                <div key={b.id} className="card mb-2 flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{b.profile?.first_name} {b.profile?.last_name}</div>
                    <div className="text-xs text-yoga-text/50">{b.profile?.email}</div>
                  </div>
                  <button onClick={() => cancelBookingForYogi(b.id, b.credit_id, selectedSession.id)}
                    className="text-xs bg-yoga-red-bg text-yoga-red-text border-0 rounded-full px-2.5 py-1 cursor-pointer font-semibold flex-shrink-0">
                    Austragen
                  </button>
                </div>
              ))}

              {/* Ausgetragen */}
              {sessionBookings.filter(b => b._type === 'booking' && b.status === 'cancelled').length > 0 && (
                <>
                  <p className="section-label mt-3">Ausgetragen ({sessionBookings.filter(b => b._type === 'booking' && b.status === 'cancelled').length})</p>
                  {sessionBookings.filter(b => b._type === 'booking' && b.status === 'cancelled').map(b => (
                    <div key={b.id} className="card mb-2 opacity-60 flex items-center justify-between">
                      <div className="text-sm">{b.profile?.first_name} {b.profile?.last_name}</div>
                      <span className="badge badge-left">Ausgetragen</span>
                    </div>
                  ))}
                </>
              )}

              {/* Warteliste */}
              {sessionBookings.filter(b => b._type === 'waitlist').length > 0 && (
                <>
                  <p className="section-label mt-3">Warteliste ({sessionBookings.filter(b => b._type === 'waitlist' && b.type === 'waitlist').length}) · Benachrichtigungen ({sessionBookings.filter(b => b._type === 'waitlist' && b.type === 'notify').length})</p>
                  {sessionBookings.filter(b => b._type === 'waitlist').map(w => (
                    <div key={w.id} className="card mb-2 flex items-center justify-between">
                      <div className="text-sm">{w.profile?.first_name} {w.profile?.last_name}</div>
                      <span className="badge badge-wait">{w.type === 'notify' ? 'Benachrichtigung' : `Pos. ${w.position}`}</span>
                    </div>
                  ))}
                </>
              )}

              {/* Yogi-Suche */}
              {showDashAddYogi && (
                <div className="mt-3 p-3 bg-yoga-bg border border-yoga-border2 rounded-yoga">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold">Yogi hinzufügen</p>
                    <button onClick={() => setShowDashAddYogi(false)} className="border-0 bg-transparent cursor-pointer text-yoga-text/40"><i className="ti ti-x" /></button>
                  </div>
                  <input className="field-input mb-2 text-sm" placeholder="Name eingeben..." autoFocus
                    value={dashYogiSearch} onChange={e => searchDashYogis(e.target.value)} />
                  {dashYogiResults.map(yogi => {
                    const free = (yogi.credits || []).filter((cr: any) => new Date(cr.expires_at) > new Date() && (cr.total - cr.used) > 0).reduce((s: number, cr: any) => s + cr.total - cr.used, 0)
                    return (
                      <div key={yogi.id} className="flex items-center justify-between py-2 border-b border-yoga-border">
                        <div>
                          <div className="text-sm font-semibold">{yogi.first_name} {yogi.last_name}</div>
                          <div className="text-xs text-yoga-text/50">{free > 0 ? `${free} Credits frei` : 'Kein Credit – wird vergeben'}</div>
                        </div>
                        <button onClick={() => addYogiToSession(yogi)} disabled={dashAddingYogi}
                          className="text-xs bg-yoga-text text-yoga-bg rounded-full px-3 py-1.5 font-semibold border-0 cursor-pointer disabled:opacity-40">
                          {dashAddingYogi ? '...' : 'Einbuchen'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              <button onClick={() => setShowCancelForm(true)} className="btn-danger mt-4">
                <i className="ti ti-calendar-x mr-1" /> Stunde absagen
              </button>
            </div>
          </div>
        )}

        {/* Cancel Form Modal */}
        {showCancelForm && selectedSession && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end">
            <div className="bg-yoga-bg w-full max-w-md mx-auto rounded-t-2xl p-5">
              <h3 className="text-base font-bold mb-1">Stunde absagen</h3>
              <p className="text-sm text-yoga-text/55 mb-4">
                {selectedSession.course?.name} · {new Date(selectedSession.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'long' })}
              </p>

              <div className="bg-yoga-amber-bg border border-yoga-amber-text/20 rounded-yoga p-3 mb-4">
                <p className="text-sm text-yoga-amber-text leading-relaxed">
                  Alle {sessionBookings.filter(b => b._type === 'booking' && b.status === 'active').length} angemeldeten Yogis bekommen ihren Credit zurück. Wenn du einen Ersatztermin einträgst, wird der Credit direkt wieder verbucht.
                </p>
              </div>

              <p className="section-label">Ersatztermin (optional)</p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="field-label">Datum</label>
                  <input className="field-input" type="date" value={replacementDate}
                    onChange={e => setReplacementDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]} />
                </div>
                <div>
                  <label className="field-label">Uhrzeit</label>
                  <input className="field-input" type="time" value={replacementTime}
                    onChange={e => setReplacementTime(e.target.value)} />
                </div>
              </div>

              {replacementDate && (
                <div className="bg-yoga-green-bg border border-yoga-green-text/20 rounded-yoga p-3 mb-4">
                  <p className="text-sm text-yoga-green-text">
                    Ersatztermin am {new Date(replacementDate + 'T00:00:00').toLocaleDateString('de-DE', { weekday:'long', day:'numeric', month:'long' })} wird angelegt. Credits werden direkt wieder verbucht.
                  </p>
                </div>
              )}

              <button onClick={cancelSession} disabled={cancelling} className="btn-danger mb-2">
                {cancelling ? 'Wird abgesagt...' : replacementDate ? 'Absagen & Ersatztermin anlegen' : 'Stunde absagen (Credits freigeben)'}
              </button>
              <button onClick={() => setShowCancelForm(false)} className="btn-ghost">Abbrechen</button>
            </div>
          </div>
        )}

        {/* Admin Benachrichtigungen */}
        {notifications.length > 0 && (
          <div className="mb-4">
            <p className="section-label">Benachrichtigungen</p>
            {notifications.map(n => (
              <div key={n.id} className="card mb-2 border-l-4 border-l-yoga-amber-text">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-yoga-amber-text">
                      {n.type === 'account_deleted' ? 'Account gelöscht'
                        : n.type === 'account_deleted_dsgvo' ? 'Account DSGVO-gelöscht (PDF im Drive löschen!)'
                        : n.type === 'new_yogi_registered' ? 'Neuer Yogi registriert'
                        : n.type === 'email_failed' ? 'E-Mail konnte nicht zugestellt werden'
                        : n.type === 'system_alert' ? 'System-Warnung'
                        : n.type}
                    </p>
                    <p className="text-sm text-yoga-text/70 mt-0.5">{n.message}</p>
                    <p className="text-xs text-yoga-text/40 mt-1">
                      {new Date(n.created_at).toLocaleDateString('de-DE', { day:'numeric', month:'short' })} · {new Date(n.created_at).toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' })}
                    </p>
                  </div>
                  <button onClick={async () => {
                    await supabase.from('admin_notifications').update({ read: true }).eq('id', n.id)
                    setNotifications(prev => prev.filter(x => x.id !== n.id))
                  }} className="text-yoga-text/40 border-0 bg-transparent cursor-pointer text-lg flex-shrink-0">
                    <i className="ti ti-x" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Woche Navigation */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setWeekOffset(o => o - 1)}
            className="flex items-center gap-1 text-sm font-semibold px-3 py-2 border-2 border-yoga-text/30 rounded-full text-yoga-text">
            <i className="ti ti-chevron-left" /> Zurück
          </button>
          <span className="text-sm font-bold">{weekLabel}</span>
          <button onClick={() => setWeekOffset(o => o + 1)}
            className="flex items-center gap-1 text-sm font-semibold px-3 py-2 border-2 border-yoga-text/30 rounded-full text-yoga-text">
            Vor <i className="ti ti-chevron-right" />
          </button>
        </div>

        {/* Wöchentliche Stats */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            { key: 'buchungen', label: 'Buchungen', value: stats.bookings },
            { key: 'abmeldungen', label: 'Abmeldungen', value: stats.cancellations },
            { key: 'warteliste', label: 'Warteliste', value: stats.waitlist },
          ].map(tile => (
            <button key={tile.key}
              onClick={() => router.push(`/admin/stats/${tile.key}`)}
              className="card text-center cursor-pointer hover:border-yoga-border2 active:opacity-70 transition-opacity">
              <div className="text-2xl font-bold">{tile.value}</div>
              <div className="text-xs text-yoga-text/50">{tile.label}</div>
            </button>
          ))}
        </div>

        {/* Schnellzugriff */}
        <div className="grid grid-cols-2 gap-2 mb-5">
          {[
            { label: 'Yogis', icon: 'ti-users', href: '/admin/yogis' },
            { label: 'Einladen', icon: 'ti-user-plus', href: '/admin/einladen' },
            { label: 'Kurse', icon: 'ti-calendar', href: '/admin/kurse' },
            { label: 'Protokoll', icon: 'ti-list-details', href: '/admin/protokoll' },
          ].map(item => (
            <button key={item.href} onClick={() => router.push(item.href)}
              className="card flex flex-col items-center py-4 gap-2 cursor-pointer hover:border-yoga-border2">
              <i className={`ti ${item.icon} text-2xl text-yoga-text/60`} />
              <span className="text-sm font-semibold">{item.label}</span>
            </button>
          ))}
        </div>

        {/* Kursstunden diese Woche */}
        <p className="section-label">Stunden {weekLabel.toLowerCase()}</p>
        {sessions.length === 0 ? (
          <p className="text-sm text-yoga-text/40 text-center py-4">Keine Stunden diese Woche</p>
        ) : sessions.map(s => {
          const isPast = new Date(`${s.date}T${s.time_start}`) < new Date()
          return (
            <button key={s.id} onClick={() => loadSessionDetail(s)}
              className={`w-full card mb-3 text-left hover:border-yoga-border2 ${s.is_cancelled || isPast ? 'opacity-40' : ''}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="text-sm font-bold">{s.course?.name}</div>
                  <div className="text-xs text-yoga-text/55">
                    {new Date(s.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short' })} · {s.time_start?.slice(0,5)} Uhr
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {s.is_cancelled ? (
                    <span className="badge badge-full">Abgesagt</span>
                  ) : isPast ? (
                    <span className="badge bg-yoga-gray text-yoga-text/40">Vergangen</span>
                  ) : (
                    <span className={`badge ${s.active_count >= s.course?.max_spots ? 'badge-full' : 'badge-free'}`}>
                      {s.active_count}/{s.course?.max_spots}
                    </span>
                  )}
                  <i className="ti ti-chevron-right text-sm text-yoga-text/30" />
                </div>
              </div>
              {!s.is_cancelled && !isPast && (
                <div className="flex gap-3 text-xs text-yoga-text/50">
                  <span><i className="ti ti-check mr-0.5" />{s.active_count} angemeldet</span>
                  {s.cancelled_count > 0 && <span><i className="ti ti-x mr-0.5" />{s.cancelled_count} ausgetragen</span>}
                </div>
              )}
            </button>
          )
        })}
      </div>
      <BottomNav isAdmin />
    </div>
  )
}
