'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Email } from '@/lib/email'
import { isActive, isStarted, countActiveFutureUnits } from '@/lib/session-status'
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
        .select('*, session:sessions(date, time_start, duration_min, course:courses(name))')
        .eq('user_id', id).order('created_at', { ascending: false }).limit(20),
      supabase.from('credits').select('*, course:courses(name)').eq('user_id', id).order('created_at', { ascending: false }),
      supabase.from('enrollments').select('*, course:courses(*)').eq('user_id', id),
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
  function computeFree(c: any) {
    if (c.model === 'course') {
      // WICHTIG: isStarted direkt aus lib verwenden, NICHT sessionEnded-Alias —
      // sonst TDZ-ReferenceError (const wird weiter unten in der Komponente
      // initialisiert, computeFree läuft aber sofort beim ersten Render).
      return bookings.filter(b =>
        b.credit_id === c.id && b.status === 'active' && !isStarted(b.session)
      ).length
    }
    return Math.max(0, c.total - c.used)
  }
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
    if (!confirm(`Account von ${yogi?.first_name} ${yogi?.last_name} DSGVO-konform anonymisieren? Buchungshistorie bleibt anonym erhalten.`)) return
    if (!confirm('Bist du sicher? Diese Aktion kann nicht rückgängig gemacht werden!')) return

    const fullName = `${yogi?.first_name || ''} ${yogi?.last_name || ''}`.trim()
    const email = yogi?.email || ''

    // DSGVO: Anonymisieren statt hart löschen
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

    // Warteliste entfernen
    await supabase.from('waitlist').delete().eq('user_id', id)

    // DSGVO: audit_log Einträge anonymisieren (PII aus details JSONB entfernen)
    await supabase.rpc('anonymize_user_audit_logs', { target_user_id: id }).catch(() => {})

    // Auth User löschen + Sessions invalidieren
    try {
      const deleteRes = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id })
      })
      if (!deleteRes.ok) {
        // Kein Alert - Profil ist anonymisiert, Auth-Löschung ist sekundär
        const err = await deleteRes.json().catch(() => ({}))
        console.error('Delete account failed (non-critical):', err)
      }
    } catch (e) {
      console.error('Delete account error:', e)
    }

    // DSGVO: kein Klartext-Name/Email im audit_log – nur abstrakter Vorgang
    await supabase.from('audit_log').insert({
      action: 'yogi_anonymized_dsgvo',
      details: { anonymized_user_id: id }
    })

    // Email an dich: Drive-PDF löschen
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

    // Prüfen ob Kurs bereits voll
    const { count } = await supabase
      .from('enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('course_id', selectedCourseId)
    // Dummy-User dürfen auch in volle Kurse als Platzhalter
    if (course?.max_spots && (count ?? 0) >= course.max_spots && !yogi?.is_dummy) {
      alert(`Kurs ist bereits voll (max. ${course.max_spots} Teilnehmer).`)
      setEnrolling(false)
      return
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

      // Email mit Range-Info
      try {
        const { data: yProf } = await supabase.from('profiles').select('email, first_name').eq('id', id).single()
        if (yProf?.email && course && !yogi?.is_dummy) {
          await Email.yogiEnrolledByAdmin({
            email: yProf.email, firstName: yProf.first_name || 'Yogi',
            courseName: course.name, weekday: course.weekday, timeStart: course.time_start,
            durationMin: course.duration_min || 75, totalUnits: rangeCount, dateStart: course.date_start,
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
        await Email.yogiEnrolledByAdmin({
          email: yProf.email,
          firstName: yProf.first_name || 'Yogi',
          courseName: course.name || '',
          weekday: course.weekday || '',
          timeStart: course.time_start || '',
          durationMin: course.duration_min || 75,
          totalUnits: actualCount,
          dateStart: course.date_start || undefined,
        })
      }
    } catch(e) {}

    // Email an Admin wenn Guthaben verrechnet wurde
    if (guthabenUsable > 0) {
      try {
        await Email.adminGuthabenVerrechnet({
          yogiName: `${yogi?.first_name || ''} ${yogi?.last_name || ''}`.trim(),
          yogiEmail: yogi?.email || '',
          courseName: course?.name || '',
          guthabenAmount: guthabenUsable,
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

      // Für jede Session: Warteliste + Notify prüfen
      for (const sid of sessionIds) {
        try {
          const { data: sess } = await supabase.from('sessions')
            .select('date, time_start, course:courses(name)').eq('id', sid).single()

          const { data: wFirst } = await supabase.from('waitlist')
            .select('*, profile:profiles(email, first_name)')
            .eq('session_id', sid).eq('type', 'waitlist')
            .order('position').limit(1).single()
          if (wFirst?.profile) {
            await Email.waitlistPromoted({
              email: wFirst.profile.email, firstName: wFirst.profile.first_name || 'Yogi',
              courseName: sess?.course?.name || '', date: sess?.date || '', timeStart: sess?.time_start || '',
            })
            await supabase.from('waitlist').delete().eq('id', wFirst.id)
          }

          const { data: notifyUsers } = await supabase.from('waitlist')
            .select('*, profile:profiles(email, first_name)')
            .eq('session_id', sid).eq('type', 'notify')
          if (notifyUsers?.length) {
            for (const nu of notifyUsers) {
              if (nu.profile) await Email.notifyPlaceFree({
                email: nu.profile.email, firstName: nu.profile.first_name || 'Yogi',
                courseName: sess?.course?.name || '', date: sess?.date || '',
                timeStart: sess?.time_start || '', sessionId: sid,
              })
            }
            await supabase.from('waitlist').delete().eq('session_id', sid).eq('type', 'notify')
          }
        } catch(e) {}
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
          {(yogi.emergency_name || yogi.emergency_phone) && (
            <div className="mt-2 p-2 bg-yoga-amber-bg/40 rounded-yoga border border-yoga-amber-text/20">
              <div className="text-xs text-yoga-text/50 mb-1"> Notfallkontakt</div>
              {yogi.emergency_name && <div className="text-sm font-semibold">{yogi.emergency_name}</div>}
              {yogi.emergency_phone && <div className="text-sm text-yoga-text/70">{yogi.emergency_phone}</div>}
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
                return (
                  <option key={c.id} value={c.id} disabled={!!isFull}>
                    {isFull ? ` ${c.name} (voll – ${enrollCount}/${c.max_spots})` : `${c.name} → ${rem} Credits · ${enrollCount}/${c.max_spots ?? '∞'} Plätze`}
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

        {/* Eingebuchte Kurse */}
        {enrollments.length > 0 && (
          <>
            <p className="section-label">Eingebuchte Kurse</p>
            {enrollments.map(e => (
              <div key={e.id} className="card mb-3">
                <div className="text-base font-bold mb-1">{e.course?.name}</div>
                <div className="text-sm text-yoga-text/50 mb-3">{e.course?.weekday}</div>
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
            ))}
          </>
        )}

        {/* Credits */}
        {credits.length > 0 && (
          <>
            <p className="section-label mt-2">Credits verwalten</p>
            {credits.map(c => {
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
                          {free} von {c.total} Credits frei
                        </div>
                        <div className="text-xs text-yoga-text/50 mt-0.5">
                          {c.model === 'course' ? `Credits aus Kurs: ${c.course?.name || '—'}` : c.model === 'guthaben' ? 'Guthaben aus Kursabbruch' : c.model === 'single' ? 'Credits aus Punktekarte' : c.model === 'tenpack' ? 'Punktekarte' : 'Quartal'} ·
                          {isExpired ? ' Abgelaufen' : ` verfällt ${new Date(c.expires_at).getFullYear() > 2090 ? 'nie' : new Date(c.expires_at).toLocaleDateString('de-DE')}`}
                        </div>
                        {c.model !== 'tenpack' && (
                          <div className="text-xs text-yoga-text/30 mt-0.5">Nur Lesezugriff</div>
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
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}

        {/* Yogi löschen */}
        <div className="mt-6 pt-4 border-t border-yoga-border">
          <button onClick={handleDeleteYogi}
            className="w-full text-sm text-yoga-red-text py-3 border border-yoga-red-bg rounded-yoga cursor-pointer hover:opacity-80 font-semibold">
            <i className="ti ti-trash mr-1" /> Yogi-Account löschen
          </button>
        </div>

        {/* Buchungshistorie */}
        {bookings.length > 0 && (
          <>
            <p className="section-label mt-2">Letzte Buchungen</p>
            {bookings.slice(0, 10).map(b => (
              <div key={b.id} className="card mb-2 flex items-center gap-2.5">
                <div className="flex-shrink-0 w-20">
                  <div className="text-sm font-bold">
                    {b.session?.date ? new Date(b.session.date).toLocaleDateString('de-DE', { day:'numeric', month:'short' }) : '—'}
                  </div>
                  <div className="text-xs text-yoga-text/50">{b.session?.time_start?.slice(0,5)}</div>
                </div>
                <div className="w-px h-6 bg-yoga-border2 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{b.session?.course?.name}</div>
                  <div className="text-xs text-yoga-text/40">{b.type === 'single' ? 'Einzelstunde' : 'Kursstunde'}</div>
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
