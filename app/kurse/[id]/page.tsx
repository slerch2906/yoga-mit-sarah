'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getServerNow } from '@/lib/server-time'
import { Email } from '@/lib/email'
import { getCurrentUser } from '@/lib/auth'
import { isExcluded, isCancelled } from '@/lib/session-status'
import { selectCreditForBooking } from '@/lib/credit-selector'
import { promoteWaitlistOrOfferLate } from '@/lib/waitlist-promote'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'
import { sessionDisplayName } from '@/lib/session-display'

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [session, setSession] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [myBooking, setMyBooking] = useState<any>(null)
  const [myWaitlist, setMyWaitlist] = useState<any>(null)
  const [freeCredits, setFreeCredits] = useState(0)
  const [bestCredit, setBestCredit] = useState<any>(null)
  const [hasGuthabenOnly, setHasGuthabenOnly] = useState(false)
  const [freeSpots, setFreeSpots] = useState(0)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [conflictingWaitlists, setConflictingWaitlists] = useState<any[]>([])
  const [showWaitlistConflict, setShowWaitlistConflict] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { loadData() }, [id])

  async function loadData() {
    const user = await getCurrentUser()
    if (!user) { window.location.href = '/login'; return }

    const [{ data: prof }, { data: sess }, { data: myBook }, { data: myWait }, { data: allCredits }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      // KEIN self-referenzierender Subquery (PostgREST gibt 400). Replacement separat unten laden.
      supabase.from('sessions').select('*, course:courses(*)').eq('id', id).single(),
      supabase.from('bookings').select('*').eq('session_id', id).eq('user_id', user.id).eq('status', 'active').maybeSingle(),
      supabase.from('waitlist').select('*').eq('session_id', id).eq('user_id', user.id).maybeSingle(),
      supabase.from('credits').select('*').eq('user_id', user.id).gt('expires_at', new Date().toISOString()),
    ])

    // Replacement-Session separat laden (Self-Join via PostgREST war fehlerhaft → 400)
    // 1) Wenn DIESE Session abgesagt wurde und auf einen Ersatz zeigt → "replacement"
    // 2) Wenn eine andere (abgesagte) Session auf DIESE zeigt → "origin" (=> ich bin Ersatzstunde)
    let replacement: any = null
    if ((sess as any)?.replacement_session_id) {
      const { data: rep } = await supabase.from('sessions')
        .select('id, date, time_start, is_cancelled')
        .eq('id', (sess as any).replacement_session_id).maybeSingle()
      replacement = rep
    }
    let origin: any = null
    if (sess?.id) {
      const { data: orig } = await supabase.from('sessions')
        .select('id, date, time_start')
        .eq('replacement_session_id', sess.id).maybeSingle()
      origin = orig
    }

    const { count: bookingCount } = await supabase
      .from('bookings').select('*', { count: 'exact', head: true })
      .eq('session_id', id).eq('status', 'active')

    setProfile(prof)
    setSession(sess ? { ...sess, replacement, origin } : sess)
    setMyBooking(myBook)
    setMyWaitlist(myWait)
    // Welle 2.5: session.max_spots Vorrang (Events/Einzelstunden), Fallback course.
    const maxSpots = (sess as any)?.max_spots ?? (sess as any)?.course?.max_spots ?? 0
    setFreeSpots(maxSpots - (bookingCount || 0))

    // Freie Credits berechnen: Guthaben (aus Kursabbruch) ist NUR für neue Kurse,
    // nicht für Einzelstunden. Alle anderen Credit-Modelle (course/single/tenpack)
    // sind universell einlösbar — auch ein Course-Credit kann für Drop-In in eine
    // fremde Stunde verwendet werden (Sarah-Regel 2026-05-22).
    const available = (allCredits || []).filter(c => c.total > c.used && c.model !== 'guthaben')
    const totalFree = available.reduce((sum, c) => sum + (c.total - c.used), 0)
    setFreeCredits(totalFree)
    const guthabenOnly = totalFree === 0 && (allCredits || []).some(c => c.model === 'guthaben' && c.total > c.used)
    setHasGuthabenOnly(guthabenOnly)
    // Besten Credit wählen: zuerst ablaufende
    const sorted = available.sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())
    setBestCredit(sorted[0] || null)

    setLoading(false)
  }

  function isWithin3Hours() {
    if (!session) return false
    const dt = new Date(`${session.date}T${session.time_start}`)
    const diff = dt.getTime() - Date.now()
    return diff < 3 * 60 * 60 * 1000 && diff > 0
  }

  function isPast() {
    if (!session) return false
    return new Date(`${session.date}T${session.time_start}`) < new Date()
  }

  function cancelDeadline() {
    if (!session) return ''
    const dt = new Date(`${session.date}T${session.time_start}`)
    dt.setHours(dt.getHours() - 3)
    return dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'
  }

  // Prüft ob Yogi nach dieser Buchung noch genug Credits für alle Warteliste-Einträge hat.
  // Falls nicht: gibt die zu entfernenden Wartelisten zurück (älteste zuerst).
  async function checkWaitlistConflicts(userId: string): Promise<any[]> {
    const { data: waitlists } = await supabase.from('waitlist')
      .select('id, position, created_at, session_id, session:sessions(date, time_start, name, session_type, course:courses(name))')
      .eq('user_id', userId).eq('type', 'waitlist').order('created_at')
    if (!waitlists || waitlists.length === 0) return []
    // Wieviele Credits stehen NACH dieser Buchung noch zur Verfügung?
    const creditsAfterBooking = Math.max(0, freeCredits - 1)
    // Wenn freeCredits-1 < waitlists.length, müssen die ältesten entfernt werden
    const removalCount = Math.max(0, waitlists.length - creditsAfterBooking)
    if (removalCount === 0) return []
    return waitlists.slice(0, removalCount)
  }

  async function handleBook() {
    const isCharity = !!(session as any)?.course?.is_free
    // Welle 2.5 (Sarah 2026-05-26): Events (event_free + event_paid) verbrauchen
    // KEINEN Credit. Buchung ist bei event_paid verbindlich, Zahlung extern. Die
    // Booking-Logik (Credit-Insert, Cancellation-Frist 7 Tage hard-block) kommt
    // in Welle 3 — hier nur das UI/no-credit-Verhalten als Brücke.
    const _sessType: string = (session as any)?.session_type || 'course_session'
    const isEventTypeNoCredit = _sessType === 'event_free' || _sessType === 'event_paid'
    const skipCreditCheck = isCharity || isEventTypeNoCredit
    // Charity / event_free / event_paid: kein Credit nötig. Sonst: Credit muss da sein.
    if (!skipCreditCheck && !bestCredit) return
    const user = await getCurrentUser()
    // Wartelisten-Konflikt-Check NUR wenn ein Credit verwendet wird (= nicht charity/event)
    const conflicts = skipCreditCheck ? [] : await checkWaitlistConflicts(user!.id)
    if (conflicts.length > 0 && !showWaitlistConflict) {
      // Modal anzeigen, User muss bestätigen
      setConflictingWaitlists(conflicts)
      setShowWaitlistConflict(true)
      return
    }
    setActionLoading(true)

    // Wartelisten-Konflikte entfernen + Yogi informieren
    if (conflicts.length > 0) {
      const ids = conflicts.map((w: any) => w.id)
      await supabase.from('waitlist').delete().in('id', ids)
      // Yogi-Email pro entfernter Warteliste
      try {
        const { data: prof } = await supabase.from('profiles').select('email, first_name').eq('id', user!.id).single()
        if (prof?.email) {
          for (const w of conflicts) {
            await Email.waitlistRemovedCreditUsedElsewhere({
              email: prof.email,
              firstName: prof.first_name || 'Yogi',
              courseName: w.session?.course?.name || '',
              date: w.session?.date || '',
              timeStart: w.session?.time_start || '',
            })
          }
        }
      } catch (e) {}
    }

    // Prüfe ob bereits eine (cancelled) Buchung existiert → dann updaten statt inserieren
    const { data: existingBooking } = await supabase.from('bookings')
      .select('*').eq('session_id', id).eq('user_id', user!.id).maybeSingle()

    let chosenCreditId: string | null = null
    let originSessionId: string | null = null
    let pickUsedModel: string | null = null
    if (!skipCreditCheck) {
      // Smart Credit-Picker (Sarah-Regel 2026-05-22):
      //   1. Course-Credit zuerst probieren (mit minutengenauem 10d-/8d-Fenster-Check)
      //   2. Falls Fenster nicht passt: Fallback auf Single/Tenpack/Quartal
      //   3. Falls weder noch → Fehlermeldung
      const pick = await selectCreditForBooking(supabase, user!.id, id as string, session!.date, session!.time_start)
      if (!pick.ok) {
        alert(pick.message)
        setActionLoading(false)
        return
      }
      chosenCreditId = pick.creditId
      originSessionId = pick.originSessionId
      pickUsedModel = pick.usedModel
    }
    // Bei Charity: chosenCreditId bleibt null (bookings.credit_id ist NULLABLE)

    // Buchungstyp: 'course' wenn der Yogi entweder
    //   a) einen Course-Credit des EIGENEN Kurses verwendet, ODER
    //   b) im Kurs der Session enrolled ist (egal welcher Credit bezahlt).
    // Sonst 'single' (Drop-In in fremden Kurs mit Punktekarte/Guthaben-Credit).
    // Charity (is_free): IMMER 'single' — kein Kurs-Block, keine Aggregation.
    const sessCourseId = (session as any)?.course_id
    const { data: enrolledHere } = await supabase.from('enrollments')
      .select('id').eq('user_id', user!.id).eq('course_id', sessCourseId).maybeSingle()
    const usedIsCourseModel = pickUsedModel === 'course'
    const bookingType = skipCreditCheck ? 'single' : ((enrolledHere || usedIsCourseModel) ? 'course' : 'single')

    let error = null
    if (existingBooking) {
      const { error: updateError } = await supabase.from('bookings').update({
        status: 'active', credit_id: chosenCreditId, type: bookingType,
        origin_session_id: originSessionId,
        cancelled_at: null, cancel_late: false
      }).eq('id', existingBooking.id)
      error = updateError
    } else {
      const { error: insertError } = await supabase.from('bookings').insert({
        user_id: user!.id, session_id: id,
        credit_id: chosenCreditId, type: bookingType, status: 'active',
        origin_session_id: originSessionId,
      })
      error = insertError
    }

    if (!error) {
      // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
      await supabase.from('audit_log').insert({
        user_id: user!.id, action: 'booking_created',
        details: { session_id: id, type: 'single', course_name: session?.course?.name, session_date: session?.date, session_time: session?.time_start }
      })
      // Buchungsbestätigung Email — nur wenn Yogi sie aktiviert hat (Default: ja)
      try {
        const { data: prof } = await supabase.from('profiles').select('email, first_name, notify_booking_confirmations').eq('id', user!.id).single()
        if (prof && prof.notify_booking_confirmations !== false) await Email.bookingConfirmed({
          email: prof.email,
          firstName: prof.first_name || 'Yogi',
          courseName: session?.course?.name || '',
          date: session?.date || '',
          timeStart: session?.time_start || '',
          durationMin: session?.duration_min || 60,
          isSingle: !!(session as any)?.course?.is_single,
        })
      } catch(e) {}
      router.push(`/kurse/${id}/bestaetigung`)
    } else {
      alert('Fehler beim Buchen: ' + error.message)
    }
    setShowWaitlistConflict(false)
    setConflictingWaitlists([])
    setActionLoading(false)
  }

  async function handleCancel() {
    const user = await getCurrentUser()
    // Server-Zeit verwenden statt Browser-Zeit
    const serverNow = await getServerNow()
    const sessionStart = new Date(`${session.date}T${session.time_start}`)
    const deadline3h = new Date(sessionStart.getTime() - 3 * 60 * 60 * 1000)
    const late = serverNow > deadline3h

    // Sarah-Wunsch 2026-05-23: Yogi muss bewusst bestätigen wenn er innerhalb
    // der 3h-Frist abmeldet — dann verfällt der Credit ersatzlos.
    if (late && !confirm(
      'Du bist innerhalb der 3-Stunden-Frist.\n\n' +
      'Wenn du dich jetzt abmeldest, verfällt dein Credit — du kannst diese Stunde nicht mehr nachholen.\n\n' +
      'Trotzdem abmelden?'
    )) return

    setActionLoading(true)

    await supabase.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: late
    }).eq('id', myBooking.id)

    // credit.used wird automatisch durch trg_sync_credit_used aktualisiert

    await supabase.from('audit_log').insert({
      user_id: user!.id, action: 'booking_cancelled',
      details: { session_id: id, late, course_name: session?.course?.name, session_date: session?.date, session_time: session?.time_start }
    })

    // Email an Yogi senden — nur wenn Yogi sie aktiviert hat (Default: ja)
    try {
      const { data: prof } = await supabase.from('profiles')
        .select('email, first_name, notify_booking_confirmations').eq('id', user!.id).single()
      if (prof?.email && prof.notify_booking_confirmations !== false) {
        await Email.bookingCancelled({
          email: prof.email,
          firstName: prof.first_name || 'Yogi',
          courseName: session?.course?.name || '',
          date: session?.date || '',
          timeStart: session?.time_start || '',
          durationMin: session?.duration_min || 75,
          creditReturned: !late,
          isSingle: !!(session as any)?.course?.is_single,
        })
      }
    } catch (e) { console.error('Cancel email error:', e) }

    // Sarah-Wunsch 2026-05-23: bei ≤90 Min vor Stundenbeginn KEIN Auto-Promote,
    // sondern alle Waitlist-Yogis kriegen Auswahl-Mail (waitlist_offer_late).
    const sessStartMs = session?.date && session?.time_start
      ? new Date(`${session.date}T${session.time_start}`).getTime() : 0
    const minsUntilStart = (sessStartMs - Date.now()) / 60000
    if (sessStartMs > 0 && minsUntilStart <= 90) {
      try { await promoteWaitlistOrOfferLate(supabase, id as string) } catch (e) { console.error('late-offer:', e) }
      router.push('/meine'); return
    }

    // > 90 Min: Standard-Pfad via RPC + Email-Versand client-side
    try {
      const { data: result } = await supabase.rpc('process_cancellation_with_waitlist', { p_session_id: id })

      // Email an Wartelisten-Promoted-User (Daten kommen kontrolliert aus der RPC)
      if (result?.promoted?.email) {
        await Email.waitlistPromoted({
          email: result.promoted.email,
          firstName: result.promoted.first_name || 'Yogi',
          courseName: result.promoted.course_name || '',
          date: result.promoted.date || '',
          timeStart: result.promoted.time_start || '',
        })
      }

      // Notify-Users emailen
      for (const nu of (result?.notify_users || [])) {
        if (nu?.email) {
          await Email.notifyPlaceFree({
            email: nu.email,
            firstName: nu.first_name || 'Yogi',
            courseName: nu.course_name || '',
            date: nu.date || '',
            timeStart: nu.time_start || '',
            sessionId: nu.session_id || id,
          })
        }
      }

      // Skipped-Wartelisten-Yogis (kein Credit mehr beim Promote-Versuch) informieren —
      // edge case z.B. wenn Yogi gleichzeitig in 2 Tabs hantiert
      for (const sk of (result?.skipped_no_credit || [])) {
        if (sk?.email) {
          await Email.waitlistRemovedCreditUsedElsewhere({
            email: sk.email,
            firstName: sk.first_name || 'Yogi',
            courseName: sk.course_name || '',
            date: sk.date || '',
            timeStart: sk.time_start || '',
          })
        }
      }
    } catch(e) { console.error('Waitlist promotion error:', e) }

    router.back()
  }

  async function handleWaitlist(type: 'waitlist' | 'notify') {
    setActionLoading(true)
    const user = await getCurrentUser()
    const { data: prof } = await supabase.from('profiles').select('email, first_name, notify_waitlist_joined').eq('id', user!.id).single()

    // Atomic Insert via SECURITY DEFINER RPC (verhindert dass Yogi alle waitlist-Counts lesen muss)
    // RPC gibt unsubscribe_token zurück, damit Email-Link den Yogi ohne Login austragen kann.
    const { data: result } = await supabase.rpc('join_waitlist', {
      p_session_id: id, p_type: type,
    })
    const position = result?.position ?? 0
    const unsubscribeToken = result?.unsubscribe_token

    // Wartelisten-Bestätigung nur wenn Yogi sie aktiviert hat (Default: ja). Nur waitlist (nicht notify).
    if (type === 'waitlist' && prof && prof.notify_waitlist_joined !== false) {
      try {
        await Email.waitlistJoined({
          email: prof.email,
          firstName: prof.first_name || 'Yogi',
          courseName: session?.course?.name || '',
          date: session?.date || '',
          timeStart: session?.time_start || '',
          position,
          unsubscribeToken,
          isSingle: !!(session as any)?.course?.is_single,
        })
      } catch(e) {}
    }
    router.push(`/kurse/${id}/bestaetigung?type=${type}`)
    setActionLoading(false)
  }

  async function handleLeaveWaitlist() {
    setActionLoading(true)
    await supabase.from('waitlist').delete().eq('id', myWaitlist.id)
    router.push('/kurse')
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>
  if (!session) return null

  const course = (session as any).course
  const past = isPast()
  const within3h = isWithin3Hours()
  const deadline = cancelDeadline()

  // Welle 2.5 (Sarah 2026-05-26): session_type bestimmt das Verhalten der Seite.
  //   course_session  → Reguläre Kursstunde (wie bisher).
  //   single          → Einzelstunde (Credit-Verbrauch wie heute).
  //   event_free      → Kostenloses Event (kein Credit, keine Stornofrist-Logik).
  //   event_paid      → Bezahltes Event (extern, Stornofrist 7 Tage, kein Credit).
  //   event_credit    → Legacy Event-mit-Credit (= wie single).
  const sessionType: string = (session as any).session_type || 'course_session'
  const isCourseSession = sessionType === 'course_session'
  const isEventPaid = sessionType === 'event_paid'
  const isEventFree = sessionType === 'event_free'
  const isEvent = isEventPaid || isEventFree
  // Welle 2.9 (Sarah 2026-05-26): Effective-Open-Logik. SYS-Container haben
  // is_open=false (Container ist NIE buchbar). Daher fuer single/event_*
  // wird stattdessen session.is_open genutzt (Default = true wenn NULL).
  // Bei normalen Kursstunden bleibt course.is_open massgeblich.
  const effectiveOpen: boolean = isCourseSession
    ? !!course?.is_open
    : ((session as any)?.is_open !== false)
  // Für Anzeige: session.name/description haben Vorrang vor course.name/description
  // (course.name = SYS-Container für event_*/single).
  // Sarah-Wunsch 2026-05-26 Welle 2.8: SYS-Container-Description darf NIE
  // beim Yogi durchschlagen ("Unsichtbarer Container fuer ..."). Bei
  // session_type != 'course_session' wird der course-Fallback unterdrueckt;
  // bei event_free zeigen wir stattdessen einen Standard-Hinweis.
  const isContainerSession = sessionType && sessionType !== 'course_session'
  const displayName = (session as any).name ?? (isContainerSession ? null : course?.name)
  const sessionOwnDescription = (session as any).description as string | null | undefined
  const defaultDescription =
    sessionType === 'event_free'
      ? 'Kostenlos — einfach anmelden und teilnehmen. Abmelden jederzeit möglich.'
      : null
  const displayDescription = isContainerSession
    ? (sessionOwnDescription || defaultDescription)
    : (sessionOwnDescription ?? course?.description)
  const displayLocation = (session as any).location ?? (isContainerSession ? null : course?.location)
  const displayBringAlong = (session as any).bring_along ?? (isContainerSession ? null : course?.bring_along)
  const displayDifficulty = (session as any).difficulty ?? (isContainerSession ? null : course?.difficulty)
  const displayImageUrl = (session as any).image_url ?? (isContainerSession ? null : course?.image_url)
  const displayMaxSpots = (session as any).max_spots ?? (isContainerSession ? null : course?.max_spots)
  // Bei Events: andere Überschrift für die Description.
  const descriptionHeader = isEvent ? 'Über dieses Event'
    : sessionType === 'single' || sessionType === 'event_credit' ? 'Über die Stunde'
    : 'Über diesen Kurs'

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="" isAdmin={profile?.is_admin} />

      {/* Header */}
      <div className="px-4 py-3 border-b border-yoga-border bg-yoga-bg">
        <button onClick={() => router.back()}
          className="flex items-center gap-1 text-sm text-yoga-text/60 mb-2.5 hover:opacity-80">
          <i className="ti ti-arrow-left" /> Zurück
        </button>
        {/* Charity / Bild — kleines Foto links neben Titel (Variante A). Welle 2.5:
            displayImageUrl/displayName mit session-Fallback. */}
        {displayImageUrl && (
          <div className="flex items-start gap-3 mb-2">
            <img src={displayImageUrl} alt="" className="w-16 h-16 rounded-yoga object-cover flex-shrink-0 border border-yoga-border" />
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold mb-1">
                {displayName}
                {(session as any).origin && (
                  <span className="text-yoga-text font-semibold"> · Ersatzstunde</span>
                )}
              </h2>
              {course?.is_free && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-yoga-green-bg text-yoga-green-text text-xs font-semibold">
                  Kostenlos
                </span>
              )}
              {isEventFree && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-yoga-green-bg text-yoga-green-text text-xs font-semibold">
                  Kostenlos
                </span>
              )}
              {isEventPaid && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-yoga-amber-bg text-yoga-amber-text text-xs font-semibold">
                  {(session as any).price_eur} €
                </span>
              )}
            </div>
          </div>
        )}
        {!displayImageUrl && (
          <h2 className="text-lg font-bold mb-1">
            {displayName}
            {(session as any).origin && (
              <span className="text-yoga-text font-semibold"> · Ersatzstunde</span>
            )}
            {course?.is_free && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-yoga-green-bg text-yoga-green-text text-xs font-semibold align-middle">
                Kostenlos
              </span>
            )}
            {isEventFree && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-yoga-green-bg text-yoga-green-text text-xs font-semibold align-middle">
                Kostenlos
              </span>
            )}
            {isEventPaid && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-yoga-amber-bg text-yoga-amber-text text-xs font-semibold align-middle">
                {(session as any).price_eur} €
              </span>
            )}
          </h2>
        )}
        <p className="text-sm text-yoga-text/55 mb-2">
          {new Date(session.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'long' })} · {session.time_start?.slice(0,5)} Uhr · {session.duration_min} min
        </p>
        {(session as any).origin && (
          <div className="bg-yoga-amber-bg/60 border border-yoga-amber-text/20 rounded-yoga px-3 py-2 mb-2 flex items-center gap-1.5 text-sm text-yoga-text">
            <i className="ti ti-arrow-back-up text-base" />
            <span>
              Ersatzstunde für{' '}
              <strong>
                {new Date((session as any).origin.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short' })}
                {' · '}{(session as any).origin.time_start?.slice(0,5)} Uhr
              </strong>
            </span>
          </div>
        )}
        {displayLocation && (
          <p className="text-sm text-yoga-text/50 mb-1"><i className="ti ti-map-pin mr-1" />{displayLocation}</p>
        )}
        {displayDifficulty && (
          <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-yoga-gray text-yoga-text/60 font-semibold">{displayDifficulty}</span>
        )}
        {past && (
          <span className="inline-block mt-2 text-xs px-2 py-1 rounded-full bg-yoga-gray text-yoga-text/50 font-semibold">
            Diese Stunde ist bereits vergangen
          </span>
        )}
        {/* Teilen-Button wurde 2026-05-24 in Admin-Stundenseite verlagert — Sarah teilt selbst per WhatsApp */}
      </div>

      <div className="px-4 py-4">
        {/* Info grid — Welle 2.5 (Sarah 2026-05-26): Bei event_paid + event_free
            werden Credits-Kachel + 3h-Abmeldefrist ausgeblendet (Credits irrelevant,
            stattdessen: Stornofrist 7 Tage bei event_paid). */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="info-tile">
            <div className="lbl">{myBooking ? 'Dein Status' : 'Freie Plätze'}</div>
            <div className={`val ${myBooking ? 'text-yoga-green-text' : freeSpots <= 0 ? 'text-yoga-red-text' : ''}`}>
              {myBooking ? 'Angemeldet ' : past ? '—' : freeSpots <= 0 ? 'Ausgebucht' : `${freeSpots} frei`}
            </div>
          </div>
          {!course?.is_free && !isEvent && (
            <div className="info-tile">
              <div className="lbl">Abmeldefrist</div>
              <div className={`val ${within3h && !past ? 'text-yoga-amber-text' : ''}`}>
                {past ? 'Vergangen' : deadline}
              </div>
            </div>
          )}
          {isEventPaid && (
            <div className="info-tile">
              <div className="lbl">Stornofrist</div>
              <div className="val">7 Tage</div>
            </div>
          )}
          {!course?.is_free && !isEvent && (
            <div className="info-tile">
              <div className="lbl">Deine Credits</div>
              <div className={`val ${freeCredits === 0 ? 'text-yoga-red-text' : ''}`}>
                {freeCredits} verfügbar
              </div>
            </div>
          )}
          <div className="info-tile">
            <div className="lbl">Warteliste</div>
            <div className="val">{myWaitlist ? (myWaitlist.type === 'notify' ? 'Benachrichtigung aktiv' : `Pos. ${myWaitlist.position}`) : '—'}</div>
          </div>
        </div>

        {/* Kursbeschreibung — Welle 2.5: session-Werte mit Fallback aus course.
            Bei Events: "Über dieses Event", bei Einzelstunden: "Über die Stunde",
            sonst "Über diesen Kurs". WICHTIG: bei single/event_* darf NICHT die
            Container-Description ("Unsichtbarer Container für ...") gezeigt werden. */}
        {(displayDescription || displayBringAlong) && (
          <div className="card mb-4">
            {displayDescription && (
              <div className="mb-3">
                <p className="text-xs text-yoga-text/40 uppercase tracking-wider font-bold mb-1">{descriptionHeader}</p>
                <p className="text-sm text-yoga-text/80 leading-relaxed">{displayDescription}</p>
              </div>
            )}
            {displayBringAlong && (
              <div>
                <p className="text-xs text-yoga-text/40 uppercase tracking-wider font-bold mb-1">Was mitbringen</p>
                <p className="text-sm text-yoga-text/80 leading-relaxed"><i className="ti ti-backpack mr-1" />{displayBringAlong}</p>
              </div>
            )}
          </div>
        )}

        {/* VERGANGEN – gesperrt */}
        {past && (
          <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-4 mb-4 text-center">
            <i className="ti ti-lock text-2xl text-yoga-text/30 block mb-2" />
            <p className="text-sm text-yoga-text/50">Diese Stunde ist bereits vergangen und kann nicht mehr gebucht oder geändert werden.</p>
          </div>
        )}

        {/* ABGESAGT/AUSGESCHLOSSEN – keine Buchung möglich, ggf. Link zur Ersatzstunde */}
        {!past && session.is_cancelled && (
          <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-4 mb-4 text-center">
            <i className="ti ti-calendar-cancel text-2xl text-yoga-text/30 block mb-2" />
            <p className="text-sm font-semibold text-yoga-text/50 mb-1">
              {isExcluded(session) ? 'Diese Stunde ist ausgeschlossen' : 'Diese Stunde wurde abgesagt'}
            </p>
            <p className="text-sm text-yoga-text/40">
              {isExcluded(session) ? 'Die Stunde gehört nicht zum Kurs.' : 'Buchungen und Warteliste sind nicht möglich.'}
            </p>
            {isCancelled(session) && (session as any).replacement && !(session as any).replacement.is_cancelled && (
              <button onClick={() => router.push(`/kurse/${(session as any).replacement.id}`)}
                className="btn-primary mt-3 w-full">
                <i className="ti ti-calendar-event mr-1" />
                Zur Ersatzstunde am {new Date((session as any).replacement.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })} · {(session as any).replacement.time_start?.slice(0,5)} Uhr
              </button>
            )}
            <button onClick={() => router.back()} className="btn-ghost mt-3">Zurück</button>
          </div>
        )}

        {/* ANGEMELDET */}
        {!past && !session.is_cancelled && myBooking && !showCancel && (
          <>
            <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-3 mb-4">
              <p className="text-sm text-yoga-text/80 leading-relaxed">
                {course?.is_free || isEventFree
                  ? 'Du bist angemeldet. Abmeldung jederzeit möglich.'
                  : isEventPaid
                  ? 'Du bist angemeldet. Diese Buchung ist verbindlich. Stornofrist: 7 Tage vor dem Event.'
                  : <>Du bist angemeldet. Abmeldung kostenlos bis <strong>{deadline}</strong> – danach gilt die Stunde als wahrgenommen.</>}
              </p>
            </div>
            <button onClick={() => setShowCancel(true)} className="btn-danger mb-2">
              <i className="ti ti-calendar-minus mr-1" /> Von dieser Stunde abmelden
            </button>
            <button onClick={() => router.back()} className="btn-ghost">Zurück</button>
          </>
        )}

        {/* ABMELDE-BESTÄTIGUNG */}
        {!past && !session.is_cancelled && myBooking && showCancel && (
          <>
            {course?.is_free || isEventFree ? (
              // Charity / event_free: kein Credit involviert
              <div className="rounded-yoga p-3 mb-4 bg-yoga-green-bg text-yoga-green-text">
                <p className="text-sm font-semibold mb-1">Abmeldung jederzeit möglich</p>
                <p className="text-sm leading-relaxed opacity-90">
                  Möchtest du dich wirklich abmelden?
                </p>
              </div>
            ) : isEventPaid ? (
              // event_paid: 7-Tage-Stornofrist (Hard-Block-Logik kommt in Welle 3)
              <div className="rounded-yoga p-3 mb-4 bg-yoga-amber-bg text-yoga-amber-text">
                <p className="text-sm font-semibold mb-1">Verbindliche Buchung</p>
                <p className="text-sm leading-relaxed opacity-90">
                  Stornofrist: 7 Tage vor dem Event. Bei späterer Abmeldung wende dich bitte an Sarah.
                </p>
              </div>
            ) : (
              <div className={`rounded-yoga p-3 mb-4 ${within3h ? 'bg-yoga-red-bg text-yoga-red-text' : 'bg-yoga-green-bg text-yoga-green-text'}`}>
                <p className="text-sm font-semibold mb-1">
                  {within3h ? ' Zu spät für kostenlose Abmeldung' : 'Rechtzeitige Abmeldung'}
                </p>
                <p className="text-sm leading-relaxed opacity-90">
                  {within3h ? 'Credit wird nicht zurückgebucht.' : 'Dein Credit wird zurückgebucht.'}
                </p>
              </div>
            )}
            <button onClick={handleCancel} className="btn-danger mb-2" disabled={actionLoading}>
              {actionLoading ? 'Wird abgemeldet...' : 'Ja, abmelden'}
            </button>
            <button onClick={() => setShowCancel(false)} className="btn-ghost">Abbrechen</button>
          </>
        )}

        {/* NICHT ANGEMELDET + KEIN WARTELISTENEINTRAG */}
        {!past && !session.is_cancelled && !myBooking && !myWaitlist && (
          <>
            {/* Welle 2.5: Charity + Events brauchen keinen Credit. Treat als Pseudo-"hat Credit".
                event_paid → "Verbindlich anmelden, Zahlung extern" Hinweis. */}
            {/* Kurs gesperrt für externe Buchungen */}
            {!effectiveOpen && freeSpots > 0 && (freeCredits > 0 || course?.is_free || isEvent) && (
              <div className="bg-yoga-amber-bg border border-yoga-amber-text/30 rounded-yoga p-4 mb-4">
                <p className="text-sm font-bold text-yoga-amber-text mb-1">
                  <i className="ti ti-lock mr-1" /> Kurs noch nicht freigegeben
                </p>
                <p className="text-sm text-yoga-amber-text/90 leading-relaxed">
                  Dieser Kurs ist noch nicht für Einzelstunden-Buchungen freigegeben. Bitte wende dich an Sarah.
                </p>
              </div>
            )}
            {course?.is_free && freeSpots > 0 && effectiveOpen && (
              <div className="bg-yoga-green-bg border border-yoga-green-text/20 rounded-yoga p-3 mb-4">
                <p className="text-sm text-yoga-green-text leading-relaxed">
                  <span className="font-bold">Kostenlose Stunde</span> — kein Credit nötig. Einfach anmelden und teilnehmen.
                </p>
              </div>
            )}
            {isEventFree && freeSpots > 0 && effectiveOpen && (
              <div className="bg-yoga-green-bg border border-yoga-green-text/20 rounded-yoga p-3 mb-4">
                <p className="text-sm text-yoga-green-text leading-relaxed">
                  <span className="font-bold">Kostenloses Event</span> — einfach anmelden und teilnehmen.
                </p>
              </div>
            )}
            {isEventPaid && freeSpots > 0 && effectiveOpen && (
              <div className="bg-yoga-amber-bg border border-yoga-amber-text/20 rounded-yoga p-3 mb-4">
                <p className="text-sm text-yoga-amber-text leading-relaxed">
                  <span className="font-bold">Verbindlich anmelden</span> — Bezahlung extern (PayPal/Bar). Stornofrist: 7 Tage.
                </p>
              </div>
            )}
            {effectiveOpen && freeSpots > 0 && (freeCredits > 0 || course?.is_free || isEvent) ? (
              <>
                {/* Welle 2.5: bei Events keine 3h-Frist-Logik anzeigen */}
                {within3h && !isEvent ? (
                  <>
                    <div className="bg-amber-50 border border-yoga-amber-text/30 rounded-yoga p-3 mb-4">
                      <p className="text-sm font-bold text-yoga-amber-text mb-2">
                        <i className="ti ti-alert-triangle mr-1" /> Innerhalb der 3-Stunden-Frist
                      </p>
                      <p className="text-sm text-yoga-amber-text/90 leading-relaxed">
                        Kurs beginnt in weniger als 3 Stunden. Abmeldung danach <strong>nicht möglich</strong> – Credit verfällt auch bei Nichterscheinen.
                      </p>
                    </div>
                    <div className="bg-yoga-red-bg border border-yoga-red-text/20 rounded-yoga p-3 mb-4">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-0.5 w-5 h-5" />
                        <span className="text-sm text-yoga-red-text leading-relaxed">
                          Ich verstehe, dass mein Credit verfällt und ich mich nicht mehr abmelden kann.
                        </span>
                      </label>
                    </div>
                    <button onClick={handleBook} disabled={!confirmed || actionLoading}
                      className={`btn-primary mb-2 ${!confirmed ? 'opacity-40 cursor-not-allowed' : ''}`}
                      style={{ background: confirmed ? '#8a6020' : undefined }}>
                      {actionLoading ? 'Wird eingetragen...' : 'Trotzdem eintragen'}
                    </button>
                  </>
                ) : (
                  <>
                    {/* Storno-Hinweis NUR bei Credit-pflichtigen Stunden — bei Charity sinnlos */}
                    {!course?.is_free && !isEvent && (
                      <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-3 mb-4">
                        <p className="text-sm text-yoga-text/80 leading-relaxed">
                          Abmeldung kostenlos bis <strong>{deadline}</strong> – Credit kommt zurück.
                        </p>
                      </div>
                    )}
                    <button onClick={handleBook} className="btn-primary mb-2" disabled={actionLoading}>
                      {actionLoading ? 'Wird eingetragen...' : 'Für diese Stunde eintragen'}
                    </button>
                  </>
                )}
                <button onClick={() => router.back()} className="btn-ghost">Abbrechen</button>
              </>
            ) : (
              <>
                {freeCredits === 0 && !course?.is_free && !isEvent && (
                  <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-3 mb-4">
                    <p className="text-sm text-yoga-text/80">
                      Du hast keine freien Credits. Bitte wende dich an Sarah.
                    </p>
                  </div>
                )}
                {freeSpots <= 0 && (
                  <>
                    {freeCredits === 0 ? (
                      // Kein Credit: nur Benachrichtigung möglich
                      <>
                        <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-3 mb-4">
                          <p className="text-sm font-semibold text-yoga-text/80 mb-1">
                            <i className="ti ti-list-x mr-1" /> Warteliste nicht möglich
                          </p>
                          <p className="text-sm text-yoga-text/60 leading-relaxed">
                            Du hast keine freien Credits. Wenn du nachrückst würdest du keinen Platz belegen können. Du kannst dich aber benachrichtigen lassen – vielleicht hast du dann einen Credit.
                          </p>
                        </div>
                        <button onClick={() => handleWaitlist('notify')} className="btn-secondary mb-2" disabled={actionLoading}>
                          <i className="ti ti-bell mr-1" /> Benachrichtige mich wenn ein Platz frei wird
                        </button>
                      </>
                    ) : (
                      // Hat Credits: Warteliste + Benachrichtigung
                      <>
                        <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-3 mb-4">
                          <p className="text-sm text-yoga-text/80 leading-relaxed">
                            Diese Stunde ist ausgebucht. Du kannst dich auf die Warteliste setzen oder benachrichtigt werden wenn ein Platz frei wird.
                          </p>
                        </div>
                        <button onClick={() => handleWaitlist('waitlist')} className="btn-primary mb-2" disabled={actionLoading}>
                          <i className="ti ti-list mr-1" /> Auf die Warteliste setzen
                        </button>
                        <button onClick={() => handleWaitlist('notify')} className="btn-secondary mb-2" disabled={actionLoading}>
                          <i className="ti ti-bell mr-1" /> Benachrichtige mich wenn ein Platz frei wird
                        </button>
                      </>
                    )}
                  </>
                )}
                <button onClick={() => router.back()} className="btn-ghost">Zurück</button>
              </>
            )}
          </>
        )}

        {/* WARTELISTEN-KONFLIKT MODAL */}
        {showWaitlistConflict && conflictingWaitlists.length > 0 && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end modal-overlay" onClick={() => { setShowWaitlistConflict(false); setConflictingWaitlists([]) }}>
            <div className="bg-yoga-card w-full max-w-md mx-auto rounded-t-2xl p-5 pb-10" onClick={e => e.stopPropagation()}>
              <h3 className="text-base font-bold mb-2 text-yoga-amber-text">
                <i className="ti ti-alert-triangle mr-1" />Wartelisten-Konflikt
              </h3>
              <p className="text-sm text-yoga-text/80 leading-relaxed mb-3">
                Du bist auf {conflictingWaitlists.length === 1 ? 'folgender Warteliste' : 'folgenden Wartelisten'}, hast aber nicht genug Credits für alle. Wenn du diese Stunde buchst, wirst du von {conflictingWaitlists.length === 1 ? 'dieser Warteliste' : 'diesen Wartelisten'} entfernt:
              </p>
              <div className="bg-yoga-bg rounded-yoga p-3 mb-4">
                {conflictingWaitlists.map((w: any) => (
                  <div key={w.id} className="text-sm py-1 border-b last:border-b-0 border-yoga-border">
                    <strong>{sessionDisplayName(w.session)}</strong> · {new Date(w.session?.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short' })} · {w.session?.time_start?.slice(0,5)} Uhr
                  </div>
                ))}
              </div>
              <button onClick={handleBook} disabled={actionLoading} className="btn-primary mb-2">
                {actionLoading ? 'Wird gebucht...' : 'Ja, buchen und Warteliste verlassen'}
              </button>
              <button onClick={() => { setShowWaitlistConflict(false); setConflictingWaitlists([]) }} className="btn-ghost">
                Abbrechen
              </button>
            </div>
          </div>
        )}

        {/* AUF WARTELISTE */}
        {!past && !session.is_cancelled && myWaitlist && (
          <>
            <div className="bg-yoga-amber-bg border border-yoga-amber-text/30 rounded-yoga p-3 mb-4">
              <p className="text-sm font-bold text-yoga-amber-text mb-1">
                {myWaitlist.type === 'waitlist' ? `Du bist auf Position ${myWaitlist.position} der Warteliste` : 'Du wirst benachrichtigt'}
              </p>
              <p className="text-sm text-yoga-amber-text/90 leading-relaxed">
                {myWaitlist.type === 'waitlist'
                  ? 'Du rückst automatisch nach wenn ein Platz frei wird. Du hast dann 1 Stunde Zeit dich kostenlos abzumelden.'
                  : 'Sobald ein Platz frei wird, bekommst du eine Benachrichtigung.'}
              </p>
            </div>
            <button onClick={handleLeaveWaitlist} className="btn-danger mb-2" disabled={actionLoading}>
              {myWaitlist.type === 'waitlist' ? 'Von Warteliste austragen' : 'Benachrichtigung deaktivieren'}
            </button>
            <button onClick={() => router.back()} className="btn-ghost">Zurück</button>
          </>
        )}
      </div>

      <BottomNav isAdmin={profile?.is_admin} />
    </div>
  )
}
