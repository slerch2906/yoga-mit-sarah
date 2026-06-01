'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Email } from '@/lib/email'
import { isActive, isStarted, countActiveFutureUnits, isExcluded, bookingStatusLabel, cancelledActorLabel } from '@/lib/session-status'
import { promoteWaitlistOrOfferLate } from '@/lib/waitlist-promote'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'
import { sessionDisplayName } from '@/lib/session-display'

export default function AdminYogiDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [yogi, setYogi] = useState<any>(null)
  const [bookings, setBookings] = useState<any[]>([])
  const [credits, setCredits] = useState<any[]>([])
  const [enrollments, setEnrollments] = useState<any[]>([])
  const [courses, setCourses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState<string | null>(null)
  const [showEnrollForm, setShowEnrollForm] = useState(false)
  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [enrolling, setEnrolling] = useState(false)
  // Ausnahme-Range (Standard: NICHT aktiv → ganzer Kurs)
  // String-State erlaubt leeren Inhalt während Bearbeitung (kein Auto-Fallback auf 1)
  const [enrollRangeMode, setEnrollRangeMode] = useState(false)
  const [enrollFromUnit, setEnrollFromUnit] = useState('1')
  const [enrollUntilUnit, setEnrollUntilUnit] = useState('1')
  const [selectedCourseUnits, setSelectedCourseUnits] = useState(0)
  const [editingCredit, setEditingCredit] = useState<any>(null)
  const [editCreditAmount, setEditCreditAmount] = useState(0)
  // Welle G (2026-05-25): Krankheits-Austragung mit Guthaben.
  // cancelIllnessFor enthaelt das aktive Enrollment, gegen das das Modal laeuft.
  // attestDate = Datum ab dem das Attest gilt (Default: heute).
  // attestConfirmed = Pflicht-Checkbox "Yogi hat Attest vorgelegt".
  // illnessPreview = Live-Berechnung (Reststunden + Vorhol-Anzahl + Termine).
  const [cancelIllnessFor, setCancelIllnessFor] = useState<{ courseId: string; courseName: string; enrollmentId: string } | null>(null)
  const [attestDate, setAttestDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [attestConfirmed, setAttestConfirmed] = useState(false)
  const [illnessPreview, setIllnessPreview] = useState<{ hoursCredited: number; sessions: { date: string; time_start: string }[]; vorholCount: number } | null>(null)
  const [illnessSubmitting, setIllnessSubmitting] = useState(false)
  // Sarah-Wunsch 2026-05-26: yogi-bezogenes Protokoll als aufklappbares Element
  // ganz unten. Lädt audit_log gefiltert auf user_id ODER details.target_user_id
  // ODER details.user_id, max 24 Monate (DSGVO-Aufbewahrungsfrist gem. AGB).
  const [auditLog, setAuditLog] = useState<any[]>([])
  const [auditOpen, setAuditOpen] = useState(false)
  // Lookup-Maps fuer Kontext (Kurs-Name + Session-Datum/Zeit) — wird aus
  // sessions/courses tabellen waehrend loadData() befuellt, damit jeder
  // Protokoll-Eintrag konkret zeigen kann WAS, WANN, IN WELCHEM KURS.
  const [auditSessionMap, setAuditSessionMap] = useState<Map<string, any>>(new Map())
  const [auditCourseMap, setAuditCourseMap] = useState<Map<string, string>>(new Map())
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { loadData() }, [id])

  // Wenn Kurs gewählt: Range-Felder initial auf "ganzer Kurs" setzen
  useEffect(() => {
    if (!selectedCourseId) {
      setSelectedCourseUnits(0); setEnrollRangeMode(false)
      return
    }
    const course = courses.find(c => c.id === selectedCourseId)
    const remaining = course ? getRemainingUnits(course) : 0
    setSelectedCourseUnits(remaining)
    setEnrollFromUnit('1')
    setEnrollUntilUnit(String(remaining))
    setEnrollRangeMode(false) // Reset auf Standard
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourseId])

  async function loadData() {
    // Yogi-Protokoll: audit_log gefiltert auf 24 Monate
    const sinceDate = new Date()
    sinceDate.setMonth(sinceDate.getMonth() - 24)
    const sinceISO = sinceDate.toISOString()
    const [{ data: y }, { data: b }, { data: c }, { data: e }, { data: courseList }, { data: al }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', id).single(),
      supabase.from('bookings')
        .select('*, session:sessions!bookings_session_id_fkey(id, date, time_start, duration_min, is_cancelled, cancel_reason, replacement_session_id, course_id, name, session_type, course:courses(name, is_active, is_cancelled))')
        .eq('user_id', id).order('created_at', { ascending: false }),
      supabase.from('credits').select('*, course:courses(name)').eq('user_id', id).order('created_at', { ascending: false }),
      supabase.from('enrollments').select('*, course:courses(*, sessions(id, date, time_start, is_cancelled, cancel_reason, replacement_session_id, course_id))').eq('user_id', id),
      // Welle 1 (Sarah 2026-05-26): SYS-Container-Kurse nicht im "In Kurs einbuchen"-Dropdown.
      supabase.from('courses').select('*, sessions(date, is_cancelled, cancel_reason), enrollments(id)').eq('is_active', true).eq('is_system_container', false).order('name'),
      // Sarah-Wunsch 2026-05-26: yogi-bezogenes Protokoll (audit_log).
      // Filter: user_id = yogi ODER details.target_user_id ODER details.user_id.
      supabase.from('audit_log')
        .select('id, action, user_id, details, created_at')
        .or(`user_id.eq.${id},details->>target_user_id.eq.${id},details->>user_id.eq.${id}`)
        .gte('created_at', sinceISO)
        .order('created_at', { ascending: false })
        .limit(200),
    ])

    // Sarah-Wunsch 2026-05-26: Yogi-Protokoll soll bei JEDEM Eintrag den
    // Kurs- und Stunden-Kontext zeigen, nicht nur die nackte action. Viele
    // audit_log-Eintraege speichern aber nur session_id / course_id ohne
    // Klartext. Daher zur Render-Zeit zusammensammeln und in 2 Lookup-Queries
    // aufloesen — robust gegen alte Eintraege die kein course_name etc. haben.
    const sessionIds = new Set<string>()
    const courseIds = new Set<string>()
    for (const a of (al || [])) {
      const d = a.details || {}
      if (d.session_id) sessionIds.add(d.session_id)
      if (d.original_session_id) sessionIds.add(d.original_session_id)
      if (d.replacement_session_id) sessionIds.add(d.replacement_session_id)
      if (d.course_id) courseIds.add(d.course_id)
    }
    const [{ data: sLookup }, { data: cLookup }] = await Promise.all([
      sessionIds.size > 0
        // Bug-Fix (Sarah 2026-05-28): name mitladen — sonst fehlt bei Einzel-
        // stunden/Events der echte Titel im Protokoll (course.name ist nur der
        // SYS-Container-Name und wird gefiltert). formatAuditEntry nutzt sess.name
        // mit hoechster Prioritaet.
        ? supabase.from('sessions').select('id, date, time_start, name, session_type, course:courses(name)').in('id', Array.from(sessionIds))
        : Promise.resolve({ data: [] as any[] }),
      courseIds.size > 0
        ? supabase.from('courses').select('id, name').in('id', Array.from(courseIds))
        : Promise.resolve({ data: [] as any[] }),
    ])
    const sessMap = new Map<string, any>()
    ;(sLookup || []).forEach((s: any) => sessMap.set(s.id, s))
    const courseMap = new Map<string, string>()
    ;(cLookup || []).forEach((c: any) => courseMap.set(c.id, c.name))

    setYogi(y); setBookings(b || []); setCredits(c || [])
    setEnrollments(e || []); setCourses(courseList || [])
    setAuditLog(al || [])
    setAuditSessionMap(sessMap); setAuditCourseMap(courseMap)
    setLoading(false)
  }

  // Modell-bewusste "freie Credits"-Anzeige:
  // - Course-Credits: free = noch nicht absolvierte aktive Buchungen (upcoming).
  //   Hintergrund: bei Auto-Enrollment werden alle Sessions sofort gebucht, used=total.
  //   Sarahs Erwartung: free = "noch verfügbare Stunden", nicht "nicht-allokierte Credits".
  // - Tenpack/Single/Guthaben: free = total - used (allokierte Credits, DB-Semantik).
  // Sarah 2026-05-22: Course-Credit-Anzeige konsistent zur /meine-Logik
  // (Ersatzstunden ersetzen das Original, zählen nicht doppelt; Anzeige als
  // "X von Y genutzt" mit "frei" = total - used).
  // Sarah-Regel 2026-05-22: Anzeige folgt direkt der DB-Wahrheit (credit.total/used).
  // Der DB-Trigger zählt korrekt: aktive Bookings (egal in welchem Kurs der Yogi
  // den Credit einlöst — auch für Drop-Ins). Cancelled Sessions und cancelled
  // Bookings sind automatisch raus.
  function computeFree(c: any) { return Math.max(0, c.total - c.used) }
  // Sarah-Wunsch 2026-05-26: Guthaben (model='guthaben') separat anzeigen —
  // war vorher in "Freie Credits" eingerechnet → irrefuehrend, weil Admin
  // dachte der Yogi habe noch buchbare Stunden.
  const freeCredits = credits.reduce((sum, c) => {
    if (c.model === 'guthaben') return sum
    if (new Date(c.expires_at) > new Date()) return sum + computeFree(c)
    return sum
  }, 0)
  const guthabenCredits = credits.reduce((sum, c) => {
    if (c.model !== 'guthaben') return sum
    if (new Date(c.expires_at) > new Date()) return sum + computeFree(c)
    return sum
  }, 0)

  function getRemainingUnits(course: any) {
    // Nur aktive zukünftige Sessions zählen (excluded/cancelled NICHT mitzählen).
    // Quelle der Wahrheit: lib/session-status.ts countActiveFutureUnits.
    return countActiveFutureUnits(course?.sessions)
  }

  function getExpiryDate(course: any) {
    // Ablaufdatum aus AKTIVEN Sessions (excluded/cancelled ignorieren).
    const dates = (course.sessions || []).filter(isActive).map((s: any) => new Date(s.date))
    if (dates.length === 0) return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    const last = new Date(Math.max(...dates.map((d: Date) => d.getTime())))
    last.setDate(last.getDate() + 8)
    return last
  }

  async function handleDeleteYogi() {
    // Sarah-Wunsch 2026-05-23 v6: Yogi-Account DSGVO-konform löschen UND
    // Plätze SOFORT freigeben. Reihenfolge:
    //  1. Aktive Buchungen, Enrollments, Credits, Waitlist, Notification-Log
    //     EXPLIZIT löschen (nicht auf FK-Cascade verlassen — falls Auth-Delete
    //     später fehlschlägt, müssen die Plätze trotzdem sofort frei sein)
    //  2. Profile + legal_acceptances anonymisieren (PII raus, "Gelöschter
    //     Nutzer" als Platzhalter — falls Auth-Delete fehlschlägt, keine PII)
    //  3. audit_log-PII anonymisieren
    //  4. Auth-User löschen (cascadet alles Restliche; audit_log SET NULL)
    //  5. Audit-Eintrag yogi_anonymized_dsgvo + Email an Sarah
    if (!confirm(
      `Account von ${yogi?.first_name} ${yogi?.last_name} DSGVO-konform löschen?\n\n` +
      `• Plätze in allen Kursen + Stunden werden sofort frei\n` +
      `• Aktive Buchungen + Guthaben werden gelöscht\n` +
      `• Persönliche Daten werden anonymisiert\n` +
      `• Buchungshistorie bleibt anonym im Protokoll`
    )) return
    if (!confirm('Bist du sicher? Diese Aktion kann nicht rückgängig gemacht werden!')) return

    const fullName = `${yogi?.first_name || ''} ${yogi?.last_name || ''}`.trim()
    const email = yogi?.email || ''

    // Sarah-Wunsch 2026-05-25: Wartelisten der freigewordenen Stunden
    // automatisch nachruecken. Zuerst session_ids der zukuenftigen
    // Buchungen sammeln, BEVOR sie geloescht werden.
    const today = new Date().toISOString().split('T')[0]
    const { data: futureActiveBookings } = await supabase.from('bookings')
      .select('session_id, session:sessions!bookings_session_id_fkey(date)')
      .eq('user_id', id).eq('status', 'active')
    const sessionsToPromote: string[] = (futureActiveBookings || [])
      .filter((b: any) => b.session?.date && b.session.date >= today)
      .map((b: any) => b.session_id)

    // 1. PLÄTZE FREIGEBEN — alle Yogi-Ressourcen explizit löschen
    //    (auch wenn Auth-Delete cascadet, hier robust falls API fehlschlägt)
    await supabase.from('bookings').delete().eq('user_id', id)
    await supabase.from('enrollments').delete().eq('user_id', id)
    await supabase.from('credits').delete().eq('user_id', id)
    await supabase.from('waitlist').delete().eq('user_id', id)
    await supabase.from('notification_log').delete().eq('user_id', id)
    // Finding E1 (2026-05-29): Kursabbruch-Wahl-Tokens räumen — sonst blockiert ihr
    // FK (course_cancellation_responses.user_id → profiles, NO ACTION) die profiles-
    // Cascade beim Auth-Delete → Route 502, Auth-User bliebe trotz "gelöscht"-Mail.
    await supabase.from('course_cancellation_responses').delete().eq('user_id', id)

    // 1b. Wartelisten der freigewordenen Stunden automatisch nachruecken
    //     (Sarah-Wunsch 2026-05-25, gleiches Verhalten wie bei Yogi-Selbst-Loeschung)
    for (const sId of sessionsToPromote) {
      promoteWaitlistOrOfferLate(supabase, sId).catch(e => console.error('promote on admin-delete:', e))
    }

    // 2. PII anonymisieren — Profile + legal_acceptances
    await supabase.from('profiles').update({
      first_name: 'Gelöschter',
      last_name: 'Nutzer',
      email: null,
      emergency_name: null,
      emergency_phone: null,
      legal_accepted_at: null,
    }).eq('id', id)

    await supabase.from('legal_acceptances').update({
      full_name: 'Gelöschter Nutzer',
      ip_address: null,
      user_agent: null,
      emergency_contact: null,
      phone: null,
    }).eq('user_id', id)

    // 3. audit_log-PII anonymisieren (Name/Email in details JSONB entfernen)
    try { await supabase.rpc('anonymize_user_audit_logs' as any, { target_user_id: id }) } catch {}

    // Sarah 2026-06-01: Yogi-Bestaetigungsmail, Admin-Info-Mail und Admin-Benachrichtigung
    // laufen jetzt server-seitig in /api/delete-account (RLS-immun, einheitlich fuer
    // Selbst- + Admin-Loeschung). email/fullName/firstName werden unten uebergeben.

    // 4. Auth-User löschen → Sessions invalidiert, profile cascadet weg
    //    (audit_log user_id wird SET NULL — Compliance-Spur bleibt erhalten)
    // Sarah-Bug 2026-05-31: Die Route verlangt seit Welle S1/H1 einen Bearer-Token
    // (Caller-Authentifizierung). Ohne ihn → 401 → Auth-User + E-Mail bleiben bestehen,
    // die Adresse liesse sich NIE wieder registrieren. Token also mitschicken und das
    // Ergebnis NICHT mehr verschlucken, sondern den Admin bei Fehlschlag warnen.
    let authDeleted = false
    try {
      let accessToken = ''
      try {
        const { data: { session: sess } } = await supabase.auth.getSession()
        accessToken = sess?.access_token || ''
      } catch {}
      const deleteRes = await fetch('/api/delete-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ userId: id, email, fullName, firstName: yogi?.first_name || 'Yogi' })
      })
      authDeleted = deleteRes.ok
      if (!deleteRes.ok) {
        const err = await deleteRes.json().catch(() => ({}))
        console.error('Delete account failed:', err)
      }
    } catch (e) {
      console.error('Delete account error:', e)
    }

    // 5. Audit-Log: anonymer Lösch-Vorgang (für Compliance-Trail)
    await supabase.from('audit_log').insert({
      action: 'yogi_anonymized_dsgvo',
      details: { anonymized_user_id: id }
    })

    // (Admin-Info-Mail + admin_notifications laufen jetzt server-seitig in der Route.)

    // Ehrliche Rueckmeldung: Wenn der Auth-Login NICHT entfernt werden konnte,
    // bleibt die E-Mail-Adresse belegt → Admin klar warnen statt "erfolgreich".
    if (!authDeleted) {
      alert(
        'Achtung: Die persönlichen Daten wurden anonymisiert, aber der Login bzw. die ' +
        'E-Mail-Adresse konnte NICHT entfernt werden.\n\n' +
        'Die Adresse lässt sich dadurch evtl. nicht sofort neu registrieren. Bitte gib ' +
        'kurz Bescheid, damit der Auth-Login manuell entfernt wird.'
      )
    }

    router.push('/admin/yogis')
  }

  async function handleEnroll() {
    if (!selectedCourseId) return
    setEnrolling(true)
    const course = courses.find(c => c.id === selectedCourseId)
    const remaining = getRemainingUnits(course)
    const expiry = getExpiryDate(course)

    // Range-Mode validieren (String-State → Number parsen)
    let fromUnit = 1
    let untilUnit: number | null = null
    if (enrollRangeMode) {
      const fromN = parseInt(enrollFromUnit, 10)
      const untilN = parseInt(enrollUntilUnit, 10)
      if (!Number.isFinite(fromN) || !Number.isFinite(untilN) || fromN < 1 || untilN < fromN || untilN > remaining) {
        alert(`Ungültiger Bereich. Möglich: 1 bis ${remaining}.`)
        setEnrolling(false); return
      }
      fromUnit = fromN
      untilUnit = untilN
    }

    // Sarah-Regel 2026-05-23: Admin darf überbuchen. Bei vollem Kurs nur Hinweis,
    // kein Block. Counter im Dropdown zeigt sowieso „voll" — Admin entscheidet bewusst.
    const { count } = await supabase
      .from('enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('course_id', selectedCourseId)
    if (course?.max_spots && (count ?? 0) >= course.max_spots && !yogi?.is_dummy) {
      if (!confirm(`Kurs ist eigentlich voll (${count}/${course.max_spots}). Trotzdem überbuchen?`)) {
        setEnrolling(false)
        return
      }
    }

    // Range-Mode: Guthaben-Pfad überspringen (Edge-Case, manuell handhaben)
    if (enrollRangeMode) {
      // Sessions ab heute, sortiert nach Datum
      const { data: allSessions } = await supabase.from('sessions')
        .select('id, date, is_cancelled, cancel_reason')
        .eq('course_id', selectedCourseId)
        .gte('date', new Date().toISOString().split('T')[0])
        .order('date')
      // Nur aktive (nicht excluded, nicht admin-cancelled) zählen als Einheit
      const activeSessions = (allSessions || [])
        .filter((s: any) => s.cancel_reason !== 'excluded' && !s.is_cancelled)
      const targetSessions = activeSessions.slice(fromUnit - 1, untilUnit!)
      const rangeCount = targetSessions.length

      await supabase.from('enrollments').upsert({
        user_id: id, course_id: selectedCourseId,
        enrolled_from_unit: fromUnit, enrolled_until_unit: untilUnit,
      })

      // Sarah-Befund 2026-05-25: Bug-Fix — frueher gab's '|| null' Fallback, was bei
      // fehlgeschlagenem Credit-INSERT zu Bookings ohne credit_id fuehrte. Jetzt:
      // wenn Credit nicht angelegt werden konnte, brechen wir sauber ab.
      const { data: credit, error: creditErr } = await supabase.from('credits').insert({
        user_id: id, course_id: selectedCourseId, model: 'course',
        total: rangeCount, used: 0, expires_at: expiry.toISOString(),
      }).select().single()

      if (creditErr || !credit?.id) {
        alert(`Credit-Anlage fehlgeschlagen — Buchung wurde abgebrochen.\n\nDetails: ${creditErr?.message || 'Unbekannter Fehler'}\n\nBitte versuche es erneut.`)
        return
      }

      for (const s of targetSessions) {
        const { data: existing } = await supabase.from('bookings')
          .select('id').eq('session_id', s.id).eq('user_id', id).maybeSingle()
        if (existing) {
          await supabase.from('bookings').update({
            status: 'active', credit_id: credit.id,
            cancelled_at: null, cancel_late: false, type: 'course',
          }).eq('id', existing.id)
        } else {
          await supabase.from('bookings').insert({
            user_id: id, session_id: s.id,
            credit_id: credit.id, type: 'course', status: 'active',
          })
        }
      }

      // Email mit Range-Info — Range-Mode hat eigene totalUnits (rangeCount = Anzahl Range-Sessions)
      try {
        const { data: yProf } = await supabase.from('profiles').select('email, first_name').eq('id', id).single()
        if (yProf?.email && course && !yogi?.is_dummy) {
          const firstSession = targetSessions[0]?.date
          await Email.yogiEnrolledByAdmin({
            email: yProf.email, firstName: yProf.first_name || 'Yogi',
            courseName: course.name, weekday: course.weekday, timeStart: course.time_start,
            durationMin: course.duration_min || 75,
            totalUnits: course.total_units || rangeCount,  // Gesamt-Kurs
            remainingUnits: rangeCount,                    // Yogis Anteil (Range)
            dateStart: course.date_start,
            firstSessionDate: firstSession,
          })
        }
      } catch(e) {}

      await supabase.from('audit_log').insert({
        action: 'yogi_enrolled_by_admin',
        details: {
          target_user_id: id, course_id: selectedCourseId,
          credits: rangeCount, range: { from: fromUnit, until: untilUnit },
        },
      })

      setShowEnrollForm(false); setSelectedCourseId('')
      loadData(); setEnrolling(false); return
    }

    // === Normal-Pfad: Guthaben automatisch verrechnen wenn vorhanden ===
    // Sessions laden (sortiert nach Datum)
    const { data: sessionsData } = await supabase.from('sessions').select('id, date')
      .eq('course_id', selectedCourseId)
      .gte('date', new Date().toISOString().split('T')[0])
      .eq('is_cancelled', false)
      .order('date')
    const sessionList = sessionsData || []
    const actualCount = sessionList.length

    // Verfügbares Guthaben (auto-verrechnen, kein Confirm-Dialog mehr)
    const { data: guthabenCredits } = await supabase.from('credits')
      .select('*').eq('user_id', id).eq('model', 'guthaben')
      .gt('expires_at', new Date().toISOString()).order('expires_at')
    const availableGuthaben = (guthabenCredits || []).filter((g: any) => (g.total - g.used) > 0)
    const totalGuthaben = availableGuthaben.reduce((s: number, g: any) => s + (g.total - g.used), 0)
    const guthabenUsable = Math.min(totalGuthaben, actualCount)
    const newCreditsNeeded = actualCount - guthabenUsable

    // Enrollment upserten
    await supabase.from('enrollments').upsert({ user_id: id, course_id: selectedCourseId, enrolled_from_unit: 1 })

    // Falls neue Credits nötig: Course-Credit anlegen (used=0, Trigger setzt auf #aktive)
    let newCourseCreditId: string | null = null
    if (newCreditsNeeded > 0) {
      const { data: cc } = await supabase.from('credits').insert({
        user_id: id, course_id: selectedCourseId, model: 'course',
        total: newCreditsNeeded, used: 0, expires_at: expiry.toISOString(),
      }).select().single()
      newCourseCreditId = cc?.id || null
    }

    // Credit-IDs pro Session: erst Guthaben aufbrauchen, dann Course-Credit
    const creditPerSession: (string | null)[] = []
    const guthabenRemaining = availableGuthaben.map((g: any) => ({
      id: g.id, free: g.total - g.used,
    }))
    for (let i = 0; i < sessionList.length; i++) {
      let assigned: string | null = null
      for (const g of guthabenRemaining) {
        if (g.free > 0) {
          assigned = g.id
          g.free -= 1
          break
        }
      }
      creditPerSession.push(assigned || newCourseCreditId)
    }

    // Bookings reaktivieren / anlegen (mit credit_id-Link, damit Trigger korrekt recalct)
    for (let i = 0; i < sessionList.length; i++) {
      const s = sessionList[i]
      const creditId = creditPerSession[i]
      const { data: existing } = await supabase.from('bookings')
        .select('id').eq('session_id', s.id).eq('user_id', id).maybeSingle()
      if (existing) {
        await supabase.from('bookings').update({
          status: 'active', credit_id: creditId,
          cancelled_at: null, cancel_late: false, type: 'course',
        }).eq('id', existing.id)
      } else {
        await supabase.from('bookings').insert({
          user_id: id, session_id: s.id,
          credit_id: creditId, type: 'course', status: 'active',
        })
      }
    }

    // Email: Kurs-Einbuchung an Yogi
    try {
      const { data: yProf } = await supabase.from('profiles').select('email, first_name, is_dummy').eq('id', id).single()
      if (yProf?.email && course && !yProf.is_dummy) {
        const firstSession = sessionList[0]?.date
        await Email.yogiEnrolledByAdmin({
          email: yProf.email,
          firstName: yProf.first_name || 'Yogi',
          courseName: course.name || '',
          weekday: course.weekday || '',
          timeStart: course.time_start || '',
          durationMin: course.duration_min || 75,
          totalUnits: course.total_units || actualCount,  // Gesamt-Kurs
          remainingUnits: actualCount,                    // verbleibende Stunden für Yogi
          dateStart: course.date_start || undefined,
          firstSessionDate: firstSession,
        })
      }
    } catch(e) {}

    // Email an Admin wenn Guthaben verrechnet wurde (Buchhaltungs-Info)
    if (guthabenUsable > 0) {
      try {
        await Email.adminGuthabenVerrechnet({
          yogiName: `${yogi?.first_name || ''} ${yogi?.last_name || ''}`.trim(),
          yogiEmail: yogi?.email || '',
          courseName: course?.name || '',
          guthabenAmount: guthabenUsable,          // verrechnet
          courseTotal: actualCount,                // Gesamt-Credits des Kurses
          newCreditsCount: newCreditsNeeded,       // muss Yogi neu zahlen
          guthabenRemaining: totalGuthaben - guthabenUsable, // Rest-Guthaben
        })
      } catch(e) {}
      // Sarah-Wunsch 2026-05-25: zusaetzlich als abhakbare Dashboard-Aufgabe
      const yogiName = `${yogi?.first_name || ''} ${yogi?.last_name || ''}`.trim()
      await supabase.from('admin_notifications').insert({
        type: 'guthaben_verrechnet',
        message: `${yogiName}: ${guthabenUsable}/${actualCount} Credits aus Guthaben verrechnet, ${newCreditsNeeded} muss neu bezahlt werden.`,
        details: {
          user_id: id,
          yogi_name: yogiName,
          course_name: course?.name || '',
          guthaben_used: guthabenUsable,
          course_total: actualCount,
          must_pay: newCreditsNeeded,
          guthaben_remaining: totalGuthaben - guthabenUsable,
        },
        read: false,
      })
    }

    await supabase.from('audit_log').insert({
      action: 'yogi_enrolled_by_admin',
      details: {
        target_user_id: id, course_id: selectedCourseId,
        credits: actualCount,
        guthaben_verrechnet: guthabenUsable,
        neue_credits: newCreditsNeeded,
      },
    })

    setShowEnrollForm(false); setSelectedCourseId('')
    if (guthabenUsable > 0) {
      alert(`✓ Einbuchung erfolgt.\n${guthabenUsable} Stunde${guthabenUsable === 1 ? '' : 'n'} mit Guthaben verrechnet.${newCreditsNeeded > 0 ? `\n${newCreditsNeeded} neue Credits angelegt.` : ''}`)
    }
    loadData(); setEnrolling(false)
  }

  // Welle G (2026-05-25): Live-Preview fuer Krankheits-Austragung.
  // Sobald cancelIllnessFor + attestDate gesetzt: zukuenftige Kurs-Sessions
  // (ab Attest-Datum, nicht cancelled, nicht excluded) zaehlen + offene
  // Vorhol/Nachhol-Buchungen des Yogis (origin_session_id NOT NULL, future).
  useEffect(() => {
    if (!cancelIllnessFor || !attestDate) { setIllnessPreview(null); return }
    let cancelled = false
    ;(async () => {
      // 1) Zukuenftige aktive Kurs-Sessions ab Attest-Datum
      const { data: allSessions } = await supabase.from('sessions')
        .select('id, date, time_start, is_cancelled, cancel_reason')
        .eq('course_id', cancelIllnessFor.courseId)
        .gte('date', attestDate)
        .order('date')
      const activeSessions = (allSessions || []).filter((s: any) =>
        !s.is_cancelled && s.cancel_reason !== 'excluded'
      )
      // Yogi-Bookings in diesen Sessions
      const sIds = activeSessions.map((s: any) => s.id)
      let bookedIds = new Set<string>()
      if (sIds.length > 0) {
        const { data: bks } = await supabase.from('bookings')
          .select('session_id').eq('user_id', id).in('session_id', sIds).eq('status', 'active')
        bookedIds = new Set((bks || []).map((b: any) => b.session_id))
      }
      // Sarah-Fix 2026-05-28: Credits DIESES Kurses ermitteln. Stunden, die der
      // Yogi abgemeldet und mit diesen Credits in Vorhol-/Nachholstunden
      // verschoben hat, zählen ZUR Gutschrift dazu (die Ersatzstunden werden ja
      // mitgelöscht). Sonst wäre die Gutschrift zu niedrig (5 statt 7).
      const { data: courseCreds } = await supabase.from('credits')
        .select('id').eq('user_id', id).eq('course_id', cancelIllnessFor.courseId)
      const courseCreditIds = new Set((courseCreds || []).map((c: any) => c.id))
      // Zukünftige Vorhol-/Nachholstunden, die mit den Credits DIESES Kurses gebucht wurden
      const { data: allBookings } = await supabase.from('bookings')
        .select('id, credit_id, origin_session_id, session:sessions!bookings_session_id_fkey(date)')
        .eq('user_id', id).eq('status', 'active').not('origin_session_id', 'is', null)
      const courseMakeups = (allBookings || []).filter((b: any) =>
        b.session?.date && b.session.date >= attestDate && courseCreditIds.has(b.credit_id)
      )
      // Anspruchs-Stunden = aktiv gebuchte Kursstunden + Ursprungsstunden der verschobenen
      const entitledIds = new Set<string>(bookedIds)
      for (const m of courseMakeups) if (m.origin_session_id) entitledIds.add(m.origin_session_id)
      const entitledSessions = activeSessions.filter((s: any) => entitledIds.has(s.id))
      if (cancelled) return
      setIllnessPreview({
        hoursCredited: bookedIds.size + courseMakeups.length,
        sessions: entitledSessions.map((s: any) => ({ date: s.date, time_start: s.time_start })),
        vorholCount: courseMakeups.length,
      })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelIllnessFor, attestDate])

  // Welle G (2026-05-25): Admin trägt Yogi krankheitsbedingt aus dem Kurs.
  // - storniert alle zukuenftigen Kurs-Bookings ab Attest-Datum (cancel_late=false → Credit zurueck)
  // - storniert alle offenen Vorhol/Nachhol-Buchungen des Yogis ab Attest-Datum (ersatzlos)
  // - promoted Wartelisten fuer alle freigewordenen Sessions
  // - setzt enrollment.end_date + end_reason='illness'
  // - legt Guthaben an (source='illness', expires_at = attestDate + 10 Monate)
  // - Audit-Log + Email an Yogi (illness_credit)
  async function cancelEnrollmentDueToIllness(courseId: string, attestDateStr: string) {
    setIllnessSubmitting(true)
    try {
      // Zukuenftige aktive Sessions im Kurs ab Attest-Datum
      const { data: allSessions } = await supabase.from('sessions')
        .select('id, date, time_start, is_cancelled, cancel_reason')
        .eq('course_id', courseId)
        .gte('date', attestDateStr)
        .order('date')
      const activeSessions = (allSessions || []).filter((s: any) =>
        !s.is_cancelled && s.cancel_reason !== 'excluded'
      )
      const sessionIds = activeSessions.map((s: any) => s.id)

      // 1) Storniere Bookings dieses Yogis in zukuenftigen Kurs-Sessions
      let cancelledCourseBookings = 0
      if (sessionIds.length > 0) {
        const { data: bksToCancel } = await supabase.from('bookings')
          .select('id').eq('user_id', id).in('session_id', sessionIds).eq('status', 'active')
        cancelledCourseBookings = (bksToCancel || []).length
        if (cancelledCourseBookings > 0) {
          // cancel_late=TRUE: kein Credit-Rueckfluss waehrend der Stornierung
          // (der DB-Trigger recalc_credit_used wuerde den alten Course-Credit
          // sonst zurueckbuchen). Der alte Course-Credit wird ohnehin in
          // Schritt 5b komplett geloescht — der Wert steckt im neuen
          // Krankheits-Guthaben (Schritt 5). So kein Doppel-Credit.
          await supabase.from('bookings').update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            cancel_late: true,
            cancelled_by: 'admin',
          }).eq('user_id', id).in('session_id', sessionIds).eq('status', 'active')
        }
      }

      // 2) Storniere offene Vorhol/Nachhol-Buchungen des Yogis ab Attest-Datum
      //    (origin_session_id NOT NULL = Vorhol/Nachhol). Ersatzlos: cancel_late=true,
      //    damit kein Credit zurueckgebucht wird (Sarah-Spec).
      //    Sarah-Fix 2026-05-28: NUR Vorhol-/Nachholstunden, die mit den Credits
      //    DIESES Kurses gebucht wurden, werden geloescht — und zaehlen daher zur
      //    Gutschrift dazu (siehe hoursCredited unten). Andere Ersatzstunden
      //    (z.B. aus einem anderen Kurs) bleiben unberuehrt.
      const { data: courseCreds } = await supabase.from('credits')
        .select('id').eq('user_id', id).eq('course_id', courseId)
      const courseCreditIds = new Set((courseCreds || []).map((c: any) => c.id))
      const { data: vorholBks } = await supabase.from('bookings')
        .select('id, session_id, credit_id, session:sessions!bookings_session_id_fkey(date)')
        .eq('user_id', id).eq('status', 'active').not('origin_session_id', 'is', null)
      const vorholToCancel = (vorholBks || []).filter((b: any) =>
        b.session?.date && b.session.date >= attestDateStr && courseCreditIds.has(b.credit_id)
      )
      const vorholCancelled = vorholToCancel.length
      const vorholSessionIds: string[] = []
      for (const b of vorholToCancel) {
        await supabase.from('bookings').update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancel_late: true, // ersatzlos → kein Credit-Rueckfluss
          cancelled_by: 'admin',
        }).eq('id', b.id)
        if (b.session_id) vorholSessionIds.push(b.session_id)
      }

      // 3) Waitlist promoten fuer alle freigewordenen Sessions
      const allFreedSessions = [...sessionIds, ...vorholSessionIds]
      for (const sId of allFreedSessions) {
        promoteWaitlistOrOfferLate(supabase, sId).catch(e => console.error('promote on illness:', e))
      }

      // 4) Enrollment-Ende setzen (end_date + end_reason)
      await supabase.from('enrollments')
        .update({ end_date: attestDateStr, end_reason: 'illness' })
        .eq('user_id', id).eq('course_id', courseId)

      // 5) Neues Guthaben anlegen (10 Monate gueltig, source='illness')
      //    Sarah-Fix 2026-05-28: aktive Kursstunden + die geloeschten Vorhol-/
      //    Nachholstunden dieses Kurses (5 + 2 = 7), denn fuer die abgemeldeten
      //    Stunden wurden Ersatzstunden gebucht, die hier ebenfalls entfallen.
      const hoursCredited = cancelledCourseBookings + vorholCancelled
      const expiresAt = new Date(attestDateStr)
      expiresAt.setMonth(expiresAt.getMonth() + 10) // 10 Monate (Welle G Sarah-Spec)
      let newCreditId: string | null = null
      if (hoursCredited > 0) {
        // Sarah-Wunsch 2026-05-26: course_id mitspeichern damit die Credit-Karte
        // "Krankheits-Guthaben aus Kurs: <name> (ausgetragen am <attest_date>)"
        // anzeigen kann. course_id ist trotzdem NUR Herkunfts-Info — der Yogi
        // kann den Guthaben fuer JEDEN Kurs einloesen.
        // Sarah-Fix 2026-05-29: source_course_name zusaetzlich speichern. Der
        // Kurstitel muss DAUERHAFT erhalten bleiben — auch wenn der Admin den
        // Quell-Kurs spaeter loescht (dann wird course_id entkoppelt, der Titel
        // bleibt aber in source_course_name stehen).
        const { data: srcCourse } = await supabase.from('courses')
          .select('name').eq('id', courseId).single()
        const { data: newCredit } = await supabase.from('credits').insert({
          user_id: id,
          course_id: courseId,
          source_course_name: srcCourse?.name || null,
          model: 'guthaben',
          total: hoursCredited,
          used: 0,
          expires_at: expiresAt.toISOString(),
          source: 'illness',
        } as any).select().single()
        newCreditId = newCredit?.id || null
      }

      // 5b) Alten Kurs-Credit DIESES Kurses loeschen (Sarah-Fix 2026-05-28).
      //     Vorher blieb er als used=total stehen → in /meine hing eine
      //     "0 / X genutzt"-Karte. Jetzt sauber loeschen — exakt wie beim
      //     Kursabbruch; der Wert steckt vollstaendig im neuen Krankheits-
      //     Guthaben (Schritt 5). Buchungen + Enrollment vorher entkoppeln,
      //     sonst blockieren die FKs den DELETE still.
      //     courseCreditIds wurde in Schritt 2 erfasst — VOR Anlage des neuen
      //     Guthabens — enthaelt also nur die alten Course-Credits, nicht das
      //     gerade angelegte Krankheits-Guthaben.
      if (courseCreditIds.size > 0) {
        const oldCreditIds = Array.from(courseCreditIds)
        await supabase.from('bookings').update({ credit_id: null })
          .eq('user_id', id).in('credit_id', oldCreditIds)
        await supabase.from('enrollments').update({ credit_id: null })
          .eq('user_id', id).in('credit_id', oldCreditIds)
        const { error: oldCredDelErr } = await supabase.from('credits').delete().in('id', oldCreditIds)
        if (oldCredDelErr) console.error('illness: Loeschen des alten Kurs-Credits fehlgeschlagen:', oldCredDelErr)
      }

      // 6) Audit-Log
      await supabase.from('audit_log').insert({
        action: 'admin_illness_credit',
        details: {
          target_user_id: id,
          course_id: courseId,
          attest_date: attestDateStr,
          hours_credited: hoursCredited,
          vorhol_cancelled_count: vorholCancelled,
          credit_id: newCreditId,
          expires_at: expiresAt.toISOString(),
        },
      })

      // 7) Email an Yogi (illness_credit) — nur wenn echte Email (kein Dummy)
      try {
        const { data: yProf } = await supabase.from('profiles').select('email, first_name, is_dummy').eq('id', id).single()
        const courseName = cancelIllnessFor?.courseName || ''
        if (yProf?.email && !yProf.is_dummy && hoursCredited > 0) {
          await Email.illnessCredit({
            email: yProf.email,
            firstName: yProf.first_name || 'Yogi',
            courseName,
            hoursCredited,
            expiresAt: expiresAt.toISOString(),
          })
        }
      } catch (e) { console.error('illness email:', e) }

      // Modal schliessen + State reset + neu laden
      setCancelIllnessFor(null)
      setAttestConfirmed(false)
      setIllnessPreview(null)
      setAttestDate(new Date().toISOString().split('T')[0])
      loadData()
      alert(`Yogi krankheitsbedingt ausgetragen.\n${hoursCredited} Stunden Guthaben gutgeschrieben (gültig 10 Monate).${vorholCancelled > 0 ? `\n${vorholCancelled} Vorhol-/Nachholbuchung${vorholCancelled === 1 ? '' : 'en'} storniert.` : ''}`)
    } catch (e: any) {
      console.error('cancelEnrollmentDueToIllness:', e)
      alert('Fehler bei der Krankheits-Austragung. Bitte Console prüfen.')
    } finally {
      setIllnessSubmitting(false)
    }
  }

  async function removeFromCourse(enrollmentId: string, courseId: string) {
    // Nur Kurs-Credits löschen (nach course_id) – Punktekarte IMMER behalten
    const { data: sessions } = await supabase.from('sessions').select('id').eq('course_id', courseId)
    const sessionIds = (sessions || []).map((s: any) => s.id)

    if (sessionIds.length > 0) {
      await supabase.from('bookings').update({
        status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: 'admin'
      }).eq('user_id', id).in('session_id', sessionIds).eq('status', 'active')

      // Sarah-Regel 2026-05-23: zentraler Helper mit 90-Min-Cutoff.
      // > 90 Min: erster Waitlist-Yogi wird auto-promoted (alte Logic).
      // ≤ 90 Min: alle Waitlist-Yogis kriegen Auswahl-Mail mit Token.
      // Notify-Subscribers werden in beiden Fällen informiert.
      for (const sid of sessionIds) {
        try { await promoteWaitlistOrOfferLate(supabase, sid) } catch(e) { console.error('promote:', e) }
      }
    }

    // Zuerst Bookings entkoppeln (Foreign Key auf credits), dann Credits löschen
    const { data: courseCredits } = await supabase.from('credits')
      .select('id').eq('user_id', id).eq('course_id', courseId)
    if (courseCredits && courseCredits.length > 0) {
      const creditIds = courseCredits.map((c: any) => c.id)
      await supabase.from('bookings').update({ credit_id: null })
        .eq('user_id', id).in('credit_id', creditIds)
      await supabase.from('credits').delete()
        .eq('user_id', id).eq('course_id', courseId)
    }

    await supabase.from('enrollments').delete().eq('id', enrollmentId)
    await supabase.from('audit_log').insert({
      action: 'yogi_removed_from_course',
      details: { target_user_id: id, course_id: courseId, delete_credits: true }
    })
    setRemoving(null); loadData()
  }

  async function handleEditCredit(credit: any, newTotal: number) {
    if (newTotal < credit.used) {
      alert(`Mindestens ${credit.used} Credits nötig (bereits verbraucht).`)
      return
    }
    await supabase.from('credits').update({ total: newTotal }).eq('id', credit.id)
    await supabase.from('audit_log').insert({
      action: 'credit_adjusted',
      details: { target_user_id: id, credit_id: credit.id, old_total: credit.total, new_total: newTotal }
    })
    setEditingCredit(null); loadData()
  }

  async function handleDeleteCredit(creditId: string) {
    if (!confirm('Diese Credits komplett löschen?')) return
    // Sarah-Befund 2026-05-25: FK bookings.credit_id blockt sonst den DELETE,
    // wenn historische (auch cancelled) Buchungen den Credit noch referenzieren.
    // Aktive Buchungen: refusen mit klarer Meldung. Cancelled: entlinken.
    const { data: refBookings } = await supabase.from('bookings')
      .select('id, status').eq('credit_id', creditId)
    const activeRefs = (refBookings || []).filter((b: any) => b.status === 'active')
    if (activeRefs.length > 0) {
      alert(`Loeschung nicht moeglich: ${activeRefs.length} aktive Buchung(en) nutzen diesen Credit noch.\n\nBuche den Yogi zuerst aus diesen Stunden aus, dann kann der Credit geloescht werden.`)
      return
    }
    // Cancelled / stale Bookings: credit_id entlinken (Booking-Historie bleibt erhalten)
    if ((refBookings || []).length > 0) {
      await supabase.from('bookings').update({ credit_id: null }).eq('credit_id', creditId)
    }
    const { error: delErr } = await supabase.from('credits').delete().eq('id', creditId)
    if (delErr) {
      alert(`Loeschung fehlgeschlagen: ${delErr.message}`)
      return
    }
    await supabase.from('audit_log').insert({
      action: 'credit_deleted',
      details: { target_user_id: id, credit_id: creditId, unlinked_bookings: (refBookings || []).length }
    })
    loadData()
  }

  // "Teilgenommen" ab Stundenstart — Logik aus lib/session-status.ts
  function getStatusBadge(b: any) {
    // Welle Akteur-Logik (Sarah 2026-05-29): zentrales Status-Wort.
    // Fix U2: Session-Absage (Abgesagt/Ausgeschlossen) hat jetzt Vorrang.
    // Fix U1: Storno-Akteur unterscheidet Ausgetragen (Admin) vs. Abgemeldet (selbst).
    const label = bookingStatusLabel(b.session, b)
    if (label === 'Ausgeschlossen') return <span className="badge badge-left">Ausgeschlossen</span>
    if (label === 'Abgesagt') return <span className="badge" style={{background:'var(--yoga-red-bg)',color:'var(--yoga-red-text)'}}>Abgesagt</span>
    if (label === 'Ausgetragen' || label === 'Abgemeldet') return <span className="badge badge-left">{label}</span>
    if (label === 'Teilgenommen') return <span className="badge badge-done">Teilgenommen </span>
    return <span className="badge badge-enrolled">Angemeldet</span>
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>
  if (!yogi) return null

  // Sarah-Wunsch 2026-05-26: jeder Protokoll-Eintrag MUSS nachvollziehbar
  // sein — Welcher Kurs? Welche Stunde? Wieviele Credits? Daher cascading
  // Fallbacks: details.course_name → auditCourseMap[course_id] → "—".
  // Session-Lookup fuer Termin (Datum + Uhrzeit) inkl. originaler/Ersatz-Session.
  const formatAuditEntry = (entry: any): { text: string; subject?: string } => {
    const d = entry.details || {}
    // Helper: Termin aus session-Lookup oder details.session_date/time
    const fmtDateTime = (dateStr?: string, timeStr?: string) => {
      if (!dateStr) return ''
      const dt = new Date(dateStr).toLocaleDateString('de-DE', { day:'numeric', month:'short', year:'numeric' })
      const tm = timeStr ? ` um ${String(timeStr).slice(0,5)} Uhr` : ''
      return `${dt}${tm}`
    }
    const sessLookup = (sid?: string) => sid ? auditSessionMap.get(sid) : null
    // Termin der primaeren Session: zuerst details, dann lookup
    const sess = sessLookup(d.session_id)
    const sessDateTime = d.session_date
      ? fmtDateTime(d.session_date, d.session_time)
      : (sess ? fmtDateTime(sess.date, sess.time_start) : '')
    // Kurs-Name: details → session.course → course-lookup → '—'
    // Welle 6A (Sarah 2026-05-27): SYS-Container-Namen ("SYS · Einzelstunden",
    // "SYS · Events (kostenlos)" etc.) sind irreführend im Yogi-Protokoll — der
    // Admin will den ECHTEN Titel der Stunde / des Events sehen. session.name
    // hält den echten Titel; courses.name hält bei SYS-Containern den SYS-Namen.
    const isSysName = (n?: string | null) => !!n && /^SYS\s*[·\-]/.test(n)
    // session.name (= echter Titel bei single/event_*) hat höchste Priorität,
    // dann erst details, dann der course.name (= bei SYS irreführend, daher ggf. übersprungen).
    const realSessionName = sess?.name && !isSysName(sess.name) ? sess.name : null
    const cleanedCourseName = isSysName(d.course_name) ? null : d.course_name
    const cleanedOriginalCourseName = isSysName(d.original_course_name) ? null : d.original_course_name
    const cleanedVonKursName = isSysName(d.von_kurs_name) ? null : d.von_kurs_name
    const cleanedDetailsName = isSysName(d.name) ? null : d.name
    const sessDisplayName = realSessionName || (sess?.course?.name && !isSysName(sess.course.name) ? sess.course.name : null)
    const courseName =
      realSessionName              // echter Titel der Session (single/event_* Container)
      || cleanedDetailsName        // details.name (z.B. session_name beim event_created Audit)
      || cleanedCourseName         // details.course_name (Kursstunden)
      || cleanedOriginalCourseName
      || cleanedVonKursName
      || sessDisplayName
      || (d.course_id ? auditCourseMap.get(d.course_id) : null)
      || (d.von_kurs_id ? auditCourseMap.get(d.von_kurs_id) : null)
      || null
    const courseLabel = courseName ? `„${courseName}"` : 'Kurs unbekannt'
    const reason = d.reason && d.reason !== 'no_choice_within_7d_default_refund' ? ` — Grund: ${d.reason}` : ''
    // Termin + Kurs in eine Zeile zusammenfassen fuer subject
    const termin = sessDateTime ? `${sessDateTime}${courseName ? ` · ${courseName}` : ''}` : (courseName || '')

    switch (entry.action) {
      case 'booking_created': {
        // Sarah-Fix 2026-05-30: Events werden technisch mit type='single' gebucht.
        // Das Label daher am session_type festmachen (Event vs Einzelstunde vs Kursstunde).
        const effType = d.session_type || sess?.session_type
        const typeLbl = (effType === 'event_free' || effType === 'event_paid') ? ' (Event)'
          : (d.type === 'single' || effType === 'single') ? ' (Einzelstunde)'
          : ''
        return { text: `Yogi hat gebucht${typeLbl}`, subject: termin }
      }
      case 'booking_cancelled': {
        // Sarah-Regel 2026-05-28: Events (kostenlos + bezahlt) ziehen KEINE
        // Credits → kein Credit-Hinweis. session_type aus details ODER Lookup.
        const effType = d.session_type || sess?.session_type
        const isAnyEvent = effType === 'event_free' || effType === 'event_paid'
        const lateStr = isAnyEvent
          ? ''
          : (d.late ? ' — Spät-Abmeldung, Credit verfallen' : ' — Credit zurück')
        return { text: `Yogi hat sich abgemeldet${lateStr}`, subject: termin }
      }
      case 'booking_cancelled_by_admin': {
        // Welle 6A (Sarah 2026-05-27): differenzierte Frist-Hinweise nach session_type.
        // event_paid → 7-Tage-Frist; Kursstunde/Einzelstunde → 3-Stunden-Frist; Events → keine Frist.
        const sessType = d.session_type || sess?.session_type
        const isEventPaid = sessType === 'event_paid'
        // Sarah-Regel 2026-05-28: ALLE Events (kostenlos + bezahlt + credit)
        // ziehen keine Credits → kein "Credit zurück/verfallen"-Hinweis.
        const isAnyEvent = sessType === 'event_free' || sessType === 'event_paid'
        let fristStr = ''
        if (isEventPaid) {
          fristStr = d.within_7d ? ' (innerhalb 7-Tage-Frist)' : ' (außerhalb 7-Tage-Frist)'
        } else if (!isAnyEvent) {
          fristStr = d.within_3h ? ' (innerhalb 3-Stunden-Frist)' : ''
        }
        const cStr = isAnyEvent
          ? '' // kein Credit involviert
          : (d.credit_returned === false ? ' — Credit verfallen' : ' — Credit zurück')
        return { text: `Admin hat Yogi abgemeldet${fristStr}${cStr}`, subject: termin }
      }
      case 'illness_credit_expired': {
        return { text: `Krankheits-Guthaben nach 10 Monaten abgelaufen und gelöscht${d.unused_credits ? ` (${d.unused_credits} ungenutzt)` : ''}`, subject: '' }
      }
      case 'booking_failed_deadline': {
        const grund = d.reason === 'window_blocked'
          ? 'Frist/Fenster überschritten'
          : (d.reason === 'no_credit' ? 'kein freier Credit' : 'blockiert')
        return { text: `Buchung fehlgeschlagen — ${grund}`, subject: termin }
      }
      case 'admin_added_yogi_to_session': {
        const oStr = d.origin_session_id ? ' (als Vorhol-/Nachholbuchung)' : ''
        return { text: `Admin hat Yogi in Stunde eingetragen${oStr}`, subject: termin }
      }
      // Welle 3 (Sarah 2026-05-26): neue Audit-Actions sauber gemappt
      case 'admin_added_yogi_to_event': {
        const priceStr = d.price_eur ? ` (${d.price_eur} €, Bezahlung extern)` : ' (kostenlos)'
        return { text: `Admin hat Yogi zu Event hinzugefügt${priceStr} — kein Credit verbraucht`, subject: termin }
      }
      case 'single_session_created':
        return { text: `Admin hat Einzelstunde angelegt`, subject: termin }
      case 'single_session_updated':
        return { text: `Admin hat Einzelstunde bearbeitet`, subject: termin }
      case 'event_created': {
        const pStr = d.payment_type === 'paid' ? ` (${d.price_eur} €, Bezahlung extern)` : ' (kostenlos)'
        return { text: `Admin hat Event angelegt${pStr}`, subject: termin }
      }
      case 'event_updated': {
        const pStr = d.payment_type === 'paid' ? ` (${d.price_eur} €)` : ''
        return { text: `Admin hat Event bearbeitet${pStr}`, subject: termin }
      }
      case 'single_or_event_deleted':
        return { text: `Admin hat Einzelstunde / Event gelöscht`, subject: termin }
      case 'single_or_event_updated':
        return { text: `Admin hat Einzelstunde / Event geändert`, subject: termin }
      case 'external_participants_changed': {
        const o = d.old_count ?? '?'
        const n = d.new_count ?? '?'
        return { text: `Externe Teilnehmer geändert: ${o} → ${n}`, subject: termin }
      }
      case 'session_open_toggled':
        return { text: d.is_open ? 'Stunde/Event freigegeben' : 'Stunde/Event gesperrt', subject: termin }
      // ── Welle 4.7 (2026-05-26): Kurs-Mutationen ────────────────────────
      case 'course_created':
        return { text: `Admin hat Kurs „${d.name || courseName || '?'}" angelegt (${d.total_units || '?'} Einheiten)`, subject: '' }
      case 'course_updated':
        return { text: `Admin hat Kurs „${d.name || courseName || '?'}" bearbeitet`, subject: '' }
      case 'course_archived':
        return { text: `Admin hat Kurs „${d.course_name || courseName || '?'}" archiviert`, subject: '' }
      case 'course_deleted':
        return { text: `Admin hat Kurs „${d.course_name || '?'}" komplett gelöscht (${d.sessions_count || 0} Sessions)`, subject: '' }
      case 'course_open_toggled': {
        const cn = d.course_name || courseName || '?'
        return { text: d.is_open ? `Kurs „${cn}" wurde für externe Buchungen FREIGEGEBEN` : `Kurs „${cn}" wurde für externe Buchungen GESPERRT`, subject: '' }
      }
      case 'admin_illness_credit': {
        const attest = d.attest_date ? new Date(d.attest_date).toLocaleDateString('de-DE') : '?'
        const hrs = d.hours_credited ?? '?'
        const vh = d.vorhol_cancelled_count > 0 ? `, ${d.vorhol_cancelled_count} Vorhol-/Nachholbuchung${d.vorhol_cancelled_count === 1 ? '' : 'en'} ersatzlos storniert` : ''
        return {
          text: `Admin hat Yogi krankheitsbedingt aus ${courseLabel} ausgetragen — ${hrs} Stunden Krankheits-Guthaben (10 Monate gültig)${vh}`,
          subject: `Attest vom ${attest}`
        }
      }
      case 'yogi_enrolled_by_admin': {
        const cr = d.credits ?? d.neue_credits ?? '?'
        const gh = d.guthaben_verrechnet > 0 ? `, davon ${d.guthaben_verrechnet} aus Guthaben verrechnet` : ''
        return { text: `Admin hat Yogi in ${courseLabel} eingebucht — ${cr} Stunden${gh}`, subject: '' }
      }
      case 'yogi_removed_from_course': {
        const dc = d.delete_credits ? ' (inkl. Credit-Löschung)' : ''
        return { text: `Admin hat Yogi aus ${courseLabel} entfernt${dc}`, subject: '' }
      }
      case 'yogi_course_cancellation_choice': {
        const choice = d.choice === 'guthaben' ? 'Guthaben behalten' : 'Geld zurück (Erstattung)'
        const sess = d.remaining_sessions ?? '?'
        return { text: `Yogi hat zum Abbruch von ${courseLabel} geantwortet: ${choice} — betrifft ${sess} Stunden`, subject: '' }
      }
      case 'course_cancelled': {
        const sess = d.remaining_sessions ?? '?'
        const mode = d.refund_mode === 'all_refund' ? 'alle Erstattung' : 'Yogi-Wahl Guthaben/Erstattung'
        return { text: `Admin hat ${courseLabel} abgebrochen — ${sess} Stunden entfallen, ${mode}${reason}`, subject: '' }
      }
      case 'session_cancelled': {
        // Welle 6A (Sarah 2026-05-27): differenziert nach session_type — Yogi sieht
        // welcher Art Termin abgesagt wurde + ob Credit zurück.
        const sessType = d.session_type
        const kind = sessType === 'single' ? 'Einzelstunde'
          : sessType === 'event_free' ? 'Event'
          : sessType === 'event_paid' ? 'Event'
          : 'Kursstunde'
        const creditNote = (sessType === 'event_free' || sessType === 'event_paid')
          ? '' // kein Credit involviert bei Events
          : ' — Credit zurückgebucht'
        return { text: `Admin hat ${kind} abgesagt${creditNote}${reason}`, subject: termin }
      }
      case 'replacement_session_added': {
        const orig = sessLookup(d.original_session_id)
        const origStr = orig ? `Ersatz für ${fmtDateTime(orig.date, orig.time_start)}` : 'Neuer Ersatztermin'
        const yEnrolled = d.yogis_enrolled != null ? ` — ${d.yogis_enrolled} Yogis automatisch eingebucht` : ''
        return { text: `Admin hat Ersatztermin angelegt: ${origStr}${yEnrolled}`, subject: termin }
      }
      case 'cascade_replacement_cancelled': {
        const cnt = d.cancelled_booking_count ?? '?'
        return { text: `Ursprungs-Stunde abgesagt — ${cnt} bereits gebuchte Ersatztermin-Buchung${cnt === 1 ? '' : 'en'} damit hinfällig`, subject: courseName || '' }
      }
      case 'waitlist_offer_late_accepted':
        return { text: `Yogi hat 90-Min-Wartelisten-Angebot angenommen${termin ? ` für ${termin}` : ''}`, subject: termin }
      case 'admin_promoted_waitlist_yogi': {
        const ob = d.was_overbooking ? ' (mit Überbuchung)' : ''
        return { text: `Admin hat Yogi manuell von der Warteliste nachgerückt${ob}`, subject: termin }
      }
      case 'credit_assigned': {
        const m = d.model || '?'
        const amt = d.amount ?? '?'
        const exp = d.expires_at ? ` (verfällt ${new Date(d.expires_at).toLocaleDateString('de-DE')})` : ''
        const vf = d.valid_from ? `, nutzbar ab ${new Date(d.valid_from).toLocaleDateString('de-DE')}` : ''
        return { text: `Admin hat ${amt} ${m}-Credits vergeben${exp}${vf}`, subject: '' }
      }
      case 'credit_adjusted': {
        const o = d.old_total ?? '?'
        const n = d.new_total ?? '?'
        return { text: `Admin hat Credit-Gesamtzahl angepasst: ${o} → ${n}`, subject: '' }
      }
      case 'credit_deleted': {
        const ub = d.unlinked_bookings > 0 ? ` (${d.unlinked_bookings} Buchungen entkoppelt)` : ''
        return { text: `Admin hat Credit gelöscht — z.B. für Auszahlung${ub}`, subject: '' }
      }
      case 'guthaben_2y_auto_refund': {
        const uc = d.unused_credits ?? '?'
        return { text: `Guthaben nach 2 Jahren automatisch verfallen — ${uc} ungenutzte Credits, Sarah muss Geldbetrag erstatten`, subject: courseName || '' }
      }
      case 'token_expired_auto_refund': {
        const rs = d.remaining_sessions ?? '?'
        return { text: `Yogi hat 7-Tage-Wahl-Frist verstreichen lassen — Default: Erstattung für ${rs} Stunden in ${courseLabel}`, subject: '' }
      }
      case 'yogi_anonymized_dsgvo':
        return { text: 'Yogi-Account DSGVO-konform gelöscht — alle Stammdaten anonymisiert, Buchungshistorie entfernt', subject: '' }
      case 'course_rollover': {
        const von = d.von_kurs_name || courseName
        const folge = d.folgekurs_name || '?'
        const tn = d.anzahl_teilnehmer ? ` mit ${d.anzahl_teilnehmer} Teilnehmer${d.anzahl_teilnehmer === 1 ? '' : 'n'}` : ''
        const ds = d.datum_start ? new Date(d.datum_start).toLocaleDateString('de-DE') : '?'
        const de = d.datum_ende ? new Date(d.datum_ende).toLocaleDateString('de-DE') : '?'
        return { text: `Admin hat Kurs verlängert — „${von}" → „${folge}" (${ds}–${de})${tn}`, subject: '' }
      }
      case 'admin_bulk_mail': {
        const subj = d.subject ? `: „${d.subject}"` : ''
        const sent = d.sent != null ? ` (an ${d.sent} Empfänger${d.failed > 0 ? `, ${d.failed} fehlgeschlagen` : ''})` : ''
        return { text: `Admin hat Bulk-Mail an Yogis verschickt${subj}${sent}`, subject: '' }
      }
      // Welle 5 (Sarah 2026-05-26): bislang fehlende Cases — laut Agent-A-Audit
      // entweder via Trigger geschrieben oder zukünftig vorgesehen. Backbone-Argumentation
      // braucht lückenlose Yogi-Sicht — daher hier menschenlesbar gemappt.
      case 'yogi_deleted': {
        const em = d.email || d.user_email || '?'
        const reason = d.reason ? ` (Grund: ${d.reason})` : ''
        return { text: `Yogi hat eigenen Account gelöscht — ${em}${reason}`, subject: '' }
      }
      case 'legal_accepted': {
        const ver = d.version || d.agb_version || ''
        const t = ver ? `AGB Version ${ver} bestätigt` : 'AGB bestätigt'
        return { text: `Yogi hat ${t}`, subject: '' }
      }
      case 'waitlist_joined': {
        // Sarah-Fix 2026-05-30: konkrete Stunde (Datum/Zeit · Kurs) als subject zeigen,
        // statt nur dem Kursnamen im Text — der Admin muss sehen, FÜR WELCHE Stunde.
        const cn = courseName || d.course_name
        return { text: `Yogi hat sich auf Warteliste eingetragen`, subject: termin || (cn ? `· ${cn}` : '') }
      }
      case 'waitlist_promoted': {
        const cn = courseName || d.course_name
        return { text: `Yogi wurde automatisch von Warteliste nachgerückt`, subject: termin || (cn ? `· ${cn}` : '') }
      }
      case 'waitlist_auto_removed': {
        const cn = d.course_name || courseName
        return { text: `Yogi automatisch von Warteliste entfernt (letzter Credit verbraucht)${cn ? ` — ${cn}` : ''}`, subject: '' }
      }
      case 'admin_dsgvo_deletion': {
        const reason = d.reason ? ` (Grund: ${d.reason})` : ''
        return { text: `Admin hat Yogi-Account DSGVO-konform gelöscht${reason}`, subject: '' }
      }
      // ── Welle S2/S3 (Sarah 2026-05-27): Folge-Audits Sicherheits-/Logik-Fixes ──
      case 'replacement_credit_invalid': {
        const r = d.reason === 'expires_before_replacement' ? 'Credit war abgelaufen' : 'Credit galt noch nicht'
        return { text: `Ersatztermin-Buchung NICHT automatisch erstellt (${r}) — Yogi muss selbst handeln`, subject: termin }
      }
      case 'kursabbruch_token_reclicked':
        return { text: `Yogi hat Kursabbruch-Link erneut geklickt (Original-Wahl: ${d.original_choice || '?'})`, subject: '' }
      case 'apply_cancellation_refund_failed':
        return { text: `Erstattungs-Workflow fehlgeschlagen (${d.error || 'unbekannt'}) — Sarah muss manuell prüfen`, subject: '' }
      case 'profile_email_update_failed':
        return { text: `Email-Update fehlgeschlagen (${d.error || 'unbekannt'}) — Rollback versucht`, subject: '' }
      case 'waitlist_offer_rollback':
        return { text: `Warteliste-Angebot zurückgerollt (${d.reason || 'unbekannt'})`, subject: termin }
      default:
        return { text: `${entry.action} — keine lesbare Beschreibung verfügbar (bitte Mapping ergänzen)`, subject: '' }
    }
  }

  // Sarah-Wunsch 2026-05-26: "Credits verwalten" wandert nach oben (zwischen
  // Action-Buttons und "Eingebuchte Kurse"). Block in Render-Funktion
  // extrahiert, damit er an einer Stelle gerendert und an der alten Stelle
  // (unter Letzte Buchungen) entfernt werden kann.
  const renderCreditsManageSection = () => {
    // Sarah-Wunsch 2026-05-26: Course-Credits AUSBLENDEN, wenn das zugehörige
    // Enrollment beendet ist (z.B. krankheitsbedingt ausgetragen, end_date in
    // der Vergangenheit). Sonst sieht der Admin eine "0 frei"-Karte für einen
    // Kurs in dem der Yogi gar nicht mehr ist — verwirrend. Guthaben (illness
    // & cancellation_choice) bleiben sichtbar.
    const todayStr = new Date().toISOString().slice(0, 10)
    const endedCourseIds = new Set(
      enrollments
        .filter((e: any) => e.end_date && e.end_date <= todayStr)
        .map((e: any) => e.course_id)
    )
    const visibleCredits = credits.filter((c: any) => {
      // Course-Credit fuer beendeten Kurs → raus
      if (c.model === 'course' && endedCourseIds.has(c.course_id)) return false
      // Sonst alte Regel: course immer; andere nur wenn noch frei.
      return c.model === 'course' || Math.max(0, c.total - c.used) > 0
    })
    if (visibleCredits.length === 0) return null
    return (
      <>
        <p className="section-label mt-2">Credits / Guthaben verwalten</p>
        {visibleCredits.map(c => {
          const free = computeFree(c)
          const isExpired = new Date(c.expires_at) < new Date()
          return (
            <div key={c.id} className={`card mb-2 ${isExpired ? 'opacity-50' : ''}`}>
              {editingCredit?.id === c.id && (c.model === 'tenpack' || c.model === 'quarterly' || c.model === 'single') ? (
                <div>
                  <p className="text-sm font-semibold mb-2">Credits anpassen</p>
                  <p className="text-xs text-yoga-text/50 mb-2">Bereits verbraucht: {c.used}</p>
                  <div className="flex items-center gap-2 mb-2">
                    <label className="text-xs text-yoga-text/60">Neue Gesamtzahl:</label>
                    <input type="number" min={c.used} max={100} value={editCreditAmount}
                      onChange={e => setEditCreditAmount(parseInt(e.target.value, 10))}
                      className="field-input w-20 text-center py-1" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleEditCredit(c, editCreditAmount)}
                      className="flex-1 btn-primary text-sm py-2">Speichern</button>
                    <button onClick={() => setEditingCredit(null)}
                      className="flex-1 btn-ghost text-sm py-2">Abbrechen</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-semibold">
                      {c.model === 'course'
                        ? `${c.used} / ${c.total} genutzt · ${Math.max(0, c.total - c.used)} frei`
                        : c.model === 'guthaben'
                          // Sarah-Wunsch 2026-05-26: bei Guthaben kein "Credits"
                          // und kein "frei" — semantisch falsch. Stattdessen
                          // "X von Y Stunden verfügbar" (Yogi kann sie nur für
                          // Kurse einlösen).
                          ? `${free} von ${c.total} Stunden verfügbar`
                          : `${free} von ${c.total} Credits frei`}
                    </div>
                    {(() => {
                      const isQuarterly = c.model === 'quarterly'
                      const exp = new Date(c.expires_at)
                      const fmtDay = (d: Date) => d.toLocaleDateString('de-DE', { day:'numeric', month:'long', year:'numeric' })
                      const fmtShort = (d: Date) => d.toLocaleDateString('de-DE', { day:'numeric', month:'long' })
                      if (isQuarterly) {
                        const qNumber = Math.floor(exp.getMonth() / 3) + 1
                        const qYear = exp.getFullYear()
                        const qStart = c.valid_from ? new Date(c.valid_from) : new Date(qYear, (qNumber - 1) * 3, 1)
                        return <>
                          <div className="text-xs text-yoga-text/50 mt-0.5">
                            Quartals-Credits · Q{qNumber} {qYear}
                          </div>
                          <div className="text-xs text-yoga-text/55 mt-0.5">
                            Gültig vom {fmtShort(qStart)} bis {fmtDay(exp)}
                          </div>
                          {c.valid_from && new Date(c.valid_from) > new Date() && (
                            <div className="text-xs text-yoga-amber-text font-semibold mt-1">
                              Nutzbar ab {fmtDay(new Date(c.valid_from))}
                            </div>
                          )}
                        </>
                      }
                      // Sarah-Wunsch 2026-05-26: bei Guthaben-Credits zusätzlich
                      // den Herkunfts-Kurs + Datum (Anlage = created_at) anzeigen,
                      // damit der Admin nachvollziehen kann woher das Guthaben kommt.
                      const created = c.created_at ? new Date(c.created_at).toLocaleDateString('de-DE') : null
                      // Sarah-Fix 2026-05-29: source_course_name als Fallback — bleibt
                      // erhalten, auch wenn der Quell-Kurs geloescht (course_id entkoppelt) wurde.
                      const courseName = c.course?.name || c.source_course_name || null
                      const isGuthaben = c.model === 'guthaben'
                      const isIllness = isGuthaben && c.source === 'illness'
                      const label =
                        c.model === 'course' ? `Credits aus Kurs: ${courseName || '—'}` :
                        isIllness ? 'Krankheits-Guthaben' :
                        isGuthaben ? 'Guthaben aus Kursabbruch' :
                        c.model === 'single' ? 'Credits aus Punktekarte' :
                        c.model === 'tenpack' ? 'Punktekarte' : 'Credits'
                      return (
                        <>
                          <div className="text-xs text-yoga-text/50 mt-0.5">
                            {label} ·
                            {isExpired ? ' Abgelaufen' : ` verfällt ${exp.getFullYear() > 2090 ? 'nie' : exp.toLocaleDateString('de-DE')}`}
                          </div>
                          {isGuthaben && (courseName || created) && (
                            <div className="text-xs text-yoga-text/45 mt-0.5">
                              {courseName && <>aus Kurs: <strong>{courseName}</strong></>}
                              {courseName && created && ' · '}
                              {created && (
                                isIllness
                                  ? <>krankheitsbedingt ausgetragen am {created}</>
                                  : <>Kurs abgebrochen am {created}</>
                              )}
                            </div>
                          )}
                        </>
                      )
                    })()}
                    {c.model === 'course' && (
                      <div className="text-xs text-yoga-text/30 mt-0.5">Nur Lesezugriff</div>
                    )}
                    {c.model === 'guthaben' && (
                      <div className="text-xs text-yoga-text/30 mt-0.5">Löschbar (für Auszahlung)</div>
                    )}
                  </div>
                  {(c.model === 'tenpack' || c.model === 'quarterly' || c.model === 'single') && (
                    <div className="flex gap-2">
                      <button onClick={() => { setEditingCredit(c); setEditCreditAmount(c.total) }}
                        className="text-xs border border-yoga-border2 rounded-full px-2 py-1 hover:opacity-80">
                        <i className="ti ti-edit" />
                      </button>
                      <button onClick={() => handleDeleteCredit(c.id)}
                        className="text-xs bg-yoga-red-bg text-yoga-red-text border-0 rounded-full px-2 py-1 cursor-pointer hover:opacity-80">
                        <i className="ti ti-trash" />
                      </button>
                    </div>
                  )}
                  {c.model === 'guthaben' && (
                    <button onClick={() => {
                      if (!confirm(`Guthaben (${c.total - c.used} Credits) löschen?\n\nNutze das nur, wenn du dem Yogi den Betrag stattdessen in Geld erstattest.`)) return
                      handleDeleteCredit(c.id)
                    }} className="text-xs bg-yoga-red-bg text-yoga-red-text border-0 rounded-full px-2 py-1 cursor-pointer hover:opacity-80">
                      <i className="ti ti-trash" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </>
    )
  }

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title={`${yogi.first_name} ${yogi.last_name}`} isAdmin />
      <div className="px-4 py-4">

        {/* Zurück */}
        <button onClick={() => router.back()}
          className="flex items-center gap-1 text-sm text-yoga-text/60 mb-4 hover:opacity-80">
          <i className="ti ti-arrow-left" /> Zurück
        </button>

        <div className="card mb-4">
          {yogi.is_dummy && (
            <span className="badge bg-yoga-text text-white mb-2 inline-block">
              <i className="ti ti-user-question mr-1" />Dummy-User (kein Login)
            </span>
          )}
          <p className="text-sm font-semibold">{yogi.email || 'Keine E-Mail'}</p>
          <p className="text-xs text-yoga-text/40 mt-1">
            Dabei seit {new Date(yogi.created_at).toLocaleDateString('de-DE', { month:'long', year:'numeric' })}
          </p>
          {yogi.birthdate && (() => {
            // Sarah-Wunsch 2026-05-23: Geburtsdatum + Alter sichtbar im Admin-Detail
            const [y, m, d] = (yogi.birthdate as string).split('-')
            const bd = new Date(yogi.birthdate as string)
            const ageYears = Math.floor((Date.now() - bd.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
            return (
              <p className="text-xs text-yoga-text/40 mt-0.5">
                Geboren am {d}.{m}.{y} ({ageYears} Jahre)
              </p>
            )
          })()}
          {(yogi.emergency_name || yogi.emergency_phone) && (
            <div className="mt-2 p-2 bg-yoga-amber-bg/40 rounded-yoga border border-yoga-amber-text/20">
              <div className="text-xs text-yoga-text/50 mb-1">Notfallkontakt</div>
              {yogi.emergency_name && <div className="text-sm font-semibold">{yogi.emergency_name}</div>}
              {yogi.emergency_phone && (() => {
                // Sarah-Wunsch 2026-05-23: tel: und WhatsApp-Link für direkten Kontakt.
                // Telefon normalisieren auf +49xxx Format für WhatsApp wa.me.
                const raw = (yogi.emergency_phone as string).replace(/\s|-|\(|\)|\//g, '')
                let waNumber = raw.startsWith('+') ? raw.replace('+', '') :
                  raw.startsWith('00') ? raw.slice(2) :
                  raw.startsWith('0') ? '49' + raw.slice(1) : raw
                return (
                  <>
                    <div className="text-sm text-yoga-text/70 mb-1.5">{yogi.emergency_phone}</div>
                    <div className="flex gap-1.5">
                      <a href={`tel:${raw}`}
                        className="flex-1 inline-flex items-center justify-center gap-1 text-xs bg-yoga-text text-yoga-bg rounded-full px-2.5 py-1 font-semibold no-underline">
                        <i className="ti ti-phone" />Anrufen
                      </a>
                      <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noopener noreferrer"
                        className="flex-1 inline-flex items-center justify-center gap-1 text-xs bg-[#25D366] text-white rounded-full px-2.5 py-1 font-semibold no-underline">
                        <i className="ti ti-brand-whatsapp" />WhatsApp
                      </a>
                    </div>
                  </>
                )
              })()}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            {yogi.legal_accepted_at ? (
              <span className="text-xs bg-yoga-green-bg text-yoga-green-text px-2 py-0.5 rounded-full font-semibold">
                <i className="ti ti-check mr-0.5" />AGB akzeptiert am {new Date(yogi.legal_accepted_at).toLocaleDateString('de-DE')}
              </span>
            ) : (
              <span className="text-xs bg-yoga-amber-bg text-yoga-amber-text px-2 py-0.5 rounded-full font-semibold">
                <i className="ti ti-alert-triangle mr-0.5" />AGB noch nicht akzeptiert
              </span>
            )}
          </div>
        </div>

        {/* Sarah-Wunsch 2026-05-26: 3. Kachel "Guthaben" erscheint nur wenn vorhanden.
            Sonst 2-Spalten wie bisher. Guthaben separat damit Admin auf einen
            Blick sieht: Yogi hat z.B. 0 buchbare Credits aber 6 Guthaben aus
            Kursabbruch. */}
        <div className={`grid gap-2 mb-4 ${guthabenCredits > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <div className="card text-center">
            <div className="text-2xl font-bold">{freeCredits}</div>
            <div className="text-xs text-yoga-text/50">Freie Credits</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold">
              {bookings.filter(b => b.status === 'active' && isStarted(b.session)).length}
            </div>
            <div className="text-xs text-yoga-text/50">Absolvierte Stunden</div>
          </div>
          {guthabenCredits > 0 && (
            <div className="card text-center">
              <div className="text-2xl font-bold">{guthabenCredits}</div>
              <div className="text-xs text-yoga-text/50">Guthaben</div>
            </div>
          )}
        </div>

        {/* Aktionen */}
        <div className="flex gap-2 mb-5">
          <button onClick={() => setShowEnrollForm(!showEnrollForm)} className="flex-1 btn-primary text-sm py-3">
            <i className="ti ti-calendar-plus mr-1" /> In Kurs einbuchen
          </button>
          <button onClick={() => router.push(`/admin/credits?user=${id}`)} className="flex-1 btn-secondary text-sm py-3">
            <i className="ti ti-coin mr-1" /> Credits vergeben
          </button>
        </div>

        {/* Einbuch-Formular */}
        {showEnrollForm && (
          <div className="card mb-4" style={{ background: '#e8ede6', borderColor: 'rgba(58,90,48,0.2)' }}>
            <p className="text-sm font-bold mb-2" style={{ color: '#3a5a30' }}>Direkt in Kurs einbuchen</p>
            <p className="text-xs mb-3" style={{ color: '#3a5a30', opacity: 0.8 }}>
              Credits werden automatisch berechnet. Verfall: 8 Tage nach letzter Stunde.
            </p>
            <select className="field-input mb-3" value={selectedCourseId} onChange={e => setSelectedCourseId(e.target.value)}>
              <option value="">Kurs wählen...</option>
              {courses.filter(c => !enrollments.find(e => e.course_id === c.id)).map(c => {
                const rem = getRemainingUnits(c)
                const enrollCount = c.enrollments?.length ?? 0
                const isFull = c.max_spots && enrollCount >= c.max_spots
                // Sarah-Regel 2026-05-23: Admin darf überbuchen → wählbar lassen,
                // nur als „voll" markieren damit Admin es bewusst sieht.
                return (
                  <option key={c.id} value={c.id}>
                    {isFull
                      ? `${c.name} → ${rem} Credits · voll ${enrollCount}/${c.max_spots} (überbuchen?)`
                      : `${c.name} → ${rem} Credits · ${enrollCount}/${c.max_spots ?? '∞'} Plätze`}
                  </option>
                )
              })}
            </select>

            {/* Ausnahme: Nicht ganzer Kurs (Range einbuchen) */}
            {selectedCourseId && (
              <div className="mb-3">
                {!enrollRangeMode ? (
                  <button
                    onClick={() => setEnrollRangeMode(true)}
                    className="text-xs underline cursor-pointer bg-transparent border-0 p-0"
                    style={{ color: '#3a5a30' }}>
                    + Ausnahme: nur bestimmte Stunden einbuchen
                  </button>
                ) : (
                  <div className="bg-yoga-card rounded-yoga p-3 border border-yoga-border">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold" style={{ color: '#3a5a30' }}>
                        Ausnahme: nur Teil-Buchung
                      </p>
                      <button
                        onClick={() => setEnrollRangeMode(false)}
                        className="text-xs underline cursor-pointer bg-transparent border-0 p-0 text-yoga-text/60">
                        zurück zu ganzem Kurs
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-yoga-text/70">Von Einheit</label>
                      <input
                        type="number" min={1} max={selectedCourseUnits}
                        value={enrollFromUnit}
                        onChange={e => setEnrollFromUnit(e.target.value)}
                        className="field-input w-16 py-1 text-center" />
                      <label className="text-xs text-yoga-text/70">bis</label>
                      <input
                        type="number" min={1} max={selectedCourseUnits}
                        value={enrollUntilUnit}
                        onChange={e => setEnrollUntilUnit(e.target.value)}
                        className="field-input w-16 py-1 text-center" />
                      <span className="text-xs text-yoga-text/60">von {selectedCourseUnits}</span>
                    </div>
                    <p className="text-xs text-yoga-text/50 mt-2">
                      {(() => {
                        const f = parseInt(enrollFromUnit, 10), u = parseInt(enrollUntilUnit, 10)
                        if (!Number.isFinite(f) || !Number.isFinite(u)) return 0
                        return Math.max(0, u - f + 1)
                      })()} Credits werden vergeben
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={handleEnroll} disabled={!selectedCourseId || enrolling}
                className={`flex-1 btn-primary text-sm py-2.5 ${!selectedCourseId ? 'opacity-40 cursor-not-allowed' : ''}`}>
                {enrolling ? 'Wird eingebucht...' : 'Einbuchen & Credits vergeben'}
              </button>
              <button onClick={() => setShowEnrollForm(false)} className="btn-ghost text-sm py-2.5 w-auto px-4">Abbrechen</button>
            </div>
          </div>
        )}

        {/* Credits verwalten — Sarah-Wunsch 2026-05-26: hochgezogen, zwischen
            Action-Buttons (In Kurs einbuchen / Credits vergeben) und
            "Eingebuchte Kurse". Block-Definition in renderCreditsManageSection
            (oberhalb des return). */}
        {renderCreditsManageSection()}

        {/* Eingebuchte Kurse — NUR aktive (nicht archivierte/abgesagte) Kurse.
            Archivierte Kurse verschwinden hier; ihre Credits bleiben aber im
            Credits-Block sichtbar bis sie ablaufen. */}
        {(() => {
          // Sarah-BugFix 2026-05-26: Krankheitsbedingt ausgetragene Yogis
          // (enrollment.end_date <= heute, end_reason='illness') werden
          // hier NICHT mehr angezeigt. Der Kurs ist fuer sie beendet — sie
          // sehen stattdessen ihr Krankheits-Guthaben in der Credits-Sektion.
          const todayStr = new Date().toISOString().slice(0, 10)
          const activeEnrollments = enrollments.filter((e: any) =>
            e.course?.is_active !== false
            && e.course?.is_cancelled !== true
            && (!e.end_date || e.end_date > todayStr)
          )
          if (activeEnrollments.length === 0) return null
          return (
          <>
            <p className="section-label">Eingebuchte Kurse</p>
            {activeEnrollments.map(e => {
              const ds = e.course?.date_start ? new Date(e.course.date_start) : null
              const de = e.course?.date_end ? new Date(e.course.date_end) : null
              const sameYear = ds && de && ds.getFullYear() === de.getFullYear()
              const fmtShort = (d: Date) => d.toLocaleDateString('de-DE', { day:'numeric', month:'short' })
              const fmtFull = (d: Date) => d.toLocaleDateString('de-DE', { day:'numeric', month:'short', year:'numeric' })
              const dateLabel = ds && de
                ? (sameYear ? `${fmtShort(ds)} – ${fmtFull(de)}` : `${fmtFull(ds)} – ${fmtFull(de)}`)
                : ds ? `ab ${fmtFull(ds)}`
                : null
              // Mid-Course-Einstieg: Yogi's erste Session-Datum in diesem Kurs > Kursbeginn
              // → wir zeigen "Eingestiegen ab DD.MM., X Credits" damit der Admin sofort sieht
              // warum der Yogi weniger Credits hat als der Kurs insgesamt.
              const yogiBookingsForCourse = bookings.filter(b => b.session?.course_id === e.course_id)
              const firstSessionDateStr = yogiBookingsForCourse.length > 0
                ? yogiBookingsForCourse.map(b => b.session?.date).filter(Boolean).sort()[0]
                : null
              const courseStartStr = e.course?.date_start
              const isMidCourse = !!(firstSessionDateStr && courseStartStr && firstSessionDateStr > courseStartStr)
              const yogiCourseCredit = credits.find((c: any) => c.model === 'course' && c.course_id === e.course_id)
              const yogiUnits = yogiCourseCredit?.total ?? 0
              return (
              <div key={e.id} className="card mb-3">
                <div className="text-base font-bold mb-1">{e.course?.name}</div>
                <div className="text-sm text-yoga-text/50">{e.course?.weekday}</div>
                {dateLabel && (
                  <div className="text-xs text-yoga-text/55 mt-0.5 flex items-center gap-1">
                    <i className="ti ti-calendar text-sm" />{dateLabel}
                  </div>
                )}
                {isMidCourse && firstSessionDateStr && (
                  <div className="text-xs text-yoga-amber-text bg-yoga-amber-bg/60 border border-yoga-amber-text/20 rounded-yoga px-2 py-1.5 mt-2 mb-3 flex items-center gap-1.5">
                    <i className="ti ti-arrow-narrow-right text-sm flex-shrink-0" />
                    <span>
                      Eingestiegen ab <strong>{new Date(firstSessionDateStr).toLocaleDateString('de-DE', { day:'numeric', month:'short', year:'numeric' })}</strong>
                      {yogiUnits > 0 && <> · {yogiUnits} {yogiUnits === 1 ? 'Credit' : 'Credits'}</>}
                    </span>
                  </div>
                )}
                {!isMidCourse && !dateLabel && <div className="mb-3" />}
                {!isMidCourse && dateLabel && <div className="mb-3" />}

                {/* Sarah-Wunsch 2026-05-23: Stunden-Aufstellung des Kurses mit
                    Status pro Session (Teilgenommen/Abgemeldet/Abgesagt/Eingebucht).
                    Klick auf Session öffnet /admin/sessions/[id]. */}
                {(() => {
                  // Sarah-Wunsch 2026-05-23: ausgeschlossene Stunden (Setup-Excluded)
                  // werden hier NICHT angezeigt — die existieren ja effektiv nie als Termine.
                  const courseSessions = ((e.course?.sessions || []) as any[]).filter((s: any) => !isExcluded(s))
                  if (courseSessions.length === 0) return null
                  const nowMs = Date.now()
                  const bookingsBySession = new Map<string, any>()
                  for (const b of bookings) {
                    if (b.session?.course_id === e.course_id && b.session?.id) {
                      bookingsBySession.set(b.session.id, b)
                    }
                  }
                  // Ersatzstunden-Set: jede Session deren ID als replacement_session_id
                  // auf einer ANDEREN (abgesagten) Session steht, ist eine Ersatzstunde.
                  // Wir nutzen ALLE sessions des Kurses (auch excluded), weil ausgeschlossene
                  // Stunden auch replacements haben können.
                  const allSessions = (e.course?.sessions || []) as any[]
                  const replacementIds = new Set<string>()
                  for (const s of allSessions) {
                    if (s.replacement_session_id) replacementIds.add(s.replacement_session_id)
                  }
                  const sorted = [...courseSessions].sort((a, b) =>
                    (a.date + (a.time_start||'')).localeCompare(b.date + (b.time_start||''))
                  )
                  return (
                    <div className="mb-3 mt-1">
                      <p className="text-xs font-semibold text-yoga-text/55 mb-1.5 px-0.5">Stunden des Kurses</p>
                      <div className="space-y-1">
                        {sorted.map((s: any) => {
                          const sessDt = new Date(`${s.date}T${s.time_start||'00:00'}`).getTime()
                          const isPast = sessDt < nowMs
                          const myBooking = bookingsBySession.get(s.id)
                          let badge: { label: string; bg: string; fg: string } | null = null
                          if (s.is_cancelled) {
                            badge = { label: 'Abgesagt', bg: 'var(--yoga-red-bg)', fg: 'var(--yoga-red-text)' }
                          } else if (myBooking?.status === 'active') {
                            badge = isPast
                              ? { label: 'Teilgenommen', bg: '#e8ede6', fg: '#3a5a30' }
                              : { label: 'Eingebucht', bg: '#e8ede6', fg: '#3a5a30' }
                          } else if (myBooking?.status === 'cancelled') {
                            // Welle Akteur-Logik (Sarah 2026-05-29): Ausgetragen (Admin) vs. Abgemeldet (selbst)
                            badge = { label: cancelledActorLabel(myBooking), bg: '#f0eded', fg: '#7a6a6a' }
                          } else {
                            // Kein Booking — Yogi war für diese Session nicht eingebucht (mid-course Einstieg)
                            badge = { label: '—', bg: '#f5f2f0', fg: '#999' }
                          }
                          const isReplacement = replacementIds.has(s.id)
                          return (
                            <button key={s.id} onClick={() => router.push(`/admin/sessions/${s.id}`)}
                              className="w-full text-left flex items-center justify-between gap-2 py-1.5 px-2 rounded-yoga bg-yoga-gray hover:bg-yoga-border2 transition-colors border-0 cursor-pointer text-xs">
                              <span className="font-medium text-yoga-text/85 truncate flex items-center gap-1.5">
                                {new Date(s.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short' })}
                                {s.time_start && ` · ${s.time_start.slice(0,5)} Uhr`}
                                {isReplacement && (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-yoga-text bg-yoga-amber-bg/70 rounded-full px-1.5 py-0.5">
                                    <i className="ti ti-refresh text-[10px]" />Ersatzstunde
                                  </span>
                                )}
                              </span>
                              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
                                style={{ background: badge.bg, color: badge.fg }}>
                                {badge.label}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}

                {removing === e.course_id ? (
                  <div className="bg-yoga-red-bg rounded-yoga p-3 border border-yoga-red-text/20">
                    <p className="text-sm font-bold text-yoga-red-text mb-2">Wirklich austragen?</p>
                    <p className="text-xs text-yoga-red-text/80 mb-3">Der Yogi wird aus dem Kurs ausgetragen und alle zugehörigen Credits werden gelöscht.</p>
                    <div className="flex gap-2">
                      <button onClick={() => setRemoving(null)}
                        className="flex-1 text-sm py-2 rounded-yoga border-0 cursor-pointer bg-yoga-gray text-yoga-text font-semibold">
                        Abbrechen
                      </button>
                      <button onClick={() => removeFromCourse(e.id, e.course_id)}
                        className="flex-1 text-sm font-bold py-2 rounded-yoga border-0 cursor-pointer"
                        style={{ background: '#6b2a2a', color: 'white' }}>
                        Ja, austragen
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <button onClick={() => setRemoving(e.course_id)}
                      className="w-full text-sm text-yoga-red-text bg-yoga-red-bg border-0 rounded-yoga py-2 cursor-pointer font-semibold hover:opacity-80">
                      Aus Kurs austragen
                    </button>
                    {/* Welle G (2026-05-25): Krankheits-Austragung mit Guthaben.
                        Eigener Pfad, da Yogi Reststunden ab Attest-Datum als
                        Guthaben (10 Mo gueltig) bekommt — nicht wie bei der
                        regulaeren Austragung, wo Credits geloescht werden. */}
                    <button onClick={() => {
                      setCancelIllnessFor({
                        courseId: e.course_id,
                        courseName: e.course?.name || '',
                        enrollmentId: e.id,
                      })
                      setAttestDate(new Date().toISOString().split('T')[0])
                      setAttestConfirmed(false)
                    }}
                      className="w-full text-xs text-yoga-amber-text bg-yoga-amber-bg border border-yoga-amber-text/30 rounded-yoga py-2 cursor-pointer font-semibold hover:opacity-80">
                      <i className="ti ti-medical-cross mr-1" /> Wegen Krankheit austragen
                    </button>
                  </div>
                )}
              </div>
              )
            })}
          </>
          )
        })()}

        {/* Eingebuchte Einzelstunden — alle zukünftigen active type='single' bookings.
            Sarah-Wunsch 2026-05-22: Admin braucht den Überblick auch wenn Yogi nicht
            (mehr) im Kurs ist (z.B. nach Kursabbruch noch in Drop-In Einzelstunden). */}
        {(() => {
          // Sarah-Regel 2026-05-22 (final):
          // "Eingebuchte Einzelstunden" = ALLE active future bookings deren Session
          // NICHT in einem aktiv-enrolled Kurs des Yogi liegt. Egal welcher
          // booking.type oder Credit. (Drop-In, Vorhol/Nachhol, Tenpack — alles
          // gleich.) Buchungen im eigenen Kurs gehören in den Kurs-Block.
          // Zusätzliche Filter:
          // - nur ZUKÜNFTIGE Stunden (Datum+Uhrzeit vs. now, minutengenau)
          // - Session selbst nicht abgesagt
          // - Kurs nicht abgebrochen oder archiviert
          const now = Date.now()
          const enrolledCourseIds = new Set(
            enrollments
              .filter((e: any) => e.course?.is_active !== false && e.course?.is_cancelled !== true)
              .map((e: any) => e.course_id)
          )
          const futureSingles = bookings.filter((b: any) => {
            if (b.status !== 'active') return false
            if (!b.session?.date || !b.session?.time_start) return false
            // Session im eigenen aktiv-enrolled Kurs → gehört in den Kurs-Block, nicht hier
            if (b.session?.course_id && enrolledCourseIds.has(b.session.course_id)) return false
            const sessDt = new Date(`${b.session.date}T${b.session.time_start}`).getTime()
            if (sessDt <= now) return false  // bereits gestartet/vorbei
            if (b.session?.is_cancelled) return false  // Stunde abgesagt
            const c = b.session?.course
            if (c && (c.is_active === false || c.is_cancelled === true)) return false  // Kurs abgebrochen/archiviert
            return true
          }).sort((a: any, b: any) => {
            const aKey = `${a.session?.date}T${a.session?.time_start}`
            const bKey = `${b.session?.date}T${b.session?.time_start}`
            return aKey.localeCompare(bKey)
          })
          if (futureSingles.length === 0) return null
          // Welle 3 (Sarah 2026-05-26): Sektions-Header differenziert wenn auch
          // Events drin sind — die landen aktuell mit b.type='single' im selben
          // Topf, gehoeren aber semantisch zu "Events".
          const hasEvents = futureSingles.some((b: any) =>
            b.session?.session_type === 'event_free' || b.session?.session_type === 'event_paid')
          const hasSingles = futureSingles.some((b: any) =>
            !b.session?.session_type || b.session.session_type === 'single' || b.session.session_type === 'course_session')
          const sectionHeader = hasEvents && hasSingles ? 'Eingebuchte Einzelstunden & Events'
            : hasEvents ? 'Eingebuchte Events'
            : 'Eingebuchte Einzelstunden'
          return (
            <>
              <p className="section-label">{sectionHeader}</p>
              {futureSingles.map((b: any) => (
                <button key={b.id} onClick={() => router.push(`/admin/sessions/${b.session.id}`)}
                  className="w-full card mb-2 flex items-center gap-2.5 text-left hover:border-yoga-border2 cursor-pointer">
                  {/* Sarah-Wunsch 2026-05-24: Wochentag vorne groß (analog Yogi-Ansicht) */}
                  <div className="text-center flex-shrink-0 w-12">
                    <div className="text-base font-bold">
                      {new Date(b.session.date).toLocaleDateString('de-DE', { weekday: 'short' })}
                    </div>
                    <div className="text-xs text-yoga-text/50 mt-0.5">
                      {new Date(b.session.date).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                  <div className="w-px h-8 bg-yoga-border2 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    {/* Welle 2.7: zentraler Helper */}
                    <div className="text-sm font-semibold truncate">
                      {sessionDisplayName(b.session)}
                    </div>
                    <div className="text-xs text-yoga-text/45">{b.session.time_start?.slice(0,5)} · Einzelstunde · {b.session?.duration_min || 75} min</div>
                  </div>
                  <i className="ti ti-chevron-right text-sm text-yoga-text/30 flex-shrink-0" />
                </button>
              ))}
            </>
          )
        })()}

        {/* Credits verwalten ist nach OBEN gewandert (siehe renderCreditsManageSection
            vor dem return; gerendert zwischen Action-Buttons und "Eingebuchte Kurse").
            Sarah-Wunsch 2026-05-26. */}

        {/* Yogi-Account-Loesch-Button ist Sarah-Wunsch 2026-05-26 ans ENDE der
            Seite gewandert (nach Letzte Buchungen + Protokoll). */}

        {/* Buchungshistorie */}
        {bookings.length > 0 && (
          <>
            <p className="section-label mt-2">Letzte Buchungen</p>
            {/* Sarah-Wunsch 2026-05-25: ZULETZT passiertes Event ganz oben — also
                sortieren nach "last activity": cancelled_at falls vorhanden, sonst
                created_at. So steht eine Abmeldung über einer früheren Einbuchung. */}
            {[...bookings].sort((a: any, b: any) => {
              const ta = new Date(a.cancelled_at || a.created_at || 0).getTime()
              const tb = new Date(b.cancelled_at || b.created_at || 0).getTime()
              return tb - ta
            }).slice(0, 10).map(b => (
              <div key={b.id} className="card mb-2 flex items-center gap-2.5">
                {/* Sarah-Wunsch 2026-05-24: Wochentag vorne groß (analog Yogi-Ansicht) */}
                <div className="text-center flex-shrink-0 w-12">
                  <div className="text-base font-bold">
                    {b.session?.date ? new Date(b.session.date).toLocaleDateString('de-DE', { weekday: 'short' }) : '—'}
                  </div>
                  <div className="text-xs text-yoga-text/50 mt-0.5">
                    {b.session?.date ? new Date(b.session.date).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }) : ''}
                  </div>
                </div>
                <div className="w-px h-8 bg-yoga-border2 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  {/* Welle 2.6: SYS-Container-Name unterdrücken */}
                  <div className="text-sm font-semibold truncate">
                    {sessionDisplayName(b.session)}
                  </div>
                  <div className="text-xs text-yoga-text/40">{b.session?.time_start?.slice(0,5)} · {(() => {
                    // Welle 3 (Sarah 2026-05-26): differenziert nach session.session_type,
                    // damit event_free/event_paid Buchungen nicht als "Einzelstunde" erscheinen.
                    const st = b.session?.session_type
                    if (st === 'event_free') return 'Event · Kostenlos'
                    if (st === 'event_paid') return `Event${b.session?.price_eur ? ` · ${b.session.price_eur} €` : ''}`
                    if (st === 'single' || b.type === 'single') return 'Einzelstunde'
                    return 'Kursstunde'
                  })()}</div>
                </div>
                {getStatusBadge(b)}
              </div>
            ))}
          </>
        )}

        {/* Yogi-Protokoll — Sarah-Wunsch 2026-05-26: yogi-bezogene Historie als
            aufklappbares Element. Lädt audit_log gefiltert auf 24 Monate
            (DSGVO-Aufbewahrungsfrist gem. AGB § 13). Anders als die globale
            Protokoll-Tab im Admin-Menü zeigt das hier nur Eintraege die DIESEN
            Yogi betreffen — mit lesbaren Texten zum Nachvollziehen. */}
        <div className="mt-6">
          <button onClick={() => setAuditOpen(o => !o)}
            className="w-full flex items-center justify-between text-sm font-semibold py-3 px-4 bg-yoga-card border border-yoga-border rounded-yoga cursor-pointer hover:opacity-80">
            <span>
              <i className="ti ti-history mr-1.5" />
              Protokoll {auditLog.length > 0 && <span className="text-yoga-text/50 font-normal">({auditLog.length})</span>}
            </span>
            <i className={`ti ${auditOpen ? 'ti-chevron-up' : 'ti-chevron-down'} text-yoga-text/60`} />
          </button>
          {auditOpen && (
            <div className="mt-2">
              <p className="text-xs text-yoga-text/50 mb-2 px-1">
                Letzte 24 Monate · gemäß Datenschutzerklärung § 9d werden Einträge nach max. 24 Monaten automatisch gelöscht (cron <code className="text-[10px]">delete_old_audit_logs</code>).
              </p>
              {auditLog.length === 0 ? (
                <p className="text-sm text-yoga-text/40 text-center py-4">Keine Einträge</p>
              ) : (
                auditLog.map((entry: any) => {
                  const fm = formatAuditEntry(entry)
                  const dt = new Date(entry.created_at)
                  return (
                    <div key={entry.id} className="card mb-1.5 py-2.5">
                      <div className="flex items-start gap-2.5">
                        <div className="text-xs text-yoga-text/50 flex-shrink-0 w-20 leading-tight">
                          {dt.toLocaleDateString('de-DE', { day:'numeric', month:'short' })}
                          <br/>
                          <span className="text-yoga-text/35">{dt.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' })}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm">{fm.text}</div>
                          {fm.subject && (
                            <div className="text-xs text-yoga-text/55 mt-0.5">{fm.subject}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* Yogi-Account DSGVO-konform löschen — Sarah-Wunsch 2026-05-26: ans
            ENDE der Seite, damit der gefährliche Button nicht über dem
            Protokoll steht. Alle Plätze (Bookings, Enrollments, Credits,
            Waitlist) werden sofort frei; PII anonymisiert, Auth-User
            gelöscht, Compliance-Audit bleibt. */}
        <div className="mt-6 pt-4 border-t border-yoga-border">
          <button onClick={handleDeleteYogi}
            className="w-full text-sm text-yoga-red-text py-3 border border-yoga-red-bg rounded-yoga cursor-pointer hover:opacity-80 font-semibold">
            <i className="ti ti-trash mr-1" /> Yogi-Account löschen (DSGVO-konform)
          </button>
        </div>
      </div>

      {/* Welle G (2026-05-25): Modal Krankheits-Austragung mit Guthaben. */}
      {cancelIllnessFor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => { if (!illnessSubmitting) { setCancelIllnessFor(null); setAttestConfirmed(false) } }}>
          <div className="bg-yoga-bg w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
            onClick={ev => ev.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-base font-bold">Wegen Krankheit austragen</p>
                <p className="text-xs text-yoga-text/60 mt-0.5">{cancelIllnessFor.courseName}</p>
              </div>
              {!illnessSubmitting && (
                <button onClick={() => { setCancelIllnessFor(null); setAttestConfirmed(false) }}
                  className="text-yoga-text/40 bg-transparent border-0 cursor-pointer text-xl leading-none">×</button>
              )}
            </div>

            <div className="mb-3">
              <label className="text-xs font-semibold text-yoga-text/70 block mb-1">
                Ab welchem Datum gilt das Attest?
              </label>
              <input type="date" value={attestDate}
                onChange={ev => setAttestDate(ev.target.value)}
                className="field-input w-full" />
            </div>

            {illnessPreview && (
              <div className="card mb-3" style={{ background: '#e8ede6', borderColor: 'rgba(58,90,48,0.2)' }}>
                <p className="text-sm font-bold mb-1" style={{ color: '#3a5a30' }}>
                  Es werden {illnessPreview.hoursCredited} {illnessPreview.hoursCredited === 1 ? 'Reststunde' : 'Reststunden'} gutgeschrieben
                </p>
                {illnessPreview.sessions.length > 0 && (
                  <p className="text-xs mb-1" style={{ color: '#3a5a30', opacity: 0.85 }}>
                    Termine:{' '}
                    {illnessPreview.sessions.slice(0, 5).map(s =>
                      new Date(s.date).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
                    ).join(', ')}
                    {illnessPreview.sessions.length > 5 && ` … (+${illnessPreview.sessions.length - 5} weitere)`}
                  </p>
                )}
                <p className="text-xs" style={{ color: '#3a5a30', opacity: 0.85 }}>
                  Guthaben gültig 10 Monate.
                </p>
                {illnessPreview.vorholCount > 0 && (
                  <p className="text-xs mt-2 text-yoga-amber-text">
                    {illnessPreview.vorholCount} offene Vorhol-/Nachholbuchung{illnessPreview.vorholCount === 1 ? ' wird' : 'en werden'} storniert und verfallen ersatzlos.
                  </p>
                )}
              </div>
            )}

            {illnessPreview && illnessPreview.hoursCredited < 4 && illnessPreview.hoursCredited > 0 && (
              <div className="card mb-3" style={{ background: 'var(--yoga-amber-bg)', borderColor: 'var(--yoga-amber-text)' }}>
                <p className="text-xs font-semibold text-yoga-amber-text">
                  Achtung: weniger als 4 Stunden — AGB sieht 4-Stunden-Mindestgrenze vor. Trotzdem ausführen?
                </p>
              </div>
            )}

            <label className="flex items-start gap-2 mb-4 cursor-pointer">
              <input type="checkbox" checked={attestConfirmed}
                onChange={ev => setAttestConfirmed(ev.target.checked)}
                className="mt-0.5" />
              <span className="text-sm text-yoga-text">
                Yogi hat Attest vorgelegt (ich habe es gesehen)
              </span>
            </label>

            <div className="flex gap-2">
              <button onClick={() => { setCancelIllnessFor(null); setAttestConfirmed(false) }}
                disabled={illnessSubmitting}
                className="flex-1 btn-ghost text-sm py-2.5">
                Abbrechen
              </button>
              <button onClick={() => cancelEnrollmentDueToIllness(cancelIllnessFor.courseId, attestDate)}
                disabled={!attestConfirmed || illnessSubmitting || !illnessPreview}
                className={`flex-1 text-sm font-bold py-2.5 rounded-yoga border-0 cursor-pointer ${(!attestConfirmed || illnessSubmitting || !illnessPreview) ? 'opacity-40 cursor-not-allowed' : ''}`}
                style={{ background: '#8a6020', color: 'white' }}>
                {illnessSubmitting ? 'Wird verarbeitet…' : 'Austragen + Guthaben vergeben'}
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav isAdmin />
    </div>
  )
}
