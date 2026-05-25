'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Email } from '@/lib/email'
import { isActive, isStarted, countActiveFutureUnits, isExcluded } from '@/lib/session-status'
import { promoteWaitlistOrOfferLate } from '@/lib/waitlist-promote'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

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
    const [{ data: y }, { data: b }, { data: c }, { data: e }, { data: courseList }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', id).single(),
      supabase.from('bookings')
        .select('*, session:sessions!bookings_session_id_fkey(id, date, time_start, duration_min, is_cancelled, replacement_session_id, course_id, course:courses(name, is_active, is_cancelled))')
        .eq('user_id', id).order('created_at', { ascending: false }),
      supabase.from('credits').select('*, course:courses(name)').eq('user_id', id).order('created_at', { ascending: false }),
      supabase.from('enrollments').select('*, course:courses(*, sessions(id, date, time_start, is_cancelled, cancel_reason, replacement_session_id, course_id))').eq('user_id', id),
      supabase.from('courses').select('*, sessions(date, is_cancelled, cancel_reason), enrollments(id)').eq('is_active', true).order('name'),
    ])
    setYogi(y); setBookings(b || []); setCredits(c || [])
    setEnrollments(e || []); setCourses(courseList || [])
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
  const freeCredits = credits.reduce((sum, c) => {
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

    // 4. Auth-User löschen → Sessions invalidiert, profile cascadet weg
    //    (audit_log user_id wird SET NULL — Compliance-Spur bleibt erhalten)
    try {
      const deleteRes = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id })
      })
      if (!deleteRes.ok) {
        const err = await deleteRes.json().catch(() => ({}))
        console.error('Delete account failed (non-critical):', err)
      }
    } catch (e) {
      console.error('Delete account error:', e)
    }

    // 5. Audit-Log: anonymer Lösch-Vorgang (für Compliance-Trail)
    await supabase.from('audit_log').insert({
      action: 'yogi_anonymized_dsgvo',
      details: { anonymized_user_id: id }
    })

    // Email an Sarah: PDF im Drive manuell entfernen
    const { data: { session: sess } } = await supabase.auth.getSession()
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sess?.access_token}` },
      body: JSON.stringify({ type: 'admin_dsgvo_deletion', data: { fullName, email } })
    }).catch(() => {})

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
      const fromN = parseInt(enrollFromUnit)
      const untilN = parseInt(enrollUntilUnit)
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

      const { data: credit } = await supabase.from('credits').insert({
        user_id: id, course_id: selectedCourseId, model: 'course',
        total: rangeCount, used: 0, expires_at: expiry.toISOString(),
      }).select().single()

      for (const s of targetSessions) {
        const { data: existing } = await supabase.from('bookings')
          .select('id').eq('session_id', s.id).eq('user_id', id).maybeSingle()
        if (existing) {
          await supabase.from('bookings').update({
            status: 'active', credit_id: credit?.id || null,
            cancelled_at: null, cancel_late: false, type: 'course',
          }).eq('id', existing.id)
        } else {
          await supabase.from('bookings').insert({
            user_id: id, session_id: s.id,
            credit_id: credit?.id || null, type: 'course', status: 'active',
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

  async function removeFromCourse(enrollmentId: string, courseId: string) {
    // Nur Kurs-Credits löschen (nach course_id) – Punktekarte IMMER behalten
    const { data: sessions } = await supabase.from('sessions').select('id').eq('course_id', courseId)
    const sessionIds = (sessions || []).map((s: any) => s.id)

    if (sessionIds.length > 0) {
      await supabase.from('bookings').update({
        status: 'cancelled', cancelled_at: new Date().toISOString()
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
    await supabase.from('credits').delete().eq('id', creditId)
    await supabase.from('audit_log').insert({
      action: 'credit_deleted',
      details: { target_user_id: id, credit_id: creditId }
    })
    loadData()
  }

  // "Teilgenommen" ab Stundenstart — Logik aus lib/session-status.ts
  function getStatusBadge(b: any) {
    if (b.status === 'cancelled') return <span className="badge badge-left">Ausgetragen</span>
    if (isStarted(b.session)) return <span className="badge badge-done">Teilgenommen </span>
    return <span className="badge badge-enrolled">Angemeldet</span>
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>
  if (!yogi) return null

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
            <span className="badge bg-yoga-amber-bg text-yoga-amber-text mb-2 inline-block">
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

        <div className="grid grid-cols-2 gap-2 mb-4">
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
                        const f = parseInt(enrollFromUnit), u = parseInt(enrollUntilUnit)
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

        {/* Eingebuchte Kurse — NUR aktive (nicht archivierte/abgesagte) Kurse.
            Archivierte Kurse verschwinden hier; ihre Credits bleiben aber im
            Credits-Block sichtbar bis sie ablaufen. */}
        {(() => {
          const activeEnrollments = enrollments.filter((e: any) =>
            e.course?.is_active !== false && e.course?.is_cancelled !== true
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
                            badge = { label: 'Abgemeldet', bg: '#f0eded', fg: '#7a6a6a' }
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
                  <button onClick={() => setRemoving(e.course_id)}
                    className="w-full text-sm text-yoga-red-text bg-yoga-red-bg border-0 rounded-yoga py-2 cursor-pointer font-semibold hover:opacity-80">
                    Aus Kurs austragen
                  </button>
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
          return (
            <>
              <p className="section-label">Eingebuchte Einzelstunden</p>
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
                    <div className="text-sm font-semibold truncate">{b.session?.course?.name || '—'}</div>
                    <div className="text-xs text-yoga-text/45">{b.session.time_start?.slice(0,5)} · Einzelstunde · {b.session?.duration_min || 75} min</div>
                  </div>
                  <i className="ti ti-chevron-right text-sm text-yoga-text/30 flex-shrink-0" />
                </button>
              ))}
            </>
          )
        })()}

        {/* Credits */}
        {/* Sichtbare Credits: course-credits IMMER (zeigen Fortschritt + Verfallsdatum),
            andere Modelle nur wenn noch Guthaben übrig ist. Verbrauchte Guthaben (0/0)
            werden ausgeblendet — konsistent zur /meine-Ansicht. */}
        {(() => {
          const visibleCredits = credits.filter((c: any) =>
            c.model === 'course' || Math.max(0, c.total - c.used) > 0
          )
          if (visibleCredits.length === 0) return null
          return (
          <>
            <p className="section-label mt-2">Credits verwalten</p>
            {visibleCredits.map(c => {
              const free = computeFree(c)
              const isExpired = new Date(c.expires_at) < new Date()
              return (
                <div key={c.id} className={`card mb-2 ${isExpired ? 'opacity-50' : ''}`}>
                  {editingCredit?.id === c.id && c.model === 'tenpack' ? (
                    <div>
                      <p className="text-sm font-semibold mb-2">Credits anpassen</p>
                      <p className="text-xs text-yoga-text/50 mb-2">Bereits verbraucht: {c.used}</p>
                      <div className="flex items-center gap-2 mb-2">
                        <label className="text-xs text-yoga-text/60">Neue Gesamtzahl:</label>
                        <input type="number" min={c.used} max={100} value={editCreditAmount}
                          onChange={e => setEditCreditAmount(parseInt(e.target.value))}
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
                            : `${free} von ${c.total} Credits frei`}
                        </div>
                        <div className="text-xs text-yoga-text/50 mt-0.5">
                          {c.model === 'course' ? `Credits aus Kurs: ${c.course?.name || '—'}` : c.model === 'guthaben' ? 'Guthaben aus Kursabbruch' : c.model === 'single' ? 'Credits aus Punktekarte' : c.model === 'tenpack' ? 'Punktekarte' : 'Quartal'} ·
                          {isExpired ? ' Abgelaufen' : ` verfällt ${new Date(c.expires_at).getFullYear() > 2090 ? 'nie' : new Date(c.expires_at).toLocaleDateString('de-DE')}`}
                        </div>
                        {c.model === 'course' && (
                          <div className="text-xs text-yoga-text/30 mt-0.5">Nur Lesezugriff</div>
                        )}
                        {c.model === 'guthaben' && (
                          <div className="text-xs text-yoga-text/30 mt-0.5">Löschbar (für Auszahlung)</div>
                        )}
                      </div>
                      {c.model === 'tenpack' && (
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
                        // Sarah-Wunsch 2026-05-23: Guthaben löschbar für den Fall
                        // "Yogi will nach 8 Tagen doch Geld zurück statt Guthaben"
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
        })()}

        {/* Yogi-Account DSGVO-konform löschen. Sarah-Wunsch 2026-05-23 v6:
            Alle Plätze (Bookings, Enrollments, Credits, Waitlist) sofort frei.
            PII anonymisiert, Auth-User gelöscht, Compliance-Audit bleibt. */}
        <div className="mt-6 pt-4 border-t border-yoga-border">
          <button onClick={handleDeleteYogi}
            className="w-full text-sm text-yoga-red-text py-3 border border-yoga-red-bg rounded-yoga cursor-pointer hover:opacity-80 font-semibold">
            <i className="ti ti-trash mr-1" /> Yogi-Account löschen (DSGVO-konform)
          </button>
        </div>

        {/* Buchungshistorie */}
        {bookings.length > 0 && (
          <>
            <p className="section-label mt-2">Letzte Buchungen</p>
            {bookings.slice(0, 10).map(b => (
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
                  <div className="text-sm font-semibold truncate">{b.session?.course?.name}</div>
                  <div className="text-xs text-yoga-text/40">{b.session?.time_start?.slice(0,5)} · {b.type === 'single' ? 'Einzelstunde' : 'Kursstunde'}</div>
                </div>
                {getStatusBadge(b)}
              </div>
            ))}
          </>
        )}
      </div>
      <BottomNav isAdmin />
    </div>
  )
}
