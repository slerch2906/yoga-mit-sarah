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
import AdminBirthdayBanner from '@/components/AdminBirthdayBanner'
import { sessionDisplayName } from '@/lib/session-display'

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
  // Sarah-Wunsch 2026-05-25: 3h-Frist-Modal auch im Dashboard (gleiches Pattern wie /admin/sessions/[id])
  // Welle 4 (Sarah 2026-05-26): sessionType im cancelChoice-State, damit
  // Modal-Render bei Events das 3h-Frist-Choice NICHT mehr anzeigt (Defense-in-Depth).
  const [cancelChoice, setCancelChoice] = useState<{ bookingId: string; sessionId: string; within3h: boolean; sessionType?: string } | null>(null)
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
  // Welle 6 (Sarah 2026-05-27, Item 3 Fix): useEffect haengt jetzt an
  // !!selectedSession (Boolean), NICHT am Objekt selbst. Vorher wurde der
  // Effekt bei jedem `setSelectedSession({...prev, external_participants_count})`
  // re-run → Cleanup feuerte window.history.back() → popstate → modal weg.
  // Jetzt: pushState passiert nur wenn das Modal sich oeffnet/schliesst.
  const selectedSessionOpen = !!selectedSession
  useEffect(() => {
    if (!selectedSessionOpen) return
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
  }, [selectedSessionOpen])

  // Welle 3.5 (Sarah 2026-05-26): gleiches Pattern fuer Cancel-Form-Modal und
  // Cancel-Choice-Modal — Handy-Swipe schliesst das Modal, kein Page-Back.
  useEffect(() => {
    if (!showCancelForm && !cancelChoice) return
    window.history.pushState({ cancelModal: true }, '')
    const handler = () => {
      setShowCancelForm(false); setCancelChoice(null)
    }
    window.addEventListener('popstate', handler)
    return () => {
      window.removeEventListener('popstate', handler)
      if (window.history.state?.cancelModal) window.history.back()
    }
  }, [showCancelForm, cancelChoice])

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
      // Welle 2.6: session.name + session_type sind via `*` mit dabei — Display-Name
      // bevorzugt session.name (SYS-Container-Name würde sonst durchschlagen).
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
    // Sarah-Wunsch 2026-05-25: 3h-Frist-Auswahl als Modal (statt confirm).
    // Welle 4 (Sarah 2026-05-26): Bei Events kein 3h-Frist-Modal — Admin darf
    // jederzeit austragen. event_paid + <7d: nur Hinweis auf externe Erstattung.
    const { data: freshSession } = await supabase.from('sessions')
      .select('date, time_start, session_type, price_eur, name').eq('id', sessionId).single()
    const sessType = freshSession?.session_type
    const isEvent = sessType === 'event_free' || sessType === 'event_paid'
    const isPaidEvent = sessType === 'event_paid'

    if (isEvent) {
      let confirmText = 'Yogi aus dem Event austragen?'
      if (isPaidEvent && freshSession) {
        const sessionStart = new Date(`${freshSession.date}T${freshSession.time_start}`).getTime()
        const within7d = (sessionStart - Date.now()) <= 7 * 24 * 60 * 60 * 1000 && sessionStart > Date.now()
        if (within7d) {
          confirmText = `Yogi aus dem Event austragen?\n\n⚠️ Innerhalb der 7-Tage-Stornofrist — eine eventuell schon geleistete Bezahlung (${freshSession.price_eur || '?'} €) musst du extern erstatten.`
        }
      }
      if (!confirm(confirmText)) return
      await supabase.from('bookings').update({
        status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false,
      }).eq('id', bookingId)
      // Welle 6A (Sarah 2026-05-27): within_7d + name für klares Protokoll
      let _within7d = false
      if (isPaidEvent && freshSession) {
        const _start = new Date(`${freshSession.date}T${freshSession.time_start}`).getTime()
        _within7d = (_start - Date.now()) <= 7 * 24 * 60 * 60 * 1000 && _start > Date.now()
      }
      await supabase.from('audit_log').insert({
        action: 'booking_cancelled_by_admin',
        details: {
          booking_id: bookingId, session_id: sessionId,
          session_type: sessType, credit_returned: false, within_3h: false,
          within_7d: _within7d,
          name: freshSession?.name || null,
          session_date: freshSession?.date, session_time: freshSession?.time_start,
        }
      })
      // Reload
      if (selectedSession) loadSessionDetail(selectedSession)
      loadData()
      return
    }

    let within3h = false
    if (freshSession) {
      const sessionStart = new Date(`${freshSession.date}T${freshSession.time_start}`).getTime()
      within3h = (sessionStart - Date.now()) <= 3 * 60 * 60 * 1000 && sessionStart > Date.now()
    }
    setCancelChoice({ bookingId, sessionId, within3h, sessionType: sessType })
  }

  async function confirmCancelBooking(creditReturned: boolean) {
    if (!cancelChoice) return
    const { bookingId, sessionId, within3h, sessionType } = cancelChoice
    const cancelLate = !creditReturned
    setCancelChoice(null)

    await supabase.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: cancelLate
    }).eq('id', bookingId)

    // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
    // cancel_late=true verhindert die Rueckbuchung (Credit verfaellt)

    // Welle 6A (Sarah 2026-05-27, Item 12): freshSession aus DB ziehen fuer
    // korrekten Audit-Snapshot (selectedSession kann stale sein).
    const { data: _sessAudit } = await supabase.from('sessions')
      .select('name, date, time_start').eq('id', sessionId).maybeSingle()
    await supabase.from('audit_log').insert({
      action: 'booking_cancelled_by_admin',
      details: { booking_id: bookingId, session_id: sessionId, credit_returned: creditReturned,
                 within_3h: within3h,
                 // Welle 6A: session_type + name für klares Protokoll
                 session_type: sessionType || null,
                 name: _sessAudit?.name || null,
                 session_date: _sessAudit?.date, session_time: _sessAudit?.time_start }
    })

    // Sarah-Regel 2026-05-23: zentraler Helper mit 90-Min-Cutoff.
    try { await promoteWaitlistOrOfferLate(supabase, sessionId) } catch(e) { console.error('promote:', e) }

    // Reload session detail
    if (selectedSession) loadSessionDetail(selectedSession)
  }

  // Welle 6 (Sarah 2026-05-27, Item 10/11): Waitlist-Yogi aus Dashboard-Modal
  // nachruecken. Bei event_free + Ueberbuchung erlaubt (Item 10). Dummys ohne
  // Credit. Event allgemein ohne Credit. Booking + waitlist.delete + Audit + Mail.
  async function promoteWaitlistFromDashboard(wlEntry: any) {
    if (!selectedSession) return
    const sess = selectedSession
    const sessType: string = sess.session_type || 'course_session'
    const isEvent = sessType === 'event_free' || sessType === 'event_paid'
    const isDummyWl = !!wlEntry.profile?.is_dummy
    let creditId: string | null = null
    if (!isEvent && !isDummyWl) {
      try {
        const pick = await selectCreditForBooking(supabase, wlEntry.user_id, sess.id, sess.date, sess.time_start)
        if (pick.ok) creditId = pick.creditId
      } catch (e) { /* fallback null */ }
    }
    const totalNow = sessionBookings.filter(b => b._type === 'booking' && b.status === 'active').length + (sess.external_participants_count || 0)
    const wasOverbooking = sess.max_spots != null && totalNow >= sess.max_spots
    const { error } = await supabase.from('bookings').upsert({
      user_id: wlEntry.user_id, session_id: sess.id,
      credit_id: creditId, type: 'single', status: 'active',
      origin_session_id: null, cancelled_at: null, cancel_late: false,
    }, { onConflict: 'user_id,session_id' })
    if (error) { alert('Buchung konnte nicht angelegt werden: ' + error.message); return }
    await supabase.from('waitlist').delete().eq('id', wlEntry.id)
    await supabase.from('audit_log').insert({
      action: 'admin_promoted_waitlist_yogi',
      details: {
        user_id: wlEntry.user_id, session_id: sess.id, session_type: sessType,
        credit_used: !!creditId, was_overbooking: wasOverbooking,
        name: sess.name || null,
        session_date: sess.date, session_time: sess.time_start,
        source: 'dashboard',
      },
    })
    if (wlEntry.profile?.email && !isDummyWl) {
      try {
        await Email.bookingConfirmed({
          email: wlEntry.profile.email,
          firstName: wlEntry.profile.first_name || 'Yogi',
          courseName: sess.name || sess.course?.name || '',
          date: sess.date, timeStart: sess.time_start,
          durationMin: sess.duration_min || 75,
          isSingle: sessType !== 'course_session',
          sessionType: sessType,
        })
      } catch (e) { /* nicht-blockierend */ }
    }
    loadSessionDetail(sess)
    loadData()
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

    // Welle 2.10 (Sarah 2026-05-26): Credit-Safety bei Events.
    // event_free/event_paid → KEIN Credit-Abzug, credit_id=null.
    // Welle 6 (Sarah 2026-05-27, Item 7): zusaetzlich Dummys ohne Credit.
    const evType: string = selectedSession.session_type || 'course_session'
    const isDummy = !!yogi.is_dummy
    if (evType === 'event_free' || evType === 'event_paid' || isDummy) {
      await supabase.from('bookings').insert({
        user_id: yogi.id, session_id: selectedSession.id,
        credit_id: null, type: 'single', status: 'active',
        origin_session_id: null,
      })
      await supabase.from('audit_log').insert({
        action: isDummy && evType === 'course_session' ? 'admin_added_yogi_to_session' : 'admin_added_yogi_to_event',
        details: {
          user_id: yogi.id, session_id: selectedSession.id, session_type: evType,
          credit_used: false, price_eur: evType === 'event_paid' ? selectedSession.price_eur : null,
          is_dummy: isDummy || undefined,
          // Welle 6A (Sarah 2026-05-27): Session-Name fuer Yogi-Protokoll
          name: selectedSession.name || null,
          source: 'dashboard',
        }
      })
      setDashAddingYogi(false)
      setShowDashAddYogi(false)
      setDashYogiSearch('')
      setDashYogiResults([])
      loadSessionDetail(selectedSession)
      return
    }

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
      // Welle 4.7: Audit fuer Quick-Credit-Vergabe
      if (creditId) {
        await supabase.from('audit_log').insert({
          action: 'credit_assigned',
          details: { target_user_id: yogi.id, credit_id: creditId, amount: 1,
                     model: 'single', quick_credit: true,
                     source: 'admin_added_yogi_to_session_via_quick_credit',
                     session_id: selectedSession.id }
        })
      }
    }

    // Yogi enrolled in Kurs der Session? Dann type=course (gehört in den Kurs-Block, nicht Einzelstunden)
    const { data: enrolledHere } = await supabase.from('enrollments')
      .select('id').eq('user_id', yogi.id).eq('course_id', selectedSession.course_id).maybeSingle()
    const bookingType = (enrolledHere || usedModel === 'course') ? 'course' : 'single'

    await supabase.from('bookings').insert({
      user_id: yogi.id, session_id: selectedSession.id, credit_id: creditId, type: bookingType, status: 'active',
      origin_session_id: originSessionId,
    })
    // Welle 4.7 (Sarah 2026-05-26): Audit-Spur fuer Admin-Einbuchung Course-Pfad fehlte
    await supabase.from('audit_log').insert({
      action: 'admin_added_yogi_to_session',
      details: { user_id: yogi.id, session_id: selectedSession.id,
                 credit_id: creditId, origin_session_id: originSessionId,
                 booking_type: bookingType, source: 'dashboard' }
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
    const _sessType = selectedSession.session_type
    const _isEvent = _sessType === 'event_free' || _sessType === 'event_paid'
    const _bannerTitle = (_sessType && _sessType !== 'course_session')
      ? (selectedSession.name || '')
      : ((selectedSession as any).course?.name || selectedSession.course_name || '')
    for (const b of activeBookings) {
      await supabase.from('bookings').update({
        status: 'cancelled', cancelled_at: new Date().toISOString()
      }).eq('id', b.id)
      // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
      // Welle 6.1 (Sarah 2026-05-27): Yogi-Dashboard-Banner anlegen
      await supabase.from('yogi_notifications').insert({
        user_id: b.user_id,
        type: _isEvent ? 'event_cancelled' : 'session_cancelled',
        payload: {
          session_id: selectedSession.id,
          title: _bannerTitle,
          session_type: _sessType,
          date: selectedSession.date,
          time_start: selectedSession.time_start,
          price_eur: (selectedSession as any).price_eur ?? null,
          reason: replacementDate ? null : 'Abgesagt',
        },
      })
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
    // Welle 3 (Sarah 2026-05-26): courseName fuer Container-Sessions = session.name
    const cancelMailName = (selectedSession.session_type && selectedSession.session_type !== 'course_session')
      ? (selectedSession.name || '')
      : (selectedSession.course?.name || '')
    for (const b of activeBookings) {
      const userEmail = b.profile?.email || b.email
      const firstName = b.profile?.first_name || b.first_name || 'Yogi'
      if (userEmail) {
        await Email.sessionCancelled({
          email: userEmail,
          firstName,
          courseName: cancelMailName,
          date: selectedSession.date || '',
          timeStart: selectedSession.time_start || '',
          replacementDate: replacementDate || undefined,
          replacementTime: replacementTime || undefined,
          sessionType: selectedSession.session_type,
        })
        if (replacementDate && replacementTime) {
          await Email.bookingConfirmed({
            email: userEmail,
            firstName,
            courseName: cancelMailName,
            date: replacementDate,
            timeStart: replacementTime,
            durationMin: selectedSession.duration_min || 75,
            sessionType: selectedSession.session_type,
          })
        }
      }
    }

    await supabase.from('audit_log').insert({
      action: 'session_cancelled',
      details: {
        session_id: selectedSession.id,
        session_type: selectedSession.session_type,
        replacement_date: replacementDate || null,
        affected_yogis: activeBookings.length,
        source: 'dashboard',
      }
    })
    // Welle 4.7 (Sarah 2026-05-26): wenn Ersatztermin angelegt, separater
    // replacement_session_added-Audit (analog admin/sessions/[id]).
    if (replacementDate && replacementTime) {
      await supabase.from('audit_log').insert({
        action: 'replacement_session_added',
        details: {
          original_session_id: selectedSession.id,
          replacement_date: replacementDate, replacement_time: replacementTime,
          yogis_re_enrolled: activeBookings.length,
          source: 'dashboard',
        }
      })
    }

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
          // Welle 3: bei Container-Sessions session.name in der Mail
          courseName: (selectedSession.session_type && selectedSession.session_type !== 'course_session')
            ? (selectedSession.name || '')
            : (selectedSession.course?.name || ''),
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

      {/* Welle 6.1 (Sarah 2026-05-27): Geburtstags-Hinweis für Yogis mit
          Geburtstag in der aktuellen Woche. */}
      <AdminBirthdayBanner />

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

        {/* Cancel-Booking Modal — Sarah-Wunsch 2026-05-25: 3h-Frist Auswahl
            Welle 4 (Sarah 2026-05-26): Defense-in-Depth — bei Events das
            3h-Choice NIE anzeigen, weil Events kein Credit-System haben.
            Falls (Bug-Defensive) cancelBookingForYogi den Event-Pfad nicht
            erwischt, fallen wir hier nochmal auf einen simplen Confirm zurueck. */}
        {cancelChoice && (cancelChoice.sessionType === 'event_free' || cancelChoice.sessionType === 'event_paid') ? null : cancelChoice && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-end modal-overlay">
            <div className="bg-yoga-card w-full rounded-t-2xl p-5 pb-10">
              {cancelChoice.within3h ? (
                <>
                  {/* Welle 3 (Sarah 2026-05-26): neutraler — gilt fuer Kursstunden + Einzelstunden */}
                  <h3 className="text-base font-bold mb-2">Beginn in weniger als 3 Stunden</h3>
                  <p className="text-sm text-yoga-text/70 mb-3 leading-snug">
                    Der Platz wird in beiden Fällen freigegeben und der Warteliste angeboten.
                    Wähle, was mit dem Credit passieren soll:
                  </p>
                  <div className="space-y-2">
                    <button onClick={() => confirmCancelBooking(true)}
                      className="w-full btn-primary text-sm">
                      Credit zurückbuchen
                    </button>
                    <button onClick={() => confirmCancelBooking(false)}
                      className="w-full text-sm bg-yoga-amber-bg text-yoga-amber-text border-0 rounded-full px-4 py-2.5 font-semibold cursor-pointer">
                      Credit verfällt (z.B. WhatsApp-Abmeldung)
                    </button>
                    <button onClick={() => setCancelChoice(null)}
                      className="w-full btn-secondary text-sm">Abbrechen</button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-base font-bold mb-2">Yogi austragen?</h3>
                  <p className="text-sm text-yoga-text/70 mb-4 leading-snug">
                    Der Credit wird zurückgebucht. Platz wird der Warteliste angeboten.
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setCancelChoice(null)}
                      className="flex-1 btn-secondary text-sm">Abbrechen</button>
                    <button onClick={() => confirmCancelBooking(true)}
                      className="flex-1 btn-primary text-sm">Austragen</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Session Detail Modal */}
        {selectedSession && !showCancelForm && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end modal-overlay">
            <div className="bg-yoga-bg w-full max-w-md mx-auto rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold">
                    {/* Welle 2.7: Differenziert "Einzelstunde · X" / "Event · X" / Kursname */}
                    {sessionDisplayName(selectedSession)}
                    {selectedSession.is_replacement && (
                      <span className="text-yoga-text font-semibold"> · Ersatzstunde</span>
                    )}
                  </h3>
                  <p className="text-sm text-yoga-text/55">{new Date(selectedSession.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'long' })} · {selectedSession.time_start?.slice(0,5)} Uhr</p>
                  {selectedSession.is_replacement && selectedSession.original_session && (
                    <p className="text-xs text-yoga-text mt-1 flex items-center gap-1">
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

              {/* Bei ABGESAGTER Stunde: Ersatzstunde anlegen (sofern noch keine verknüpft ist).
                  Welle 3 (Sarah 2026-05-26): Ersatzstunden machen nur fuer course_session
                  Sinn — bei Einzelstunden/Events gibt es keinen Kurs-Kontext. */}
              {selectedSession.is_cancelled && !selectedSession.replacement_session_id && !showAddReplacement && selectedSession.session_type === 'course_session' && (
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
                  {/* Welle 3: Kurs-Einheiten-Satz nur fuer course_session anzeigen — andere
                      Pfade kommen ohnehin nicht hier rein (Button bei != course_session
                      ausgeblendet). */}
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

              {/* Welle 3.5 (Sarah 2026-05-26): Externe Teilnehmer +/- direkt im
                  Modal — nur bei nicht-course_session (bei Kursstunden gibts
                  das nicht). */}
              {!selectedSession.is_cancelled && selectedSession.session_type && selectedSession.session_type !== 'course_session' && (() => {
                const ext = selectedSession.external_participants_count || 0
                const internal = sessionBookings.filter(b => b._type === 'booking' && b.status === 'active').length
                const cap = selectedSession.max_spots
                return (
                  <div className="bg-yoga-gray rounded-yoga p-3 mb-3">
                    <div className="text-sm font-semibold mb-1">
                      {internal + ext}{cap ? ` / ${cap}` : ''} Teilnehmer gesamt
                    </div>
                    <div className="text-xs text-yoga-text/60 mb-2">
                      {internal} eingebucht{ext > 0 ? ` · ${ext} extern` : ''}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-yoga-text/60">Externe Teilnehmer:</span>
                      <button type="button"
                        onClick={async () => {
                          const newCount = Math.max(0, ext - 1)
                          await supabase.from('sessions').update({ external_participants_count: newCount }).eq('id', selectedSession.id)
                          await supabase.from('audit_log').insert({ action: 'external_participants_changed', details: { session_id: selectedSession.id, old_count: ext, new_count: newCount } })
                          setSelectedSession((prev: any) => prev ? { ...prev, external_participants_count: newCount } : prev)
                          loadData()
                        }}
                        disabled={ext <= 0}
                        className="w-7 h-7 rounded-full border border-yoga-border2 text-yoga-text/70 text-sm font-bold cursor-pointer hover:opacity-80 disabled:opacity-30 flex items-center justify-center bg-transparent">−</button>
                      <strong className="text-sm w-5 text-center">{ext}</strong>
                      <button type="button"
                        onClick={async () => {
                          const newCount = ext + 1
                          await supabase.from('sessions').update({ external_participants_count: newCount }).eq('id', selectedSession.id)
                          await supabase.from('audit_log').insert({ action: 'external_participants_changed', details: { session_id: selectedSession.id, old_count: ext, new_count: newCount } })
                          setSelectedSession((prev: any) => prev ? { ...prev, external_participants_count: newCount } : prev)
                          loadData()
                        }}
                        className="w-7 h-7 rounded-full border border-yoga-border2 text-yoga-text/70 text-sm font-bold cursor-pointer hover:opacity-80 flex items-center justify-center bg-transparent">+</button>
                    </div>
                  </div>
                )
              })()}

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
                  {/* Sarah-Wunsch: Name klickbar → Yogi-Profil (Modal vorher schließen) */}
                  <button
                    onClick={() => { setSelectedSession(null); setSessionBookings([]); router.push(`/admin/yogis/${b.user_id}`) }}
                    className="flex-1 text-left bg-transparent border-0 p-0 cursor-pointer hover:opacity-70 transition-opacity min-w-0">
                    <div className="text-sm font-semibold">{b.profile?.first_name} {b.profile?.last_name}</div>
                    <div className="text-xs text-yoga-text/50 truncate">{b.profile?.email}</div>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); cancelBookingForYogi(b.id, b.credit_id, selectedSession.id) }}
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
                    <button key={b.id}
                      onClick={() => { setSelectedSession(null); setSessionBookings([]); router.push(`/admin/yogis/${b.user_id}`) }}
                      className="card mb-2 opacity-60 w-full text-left flex items-center justify-between bg-transparent border border-yoga-border cursor-pointer hover:opacity-80 transition-opacity">
                      <div className="text-sm">{b.profile?.first_name} {b.profile?.last_name}</div>
                      <span className="badge badge-left">Ausgetragen</span>
                    </button>
                  ))}
                </>
              )}

              {/* Welle 6 (Sarah 2026-05-27, Item 11): Warteliste + Notify
                  in zwei getrennten Sektionen anzeigen. Mit Nachrücken-Button
                  bei Wartelisten-Yogis (Item 10: bei kostenlosem Event auch
                  bei Ueberbuchung erlaubt). */}
              {(() => {
                const onWaitlist = sessionBookings.filter(b => b._type === 'waitlist' && b.type !== 'notify' && b.position != null)
                const onNotify = sessionBookings.filter(b => b._type === 'waitlist' && (b.type === 'notify' || b.position == null))
                return (
                  <>
                    {onWaitlist.length > 0 && (
                      <>
                        <p className="section-label mt-3">Auf der Warteliste ({onWaitlist.length})</p>
                        {onWaitlist.map(w => (
                          <div key={w.id} className="card mb-2 flex items-center justify-between gap-2">
                            <button
                              onClick={() => { setSelectedSession(null); setSessionBookings([]); router.push(`/admin/yogis/${w.user_id}`) }}
                              className="flex-1 text-left bg-transparent border-0 p-0 cursor-pointer hover:opacity-70 transition-opacity min-w-0">
                              <div className="text-sm font-semibold flex items-center gap-2">
                                <span className="text-xs text-yoga-text/50 font-normal">#{w.position}</span>
                                <span>{w.profile?.first_name} {w.profile?.last_name}</span>
                                {w.profile?.is_dummy && (
                                  <span className="text-xs bg-yoga-text text-white rounded-full px-2 py-0.5 font-normal">Dummy</span>
                                )}
                              </div>
                              <div className="text-xs text-yoga-text/50 truncate">{w.profile?.email}</div>
                            </button>
                            <button onClick={() => promoteWaitlistFromDashboard(w)}
                              className="text-xs bg-yoga-text text-yoga-bg rounded-full px-2.5 py-1 cursor-pointer font-semibold flex-shrink-0 border-0 hover:opacity-80">
                              Nachrücken
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                    {onNotify.length > 0 && (
                      <>
                        <p className="section-label mt-3">Benachrichtigung aktiviert ({onNotify.length})</p>
                        {onNotify.map(w => (
                          <button key={w.id}
                            onClick={() => { setSelectedSession(null); setSessionBookings([]); router.push(`/admin/yogis/${w.user_id}`) }}
                            className="card mb-2 w-full text-left flex items-center justify-between bg-transparent border border-yoga-border cursor-pointer hover:opacity-80 transition-opacity">
                            <div className="text-sm">
                              {w.profile?.first_name} {w.profile?.last_name}
                              {w.profile?.is_dummy && (
                                <span className="ml-2 text-xs bg-yoga-text text-white rounded-full px-2 py-0.5 font-normal">Dummy</span>
                              )}
                            </div>
                            <span className="badge badge-wait">Benachrichtigung</span>
                          </button>
                        ))}
                      </>
                    )}
                  </>
                )
              })()}

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
                    // Sarah-Plausi-Fix 2026-05-26: Credits (course/tenpack/single/
                    // quarterly) und Guthaben (model='guthaben') GETRENNT zählen —
                    // sonst zeigt Yogi mit 12 Guthaben fälschlich "12 Credits frei".
                    const free = (yogi.credits || []).filter((cr: any) =>
                      cr.model !== 'guthaben' && new Date(cr.expires_at) > new Date() && (cr.total - cr.used) > 0
                    ).reduce((s: number, cr: any) => s + cr.total - cr.used, 0)
                    const guthaben = (yogi.credits || []).filter((cr: any) =>
                      cr.model === 'guthaben' && new Date(cr.expires_at) > new Date() && (cr.total - cr.used) > 0
                    ).reduce((s: number, cr: any) => s + cr.total - cr.used, 0)
                    const parts: string[] = []
                    if (free > 0) parts.push(`${free} Credits frei`)
                    if (guthaben > 0) parts.push(`${guthaben} Guthaben`)
                    const label = parts.length > 0 ? parts.join(' · ') : 'Kein Credit – wird vergeben'
                    return (
                      <div key={yogi.id} className="flex items-center justify-between py-2 border-b border-yoga-border">
                        <div>
                          <div className="text-sm font-semibold">{yogi.first_name} {yogi.last_name}</div>
                          <div className="text-xs text-yoga-text/50">{label}</div>
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
                  {/* Welle 3 (Sarah 2026-05-26): Button-Text differenziert */}
                  <i className="ti ti-calendar-x mr-1" />
                  {selectedSession.session_type === 'event_free' || selectedSession.session_type === 'event_paid'
                    ? ' Event absagen'
                    : ' Stunde absagen'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Cancel Form Modal
            Welle 3 (Sarah 2026-05-26): session_type-aware — Events haben kein
            Credit-Refund, keinen Ersatztermin, andere Headline. */}
        {showCancelForm && selectedSession && (() => {
          const st = selectedSession.session_type
          const isEvent = st === 'event_free' || st === 'event_paid'
          const isSingle = st === 'single'
          const activeCount = sessionBookings.filter(b => b._type === 'booking' && b.status === 'active').length
          const headline = isEvent ? 'Event absagen' : 'Stunde absagen'
          // Hinweis-Text: Events ohne Credit-Logik, Kursstunde mit Refund + Ersatzbuchung
          const infoText = st === 'event_free'
            ? `Alle ${activeCount} angemeldeten Yogis werden per Email informiert. Da das Event kostenlos war, gibt es keinen Credit-Refund.`
            : st === 'event_paid'
            ? `Alle ${activeCount} angemeldeten Yogis werden per Email informiert. Eine eventuell schon geleistete Bezahlung musst du extern (PayPal/Bar) erstatten.`
            : isSingle
            ? `Alle ${activeCount} angemeldeten Yogis bekommen ihren Credit zurück.`
            : `Alle ${activeCount} angemeldeten Yogis bekommen ihren Credit zurück. Wenn du einen Ersatztermin einträgst, wird der Credit direkt wieder verbucht.`
          return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end modal-overlay">
            <div className="bg-yoga-bg w-full max-w-md mx-auto rounded-t-2xl p-5">
              <h3 className="text-base font-bold mb-1">{headline}</h3>
              <p className="text-sm text-yoga-text/55 mb-4">
                {/* Welle 2.7: differenziert Einzelstunde/Event/Kursname */}
                {sessionDisplayName(selectedSession)}
                {' · '}{new Date(selectedSession.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'long' })}
              </p>

              <div className="bg-yoga-amber-bg border border-yoga-amber-text/20 rounded-yoga p-3 mb-4">
                <p className="text-sm text-yoga-amber-text leading-relaxed">{infoText}</p>
              </div>

              {/* Ersatztermin nur bei course_session (Welle 3) */}
              {st === 'course_session' && (
                <>
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
                </>
              )}

              <button onClick={cancelSession} disabled={cancelling} className="btn-danger mb-2">
                {cancelling
                  ? 'Wird abgesagt...'
                  : replacementDate && st === 'course_session'
                  ? 'Absagen & Ersatztermin anlegen'
                  : isEvent
                  ? 'Event absagen'
                  : isSingle
                  ? 'Einzelstunde absagen (Credits freigeben)'
                  : 'Stunde absagen (Credits freigeben)'}
              </button>
              <button onClick={() => setShowCancelForm(false)} className="btn-ghost">Abbrechen</button>
            </div>
          </div>
          )
        })()}

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
              // href kann statisch (string) oder dynamisch (function aus details) sein —
              // dynamisch z.B. um direkt zur Yogi-Seite zu linken.
              type NMeta = { label: string; icon: string; tone: 'action' | 'warn' | 'info'; href?: string | ((n: any) => string) }
              const META: Record<string, NMeta> = {
                // 🔴 ACTION-REQUIRED (du musst handeln)
                refund_pending:        { label: 'Erstattung überweisen', icon: 'ti-cash',           tone: 'action', href: '/admin/kursabbruch' },
                // 2026-05-25: 2-Jahre-Auto-Refund Guthaben aus Kursabbruch
                refund_pending_auto_2y: {
                  label: 'Guthaben nach 2 Jahren abgelaufen — Geldbetrag erstatten',
                  icon: 'ti-cash-banknote',
                  tone: 'action',
                  href: (n: any) => n.details?.user_id ? `/admin/yogis/${n.details.user_id}` : '/admin/yogis',
                },
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
                course_cancellation_complete: { label: 'Kursabbruch — alle Yogis haben geantwortet', icon: 'ti-checks', tone: 'info', href: '/admin/kursabbruch' },
                guthaben_verrechnet:   { label: 'Guthaben verrechnet — bitte abhaken', icon: 'ti-receipt', tone: 'action' },
              }
              const meta = META[n.type] || { label: n.type, icon: 'ti-bell', tone: 'info' as const }
              const resolvedHref = typeof meta.href === 'function' ? meta.href(n) : meta.href
              // Sarah-Wunsch 2026-05-25: kein bunter Streifen + kein Icon im Titel,
              // gleiches Design wie der Yogi-Banner — nur farbige Headline.
              const headlineCls = {
                action: 'text-yoga-red-text',
                warn:   'text-yoga-amber-text',
                info:   'text-yoga-text/80',
              }[meta.tone]
              return (
                <div key={n.id} className="card mb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${headlineCls}`}>
                        {meta.label}
                      </p>
                      <p className="text-sm text-yoga-text/70 mt-0.5">{n.message}</p>
                      <p className="text-xs text-yoga-text/40 mt-1">
                        {new Date(n.created_at).toLocaleDateString('de-DE', { day:'numeric', month:'short' })} · {new Date(n.created_at).toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' })}
                      </p>
                      {resolvedHref && (
                        <button onClick={() => router.push(resolvedHref)}
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
          // Welle 4.7 (Sarah 2026-05-26): Event-Akzentstreifen links, dezent dunkelbraun.
          const isEventCard = s.session_type === 'event_free' || s.session_type === 'event_paid' || s.session_type === 'event_credit'
          return (
            <button key={s.id} onClick={() => loadSessionDetail(s)}
              className={`w-full bg-white border rounded-yoga px-3 py-2.5 mb-2 text-left hover:border-yoga-border2 ${s.is_cancelled || isPast ? 'opacity-40' : ''} ${highlight ? 'border-2 border-yoga-text' : 'border-yoga-border'} ${isEventCard ? 'border-l-4 border-l-yoga-text' : ''}`}>
              {/* Sarah-Wunsch 2026-05-24: Wochentag vorne, kompakt + nur Ausgetragen-Info */}
              <div className="flex items-center gap-2">
                <div className="text-center flex-shrink-0 w-10">
                  <div className="text-base font-bold leading-tight">
                    {new Date(s.date).toLocaleDateString('de-DE', { weekday: 'short' })}
                  </div>
                  <div className="text-[10px] text-yoga-text/50 mt-0.5 leading-tight">
                    {new Date(s.date).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
                <div className="w-px h-9 bg-yoga-border2 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">
                    {/* Welle 2.7 (2026-05-26): differenziert Einzelstunde/Event/Kursname */}
                    {sessionDisplayName(s)}
                    {s.is_replacement && (
                      <span className="text-yoga-text font-semibold"> · Ersatzstunde</span>
                    )}
                  </div>
                  <div className="text-xs text-yoga-text/55 mt-0.5">
                    {s.time_start?.slice(0,5)}
                    {!s.is_cancelled && !isPast && s.cancelled_count > 0 && (
                      <> · <i className="ti ti-x" /> {s.cancelled_count} ausgetragen</>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {(() => {
                    if (s.is_cancelled) return <span className="badge badge-full">Abgesagt</span>
                    if (isPast) return <span className="badge bg-yoga-gray text-yoga-text/40">Vergangen</span>
                    // Welle 2.6: bei Events/Einzelstunden max_spots aus Session,
                    // sonst aus Container-Kurs (Kursstunden).
                    const maxS = (s.session_type && s.session_type !== 'course_session')
                      ? (s.max_spots ?? s.course?.max_spots)
                      : s.course?.max_spots
                    // Welle 3.5 (Sarah 2026-05-26): externe Teilnehmer mit zaehlen,
                    // sonst stand bei Events mit 5 Externen weiter "0/12".
                    const ext = s.external_participants_count || 0
                    const total = s.active_count + ext
                    return (
                      <span className={`badge ${maxS && total >= maxS ? 'badge-full' : 'badge-free'}`}>
                        {total}/{maxS ?? '?'}
                      </span>
                    )
                  })()}
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
