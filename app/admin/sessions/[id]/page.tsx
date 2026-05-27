'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Email } from '@/lib/email'
import { promoteWaitlistOrOfferLate } from '@/lib/waitlist-promote'
import { isExcluded } from '@/lib/session-status'
import { selectCreditForBooking } from '@/lib/credit-selector'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

export default function AdminSessionPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const [session, setSession] = useState<any>(null)
  const [bookings, setBookings] = useState<any[]>([])
  const [waitlist, setWaitlist] = useState<any[]>([])
  const [promotingWaitlist, setPromotingWaitlist] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [showCancelForm, setShowCancelForm] = useState(false)
  const [hasReplacement, setHasReplacement] = useState(false)
  const [replacementDate, setReplacementDate] = useState('')
  const [replacementTime, setReplacementTime] = useState('')
  const [showAddReplacement, setShowAddReplacement] = useState(false)
  const [lateReplacementDate, setLateReplacementDate] = useState('')
  const [lateReplacementTime, setLateReplacementTime] = useState('')
  const [addingReplacement, setAddingReplacement] = useState(false)
  const [showAddYogi, setShowAddYogi] = useState(false)
  const [yogiSearch, setYogiSearch] = useState('')
  const [yogiResults, setYogiResults] = useState<any[]>([])
  const [selectedYogi, setSelectedYogi] = useState<any>(null)
  const [addingYogi, setAddingYogi] = useState(false)
  const [quickCreditYogi, setQuickCreditYogi] = useState<any>(null)
  // Sarah-Wunsch 2026-05-25: Robustes Modal statt confirm() — Cache-bust + iOS-tauglich
  // Welle 4 (Sarah 2026-05-26): sessionType im State — Defense-in-Depth gegen
  // versehentliches Anzeigen des 3h-Choice-Modals bei Events.
  const [cancelChoice, setCancelChoice] = useState<{ bookingId: string; sessionId: string; within3h: boolean; sessionType?: string } | null>(null)
  // Welle 2.5 (Sarah 2026-05-26): Edit-Form für Einzelstunden/Events (nicht für
  // course_session — die werden über den Kurs verwaltet).
  const [showEditForm, setShowEditForm] = useState(false)
  const [editForm, setEditForm] = useState<any>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  // Welle 2.6 (Sarah 2026-05-26): Lösch-Button für Einzelstunden/Events.
  // Hartes DELETE wenn keine aktiven Bookings; sonst Hinweis "vorher absagen".
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { loadData() }, [id])

  async function searchYogis(q: string) {
    setYogiSearch(q)
    if (q.length < 2) { setYogiResults([]); return }
    const { data } = await supabase.from('profiles')
      .select('id, first_name, last_name, email, is_dummy, credits(*)')
      .eq('is_admin', false)
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(8)
    // Filter already booked
    const bookedIds = bookings.map((b: any) => b.user_id)
    setYogiResults((data || []).filter((y: any) => !bookedIds.includes(y.id)))
  }

  function getFreeCredits(yogi: any) {
    return (yogi.credits || []).reduce((sum: number, c: any) => {
      if (c.model === 'guthaben') return sum // Guthaben nur für Kurse, nicht Einzelstunden
      if (new Date(c.expires_at) > new Date()) return sum + Math.max(0, c.total - c.used)
      return sum
    }, 0)
  }

  function getGuthabenCredits(yogi: any): number {
    const now = new Date()
    return (yogi.credits || []).reduce((sum: number, c: any) => {
      if (c.model !== 'guthaben') return sum
      if (new Date(c.expires_at) > now) return sum + Math.max(0, c.total - c.used)
      return sum
    }, 0)
  }

  function getBestCredit(yogi: any) {
    const now = new Date()
    return (yogi.credits || [])
      .filter((c: any) => c.model !== 'guthaben' && new Date(c.expires_at) > now && (c.total - c.used) > 0)
      .sort((a: any, b: any) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())[0] || null
  }

  async function cancelBookingForYogi(bookingId: string, creditId: string | null, sessionId: string) {
    // Sarah-Wunsch 2026-05-25: Robustes Modal statt confirm() — innerhalb 3h
    // vor Stundenbeginn muss Admin bewusst entscheiden, ob der Credit
    // zurueckgebucht wird.
    // Welle 4 (Sarah 2026-05-26): Bei Events (event_free/event_paid) entfaellt
    // die 3h-Frist-Logik komplett — Events haben kein Credit-System, und Admin
    // darf jederzeit austragen (Sarah-Wunsch: "rest mach ich manuell").
    // Bei event_paid innerhalb 7d: nur ein Hinweis-Confirm, dass eine
    // Bezahlung extern abgewickelt werden muss.
    const { data: freshSession } = await supabase.from('sessions')
      .select('date, time_start, session_type, price_eur, name').eq('id', sessionId).single()
    const sessType = freshSession?.session_type
    const isEvent = sessType === 'event_free' || sessType === 'event_paid'
    const isPaidEvent = sessType === 'event_paid'

    if (isEvent) {
      // Events: kein 3h-Modal, direktes Confirm. Bei event_paid + within7d
      // Hinweis auf externe Erstattung.
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
      // Keine credit-Aktion noetig (credit_id war null bei Events)
      loadData()
      return
    }

    // Standard-Pfad (course_session / single / event_credit): 3h-Frist-Modal
    let within3h = false
    if (freshSession) {
      const sessionStart = new Date(`${freshSession.date}T${freshSession.time_start}`).getTime()
      within3h = (sessionStart - Date.now()) <= 3 * 60 * 60 * 1000 && sessionStart > Date.now()
    }
    // Modal oeffnen — eigentliche Cancellation passiert in confirmCancelBooking(...)
    setCancelChoice({ bookingId, sessionId, within3h, sessionType: sessType })
  }

  // Sarah-Wunsch 2026-05-25: Eigentliche Cancellation, getrennt vom UI-Trigger.
  // creditReturned=true → Credit zurueck (Trigger sync_credit_used aktualisiert).
  // creditReturned=false → cancel_late=true, Credit verfaellt.
  async function confirmCancelBooking(creditReturned: boolean) {
    if (!cancelChoice) return
    const { bookingId, sessionId, within3h } = cancelChoice
    const cancelLate = !creditReturned
    setCancelChoice(null)

    await supabase.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: cancelLate,
    }).eq('id', bookingId)

    void within3h // (audit_log unten enthaelt den Flag)

    // Wenn Credit NICHT zurueckgebucht werden soll: cancel_late=true verhindert
    // den trg_sync_credit_used Trigger (alte Sarah-Regel: cancel_late=true = Credit verfaellt).

    await supabase.from('audit_log').insert({
      action: 'booking_cancelled_by_admin',
      details: { booking_id: bookingId, session_id: sessionId, credit_returned: creditReturned,
                 within_3h: within3h,
                 // Welle 6A: session_type + name für klares Protokoll
                 session_type: session?.session_type || null,
                 name: session?.name || null,
                 session_date: session?.date, session_time: session?.time_start }
    })

    // Sarah-Regel 2026-05-23: zentraler Promote-Helper mit 90-Min-Cutoff-Logic.
    // > 90 Min vor Stunde: erster Waitlist-Yogi wird auto-promoted (+Email)
    // ≤ 90 Min vor Stunde: ALLE Waitlist-Yogis kriegen Auswahl-Mail mit Token,
    //                       wer zuerst klickt gewinnt.
    // Notify-Subscribers werden IMMER informiert.
    await promoteWaitlistOrOfferLate(supabase, sessionId)

    loadData()
  }

  async function handleAddYogi(yogi: any) {
    if (!session) { setQuickCreditYogi(yogi); return }

    // ─────────────────────────────────────────────────────────────────────
    // Welle 2.10 (Sarah 2026-05-26) — CREDIT-SAFETY-AUDIT für Events:
    //
    // - event_free  → KEIN Credit-Abzug. credit_id=null. Yogi bekommt Mail
    //                  "kostenlos, einfach kommen".
    // - event_paid  → KEIN Credit-Abzug. credit_id=null. Yogi bekommt Mail
    //                  mit Preis + Bezahlungs-Hinweis (extern: bar/Überweisung).
    // - single      → Credit-Logik wie bisher (selectCreditForBooking).
    // - event_credit→ Credit-Logik wie bei single (semantisch identisch).
    // - course_session → bestehende Logik (Course-Credit vor Single/etc.).
    //
    // Begründung: bei event_free/event_paid darf NICHTS aus der credits-
    // Tabelle abgezogen werden — die Bezahlung läuft komplett außerhalb des
    // Credit-Systems. Wenn credit_id=null gesetzt wird, ignoriert auch der
    // trg_sync_credit_used Trigger den Booking-Eintrag.
    // ─────────────────────────────────────────────────────────────────────
    const sessionType: string = session.session_type || 'course_session'
    const isFreeEvent = sessionType === 'event_free'
    const isPaidEvent = sessionType === 'event_paid'
    // Welle 6 (Sarah 2026-05-27, Item 7): Dummy-Yogis buchen IMMER ohne Credit
    // (kein Credit-Check, kein credit_id), egal welcher session_type. Dummys
    // sind reine Anzeige-Platzhalter — sie brauchen kein Booking-System.
    const isDummy = !!yogi.is_dummy
    const skipCreditLogic = isFreeEvent || isPaidEvent || isDummy

    if (skipCreditLogic) {
      setAddingYogi(true)
      // Direkt buchen ohne Credit — type='single' (= Drop-In-Charakter, keine
      // Kursbindung), credit_id=null, kein origin_session_id.
      const { error: bookingError } = await supabase.from('bookings').upsert({
        user_id: yogi.id, session_id: id,
        credit_id: null, type: 'single', status: 'active',
        origin_session_id: null,
        cancelled_at: null, cancel_late: false,
      }, { onConflict: 'user_id,session_id' })
      if (bookingError) {
        setAddingYogi(false)
        alert('Buchung konnte nicht angelegt werden.')
        return
      }
      // Yogi-Email mit passendem Kontext. Für event_paid wird der Preis
      // im Email-Text über `bookingConfirmed` mit isSingle=true gerendert;
      // Preis-Hinweis kommen über das `courseName`-Feld (siehe Format unten).
      if (yogi.email && !yogi.is_dummy) {
        try {
          // Konstruktion eines aussagekräftigen "courseName"-Strings, damit
          // der Yogi in der Buchungsbestätigung sofort sieht ob bezahlt oder
          // kostenlos. Wir benutzen NICHT neue Email-Cases (Edge Function
          // ist deployed, keine Mit-Änderung möglich aus dem Frontend).
          // Statt dessen reichern wir den Display-Namen mit Marker an —
          // sauberer Workaround.
          // Welle 6 (Sarah 2026-05-27): Dummy mit Mail bei Kursstunde →
          // einfacher Name ohne Event-Marker.
          const eventLabel = isFreeEvent
            ? `${session.name} (kostenlos)`
            : isPaidEvent
            ? `${session.name} (${session.price_eur} € — bitte bar mitbringen oder vorab überweisen)`
            : (session.name || session.course?.name || '')
          await Email.bookingConfirmed({
            email: yogi.email,
            firstName: yogi.first_name || 'Yogi',
            courseName: eventLabel,
            date: session.date,
            timeStart: session.time_start,
            durationMin: session.duration_min || 75,
            isSingle: true,
          })
        } catch (e) { /* nicht-blockierend */ }
      }
      // Welle 6 (Sarah 2026-05-27, Item 12): action je nach Kontext + name fuer Yogi-Protokoll.
      await supabase.from('audit_log').insert({
        action: (isFreeEvent || isPaidEvent) ? 'admin_added_yogi_to_event' : 'admin_added_yogi_to_session',
        details: {
          user_id: yogi.id, session_id: id, session_type: sessionType,
          credit_used: false,
          price_eur: isPaidEvent ? session.price_eur : null,
          is_dummy: isDummy || undefined,
          name: session.name || null,
          session_date: session.date, session_time: session.time_start,
        }
      })
      setShowAddYogi(false); setYogiSearch(''); setYogiResults([]); setSelectedYogi(null)
      setAddingYogi(false); loadData()
      return
    }

    // Sarah-Regel 2026-05-22: Course-Credit vor Single/Tenpack/Quartal, minutengenauer 10d/8d-Check.
    // (Pfad NUR für course_session, single, event_credit — alles wo Credits
    // verbraucht werden müssen.)
    const pick = await selectCreditForBooking(supabase, yogi.id, id as string, session.date, session.time_start)
    if (!pick.ok) {
      // Course-Credit-Fenster verletzt oder kein Credit → Admin entscheidet (Quick-Credit Dialog)
      const proceed = confirm(`${pick.message}\n\nSoll trotzdem ein Quick-Credit (1 Einzelstunde) angelegt werden?`)
      if (!proceed) return
      setQuickCreditYogi(yogi)
      return
    }
    setAddingYogi(true)
    // Yogi enrolled im Session-Kurs? → type=course (gehört in Kurs-Block in /meine)
    const { data: enrolledHere } = await supabase.from('enrollments')
      .select('id').eq('user_id', yogi.id).eq('course_id', (session as any).course?.id).maybeSingle()
    const bookingType = (enrolledHere || pick.usedModel === 'course') ? 'course' : 'single'
    const { error: bookingError } = await supabase.from('bookings').upsert({
      user_id: yogi.id, session_id: id,
      credit_id: pick.creditId, type: bookingType, status: 'active',
      origin_session_id: pick.originSessionId,
      cancelled_at: null, cancel_late: false,
    }, { onConflict: 'user_id,session_id' })
    if (bookingError) {
      setAddingYogi(false)
      alert('Buchung konnte nicht angelegt werden.')
      return
    }
    await supabase.from('audit_log').insert({
      action: 'admin_added_yogi_to_session',
      // Welle 6A (Sarah 2026-05-27, Item 12): name + date/time fuer Yogi-Protokoll.
      details: {
        user_id: yogi.id, session_id: id,
        credit_id: pick.creditId, origin_session_id: pick.originSessionId,
        name: session.name || null,
        session_type: sessionType,
        session_date: session.date, session_time: session.time_start,
      }
    })
    setShowAddYogi(false); setYogiSearch(''); setYogiResults([]); setSelectedYogi(null)
    setAddingYogi(false); loadData()
  }

  async function handleQuickCredit(yogi: any) {
    const expiry = new Date(); expiry.setFullYear(expiry.getFullYear() + 1)
    const { data: newCredit } = await supabase.from('credits').insert({
      user_id: yogi.id, total: 1, used: 1,
      expires_at: expiry.toISOString(), model: 'single', course_id: null
    }).select('id, used').single()
    if (!newCredit) return
    await supabase.from('bookings').upsert({
      user_id: yogi.id, session_id: id,
      credit_id: newCredit.id, type: 'single', status: 'active',
      cancelled_at: null, cancel_late: false,
    }, { onConflict: 'user_id,session_id' })
    // Welle 4.7 (Sarah 2026-05-26): Audit-Spur war komplett leer — Sarah-Frust.
    // Jetzt 2 Eintraege: Credit-Vergabe + Einbuchung.
    await supabase.from('audit_log').insert({
      action: 'credit_assigned',
      details: { target_user_id: yogi.id, credit_id: newCredit.id, amount: 1,
                 model: 'single', quick_credit: true, source: 'admin_added_yogi_to_session_via_quick_credit',
                 session_id: id }
    })
    await supabase.from('audit_log').insert({
      action: 'admin_added_yogi_to_session',
      // Welle 6A (Sarah 2026-05-27, Item 12): name fuer Yogi-Protokoll
      details: {
        user_id: yogi.id, session_id: id,
        credit_id: newCredit.id, quick_credit: true,
        name: session?.name || null,
        session_type: session?.session_type || null,
        session_date: session?.date, session_time: session?.time_start,
      }
    })
    setQuickCreditYogi(null); setShowAddYogi(false)
    setYogiSearch(''); setYogiResults([])
    loadData()
  }

  async function loadData() {
    const [{ data: sess }, { data: bkgs }, { data: wl }] = await Promise.all([
      // KEIN self-referenzierender Subquery (PostgREST → 400). Replacement separat unten.
      // Welle 2.5 (Sarah 2026-05-26): bring_along + difficulty + alle session-eigenen
      // Felder werden via `*` mitgeladen. course bringt nur Container-Metadaten.
      supabase.from('sessions').select('*, course:courses(name, id, is_free, image_url)').eq('id', id).single(),
      supabase.from('bookings')
        .select('*, profile:profiles(email, first_name, last_name)')
        .eq('session_id', id).eq('status', 'active'),
      // Warteliste-Yogis ('waitlist' type) — chronologisch ältester zuerst (FIFO).
      // Notify-Type sind nur "informier mich"-Einträge, NICHT auf der echten Warteliste.
      supabase.from('waitlist')
        .select('*, profile:profiles(email, first_name, last_name, is_dummy)')
        .eq('session_id', id).eq('type', 'waitlist').order('created_at', { ascending: true }),
    ])

    // Replacement-Session separat laden (= die Ersatzstunde wenn DIESE abgesagt ist)
    let replacement: any = null
    if ((sess as any)?.replacement_session_id) {
      const { data: rep } = await supabase.from('sessions')
        .select('id, date, time_start, is_cancelled')
        .eq('id', (sess as any).replacement_session_id).maybeSingle()
      replacement = rep
    }
    // Sarah-Wunsch 2026-05-23: wenn DIESE Stunde selbst eine Ersatzstunde IST
    // (also eine andere abgesagte Session zeigt mit replacement_session_id auf hier),
    // dann zeige "Ersatzstunde für [Datum/Uhrzeit der abgesagten Original-Stunde]".
    let replacementOf: any = null
    const { data: origin } = await supabase.from('sessions')
      .select('id, date, time_start')
      .eq('replacement_session_id', id)
      .maybeSingle()
    if (origin) replacementOf = origin

    setSession(sess ? { ...sess, replacement, replacementOf } : sess)
    setBookings(bkgs || [])
    setWaitlist(wl || [])
    setLoading(false)
  }

  /** Warteliste-Yogi manuell zur Stunde hinzufügen (Sarah-Wunsch 2026-05-23).
   *  Überbuchung erlaubt: kein max_spots-Check (enforce_session_max_spots-Trigger
   *  bypasst Admin sowieso). Sucht passenden Credit via selectCreditForBooking.
   *  Bei keinem Credit → Quick-Credit-Modal über quickCreditYogi-State. */
  async function addWaitlistYogi(wlEntry: any) {
    if (!session?.date || !session?.time_start) return
    setPromotingWaitlist(wlEntry.id)
    // Welle 2.10 (Sarah 2026-05-26): Credit-Safety auch hier — Warteliste-Yogi
    // bei event_free/event_paid ohne Credit-Abzug einbuchen.
    // Welle 6 (Sarah 2026-05-27, Item 7): zusaetzlich Dummys ohne Credit.
    const evType: string = session.session_type || 'course_session'
    const isDummyWl = !!wlEntry.profile?.is_dummy
    if (evType === 'event_free' || evType === 'event_paid' || isDummyWl) {
      await supabase.from('bookings').upsert({
        user_id: wlEntry.user_id, session_id: id,
        credit_id: null, type: 'single', status: 'active',
        origin_session_id: null,
        cancelled_at: null, cancel_late: false,
      }, { onConflict: 'user_id,session_id' })
      await supabase.from('waitlist').delete().eq('id', wlEntry.id)
      await supabase.from('audit_log').insert({
        action: 'admin_promoted_waitlist_yogi',
        // Welle 6A (Sarah 2026-05-27, Item 12): name fuer Yogi-Protokoll
        details: {
          user_id: wlEntry.user_id, session_id: id, session_type: evType,
          credit_used: false, price_eur: evType === 'event_paid' ? session.price_eur : null,
          is_dummy: isDummyWl || undefined,
          name: session.name || null,
          session_date: session.date, session_time: session.time_start,
        }
      })
      setPromotingWaitlist(null)
      loadData()
      return
    }
    const pick = await selectCreditForBooking(supabase, wlEntry.user_id, id as string, session.date, session.time_start)
    if (!pick.ok) {
      const proceed = confirm(`${pick.message}\n\nSoll trotzdem ein Quick-Credit (1 Einzelstunde) angelegt werden?`)
      if (!proceed) { setPromotingWaitlist(null); return }
      // Quick-Credit-Pfad: legt single-Credit an und bucht (analog handleQuickCredit für normale Yogis)
      const expiry = new Date(); expiry.setFullYear(expiry.getFullYear() + 1)
      const { data: newCredit } = await supabase.from('credits').insert({
        user_id: wlEntry.user_id, total: 1, used: 1,
        expires_at: expiry.toISOString(), model: 'single', course_id: null,
      }).select('id').single()
      if (!newCredit) { setPromotingWaitlist(null); return }
      await supabase.from('bookings').upsert({
        user_id: wlEntry.user_id, session_id: id,
        credit_id: newCredit.id, type: 'single', status: 'active',
        cancelled_at: null, cancel_late: false,
      }, { onConflict: 'user_id,session_id' })
    } else {
      // Yogi enrolled im Session-Kurs? → type=course (gehört in Kurs-Block in /meine)
      const { data: enrolledHere } = await supabase.from('enrollments')
        .select('id').eq('user_id', wlEntry.user_id).eq('course_id', (session as any).course?.id).maybeSingle()
      const bookingType = (enrolledHere || pick.usedModel === 'course') ? 'course' : 'single'
      await supabase.from('bookings').upsert({
        user_id: wlEntry.user_id, session_id: id,
        credit_id: pick.creditId, type: bookingType, status: 'active',
        origin_session_id: pick.originSessionId,
        cancelled_at: null, cancel_late: false,
      }, { onConflict: 'user_id,session_id' })
    }
    // Warteliste-Eintrag entfernen
    await supabase.from('waitlist').delete().eq('id', wlEntry.id)
    // Audit-Log
    await supabase.from('audit_log').insert({
      action: 'admin_promoted_waitlist_yogi',
      // Welle 6A (Sarah 2026-05-27, Item 12): name fuer Yogi-Protokoll
      details: {
        user_id: wlEntry.user_id, session_id: id,
        was_overbooking: bookings.length >= ((session as any).course?.max_spots ?? Infinity),
        session_type: session?.session_type || null,
        name: session?.name || null,
        session_date: session?.date, session_time: session?.time_start,
      }
    })
    setPromotingWaitlist(null)
    loadData()
  }

  // Welle 2.5 (Sarah 2026-05-26): Edit-Speichern für Einzelstunden/Events.
  // Nur für session_type != 'course_session'. Updates name/date/time_start/
  // duration_min/max_spots/location/description/bring_along/difficulty/image_url,
  // bei event_paid zusätzlich price_eur.
  async function handleSaveEdit() {
    if (!editForm || !session) return
    setSavingEdit(true)
    try {
      const patch: any = {
        name: editForm.name.trim(),
        date: editForm.date,
        time_start: editForm.time_start.length === 5 ? editForm.time_start + ':00' : editForm.time_start,
        duration_min: editForm.duration_min,
        max_spots: editForm.max_spots,
        location: editForm.location || null,
        description: editForm.description || null,
        bring_along: editForm.bring_along || null,
        difficulty: editForm.difficulty || null,
        image_url: editForm.image_url || null,
      }
      if (session.session_type === 'event_paid') {
        const p = parseFloat(editForm.price_eur)
        if (!p || p <= 0) { alert('Bitte gültigen Preis angeben'); setSavingEdit(false); return }
        patch.price_eur = p
      }
      // Welle 2.6 (Sarah 2026-05-26): Externe Teilnehmer editierbar.
      // Clamp 0..max_spots; eigener audit_log Eintrag bei Aenderung.
      const newExternal = Math.max(0, Math.min(Number(editForm.external_participants_count) || 0, patch.max_spots || 200))
      const oldExternal = Number((session as any).external_participants_count) || 0
      patch.external_participants_count = newExternal
      const changedKeys = Object.keys(patch).filter(k => (session as any)[k] != patch[k])
      const { error } = await supabase.from('sessions').update(patch).eq('id', id)
      if (error) { alert('Fehler: ' + error.message); setSavingEdit(false); return }
      await supabase.from('audit_log').insert({
        action: 'single_or_event_updated',
        details: { session_id: id, session_type: session.session_type, changed_fields_count: changedKeys.length }
      })
      if (newExternal !== oldExternal) {
        await supabase.from('audit_log').insert({
          action: 'external_participants_changed',
          details: { session_id: id, old: oldExternal, new: newExternal }
        })
      }
      setShowEditForm(false)
      setEditForm(null)
      loadData()
    } catch (e: any) {
      alert('Fehler: ' + (e?.message || e))
    } finally {
      setSavingEdit(false)
    }
  }

  function openEditForm() {
    if (!session) return
    setEditForm({
      name: session.name ?? '',
      date: session.date ?? '',
      time_start: (session.time_start || '').slice(0, 5),
      duration_min: session.duration_min ?? 75,
      max_spots: session.max_spots ?? 12,
      location: session.location ?? '',
      description: session.description ?? '',
      bring_along: session.bring_along ?? '',
      difficulty: session.difficulty ?? 'Alle Level',
      image_url: session.image_url ?? '',
      price_eur: session.price_eur != null ? String(session.price_eur) : '',
      external_participants_count: session.external_participants_count ?? 0,
    })
    setShowEditForm(true)
  }

  // Welle 2.6 (Sarah 2026-05-26): Hard-DELETE einer Einzelstunde/Event.
  // Voraussetzungen:
  //  - session_type != 'course_session' (echte Kursstunden werden ueber Kurs verwaltet)
  //  - keine aktiven Bookings (sonst muss vorher abgesagt werden; Yogis informieren)
  // Audit-Log: single_or_event_deleted. Anschliessend zurueck zu /admin/kurse.
  async function handleDeleteSession() {
    if (!session) return
    if (session.session_type === 'course_session') {
      alert('Kursstunden werden über den Kurs verwaltet, nicht einzeln gelöscht.')
      return
    }
    const activeBookings = bookings.filter((b: any) => b.status === 'active')
    if (activeBookings.length > 0) {
      alert(`Sage zuerst die Stunde ab (${activeBookings.length} Yogi${activeBookings.length === 1 ? '' : 's'} müssen informiert werden).`)
      return
    }
    if (!confirm('Wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.')) return
    setDeleting(true)
    try {
      // Vorab Warteliste + alle (auch gecancelten) Bookings entfernen, damit FK-Cascade
      // sauber durchläuft (FK ohne ON DELETE CASCADE würde sonst blockieren).
      await supabase.from('waitlist').delete().eq('session_id', id)
      await supabase.from('bookings').delete().eq('session_id', id)
      const { error } = await supabase.from('sessions').delete().eq('id', id)
      if (error) { alert('Fehler beim Löschen: ' + error.message); setDeleting(false); return }
      await supabase.from('audit_log').insert({
        action: 'single_or_event_deleted',
        details: {
          session_id: id,
          session_type: session.session_type,
          name: session.name,
          date: session.date,
          time_start: session.time_start,
        }
      })
      router.push('/admin/kurse')
    } catch (e: any) {
      alert('Fehler: ' + (e?.message || e))
      setDeleting(false)
    }
  }

  async function handleAddLateReplacement() {
    if (!lateReplacementDate || !lateReplacementTime) return
    setAddingReplacement(true)

    // Alle stornierten Buchungen dieser Session holen
    const { data: cancelledBookings } = await supabase
      .from('bookings')
      .select('*, profile:profiles(email, first_name, last_name)')
      .eq('session_id', id)
      .eq('status', 'cancelled')

    // Neue Ersatz-Session im gleichen Kurs anlegen
    const { data: newSession } = await supabase.from('sessions').insert({
      course_id: session.course.id,
      date: lateReplacementDate,
      time_start: lateReplacementTime + ':00',
      duration_min: session.duration_min,
      is_cancelled: false,
    }).select('id').single()

    if (!newSession) { setAddingReplacement(false); return }

    // Ersatztermin mit Original verknüpfen (für "Zur Ersatzstunde"-Link bei abgesagter Stunde)
    await supabase.from('sessions').update({
      replacement_session_id: newSession.id,
    }).eq('id', id)

    let enrolledCount = 0
    let skippedCount = 0

    for (const booking of (cancelledBookings || [])) {
      if (!booking.credit_id) continue

      // Credit prüfen: muss existieren, noch gültig sein und freies Guthaben haben
      const { data: credit } = await supabase.from('credits')
        .select('*').eq('id', booking.credit_id).maybeSingle()

      const creditAvailable = credit
        && (credit.total - credit.used) > 0
        && new Date(credit.expires_at) > new Date()

      if (!creditAvailable) {
        skippedCount++
        continue
      }

      // Upsert: falls Yogi bereits eine Buchung für diese neue Session hat (Duplikat-Schutz)
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

      // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
      enrolledCount++

      if (booking.profile?.email) {
        await Email.sessionAdded({
          email: booking.profile.email,
          firstName: booking.profile.first_name || 'Yogi',
          // Welle 3: bei Container-Sessions session.name (sonst landet "SYS · ..." in der Mail)
          courseName: (session?.session_type && session.session_type !== 'course_session')
            ? (session?.name || '')
            : (session?.course?.name || ''),
          date: lateReplacementDate,
          timeStart: lateReplacementTime,
          durationMin: session?.duration_min || 60,
          originalDate: session?.date,
          originalTime: session?.time_start,
        })
      }
    }

    await supabase.from('audit_log').insert({
      action: 'replacement_session_added',
      details: {
        original_session_id: id,
        replacement_session_id: newSession.id,
        course: session?.course?.name,
        date: lateReplacementDate,
        yogis_enrolled: enrolledCount,
        yogis_skipped: skippedCount,
      }
    })

    setAddingReplacement(false)
    setShowAddReplacement(false)
    const skipNote = skippedCount > 0
      ? ` ${skippedCount} Yogi(s) nicht eingebucht – Credit bereits in einer anderen Stunde verwendet.`
      : ''
    alert(`Ersatztermin angelegt! ${enrolledCount} Yogi(s) eingebucht und informiert.${skipNote}`)
    loadData()
  }

  async function handleCancelSession() {
    // Welle 3 (Sarah 2026-05-26): Confirm-Text session_type-aware
    const sessType = session?.session_type
    const isEvent = sessType === 'event_free' || sessType === 'event_paid'
    const subject = isEvent ? 'Event' : 'Stunde'
    if (!confirm(`${subject} wirklich absagen? ${bookings.length} Yogi${bookings.length === 1 ? '' : 's'} werden informiert.`)) return
    setCancelling(true)

    let replacementSessionId: string | null = null

    // Welle 2.10 (Sarah 2026-05-26): Ersatztermin NUR für course_session sinnvoll —
    // bei Einzelstunden/Events gibts keinen Folgetermin. hasReplacement wird
    // bei nicht-course_session ignoriert (UI versteckt den Checkbox sowieso,
    // aber State-Defensive: doppelt absichern).
    const isCourseSession = session?.session_type === 'course_session'

    // 1) Ersatztermin anlegen falls gewünscht (nur für course_session)
    if (isCourseSession && hasReplacement && replacementDate && replacementTime) {
      const { data: newSession } = await supabase.from('sessions').insert({
        course_id: session.course.id,
        date: replacementDate,
        time_start: replacementTime,
        duration_min: session.duration_min,
        is_cancelled: false,
      }).select('id').single()
      replacementSessionId = newSession?.id || null
    }

    // 2) Ursprüngliche Session als abgesagt markieren + ggf. Ersatztermin verlinken
    // WICHTIG: cancel_reason gesetzt damit UI zwischen "Abgesagt" und "Ausgeschlossen" unterscheidet.
    await supabase.from('sessions').update({
      is_cancelled: true,
      cancel_reason: reason || 'Abgesagt',
      replacement_session_id: replacementSessionId,
    }).eq('id', id)

    // 3) Alle Buchungen stornieren
    for (const booking of bookings) {
      await supabase.from('bookings').update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancel_late: false,
      }).eq('id', booking.id)

      // Credit zurückbuchen ODER direkt in Ersatztermin einbuchen
      if (replacementSessionId && booking.credit_id) {
        // Direkt in Ersatztermin einbuchen – Credit bleibt verbraucht
        await supabase.from('bookings').insert({
          user_id: booking.user_id,
          session_id: replacementSessionId,
          credit_id: booking.credit_id,
          type: booking.type,
          status: 'active',
        })
      }
      // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
      // (bei Cancellation und/oder neuer Buchung im Ersatztermin)

      // Email an Yogi
      if (booking.profile?.email) {
        // Welle 3: courseName fuer Mails ist session.name bei Container-Sessions
        const mailName = (session?.session_type && session.session_type !== 'course_session')
          ? (session?.name || '')
          : (session?.course?.name || '')
        await Email.sessionCancelled({
          email: booking.profile.email,
          firstName: booking.profile.first_name || 'Yogi',
          courseName: mailName,
          date: session?.date || '',
          timeStart: session?.time_start || '',
          reason: reason || undefined,
          replacementDate: hasReplacement ? replacementDate : undefined,
          replacementTime: hasReplacement ? replacementTime : undefined,
          sessionType: session?.session_type,
        })

        // Falls Ersatztermin: auch Buchungsbestätigung für neuen Termin
        // (Ersatztermin gibt es nur bei course_session — siehe Welle 2.10)
        if (replacementSessionId) {
          await Email.bookingConfirmed({
            email: booking.profile.email,
            firstName: booking.profile.first_name || 'Yogi',
            courseName: mailName,
            date: replacementDate,
            timeStart: replacementTime,
            durationMin: session?.duration_min || 60,
            sessionType: session?.session_type,
          })
        }
      }
    }

    // 4) Warteliste löschen
    await supabase.from('waitlist').delete().eq('session_id', id)

    // Welle 4.7 (Sarah 2026-05-26): Audit-Spur war komplett leer — kritische
    // Compliance-Luecke. Jetzt session_cancelled + (falls Ersatz) replacement_session_added.
    await supabase.from('audit_log').insert({
      action: 'session_cancelled',
      details: {
        session_id: id, session_type: session?.session_type,
        course_name: session?.course?.name, session_name: session?.name,
        session_date: session?.date, session_time: session?.time_start,
        reason: reason || null,
        replacement_session_id: replacementSessionId,
        affected_yogis: bookings.length,
      }
    })
    if (replacementSessionId) {
      await supabase.from('audit_log').insert({
        action: 'replacement_session_added',
        details: {
          original_session_id: id, replacement_session_id: replacementSessionId,
          replacement_date: replacementDate, replacement_time: replacementTime,
          yogis_re_enrolled: bookings.filter(b => b.credit_id).length,
        }
      })
    }

    setCancelling(false)
    // Welle 2.10 (Sarah 2026-05-26): bei Events/Einzelstunden ist die Credit-
    // Rückbuchung kontextabhängig — event_free hat gar keine Credits,
    // event_paid wurde extern bezahlt. Daher generische Meldung.
    const msg = replacementSessionId
      ? `Stunde abgesagt. ${bookings.length} Yogis wurden direkt in den Ersatztermin (${replacementDate}) eingebucht und informiert.`
      : session?.session_type === 'event_free'
        ? `Stunde abgesagt. ${bookings.length} Yogis wurden informiert (kein Credit verbraucht).`
        : session?.session_type === 'event_paid'
          ? `Stunde abgesagt. ${bookings.length} Yogis wurden informiert — Rückzahlung manuell klären.`
          : `Stunde abgesagt. ${bookings.length} Yogis wurden informiert und ihre Credits zurückgebucht.`
    alert(msg)
    router.back()
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" />
    </div>
  )

  const dateStr = session?.date ? new Date(session.date).toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }) : ''

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Stunde verwalten" isAdmin />
      <div className="px-4 py-4">

        {/* Session Info — Welle 2.5: session.name Vorrang vor course.name
            (Container-Kurs zeigt sonst "SYS · Events (bezahlt)" o.ä.). */}
        <div className="card mb-4">
          <div className="flex items-start gap-3">
            {(session?.image_url || session?.course?.image_url) && (
              <img src={session?.image_url ?? session.course.image_url} alt="" className="w-14 h-14 rounded-yoga object-cover flex-shrink-0 border border-yoga-border" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-base font-bold mb-1">
                {session?.name ?? session?.course?.name}
                {session?.course?.is_free && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-yoga-green-bg text-yoga-green-text text-xs font-semibold align-middle">
                    Kostenlos
                  </span>
                )}
                {session?.session_type === 'event_free' && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-yoga-green-bg text-yoga-green-text text-xs font-semibold align-middle">
                    Event · Kostenlos
                  </span>
                )}
                {session?.session_type === 'event_paid' && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-yoga-amber-bg text-yoga-amber-text text-xs font-semibold align-middle">
                    Event · {session.price_eur} €
                  </span>
                )}
                {session?.session_type === 'single' && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-yoga-gray text-yoga-text/60 text-xs font-semibold align-middle">
                    Einzelstunde
                  </span>
                )}
              </div>
              <div className="text-sm text-yoga-text/60">{dateStr} · {session?.time_start?.slice(0,5)} Uhr</div>
              <div className="text-sm text-yoga-text/50 mt-1">{session?.duration_min} Minuten</div>
            </div>
          </div>
          {/* Charity-Quick-Promote: 1 Klick → Sprechblase mit Link zu dieser Stunde */}
          {session?.course?.is_free && !session?.is_cancelled && (
            <button
              onClick={async () => {
                const linkUrl = `/kurse/${id}`
                // Neutrale Ankündigung — egal ob in 2 Tagen oder in 5 Wochen.
                // Datum aus session.date, Jahr nur wenn nicht aktuelles Jahr.
                const sessionDate = new Date(session.date)
                const isThisYear = sessionDate.getFullYear() === new Date().getFullYear()
                const dateFormatted = sessionDate.toLocaleDateString('de-DE',
                  isThisYear
                    ? { weekday:'long', day:'numeric', month:'long' }
                    : { weekday:'long', day:'numeric', month:'long', year:'numeric' })
                const message = `${session.course.name} am ${dateFormatted} um ${session.time_start?.slice(0,5)} Uhr — kostenlos!`
                const { error } = await supabase.from('admin_announcement')
                  .update({
                    message, is_active: true,
                    link_url: linkUrl, link_label: 'Zur Stunde',
                    updated_at: new Date().toISOString(),
                  }).eq('id', 1)
                if (error) alert('Fehler: ' + error.message)
                else alert('Stunde wurde in der Sprechblase für alle Yogis promoted.')
              }}
              className="mt-3 w-full text-sm font-semibold bg-yoga-green-text text-white rounded-yoga py-2.5 hover:opacity-90">
              <i className="ti ti-bullhorn mr-1" /> In Sprechblase posten (für alle Yogis)
            </button>
          )}
          {/* Teilen-Button — für Admin sinnvoll, damit sie über WhatsApp/Email teilen kann.
              Welle 4.7 (Sarah 2026-05-26): NUR bei Events / Einzelstunden / Charity
              anzeigen. Bei normalen Kursstunden (course_session) ist Teilen sinnlos. */}
          {!session?.is_cancelled && (
            session?.session_type === 'event_free' ||
            session?.session_type === 'event_paid' ||
            session?.session_type === 'single' ||
            session?.course?.is_free
          ) && (
            <button
              onClick={async () => {
                const sessionDate = new Date(session.date)
                const isThisYear = sessionDate.getFullYear() === new Date().getFullYear()
                const dateFormatted = sessionDate.toLocaleDateString('de-DE',
                  isThisYear
                    ? { weekday:'short', day:'numeric', month:'long' }
                    : { weekday:'short', day:'numeric', month:'long', year:'numeric' })
                const shareText = `${session?.course?.name || 'Yoga-Stunde'} · ${dateFormatted} · ${session?.time_start?.slice(0,5)} Uhr${session?.course?.is_free ? ' — kostenlos!' : ''}`
                // Link auf Yogi-Page, nicht Admin-Page
                const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/kurse/${id}` : ''
                if (typeof navigator !== 'undefined' && (navigator as any).share) {
                  try {
                    await (navigator as any).share({ title: session?.course?.name || 'Yoga', text: shareText, url: shareUrl })
                  } catch (e) { /* user cancelled */ }
                } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
                  try {
                    await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`)
                    alert('Link kopiert — kannst du jetzt in WhatsApp oder einer anderen App einfügen.')
                  } catch (e) { alert('Teilen nicht verfügbar') }
                }
              }}
              className="mt-2 w-full text-sm font-semibold bg-yoga-gray hover:bg-yoga-card text-yoga-text border border-yoga-border rounded-yoga py-2">
              <i className="ti ti-share mr-1" /> Stunde teilen (WhatsApp / Email)
            </button>
          )}
          {/* Welle 2.5 (Sarah 2026-05-26): Bearbeiten-Button für Einzelstunden/Events.
              Block-Kursstunden werden über den Kurs verwaltet — kein Edit hier. */}
          {!session?.is_cancelled && session?.session_type && session.session_type !== 'course_session' && (
            <button onClick={openEditForm}
              className="mt-2 w-full text-sm font-semibold bg-yoga-bg hover:bg-yoga-card text-yoga-text border border-yoga-border2 rounded-yoga py-2">
              <i className="ti ti-edit mr-1" /> Bearbeiten
            </button>
          )}
          {/* Welle 2.6 (Sarah 2026-05-26): Löschen für Einzelstunden/Events.
              Sichtbar auch im abgesagten Zustand (dann sind keine aktiven Bookings mehr da
              und das Element kann sauber aus der DB entfernt werden). */}
          {session?.session_type && session.session_type !== 'course_session' && (
            <button onClick={handleDeleteSession} disabled={deleting}
              className="mt-2 w-full text-sm font-semibold bg-yoga-red-bg text-yoga-red-text border border-yoga-red-text/20 rounded-yoga py-2 disabled:opacity-40">
              <i className="ti ti-trash mr-1" /> {deleting ? 'Wird gelöscht...' : 'Löschen'}
            </button>
          )}
          {session?.is_cancelled && (
            <div className={`mt-2 text-sm font-semibold ${isExcluded(session) ? 'text-yoga-text/50' : 'text-yoga-red-text'}`}>
              {isExcluded(session) ? 'Diese Stunde ist ausgeschlossen (zählt nicht als Einheit)' : 'Diese Stunde ist bereits abgesagt'}
            </div>
          )}
          {/* Sarah-Wunsch 2026-05-23: wenn DIESE Stunde eine Ersatzstunde IST,
              zeige für welche Original-Stunde sie der Ersatz ist. */}
          {session?.replacementOf && (
            <div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-yoga-text bg-yoga-amber-bg/70 rounded-full px-2.5 py-1">
              <i className="ti ti-refresh text-sm" />
              Ersatzstunde für {new Date(session.replacementOf.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              {session.replacementOf.time_start && ` · ${session.replacementOf.time_start.slice(0,5)} Uhr`}
            </div>
          )}
        </div>

        {/* Eingebuchte Yogis */}
        <p className="section-label">Eingebuchte Yogis ({bookings.length})</p>
        {bookings.length === 0 ? (
          <p className="text-sm text-yoga-text/40 text-center py-4">Keine Buchungen</p>
        ) : (
          <div className="card mb-4 p-0 overflow-hidden">
            {bookings.map((b, i) => (
              <div key={b.id}
                className={`px-4 py-3 flex items-center justify-between gap-2 ${i < bookings.length - 1 ? 'border-b border-yoga-border' : ''}`}>
                {/* Sarah-Wunsch: Name klickbar → Yogi-Profil */}
                <button
                  onClick={() => router.push(`/admin/yogis/${b.user_id}`)}
                  className="flex-1 text-left bg-transparent border-0 p-0 cursor-pointer hover:opacity-70 transition-opacity min-w-0">
                  <div className="text-sm font-semibold">
                    {b.profile?.first_name} {b.profile?.last_name}
                  </div>
                  <div className="text-xs text-yoga-text/50 truncate">{b.profile?.email}</div>
                </button>
                {!session?.is_cancelled && (
                  <button onClick={(e) => { e.stopPropagation(); cancelBookingForYogi(b.id, b.credit_id, id) }}
                    className="text-xs bg-yoga-red-bg text-yoga-red-text border-0 rounded-full px-2.5 py-1 cursor-pointer font-semibold flex-shrink-0">
                    Austragen
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Warteliste — Sarah-Wunsch 2026-05-23: Admin kann jeden Warteliste-Yogi
            manuell zur Stunde hinzufügen (auch bei voller Stunde = Überbuchung).
            Bei vollen Stunden ist das die einzige Möglichkeit für den Admin,
            jemand "noch reinzunehmen". */}
        {!session?.is_cancelled && waitlist.length > 0 && (
          <>
            <p className="section-label">Warteliste ({waitlist.length})</p>
            <div className="card mb-4 p-0 overflow-hidden">
              {waitlist.map((w, i) => (
                <div key={w.id}
                  className={`px-4 py-3 flex items-center justify-between gap-2 ${i < waitlist.length - 1 ? 'border-b border-yoga-border' : ''}`}>
                  {/* Sarah-Wunsch: Name klickbar → Yogi-Profil */}
                  <button
                    onClick={() => router.push(`/admin/yogis/${w.user_id}`)}
                    className="flex-1 text-left bg-transparent border-0 p-0 cursor-pointer hover:opacity-70 transition-opacity min-w-0">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      <span className="text-xs text-yoga-text/50 font-normal">#{i + 1}</span>
                      <span className="truncate">{w.profile?.first_name} {w.profile?.last_name}</span>
                    </div>
                    <div className="text-xs text-yoga-text/50 truncate">{w.profile?.email}</div>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); addWaitlistYogi(w) }} disabled={!!promotingWaitlist}
                    className="text-xs bg-yoga-text text-yoga-bg border-0 rounded-full px-3 py-1.5 cursor-pointer font-semibold flex-shrink-0 disabled:opacity-50">
                    {promotingWaitlist === w.id ? '...' : 'Zur Stunde hinzufügen'}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Yogi hinzufügen */}
        {!session?.is_cancelled && (
          <button onClick={() => { setShowAddYogi(true); setYogiSearch(''); setYogiResults([]) }}
            className="w-full btn-secondary flex items-center justify-center gap-2 text-sm mb-4">
            <i className="ti ti-user-plus" />Yogi hinzufügen
          </button>
        )}

        {/* Absage-Bereich */}
        {/* Ersatztermin nachträglich anlegen (nur wenn bereits abgesagt) */}
        {session?.is_cancelled && (
          <div className="card border-yoga-amber-text/20 bg-yoga-amber-bg mb-4">
            <p className="text-sm font-bold text-yoga-amber-text mb-1">Stunde ist abgesagt</p>
            {/* Link zum bereits verknüpften Ersatztermin (wenn vorhanden) */}
            {(session as any).replacement && !(session as any).replacement.is_cancelled && (
              <button onClick={() => router.push(`/admin/sessions/${(session as any).replacement.id}`)}
                className="w-full mt-2 mb-2 btn-primary text-sm">
                <i className="ti ti-calendar-event mr-1" />
                Zur Ersatzstunde: {new Date((session as any).replacement.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })} · {(session as any).replacement.time_start?.slice(0,5)} Uhr
              </button>
            )}
            {!showAddReplacement && !(session as any).replacement ? (
              <button onClick={() => setShowAddReplacement(true)}
                className="w-full mt-2 text-sm border border-yoga-amber-text/30 text-yoga-amber-text rounded-yoga py-2 font-semibold bg-transparent cursor-pointer hover:opacity-80">
                <i className="ti ti-calendar-plus mr-2" />Ersatztermin nachträglich anlegen
              </button>
            ) : !showAddReplacement ? null : (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-yoga-text/60">
                  Alle damals angemeldeten Yogis werden automatisch eingebucht und per E-Mail informiert.
                </p>
                <div>
                  <label className="field-label">Datum</label>
                  <input type="date" className="field-input" value={lateReplacementDate}
                    onChange={e => setLateReplacementDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]} />
                </div>
                <div>
                  <label className="field-label">Uhrzeit</label>
                  <input type="time" className="field-input" value={lateReplacementTime}
                    onChange={e => setLateReplacementTime(e.target.value)} />
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setShowAddReplacement(false)} className="btn-ghost flex-1 text-sm">Abbrechen</button>
                  <button onClick={handleAddLateReplacement}
                    disabled={addingReplacement || !lateReplacementDate || !lateReplacementTime}
                    className="flex-1 btn-primary text-sm disabled:opacity-40">
                    {addingReplacement ? 'Wird angelegt...' : 'Ersatztermin anlegen'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {!session?.is_cancelled && (
          <>
            {!showCancelForm ? (
              <button onClick={() => setShowCancelForm(true)}
                className="w-full bg-yoga-red-bg text-yoga-red-text border border-yoga-red-text/20 rounded-yoga py-3 font-semibold text-sm cursor-pointer hover:opacity-80">
                <i className="ti ti-x mr-2" />Stunde absagen
              </button>
            ) : (
              <div className="card border-yoga-red-text/20">
                <p className="text-sm font-bold text-yoga-red-text mb-3">Stunde absagen</p>

                {/* Grund */}
                <label className="field-label">Grund (optional, erscheint in der Email)</label>
                <input className="field-input mb-4" value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="z.B. Krankheit, persönlicher Grund..." />

                {/* Ersatztermin — Welle 2.10 (Sarah 2026-05-26): NUR bei
                    course_session sinnvoll. Einzelstunden/Events kommen
                    nicht zurück; kein Ersatz-Bereich anzeigen. */}
                {session?.session_type === 'course_session' ? (
                  <div className="mb-4">
                    <label className="flex items-center gap-3 cursor-pointer mb-3">
                      <input type="checkbox" checked={hasReplacement}
                        onChange={e => setHasReplacement(e.target.checked)}
                        className="w-5 h-5 flex-shrink-0" />
                      <span className="text-sm font-semibold">Ersatztermin anbieten</span>
                    </label>

                    {hasReplacement && (
                      <div className="bg-yoga-bg rounded-yoga p-3 space-y-2">
                        <p className="text-xs text-yoga-text/50 mb-2">
                          Yogis werden direkt in den Ersatztermin eingebucht – ihr Credit bleibt verbraucht.
                        </p>
                        <div>
                          <label className="field-label">Datum</label>
                          <input type="date" className="field-input" value={replacementDate}
                            onChange={e => setReplacementDate(e.target.value)}
                            min={new Date().toISOString().split('T')[0]} />
                        </div>
                        <div>
                          <label className="field-label">Uhrzeit</label>
                          <input type="time" className="field-input" value={replacementTime}
                            onChange={e => setReplacementTime(e.target.value)} />
                        </div>
                      </div>
                    )}

                    {!hasReplacement && (
                      <p className="text-xs text-yoga-text/50">
                        Ohne Ersatztermin: Credits werden an alle Yogis zurückgebucht.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="mb-4">
                    <p className="text-xs text-yoga-text/50">
                      {session?.session_type === 'event_paid'
                        ? 'Alle eingebuchten Yogis werden per Email informiert. Bezahlung wird – wenn schon geleistet – manuell mit Sarah geklärt.'
                        : session?.session_type === 'event_free'
                          ? 'Alle eingebuchten Yogis werden per Email informiert. Kein Credit verbraucht – nichts zurückzubuchen.'
                          : 'Alle eingebuchten Yogis werden informiert und ihre Credits werden zurückgebucht.'}
                    </p>
                  </div>
                )}

                {/* Validation — nur relevant für course_session mit hasReplacement */}
                {session?.session_type === 'course_session' && hasReplacement && (!replacementDate || !replacementTime) && (
                  <p className="text-xs text-yoga-red-text mb-3">
                    Bitte Datum und Uhrzeit für den Ersatztermin eingeben.
                  </p>
                )}

                <div className="flex gap-2">
                  <button onClick={() => setShowCancelForm(false)} className="btn-ghost flex-1 text-sm">
                    Abbrechen
                  </button>
                  <button
                    onClick={handleCancelSession}
                    disabled={cancelling || (session?.session_type === 'course_session' && hasReplacement && (!replacementDate || !replacementTime))}
                    className="flex-1 bg-yoga-red-text text-white rounded-yoga py-2.5 text-sm font-bold border-0 cursor-pointer disabled:opacity-40">
                    {cancelling ? 'Wird abgesagt...' : 'Absagen'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {/* Yogi hinzufügen Modal */}
      {showAddYogi && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end modal-overlay" onClick={() => setShowAddYogi(false)}>
          <div className="bg-yoga-card w-full rounded-t-2xl p-5 pb-10 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">Yogi hinzufügen</h3>
              <button onClick={() => setShowAddYogi(false)} className="bg-transparent border-0 cursor-pointer text-yoga-text/40">
                <i className="ti ti-x text-xl" />
              </button>
            </div>
            <input className="field-input mb-3" placeholder="Name oder E-Mail eingeben..."
              value={yogiSearch} autoFocus
              onChange={e => searchYogis(e.target.value)} />
            {yogiSearch.length >= 2 && yogiResults.length === 0 && (
              <p className="text-sm text-yoga-text/40 text-center py-3">Kein Yogi gefunden</p>
            )}
            {yogiResults.map(yogi => {
              const free = getFreeCredits(yogi)
              const guthaben = getGuthabenCredits(yogi)
              return (
                <div key={yogi.id} className="flex items-center justify-between py-3 border-b border-yoga-border">
                  <div>
                    <div className="text-sm font-semibold">
                      {yogi.first_name} {yogi.last_name}
                      {yogi.is_dummy && <span className="ml-2 text-xs bg-yoga-text text-white rounded-full px-2 py-0.5">Dummy</span>}
                    </div>
                    <div className="text-xs text-yoga-text/50">{yogi.email || 'Kein Login'}</div>
                    {guthaben > 0 && free === 0 && (
                      <div className="text-xs text-yoga-amber-text mt-0.5">
                        {guthaben} Guthaben – nur für Kurse verwendbar
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${free > 0 ? 'text-yoga-green-text' : 'text-yoga-red-text'}`}>
                      {free} Credits
                    </span>
                    <button onClick={() => handleAddYogi(yogi)} disabled={addingYogi}
                      className="text-xs bg-yoga-text text-yoga-bg rounded-full px-3 py-1.5 font-semibold border-0 cursor-pointer">
                      Einbuchen
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Cancel-Booking Modal — Sarah-Wunsch 2026-05-25: 3h-Frist Auswahl als echtes Modal.
          Welle 4 (Sarah 2026-05-26): Defense-in-Depth — bei Events NIE das
          3h-Choice-Modal anzeigen (Events kennen kein Credit-System). */}
      {cancelChoice && (cancelChoice.sessionType === 'event_free' || cancelChoice.sessionType === 'event_paid') ? null : cancelChoice && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end modal-overlay">
          <div className="bg-yoga-card w-full rounded-t-2xl p-5 pb-10">
            {cancelChoice.within3h ? (
              <>
                <h3 className="text-base font-bold mb-2">Stunde beginnt in weniger als 3 Stunden</h3>
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

      {/* Welle 2.5 (Sarah 2026-05-26): Edit-Modal für Einzelstunden/Events.
          Bei event_paid zusätzlich Preis-Feld. */}
      {showEditForm && editForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end modal-overlay" onClick={() => setShowEditForm(false)}>
          <div className="bg-yoga-card w-full rounded-t-2xl p-5 pb-10 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">
                {session?.session_type === 'single' ? 'Einzelstunde bearbeiten' : 'Event bearbeiten'}
              </h3>
              <button onClick={() => setShowEditForm(false)} className="bg-transparent border-0 cursor-pointer text-yoga-text/40">
                <i className="ti ti-x text-xl" />
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleSaveEdit() }} className="space-y-3">
              <div>
                <label className="field-label">Name *</label>
                <input className="field-input" value={editForm.name}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Datum *</label>
                  <input className="field-input" type="date" value={editForm.date}
                    onChange={e => setEditForm({ ...editForm, date: e.target.value })} required />
                </div>
                <div>
                  <label className="field-label">Uhrzeit *</label>
                  <input className="field-input" type="time" value={editForm.time_start}
                    onChange={e => setEditForm({ ...editForm, time_start: e.target.value })} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Dauer (Min.)</label>
                  <input className="field-input" type="number" value={editForm.duration_min}
                    onChange={e => setEditForm({ ...editForm, duration_min: parseInt(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="field-label">Max. Teilnehmer</label>
                  <input className="field-input" type="number" min={1} max={200} value={editForm.max_spots}
                    onChange={e => setEditForm({ ...editForm, max_spots: parseInt(e.target.value) || 0 })} />
                </div>
              </div>
              <div>
                <label className="field-label">Ort</label>
                <input className="field-input" value={editForm.location}
                  onChange={e => setEditForm({ ...editForm, location: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Beschreibung</label>
                <textarea className="field-input" rows={3} value={editForm.description}
                  onChange={e => setEditForm({ ...editForm, description: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Was mitbringen</label>
                <input className="field-input" value={editForm.bring_along}
                  onChange={e => setEditForm({ ...editForm, bring_along: e.target.value })}
                  placeholder="z.B. Matte, bequeme Kleidung" />
              </div>
              <div>
                <label className="field-label">Schwierigkeitsgrad</label>
                {/* Welle 6 (Sarah 2026-05-27): identisch zu Kurs-Form — 3 Optionen. */}
                <select className="field-input" value={editForm.difficulty}
                  onChange={e => setEditForm({ ...editForm, difficulty: e.target.value })}>
                  {['Alle Level', 'Beginner', 'Geübte'].map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Bild-URL (optional)</label>
                <input className="field-input" value={editForm.image_url}
                  onChange={e => setEditForm({ ...editForm, image_url: e.target.value })}
                  placeholder="https://..." />
                {editForm.image_url && (
                  <img src={editForm.image_url} alt="" className="mt-2 w-20 h-20 rounded-yoga object-cover border border-yoga-border" />
                )}
              </div>
              {/* Welle 2.6 (Sarah 2026-05-26): Externe Teilnehmer +/- Counter.
                  Werden in der Yogi-Plätze-Anzeige draufgerechnet (active + extern). */}
              <div>
                <label className="field-label">Externe Teilnehmer</label>
                <div className="flex items-center gap-3">
                  <button type="button"
                    onClick={() => setEditForm({ ...editForm, external_participants_count: Math.max(0, (Number(editForm.external_participants_count) || 0) - 1) })}
                    className="w-9 h-9 rounded-full border border-yoga-border2 bg-yoga-bg text-yoga-text font-bold flex items-center justify-center cursor-pointer hover:bg-yoga-card">
                    <i className="ti ti-minus" />
                  </button>
                  <div className="text-base font-bold w-8 text-center">{Number(editForm.external_participants_count) || 0}</div>
                  <button type="button"
                    onClick={() => setEditForm({ ...editForm, external_participants_count: Math.min(Number(editForm.max_spots) || 200, (Number(editForm.external_participants_count) || 0) + 1) })}
                    className="w-9 h-9 rounded-full border border-yoga-border2 bg-yoga-bg text-yoga-text font-bold flex items-center justify-center cursor-pointer hover:bg-yoga-card">
                    <i className="ti ti-plus" />
                  </button>
                  <span className="text-xs text-yoga-text/50 ml-2">z.B. Drop-Ins, Barzahler</span>
                </div>
              </div>
              {session?.session_type === 'event_paid' && (
                <div>
                  <label className="field-label">Preis *</label>
                  <div className="relative">
                    <input className="field-input pr-10" type="number" min={0.01} step={0.01}
                      value={editForm.price_eur}
                      onChange={e => setEditForm({ ...editForm, price_eur: e.target.value })}
                      required />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-yoga-text/60">€</span>
                  </div>
                </div>
              )}
              <button type="submit" className="btn-primary" disabled={savingEdit}>
                {savingEdit ? 'Wird gespeichert...' : 'Änderungen speichern'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShowEditForm(false)}>
                Abbrechen
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Quick Credit Modal */}
      {quickCreditYogi && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end modal-overlay">
          <div className="bg-yoga-card w-full rounded-t-2xl p-5 pb-10">
            {getGuthabenCredits(quickCreditYogi) > 0 ? (
              <>
                <h3 className="text-base font-bold mb-2">Nur Kurs-Guthaben vorhanden</h3>
                <p className="text-sm text-yoga-text/60 mb-4">
                  <strong>{quickCreditYogi.first_name} {quickCreditYogi.last_name}</strong> hat {getGuthabenCredits(quickCreditYogi)} Guthaben aus einem abgesagten Kurs. Dieses Guthaben kann <strong>nur für neue Kurse</strong> verwendet werden, nicht für Einzelstunden.
                </p>
                <button onClick={() => setQuickCreditYogi(null)}
                  className="w-full btn-secondary text-sm">Schließen</button>
              </>
            ) : (
              <>
                <h3 className="text-base font-bold mb-2">Keine Credits vorhanden</h3>
                <p className="text-sm text-yoga-text/60 mb-4">
                  <strong>{quickCreditYogi.first_name} {quickCreditYogi.last_name}</strong> hat keine freien Credits.
                  Soll ein Einzelstunden-Credit vergeben und direkt eingebucht werden?
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setQuickCreditYogi(null)}
                    className="flex-1 btn-secondary text-sm">Abbrechen</button>
                  <button onClick={() => handleQuickCredit(quickCreditYogi)}
                    className="flex-1 btn-primary text-sm">Credit vergeben & einbuchen</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <BottomNav isAdmin />
    </div>
  )
}
