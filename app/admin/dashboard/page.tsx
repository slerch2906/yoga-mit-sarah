'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Email } from '@/lib/email'
import { promoteWaitlistOrOfferLate } from '@/lib/waitlist-promote'
import { useSwipe } from '@/lib/useSwipe'
import { selectCreditForBooking } from '@/lib/credit-selector'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'
import WeekPickerPopover from '@/components/WeekPickerPopover'
import AdminAnnouncementBubble from '@/components/AdminAnnouncementBubble'

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
  // Sarah-Wunsch 2026-05-24: Dashboard-Kachel für offene Kursabbruch-Aufgaben
  const [pendingCancellations, setPendingCancellations] = useState({ refunds: 0, openChoices: 0 })
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] = useState<any[]>([])
  const [showCancelForm, setShowCancelForm] = useState(false)
  const [replacementDate, setReplacementDate] = useState('')
  const [replacementTime, setReplacementTime] = useState('')
  const [cancelling, setCancelling] = useState(false)
  // Nachträglicher Ersatztermin für eine bereits abgesagte Stunde (vom Modal aus)
  const [showAddReplacement, setShowAddReplacement] = useState(false)
  const [lateReplacementDate, setLateReplacementDate] = useState('')
  const [lateReplacementTime, setLateReplacementTime] = useState('')
  const [addingReplacement, setAddingReplacement] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { loadData() }, [weekOffset])

  // Sarah 2026-05-23: Stunden-Detail ist ein Modal über dem Dashboard.
  // Browser-Back (z.B. Wisch-zurück auf dem Handy) soll NUR das Modal schließen,
  // nicht zur vorherigen Page navigieren. Pattern: pushState beim Öffnen,
  // popstate-Listener schließt Modal. Cleanup macht back() falls Modal anders
  // geschlossen wurde, damit kein „Geist-Eintrag" in der History bleibt.
  useEffect(() => {
    if (!selectedSession) return
    window.history.pushState({ sessionModal: true }, '')
    const handlePopState = () => {
      setSelectedSession(null)
      setShowAddReplacement(false)
      setLateReplacementDate('')
      setLateReplacementTime('')
    }
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      // Wenn das Modal programmatisch geschlossen wurde (X-Button, action complete),
      // ist der pushed history-Eintrag noch da → entfernen, damit der nächste
      // Browser-Back nicht ins Leere geht.
      if (window.history.state?.sessionModal) {
        window.history.back()
      }
    }
  }, [selectedSession])

  async function loadData() {
    // KEIN setLoading(true) hier — sonst zeigt Wochenwechsel via Swipe einen leeren
    // Spinner. Alte Daten bleiben bis neue da sind, dann sanfter Re-Render.
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

    // Ersatzstunden-Mapping: welche Sessions sind die Ersatzstunden für eine abgesagte?
    // Wir suchen alle Sessions deren replacement_session_id auf eine sichtbare Session zeigt
    // → dann wissen wir: diese sichtbare Session IST eine Ersatzstunde.
    const sessionIds = (sessionData || []).map((s: any) => s.id)
    let originMap: Record<string, any> = {}
    if (sessionIds.length > 0) {
      const { data: origins } = await supabase
        .from('sessions')
        .select('id, date, time_start, replacement_session_id, course:courses(name)')
        .in('replacement_session_id', sessionIds)
      for (const o of (origins || []) as any[]) {
        if (o.replacement_session_id) originMap[o.replacement_session_id] = o
      }
    }

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
        // Ersatzstunden-Info: wenn diese Session als Ersatz für eine andere angelegt wurde
        is_replacement: !!originMap[s.id],
        original_session: originMap[s.id] || null,
      })))
    setStats({ bookings: bookCount || 0, cancellations: cancelCount || 0, waitlist: waitCount || 0 })

    // Ungelesene Benachrichtigungen laden
    const { data: notifs } = await supabase.from('admin_notifications')
      .select('*').eq('read', false).order('created_at', { ascending: false }).limit(10)
    setNotifications(notifs || [])

    // Sarah-Wunsch 2026-05-24: Offene Kursabbruch-Aufgaben zählen
    // refunds = Yogi wählte Erstattung, noch nicht überwiesen
    // openChoices = Token nicht verfallen, Yogi hat noch nicht gewählt
    const { count: refundsCount } = await supabase.from('course_cancellation_responses')
      .select('id', { count: 'exact', head: true })
      .eq('choice', 'erstattung').eq('refund_paid', false)
    const { count: openCount } = await supabase.from('course_cancellation_responses')
      .select('id', { count: 'exact', head: true })
      .is('choice', null).gte('expires_at', new Date().toISOString())
    setPendingCancellations({ refunds: refundsCount || 0, openChoices: openCount || 0 })

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

    // Sarah-Regel 2026-05-23: zentraler Helper mit 90-Min-Cutoff.
    // > 90 Min: erster Waitlist-Yogi wird auto-promoted (alte Logic).
    // ≤ 90 Min: alle Waitlist-Yogis kriegen Auswahl-Mail mit Token.
    // Notify-Subscribers werden in beiden Fällen informiert.
    try { await promoteWaitlistOrOfferLate(supabase, sessionId) } catch(e) { console.error('promote:', e) }

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

    // Sarah-Regel 2026-05-22: gleiche Logic wie Yogi-Selbstbuchung.
    // Course-Credit zuerst (mit minutengenauem Window-Check), dann Single/Tenpack/Quartal.
    const pick = await selectCreditForBooking(
      supabase, yogi.id, selectedSession.id,
      selectedSession.date, selectedSession.time_start
    )

    let creditId: string | null = null
    let originSessionId: string | null = null
    let usedModel: string = 'single'

    if (pick.ok) {
      creditId = pick.creditId
      originSessionId = pick.originSessionId
      usedModel = pick.usedModel
    } else {
      // Kein passender Credit/Anspruch → Admin entscheidet ob trotzdem
      const proceed = confirm(`${pick.message}\n\nSoll ich trotzdem einen Quick-Credit (1 Einzelstunde) für diese Buchung anlegen?`)
      if (!proceed) {
        setDashAddingYogi(false)
        return
      }
      const expiry = new Date(); expiry.setFullYear(expiry.getFullYear() + 1)
      const { data: nc } = await supabase.from('credits').insert({
        user_id: yogi.id, total: 1, used: 1, expires_at: expiry.toISOString(), model: 'single', course_id: null
      }).select('id').single()
      creditId = nc?.id || null
    }

    // Yogi enrolled in Kurs der Session? Dann type=course (gehört in den Kurs-Block, nicht Einzelstunden)
    const { data: enrolledHere } = await supabase.from('enrollments')
      .select('id').eq('user_id', yogi.id).eq('course_id', selectedSession.course_id).maybeSingle()
    const bookingType = (enrolledHere || usedModel === 'course') ? 'course' : 'single'

    await supabase.from('bookings').insert({
      user_id: yogi.id, session_id: selectedSession.id, credit_id: creditId, type: bookingType, status: 'active',
      origin_session_id: originSessionId,
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

  // Sarah 2026-05-22: Nachträglich (= nachdem die Stunde schon abgesagt ist) eine
  // Ersatzstunde anlegen. Logik gespiegelt aus admin/sessions/[id]/handleAddLateReplacement.
  async function handleAddLateReplacementFromDashboard() {
    if (!selectedSession || !lateReplacementDate || !lateReplacementTime) return
    setAddingReplacement(true)

    // Alle stornierten Buchungen dieser Stunde laden
    const { data: cancelledBookings } = await supabase
      .from('bookings')
      .select('*, profile:profiles(email, first_name, last_name)')
      .eq('session_id', selectedSession.id)
      .eq('status', 'cancelled')

    // Neue Ersatz-Session im gleichen Kurs anlegen
    const { data: newSession } = await supabase.from('sessions').insert({
      course_id: selectedSession.course_id,
      date: lateReplacementDate,
      time_start: lateReplacementTime + ':00',
      duration_min: selectedSession.duration_min,
      is_cancelled: false,
    }).select('id').single()

    if (!newSession) { setAddingReplacement(false); return }

    // Original-Session mit Ersatztermin verknüpfen
    await supabase.from('sessions').update({
      replacement_session_id: newSession.id,
    }).eq('id', selectedSession.id)

    let enrolledCount = 0
    let skippedCount = 0
    for (const booking of (cancelledBookings || []) as any[]) {
      if (!booking.credit_id) continue
      const { data: credit } = await supabase.from('credits')
        .select('*').eq('id', booking.credit_id).maybeSingle()
      const creditAvailable = credit
        && (credit.total - credit.used) > 0
        && new Date(credit.expires_at) > new Date()
      if (!creditAvailable) { skippedCount++; continue }

      const { error: bookingError } = await supabase.from('bookings').upsert({
        user_id: booking.user_id,
        session_id: newSession.id,
        credit_id: booking.credit_id,
        type: booking.type || 'course',
        status: 'active',
        cancelled_at: null,
        cancel_late: false,
      }, { onConflict: 'user_id,session_id' })

      if (bookingError) { skippedCount++; continue }
      enrolledCount++

      if (booking.profile?.email) {
        await Email.sessionAdded({
          email: booking.profile.email,
          firstName: booking.profile.first_name || 'Yogi',
          courseName: selectedSession.course?.name || '',
          date: lateReplacementDate,
          timeStart: lateReplacementTime,
          durationMin: selectedSession.duration_min || 60,
          originalDate: selectedSession.date,
          originalTime: selectedSession.time_start,
        })
      }
    }

    await supabase.from('audit_log').insert({
      action: 'replacement_session_added',
      details: {
        original_session_id: selectedSession.id,
        replacement_session_id: newSession.id,
        course: selectedSession.course?.name,
        date: lateReplacementDate,
        yogis_enrolled: enrolledCount,
        yogis_skipped: skippedCount,
        source: 'admin_dashboard',
      }
    })

    setAddingReplacement(false)
    setShowAddReplacement(false)
    setLateReplacementDate('')
    setLateReplacementTime('')
    setSelectedSession(null)
    const skipNote = skippedCount > 0
      ? ` ${skippedCount} Yogi(s) nicht eingebucht – Credit bereits in einer anderen Stunde verwendet.`
      : ''
    alert(`Ersatztermin angelegt! ${enrolledCount} Yogi(s) eingebucht und informiert.${skipNote}`)
    loadData()
  }

  // Swipe-Navigation VOR jedem early return — React-Hooks-Reihenfolge muss stabil sein
  const swipeHandlers = useSwipe({
    onSwipeLeft: () => setWeekOffset(o => o + 1),
    onSwipeRight: () => setWeekOffset(o => o - 1),
  })

  const monday = getMonday(new Date())
  const weekStart = addDays(monday, weekOffset * 7)
  const weekLabel = weekOffset === 0 ? 'Diese Woche'
    : weekOffset === 1 ? 'Nächste Woche'
    : weekOffset === -1 ? 'Vorherige Woche'
    : formatWeekRange(weekStart)

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>

  return (
    <div className="max-w-md mx-auto min-h-screen" {...swipeHandlers}>
      <AppHeader title="Admin Dashboard" isAdmin />
      {/* Sprechblase auch für Admin sichtbar — Erinnerung dass die Nachricht aktiv ist */}
      <AdminAnnouncementBubble />

      {/* Sarah-Wunsch 2026-05-24: Action-Kachel für offene Kursabbruch-Aufgaben.
          Erscheint NUR wenn Aufgaben offen sind. Klick → /admin/kursabbruch */}
      {(pendingCancellations.refunds > 0 || pendingCancellations.openChoices > 0) && (
        <div className="px-4 pt-3">
          <button onClick={() => router.push('/admin/kursabbruch')}
            className="w-full text-left bg-white border border-yoga-border rounded-yoga p-3 cursor-pointer hover:opacity-80 transition-opacity">
            <div className="flex items-start gap-3">
              <i className="ti ti-calendar-off text-2xl text-yoga-text flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-yoga-text">
                  Kursabbrüche — offene Aufgaben
                </div>
                <div className="text-xs text-yoga-text/70 mt-0.5">
                  {pendingCancellations.refunds > 0 && (
                    <span className="block">
                      💰 {pendingCancellations.refunds} {pendingCancellations.refunds === 1 ? 'Erstattung' : 'Erstattungen'} überweisen
                    </span>
                  )}
                  {pendingCancellations.openChoices > 0 && (
                    <span className="block">
                      ⏳ {pendingCancellations.openChoices} {pendingCancellations.openChoices === 1 ? 'Yogi hat' : 'Yogis haben'} noch nicht entschieden
                    </span>
                  )}
                </div>
              </div>
              <i className="ti ti-chevron-right text-yoga-text/40 flex-shrink-0" />
            </div>
          </button>
        </div>
      )}

      <div className="px-4 py-4">

        {/* Session Detail Modal */}
        {selectedSession && !showCancelForm && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end modal-overlay">
            <div className="bg-yoga-bg w-full max-w-md mx-auto rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold">
                    {selectedSession.course?.name}
                    {selectedSession.is_replacement && (
                      <span className="text-yoga-amber-text font-semibold"> · Ersatzstunde</span>
                    )}
                  </h3>
                  <p className="text-sm text-yoga-text/55">{new Date(selectedSession.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'long' })} · {selectedSession.time_start?.slice(0,5)} Uhr</p>
                  {selectedSession.is_replacement && selectedSession.original_session && (
                    <p className="text-xs text-yoga-amber-text mt-1 flex items-center gap-1">
                      <i className="ti ti-arrow-back-up" />
                      Ersatzstunde für{' '}
                      <strong>
                        {new Date(selectedSession.original_session.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'long' })}
                        {' · '}{selectedSession.original_session.time_start?.slice(0,5)} Uhr
                      </strong>
                    </p>
                  )}
                </div>
                <button onClick={() => {
                  setSelectedSession(null)
                  setShowAddReplacement(false)
                  setLateReplacementDate('')
                  setLateReplacementTime('')
                }} className="text-yoga-text/40 text-2xl border-0 bg-transparent cursor-pointer">
                  <i className="ti ti-x" />
                </button>
              </div>

              {/* Bei ABGESAGTER Stunde: Ersatzstunde anlegen (sofern noch keine verknüpft ist) */}
              {selectedSession.is_cancelled && !selectedSession.replacement_session_id && !showAddReplacement && (
                <button onClick={() => setShowAddReplacement(true)}
                  className="w-full btn-secondary text-sm mb-3 flex items-center justify-center gap-2">
                  <i className="ti ti-calendar-plus" />Ersatzstunde anlegen
                </button>
              )}
              {selectedSession.is_cancelled && showAddReplacement && (
                <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-3 mb-3">
                  <p className="text-sm font-semibold mb-2">Ersatztermin für diese abgesagte Stunde</p>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div>
                      <label className="field-label">Datum</label>
                      <input className="field-input text-sm" type="date" value={lateReplacementDate}
                        onChange={e => setLateReplacementDate(e.target.value)}
                        min={new Date().toISOString().split('T')[0]} />
                    </div>
                    <div>
                      <label className="field-label">Uhrzeit</label>
                      <input className="field-input text-sm" type="time" value={lateReplacementTime}
                        onChange={e => setLateReplacementTime(e.target.value)} />
                    </div>
                  </div>
                  <p className="text-xs text-yoga-text/55 mb-3">
                    Alle ausgetragenen Yogis werden automatisch in den Ersatztermin eingebucht
                    und per Email informiert. Die Kurs-Einheiten ändern sich nicht.
                  </p>
                  <div className="flex gap-2">
                    <button onClick={handleAddLateReplacementFromDashboard}
                      disabled={!lateReplacementDate || !lateReplacementTime || addingReplacement}
                      className="flex-1 btn-primary text-sm disabled:opacity-40">
                      {addingReplacement ? 'Wird angelegt...' : 'Ersatzstunde anlegen'}
                    </button>
                    <button onClick={() => { setShowAddReplacement(false); setLateReplacementDate(''); setLateReplacementTime('') }}
                      className="flex-1 btn-ghost text-sm">Abbrechen</button>
                  </div>
                </div>
              )}

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

              {!selectedSession.is_cancelled && (
                <button onClick={() => setShowCancelForm(true)} className="btn-danger mt-4">
                  <i className="ti ti-calendar-x mr-1" /> Stunde absagen
                </button>
              )}
            </div>
          </div>
        )}

        {/* Cancel Form Modal */}
        {showCancelForm && selectedSession && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end modal-overlay">
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

        {/* Admin Benachrichtigungen — Sarah-Wunsch 2026-05-24: ausgebaut mit
            8 neuen Typen (refund_pending, cron_silent_24h, brevo_quota_warning,
            agb_push_stuck, course_completed, yogi_birthday) plus bestehenden
            (new_yogi_registered, account_deleted_dsgvo, email_failed). Jeder
            Typ hat Icon, Label, Farbe (action-required vs info) + ggf. Link. */}
        {notifications.length > 0 && (
          <div className="mb-4">
            <p className="section-label">Benachrichtigungen</p>
            {notifications.map(n => {
              // Notification-Type-Mapping
              type NMeta = { label: string; icon: string; tone: 'action' | 'warn' | 'info'; href?: string }
              const META: Record<string, NMeta> = {
                // 🔴 ACTION-REQUIRED (du musst handeln)
                refund_pending:        { label: 'Erstattung überweisen', icon: 'ti-cash',           tone: 'action', href: '/admin/kursabbruch' },
                cron_silent_24h:       { label: 'Reminder-Cron seit 24h still', icon: 'ti-alert-octagon', tone: 'action' },
                brevo_quota_warning:   { label: 'Brevo-Kontingent fast aufgebraucht', icon: 'ti-mail-exclamation', tone: 'action' },
                email_failed:          { label: 'E-Mail konnte nicht zugestellt werden', icon: 'ti-mail-x', tone: 'action' },
                // 🟡 WARNINGS
                course_almost_full:    { label: 'Kurs fast voll', icon: 'ti-users', tone: 'warn' },
                // 🟢 INFO
                new_yogi_registered:   { label: 'Neuer Yogi registriert', icon: 'ti-user-plus', tone: 'info' },
                account_deleted:       { label: 'Account gelöscht', icon: 'ti-user-x', tone: 'info' },
                account_deleted_dsgvo: { label: 'Account DSGVO-gelöscht (PDF im Drive löschen!)', icon: 'ti-user-x', tone: 'action' },
                course_ending_soon:    { label: 'Kurs endet in 2 Wochen — Folgekurs?', icon: 'ti-calendar-event', tone: 'warn' },
                yogi_birthday:         { label: 'Yogi hat Geburtstag 🎂', icon: 'ti-cake', tone: 'info' },
                system_alert:          { label: 'System-Warnung', icon: 'ti-alert-triangle', tone: 'warn' },
              }
              const meta = META[n.type] || { label: n.type, icon: 'ti-bell', tone: 'info' as const }
              const tones = {
                action: 'border-l-yoga-red-text  text-yoga-red-text',
                warn:   'border-l-yoga-amber-text text-yoga-amber-text',
                info:   'border-l-yoga-text/40    text-yoga-text/80',
              }
              const toneCls = tones[meta.tone]
              return (
                <div key={n.id} className={`card mb-2 border-l-4 ${toneCls.split(' ')[0]}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold flex items-center gap-1.5 ${toneCls.split(' ')[1]}`}>
                        <i className={`ti ${meta.icon}`} />
                        {meta.label}
                      </p>
                      <p className="text-sm text-yoga-text/70 mt-0.5">{n.message}</p>
                      <p className="text-xs text-yoga-text/40 mt-1">
                        {new Date(n.created_at).toLocaleDateString('de-DE', { day:'numeric', month:'short' })} · {new Date(n.created_at).toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' })}
                      </p>
                      {meta.href && (
                        <button onClick={() => router.push(meta.href!)}
                          className="text-xs mt-1.5 text-yoga-text underline cursor-pointer bg-transparent border-0 p-0">
                          → Jetzt erledigen
                        </button>
                      )}
                    </div>
                    <button onClick={async () => {
                      await supabase.from('admin_notifications').update({ read: true }).eq('id', n.id)
                      setNotifications(prev => prev.filter(x => x.id !== n.id))
                    }} className="text-yoga-text/40 border-0 bg-transparent cursor-pointer text-lg flex-shrink-0">
                      <i className="ti ti-x" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Woche Navigation — kompakte Buttons (Sarah-Wunsch 2026-05-23) */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setWeekOffset(o => o - 1)}
            className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 border border-yoga-text/30 rounded-full text-yoga-text">
            <i className="ti ti-chevron-left text-sm" /> Zurück
          </button>
          <WeekPickerPopover
            currentWeekStart={weekStart}
            onSelectWeek={(mon) => {
              // Anzahl Wochen-Differenz zur aktuellen Heute-Woche berechnen
              const today = new Date(); today.setHours(0,0,0,0)
              const todayMon = getMonday(today)
              const diffDays = Math.round((mon.getTime() - todayMon.getTime()) / 86400000)
              setWeekOffset(Math.round(diffDays / 7))
            }}>
            {weekLabel}
          </WeekPickerPopover>
          <button onClick={() => setWeekOffset(o => o + 1)}
            className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 border border-yoga-text/30 rounded-full text-yoga-text">
            Vor <i className="ti ti-chevron-right text-sm" />
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

        {/* Sarah-Wunsch 2026-05-23: Schnellzugriff-Kacheln entfernt.
            Yogis/Einladen/Kurse sind in der Bottom-Nav, Protokoll im "Mehr"-Menü. */}

        {/* Kursstunden — Überschrift entfernt (Sarah 2026-05-23):
            Wochen-Label oben ist schon klar genug, doppelte Beschriftung spart Platz. */}
        {sessions.length === 0 ? (
          <p className="text-sm text-yoga-text/40 text-center py-4">Keine Stunden diese Woche</p>
        ) : sessions.map(s => {
          const now = new Date()
          const isPast = new Date(`${s.date}T${s.time_start}`) < now
          // "Heute" = die Stunde findet am heutigen Kalendertag statt (auch nach Start, bis Mitternacht)
          const sDate = new Date(`${s.date}T00:00:00`)
          const isToday = sDate.getFullYear() === now.getFullYear()
            && sDate.getMonth() === now.getMonth()
            && sDate.getDate() === now.getDate()
          // Highlight nur für heute UND nicht vorbei UND nicht abgesagt
          const highlight = isToday && !isPast && !s.is_cancelled
          return (
            <button key={s.id} onClick={() => loadSessionDetail(s)}
              className={`w-full card mb-3 text-left hover:border-yoga-border2 ${s.is_cancelled || isPast ? 'opacity-40' : ''} ${highlight ? 'border-2 border-yoga-text' : ''}`}>
              {/* Sarah-Wunsch 2026-05-24: Wochentag vorne groß (analog Yogi-Pattern) */}
              <div className="flex items-center gap-3">
                <div className="text-center flex-shrink-0 w-14">
                  <div className="text-base font-bold">
                    {new Date(s.date).toLocaleDateString('de-DE', { weekday: 'short' })}
                  </div>
                  <div className="text-xs text-yoga-text/50 mt-0.5">
                    {new Date(s.date).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
                <div className="w-px h-10 bg-yoga-border2 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">
                    {s.course?.name}
                    {s.is_replacement && (
                      <span className="text-yoga-amber-text font-semibold"> · Ersatzstunde</span>
                    )}
                  </div>
                  <div className="text-xs text-yoga-text/55 mt-0.5">
                    {s.time_start?.slice(0,5)}
                    {!s.is_cancelled && !isPast && (
                      <>
                        <span className="mx-1">·</span>
                        <i className="ti ti-check" /> {s.active_count} angemeldet
                        {s.cancelled_count > 0 && <> · <i className="ti ti-x" /> {s.cancelled_count} ausgetragen</>}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
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
            </button>
          )
        })}
      </div>
      <BottomNav isAdmin />
    </div>
  )
}
