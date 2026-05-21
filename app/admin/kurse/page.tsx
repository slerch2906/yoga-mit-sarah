'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Email } from '@/lib/email'
import { createClient } from '@/lib/supabase/client'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

const WEEKDAYS = ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag']
const WEEKDAY_TO_JS: Record<string, number> = {
  'Montag':1,'Dienstag':2,'Mittwoch':3,'Donnerstag':4,'Freitag':5,'Samstag':6,'Sonntag':0
}

function toISODate(d: string): string {
  if (!d) return ''
  // Deutsches Format TT.MM.JJJJ → YYYY-MM-DD
  if (d.includes('.')) {
    const [day, month, year] = d.split('.')
    return `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`
  }
  return d
}

function formatDate(d: string): string {
  const iso = toISODate(d)
  if (!iso) return ''
  const date = new Date(iso + 'T00:00:00')
  if (isNaN(date.getTime())) return ''
  return date.toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'long' })
}

function getDatesForCourse(weekday: string, dateStart: string, dateEnd: string, maxUnits: number, excludedDates: string[]): string[] {
  const dates: string[] = []
  const end = new Date(dateEnd)
  const targetDay = WEEKDAY_TO_JS[weekday]
  let current = new Date(dateStart)
  while (current.getDay() !== targetDay) current.setDate(current.getDate() + 1)
  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0]
    if (!excludedDates.includes(dateStr)) dates.push(dateStr)
    current.setDate(current.getDate() + 7)
  }
  return dates
}

const emptyForm = {
  name: '', weekday: 'Montag', time_start: '18:00',
  duration_min: 75, location: '', description: '',
  bring_along: '', difficulty: 'Alle Level',
  max_spots: 12, total_units: 10,
  date_start: '', date_end: '', is_single: false
}

export default function AdminKursePage() {
  const [courses, setCourses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null)
  const [folgekursCourse, setFolgekursCourse] = useState<any>(null)
  const [cancellingCourse, setCancellingCourse] = useState<any>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelRefundMode, setCancelRefundMode] = useState<'all_refund'|'yogi_choice'|null>(null)
  const [doingCancelCourse, setDoingCancelCourse] = useState(false)
  const [folgekursStep, setFolgekursStep] = useState<'dates'|'members'>('dates')
  const [folgekursDateStart, setFolgekursDateStart] = useState('')
  const [folgekursDateEnd, setFolgekursDateEnd] = useState('')
  const [folgekursMembers, setFolgekursMembers] = useState<any[]>([])
  const [folgekursSelected, setFolgekursSelected] = useState<Set<string>>(new Set())
  const [folgekursLoading, setFolgekursLoading] = useState(false)
  const [folgekursExcluded, setFolgekursExcluded] = useState<string[]>([])
  const [folgekursForm, setFolgekursForm] = useState<any>(null)
  // Keep old names for backward compat during transition
  const rolloverCourse = folgekursCourse
  const rolloverMembers = folgekursMembers
  const rolloverSelected = folgekursSelected
  const rolloverLoading = folgekursLoading
  const [courseSessions, setCourseSessions] = useState<Record<string, any[]>>({})
  const [participantsCourse, setParticipantsCourse] = useState<any>(null)
  const [showAddYogiModal, setShowAddYogiModal] = useState(false)
  const [addYogiSearch, setAddYogiSearch] = useState('')
  const [addYogiResults, setAddYogiResults] = useState<any[]>([])
  const [addingYogiToCourse, setAddingYogiToCourse] = useState(false)
  const [participants, setParticipants] = useState<any[]>([])
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [editCourse, setEditCourse] = useState<any>(null)
  const [excludedDates, setExcludedDates] = useState<string[]>([])
  const [existingSessionDates, setExistingSessionDates] = useState<string[]>([])
  const [newExclude, setNewExclude] = useState('')
  const [previewDates, setPreviewDates] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    if (form.date_start && form.date_end && !form.is_single) {
      const dates = getDatesForCourse(form.weekday, form.date_start, form.date_end, 999, excludedDates)
      setPreviewDates(dates)
      // Beim Anlegen immer berechnen; beim Bearbeiten nur wenn keine Teilnehmer vorhanden
      const courseHasEnrollments = editCourse && (editCourse.enrollments?.length || 0) > 0
      if (!courseHasEnrollments) {
        setForm(f => ({ ...f, total_units: dates.length }))
      }
    }
  }, [form.weekday, form.date_start, form.date_end, excludedDates, form.is_single, editCourse])

  async function loadData() {
    const { data } = await supabase.from('courses').select('*, sessions(date, is_cancelled, cancel_reason), enrollments(id)').order('date_start', { ascending: true })
    setCourses(data || [])
    setLoading(false)
  }

  function addExcludedDate(dateStr?: string) {
    const raw = dateStr || newExclude
    const d = toISODate(raw)
    if (d && !excludedDates.includes(d)) {
      setExcludedDates([...excludedDates, d].sort())
      if (!dateStr) setNewExclude('')
    }
  }

  function removeExcludedDate(d: string) {
    setExcludedDates(excludedDates.filter(x => x !== d))
  }

  async function startEdit(course: any) {
    // Lade bestehende Sessions
    const { data: sessions } = await supabase.from('sessions')
      .select('id, date, is_cancelled, cancel_reason').eq('course_id', course.id).order('date')
    
    const allDates = (sessions || []).map((s: any) => s.date)
    const cancelledDates = (sessions || []).filter((s: any) => s.is_cancelled).map((s: any) => s.date)
    
    setEditCourse(course)
    setExistingSessionDates(allDates)
    setExcludedDates(cancelledDates)
    setForm({
      name: course.name, weekday: course.weekday,
      time_start: course.time_start?.slice(0,5) || '18:00',
      duration_min: course.duration_min, location: course.location || '',
      description: course.description || '', bring_along: course.bring_along || '',
      difficulty: course.difficulty || 'Alle Level', max_spots: course.max_spots,
      total_units: course.total_units, date_start: course.date_start,
      date_end: course.date_end, is_single: course.is_single,
    })
    setShowForm(true)
  }

  function resetForm() {
    setShowForm(false); setEditCourse(null)
    setExcludedDates([]); setExistingSessionDates([])
    setPreviewDates([]); setForm(emptyForm)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    const courseData = {
      name: form.name, weekday: form.weekday,
      time_start: form.time_start + ':00',
      duration_min: form.duration_min, location: form.location,
      description: form.description, bring_along: form.bring_along,
      difficulty: form.difficulty, max_spots: form.max_spots,
      total_units: form.total_units,
      date_start: form.date_start,
      date_end: form.date_end || form.date_start,
      is_single: form.is_single, is_active: true,
    }

    if (editCourse) {
      // Prüfen ob User im Kurs sind (mit Profile-Daten für evtl. Email)
      const { data: enrollments } = await supabase
        .from('enrollments')
        .select('id, user_id, profile:profiles(email, first_name, is_dummy)')
        .eq('course_id', editCourse.id)

      if (enrollments && enrollments.length > 0) {
        const oldTime = editCourse.time_start
        const timeChanged = oldTime !== courseData.time_start
        
        // User im Kurs → Metadaten + Uhrzeit/Dauer aktualisieren
        await supabase.from('courses').update({
          name: courseData.name,
          location: courseData.location,
          description: courseData.description,
          bring_along: courseData.bring_along,
          difficulty: courseData.difficulty,
          max_spots: courseData.max_spots,
          duration_min: courseData.duration_min,
          time_start: courseData.time_start,
        }).eq('id', editCourse.id)
        // Zukünftige Sessions: Uhrzeit + Dauer aktualisieren
        const today = new Date().toISOString().split('T')[0]
        await supabase.from('sessions').update({
          time_start: courseData.time_start,
          duration_min: courseData.duration_min,
        }).eq('course_id', editCourse.id).gte('date', today).eq('is_cancelled', false)
        // Recalculate total_units from non-cancelled sessions
        const { count: activeCount } = await supabase.from('sessions')
          .select('id', { count: 'exact', head: true })
          .eq('course_id', editCourse.id).eq('is_cancelled', false)
        if (activeCount !== null) {
          await supabase.from('courses').update({ total_units: activeCount }).eq('id', editCourse.id)
        }
        
        // Bei Uhrzeit-Änderung: Email an alle Teilnehmer
        if (timeChanged) {
          for (const enr of (enrollments || [])) {
            const prof = (enr as any).profile
            if (!prof?.email || prof.is_dummy) continue
            await Email.courseTimeChanged({
              email: prof.email,
              firstName: prof.first_name || 'Yogi',
              courseName: courseData.name,
              oldTime: oldTime || '',
              newTime: courseData.time_start || '',
            })
          }
        }
      } else {
        // Keine User → vollständige Neuberechnung
        await supabase.from('courses').update(courseData).eq('id', editCourse.id)

        // Alle alten Sessions löschen
        await supabase.from('sessions').delete().eq('course_id', editCourse.id)

        // Sessions neu berechnen: alle möglichen Termine im Zeitraum
        const allCourseDates = form.is_single
          ? [form.date_start]
          : getDatesForCourse(form.weekday, form.date_start, form.date_end, 9999, [])

        if (allCourseDates.length > 0) {
          await supabase.from('sessions').insert(
            allCourseDates.map(date => ({
              course_id: editCourse.id, date,
              time_start: form.time_start + ':00',
              duration_min: form.duration_min,
              is_cancelled: excludedDates.includes(date),
            }))
          )
        }
        // B1: total_units = aktive Sessions (nicht abgesagte)
        const activeUnits = allCourseDates.filter(d => !excludedDates.includes(d)).length
        await supabase.from('courses').update({ total_units: activeUnits }).eq('id', editCourse.id)
      }
    } else {
      // Neuer Kurs
      const { data: course, error } = await supabase.from('courses')
        .insert(courseData).select().single()

      if (error || !course) {
        alert('Fehler: ' + error?.message)
        setSaving(false); return
      }

      // Alle Termine speichern (aktive + ausgeschlossene als is_cancelled)
      const allCourseDates = form.is_single
        ? [form.date_start]
        : getDatesForCourse(form.weekday, form.date_start, form.date_end, 999, [])
      if (allCourseDates.length > 0) {
        const { error: sessError } = await supabase.from('sessions').insert(
          allCourseDates.map(date => ({
            course_id: course.id, date,
            time_start: form.time_start + ':00',
            duration_min: form.duration_min,
            is_cancelled: excludedDates.includes(date),
            cancel_reason: excludedDates.includes(date) ? 'excluded' : null,
          }))
        )
        if (sessError) alert('Kurs angelegt aber Sessions-Fehler: ' + sessError.message)
      }
    }

    await loadData()
    setSaving(false)
    if (!editCourse) {
      resetForm()
    } else {
      // Bei Bearbeitung: kurz Erfolg zeigen, dann schließen
      setSaveSuccess(true)
      setTimeout(() => { setSaveSuccess(false); resetForm() }, 1500)
    }
  }

  async function toggleOpen(id: string, currentlyOpen: boolean) {
    await supabase.from('courses').update({ is_open: !currentlyOpen }).eq('id', id)
    loadData()
  }

  async function loadSessions(courseId: string) {
    // Toggle: wenn bereits expanded → einklappen
    if (expandedCourse === courseId) { setExpandedCourse(null); return }
    if (!courseSessions[courseId]) {
      // cancel_reason MUSS mitgeladen werden, sonst kann UI nicht zwischen
      // "Ausgeschlossen" und "Abgesagt" unterscheiden.
      const { data } = await supabase.from('sessions')
        .select('id, date, time_start, is_cancelled, cancel_reason')
        .eq('course_id', courseId).order('date')
      setCourseSessions(prev => ({ ...prev, [courseId]: data || [] }))
    }
    setExpandedCourse(courseId)
  }

  async function cancelCourse() {
    if (!cancellingCourse || !cancelReason || !cancelRefundMode) return
    setDoingCancelCourse(true)

    const today = new Date().toISOString().split('T')[0]

    // 1) Zukünftige Sessions abbrechen
    const { data: futureSessions } = await supabase.from('sessions')
      .select('id').eq('course_id', cancellingCourse.id)
      .gte('date', today).eq('is_cancelled', false)
    for (const s of (futureSessions || [])) {
      await supabase.from('sessions').update({
        is_cancelled: true, cancel_reason: cancelReason
      }).eq('id', s.id)
    }
    const remainingCount = (futureSessions || []).length

    // 2) Kurs als abgebrochen markieren
    await supabase.from('courses').update({
      is_cancelled: true, is_active: false,
      cancel_reason: cancelReason,
      cancelled_at: new Date().toISOString(),
    }).eq('id', cancellingCourse.id)

    // 3) Enrollments laden
    const { data: enrollments } = await supabase.from('enrollments')
      .select('user_id, profile:profiles(id, first_name, last_name, email, is_dummy)')
      .eq('course_id', cancellingCourse.id)

    // 4) Pro Yogi: aufräumen + Token + Email
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)
    const appUrl = 'https://kurse.yogamitsarah.me'
    for (const enroll of (enrollments || [])) {
      const prof = enroll.profile as any
      if (!prof) continue

      // Alle Bookings dieses Yogis in zukünftigen Sessions stornieren
      const futureSessionIds = (futureSessions || []).map((s: any) => s.id)
      if (futureSessionIds.length > 0) {
        await supabase.from('bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .eq('user_id', prof.id).in('session_id', futureSessionIds)
      }

      // Credits löschen (FK erst entkoppeln)
      const { data: yogiCredits } = await supabase.from('credits')
        .select('id').eq('user_id', prof.id).eq('course_id', cancellingCourse.id)
      if (yogiCredits && yogiCredits.length > 0) {
        const cIds = yogiCredits.map((cc: any) => cc.id)
        await supabase.from('bookings').update({ credit_id: null })
          .eq('user_id', prof.id).in('credit_id', cIds)
        await supabase.from('credits').delete()
          .eq('user_id', prof.id).eq('course_id', cancellingCourse.id)
      }

      // Enrollment löschen → verschwindet aus "Meine"
      await supabase.from('enrollments').delete()
        .eq('user_id', prof.id).eq('course_id', cancellingCourse.id)

      // Dummy: fertig, kein Token/Email
      if (prof.is_dummy) continue

      // Token anlegen
      const token = crypto.randomUUID().replace(/-/g, '')
      await supabase.from('course_cancellation_responses').insert({
        course_id: cancellingCourse.id,
        user_id: prof.id,
        token,
        expires_at: expiresAt.toISOString(),
        remaining_sessions: remainingCount,
      })

      // Email senden (via lib/email.ts mit korrektem x-function-secret Header)
      if (prof.email) {
        await Email.courseCancelled({
          email: prof.email,
          firstName: prof.first_name || 'Yogi',
          courseName: cancellingCourse.name,
          reason: cancelReason,
          remainingSessions: remainingCount,
          refundMode: cancelRefundMode!,
          guthabenUrl: cancelRefundMode === 'yogi_choice' ? `${appUrl}/kursabbruch/${token}` : null,
        })
      }
    }

    // Admin-Übersicht per Mail (nur bei all_refund)
    if (cancelRefundMode === 'all_refund') {
      const yogiList = (enrollments || [])
        .filter((e: any) => !e.profile?.is_dummy && e.profile?.email)
        .map((e: any) => ({
          firstName: e.profile.first_name || '',
          lastName: e.profile.last_name || '',
          email: e.profile.email,
        }))
      await Email.adminCourseCancelledSummary({
        courseName: cancellingCourse.name,
        reason: cancelReason,
        remainingSessions: remainingCount,
        yogis: yogiList,
      })
    }

    await supabase.from('audit_log').insert({
      action: 'course_cancelled',
      details: { course_id: cancellingCourse.id, course_name: cancellingCourse.name, reason: cancelReason, refund_mode: cancelRefundMode, remaining_sessions: remainingCount }
    })

    setCancellingCourse(null); setCancelReason(''); setCancelRefundMode(null)
    setDoingCancelCourse(false); loadData()
    alert(`Kurs abgebrochen. ${(enrollments || []).filter((e:any) => !e.profile?.is_dummy).length} Yogis wurden informiert.`)
  }

  async function archiveCourse(courseObj: any) {
    // Prüfen ob Kurs noch aktive Termine in der Zukunft hat
    const today = new Date().toISOString().split('T')[0]
    const futureSessions = (courseObj.sessions || []).filter((s: any) => s.date >= today)
    if (futureSessions.length > 0) {
      alert(`Dieser Kurs hat noch ${futureSessions.length} zukünftige Termine und kann nicht archiviert werden. Erst nach dem letzten Termin möglich.`)
      return
    }
    if (!confirm('Kurs archivieren?')) return
    await supabase.from('courses').update({ is_active: false }).eq('id', courseObj.id)
    loadData()
  }

  async function deleteCourse(courseId: string, name: string) {
    if (!confirm(`Kurs "${name}" wirklich komplett löschen? Alle Sessions, Buchungen und Enrollments werden ebenfalls gelöscht. Das kann nicht rückgängig gemacht werden!`)) return

    // Betroffene Yogis laden und informieren
    const { data: sessions } = await supabase.from('sessions').select('id').eq('course_id', courseId)
    const sessionIds = (sessions || []).map((s: any) => s.id)

    if (sessionIds.length > 0) {
      // Alle aktiven Buchungen holen und Emails senden
      const { data: activeBookings } = await supabase.from('bookings')
        .select('*, profile:profiles(email, first_name)')
        .in('session_id', sessionIds).eq('status', 'active')

      const notifiedUsers = new Set<string>()
      for (const b of activeBookings || []) {
        if (b.profile?.email && !notifiedUsers.has(b.profile.email)) {
          notifiedUsers.add(b.profile.email)
          await Email.sessionCancelled({
            email: b.profile.email,
            firstName: b.profile.first_name || 'Yogi',
            courseName: name,
            date: new Date().toISOString().split('T')[0],
            timeStart: '00:00',
            reason: `Der Kurs "${name}" wurde gelöscht.`,
          })
        }
      }

      await supabase.from('bookings').delete().in('session_id', sessionIds)
      await supabase.from('waitlist').delete().in('session_id', sessionIds)
      await supabase.from('sessions').delete().eq('course_id', courseId)
    }
    await supabase.from('enrollments').delete().eq('course_id', courseId)
    await supabase.from('credits').delete().eq('course_id', courseId)
    await supabase.from('invitations').delete().eq('course_id', courseId)
    await supabase.from('courses').delete().eq('id', courseId)
    loadData()
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>

  // Rollover: 3 Wochen vor Kursende = anzeigen
  function getCourseStatus(course: any): string {
    if (course.is_cancelled) return 'abgebrochen'
    const today = new Date().toISOString().split('T')[0]
    if (!course.is_active) return 'beendet'
    if (course.date_start > today) return 'geplant'
    if (course.date_end < today) return 'beendet'
    return 'läuft'
  }

  function showRolloverButton(course: any): boolean {
    if (!course.date_end || course.is_single) return false
    const end = new Date(course.date_end)
    const now = new Date()
    const diff = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    return diff <= 21 && diff >= -14 // 3 Wochen vorher bis 2 Wochen nach Ende
  }

  async function searchYogisForCourse(q: string) {
    setAddYogiSearch(q)
    if (q.length < 2) { setAddYogiResults([]); return }
    const { data } = await supabase.from('profiles')
      .select('id, first_name, last_name, email, is_dummy, credits(*)')
      .eq('is_admin', false)
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(8)
    // Filter already enrolled
    const enrolledIds = participants.map((p: any) => p.id)
    setAddYogiResults((data || []).filter((y: any) => !enrolledIds.includes(y.id)))
  }

  async function addYogiToCourse(yogi: any) {
    if (!participantsCourse) return
    setAddingYogiToCourse(true)
    const course = participantsCourse

    // Sessions laden (sortiert)
    const { data: futureSessions } = await supabase.from('sessions')
      .select('id, date').eq('course_id', course.id)
      .gte('date', new Date().toISOString().split('T')[0]).eq('is_cancelled', false)
      .order('date')
    const sessionList = futureSessions || []
    const sessionCount = sessionList.length
    const expiresAt = new Date(course.date_end || new Date())
    expiresAt.setDate(expiresAt.getDate() + 8)

    // Enrollment anlegen
    await supabase.from('enrollments').upsert({ user_id: yogi.id, course_id: course.id, enrolled_from_unit: 1 })

    // Verfügbares Guthaben (auto-verrechnen)
    const nowIso = new Date().toISOString()
    const { data: guthabenCredits } = await supabase.from('credits')
      .select('*').eq('user_id', yogi.id).eq('model', 'guthaben')
      .gt('expires_at', nowIso).order('expires_at')
    const availableGuthaben = (guthabenCredits || []).filter((g: any) => (g.total - g.used) > 0)
    const totalGuthaben = availableGuthaben.reduce((s: number, g: any) => s + (g.total - g.used), 0)
    const guthabenUsable = Math.min(totalGuthaben, sessionCount)
    const newCreditsNeeded = sessionCount - guthabenUsable

    // Course-Credit nur für nicht durch Guthaben gedeckte Stunden anlegen
    let newCourseCreditId: string | null = null
    if (newCreditsNeeded > 0) {
      const { data: cc } = await supabase.from('credits').insert({
        user_id: yogi.id, course_id: course.id, model: 'course',
        total: newCreditsNeeded, used: 0, expires_at: expiresAt.toISOString(),
      }).select().single()
      newCourseCreditId = cc?.id || null
    }

    // Pro Session den richtigen Credit zuordnen (Guthaben zuerst)
    const creditPerSession: (string | null)[] = []
    const guthabenRemaining = availableGuthaben.map((g: any) => ({ id: g.id, free: g.total - g.used }))
    for (let i = 0; i < sessionList.length; i++) {
      let assigned: string | null = null
      for (const g of guthabenRemaining) {
        if (g.free > 0) { assigned = g.id; g.free -= 1; break }
      }
      creditPerSession.push(assigned || newCourseCreditId)
    }

    // Bookings reaktivieren / anlegen (mit credit_id-Link)
    for (let i = 0; i < sessionList.length; i++) {
      const s = sessionList[i]
      const creditId = creditPerSession[i]
      const { data: ex } = await supabase.from('bookings').select('id')
        .eq('user_id', yogi.id).eq('session_id', s.id).maybeSingle()
      if (ex) {
        await supabase.from('bookings').update({
          status: 'active', credit_id: creditId,
          cancelled_at: null, cancel_late: false, type: 'course',
        }).eq('id', ex.id)
      } else {
        await supabase.from('bookings').insert({
          user_id: yogi.id, session_id: s.id,
          credit_id: creditId, type: 'course', status: 'active',
        })
      }
    }

    // Admin-Info wenn Guthaben verrechnet
    if (guthabenUsable > 0) {
      try {
        await Email.adminGuthabenVerrechnet({
          yogiName: `${yogi.first_name || ''} ${yogi.last_name || ''}`.trim(),
          yogiEmail: yogi.email || '',
          courseName: course.name,
          guthabenAmount: guthabenUsable,
        })
      } catch(e) {}
    }

    // Yogi-Email
    if (yogi.email && !yogi.is_dummy) {
      try {
        await Email.yogiEnrolledByAdmin({
          email: yogi.email,
          firstName: yogi.first_name || 'Yogi',
          courseName: course.name,
          weekday: course.weekday,
          timeStart: course.time_start,
          durationMin: course.duration_min || 75,
          totalUnits: sessionCount,
          dateStart: course.date_start,
        })
      } catch(e) {}
    }

    await supabase.from('audit_log').insert({
      action: 'yogi_enrolled_by_admin',
      details: {
        target_user_id: yogi.id, course_id: course.id,
        credits: sessionCount,
        guthaben_verrechnet: guthabenUsable,
        neue_credits: newCreditsNeeded,
      },
    })

    setAddingYogiToCourse(false)
    setShowAddYogiModal(false)
    setAddYogiSearch('')
    setAddYogiResults([])
    if (guthabenUsable > 0) {
      alert(`✓ Einbuchung erfolgt.\n${guthabenUsable} Stunde${guthabenUsable === 1 ? '' : 'n'} mit Guthaben verrechnet.${newCreditsNeeded > 0 ? `\n${newCreditsNeeded} neue Credits angelegt.` : ''}`)
    }
    loadParticipants(course)
  }

  async function loadParticipants(course: any) {
    const { data } = await supabase
      .from('enrollments')
      .select('user_id, enrolled_from_unit, enrolled_until_unit, profile:profiles(id, first_name, last_name, email, is_dummy), credits(total, used, expires_at, course_id)')
      .eq('course_id', course.id)
    const members = (data || []).map((e: any) => ({
      ...e.profile,
      enrolled_from_unit: e.enrolled_from_unit,
      enrolled_until_unit: e.enrolled_until_unit,
      credit: (e.credits || []).find((c: any) => c.course_id === course.id),
    })).filter(Boolean)
    setParticipants(members)
    setParticipantsCourse(course)
  }

  async function loadFolgekursMembers(courseId: string) {
    const { data } = await supabase
      .from('enrollments')
      .select('user_id, profile:profiles(id, first_name, last_name, email)')
      .eq('course_id', courseId)
    const members = (data || []).map((e: any) => e.profile).filter(Boolean)
    setFolgekursMembers(members)
    setFolgekursSelected(new Set(members.map((m: any) => m.id)))
  }

  async function doFolgekurs() {
    if (!folgekursCourse || !folgekursDateStart || !folgekursDateEnd || !folgekursForm) return
    setFolgekursLoading(true)

    // Alle Termine (inkl. Ausnahmen) - Ausnahmen als is_cancelled anlegen
    const allDates = getDatesForCourse(
      folgekursForm.weekday, folgekursDateStart, folgekursDateEnd, 999, []
    )
    const activeDates = allDates.filter(d => !folgekursExcluded.includes(d))

    // 1) Neuen Kurs anlegen (aus Form-Daten)
    const { data: newCourse } = await supabase.from('courses').insert({
      name: folgekursForm.name,
      weekday: folgekursForm.weekday,
      time_start: folgekursForm.time_start,
      duration_min: folgekursForm.duration_min,
      location: folgekursForm.location,
      description: folgekursForm.description,
      bring_along: folgekursForm.bring_along,
      difficulty: folgekursForm.difficulty,
      max_spots: folgekursForm.max_spots,
      total_units: activeDates.length,
      date_start: folgekursDateStart,
      date_end: folgekursDateEnd,
      is_active: true,
      is_single: false,
    }).select('*').single()
    if (!newCourse) { setFolgekursLoading(false); return }

    // 2) ALLE Sessions anlegen – Ausnahmen als is_cancelled: true
    for (const date of allDates) {
      await supabase.from('sessions').insert({
        course_id: newCourse.id, date,
        time_start: folgekursForm.time_start,
        duration_min: folgekursForm.duration_min,
        is_cancelled: folgekursExcluded.includes(date),
        cancel_reason: folgekursExcluded.includes(date) ? 'excluded' : null,
      })
    }

    // 3) Sessions des neuen Kurses laden – nur aktive (keine ausgeschlossenen)
    const { data: futureSessions } = await supabase
      .from('sessions').select('id').eq('course_id', newCourse.id)
      .eq('is_cancelled', false)
    const sessionIds = (futureSessions || []).map((s: any) => s.id)
    const targetCourse = newCourse
    const credits = activeDates.length  // nur aktive Sessions, keine ausgeschlossenen

    for (const userId of folgekursSelected) {
      const member = folgekursMembers.find((m: any) => m.id === userId)
      if (!member) continue

      // Enrollment anlegen
      const { data: existingEnroll } = await supabase
        .from('enrollments')
        .select('id')
        .eq('user_id', userId)
        .eq('course_id', newCourse.id)
        .maybeSingle()

      if (!existingEnroll) {
        await supabase.from('enrollments').insert({
          user_id: userId, course_id: newCourse.id, enrolled_from_unit: 1
        })
      }

      // Credits vergeben
      const expiresAt = new Date(targetCourse.date_end)
      expiresAt.setDate(expiresAt.getDate() + 8)
      await supabase.from('credits').insert({
        user_id: userId, course_id: newCourse.id,
        model: 'course', total: credits, used: 0,
        expires_at: expiresAt.toISOString()
      })

      // Sessions buchen
      for (const sessionId of sessionIds) {
        const { data: existing } = await supabase.from('bookings')
          .select('id').eq('user_id', userId).eq('session_id', sessionId).maybeSingle()
        if (!existing) {
          await supabase.from('bookings').insert({
            user_id: userId, session_id: sessionId,
            type: 'course', status: 'active'
          })
        }
      }

      // Email senden
      if (member.email) {
        await Email.yogiEnrolledByAdmin({
          email: member.email,
          firstName: member.first_name || 'Yogi',
          courseName: targetCourse.name,
          weekday: targetCourse.weekday,
          timeStart: targetCourse.time_start,
          durationMin: targetCourse.duration_min || 75,
          totalUnits: credits,
          dateStart: targetCourse.date_start,
        })
      }
    }

    await supabase.from('audit_log').insert({
      action: 'course_rollover',
      details: {
        aktion: `Folgekurs angelegt: ${folgekursCourse.name} → ${targetCourse.name}`,
        von_kurs_name: folgekursCourse.name,
        von_kurs_id: folgekursCourse.id,
        folgekurs_name: targetCourse.name,
        folgekurs_id: targetCourse.id,
        anzahl_teilnehmer: folgekursSelected.size,
        anzahl_aktive_sessions: activeDates.length,
        datum_start: folgekursDateStart,
        datum_ende: folgekursDateEnd,
      }
    })

    setFolgekursCourse(null)
    setFolgekursDateStart('')
    setFolgekursDateEnd('')
    setFolgekursExcluded([])
    setFolgekursForm(null)
    setFolgekursMembers([])
    setFolgekursSelected(new Set())
    setFolgekursStep('dates')
    setFolgekursLoading(false)
    alert(`Folgekurs "${targetCourse.name}" angelegt! ${folgekursSelected.size} Yogi(s) eingebucht.`)
    loadData()
  }

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Kurse verwalten" isAdmin />
      <div className="px-4 py-4">
        {!showForm ? (
          <>
            <button onClick={() => setShowForm(true)} className="btn-primary mb-4">
              <i className="ti ti-plus mr-1" /> Neuen Kurs anlegen
            </button>
            <p className="section-label">Aktive Kurse</p>
            {courses.filter(c => c.is_active).length === 0 && (
              <p className="text-sm text-yoga-text/40 text-center py-4">Noch keine Kurse</p>
            )}
            {courses.filter(c => c.is_active).map(c => (
              <div key={c.id} className="card mb-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <div className="text-base font-bold">{c.name}</div>
                      {(() => {
                        const st = getCourseStatus(c)
                        const styles: Record<string,string> = {
                          'läuft': 'bg-yoga-green-bg text-yoga-green-text',
                          'geplant': 'bg-yoga-amber-bg text-yoga-amber-text',
                          'beendet': 'bg-yoga-gray text-yoga-text/50',
                          'abgebrochen': 'bg-yoga-red-bg text-yoga-red-text',
                        }
                        return <span className={`text-xs rounded-full px-2 py-0.5 font-semibold ${styles[st] || ''}`}>{st}</span>
                      })()}
                    </div>
                    <div className="text-sm text-yoga-text/50">
                      {c.weekday} · {c.time_start?.slice(0,5)} Uhr · {c.total_units} Einheiten
                    </div>
                    <div className="text-sm font-semibold text-yoga-text/60">
                      {new Date(c.date_start).toLocaleDateString('de-DE')} – {new Date(c.date_end).toLocaleDateString('de-DE')}
                    </div>
                    <div className="text-sm text-yoga-text/60 mt-0.5">
                       Teilnehmer: <strong>{(c.enrollments || []).length}</strong>{c.max_spots ? `/${c.max_spots}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {getCourseStatus(c) === 'beendet' && (
                      <span className="badge" style={{background:'var(--yoga-red-bg)', color:'var(--yoga-red-text)'}}>
                        Beendet
                      </span>
                    )}
                    {getCourseStatus(c) === 'läuft' && !c.is_single && (
                      <span className="badge" style={{background:'var(--yoga-green-bg)', color:'var(--yoga-green-text)'}}>
                        Läuft
                      </span>
                    )}
                    <span className={`badge ${c.is_single ? 'badge-wait' : 'badge-free'}`}>
                      {c.is_single ? 'Einzelstunde' : 'Kurs'}
                    </span>
                    {/* is_open badge bleibt als Info */}
                  {!c.is_open && (
                    <button onClick={() => toggleOpen(c.id, c.is_open)}
                      className="badge bg-yoga-amber-bg text-yoga-amber-text border-0 cursor-pointer hover:opacity-80"
                      title="Klicken zum Freigeben">
                      <i className="ti ti-lock text-xs mr-0.5" />Gesperrt
                    </button>
                  )}
                  {c.is_open && (
                    <button onClick={() => toggleOpen(c.id, c.is_open)}
                      className="badge bg-yoga-green-bg text-yoga-green-text border-0 cursor-pointer hover:opacity-80"
                      title="Klicken zum Sperren">
                      <i className="ti ti-lock-open text-xs mr-0.5" />Frei
                    </button>
                  )}
                  </div>
                </div>
                {/* Hauptaktionen */}
                <div className="flex gap-2 mt-2">
                  <button onClick={() => startEdit(c)}
                    className="flex-1 text-sm border border-yoga-border2 rounded-full py-2 font-semibold hover:opacity-80 cursor-pointer">
                    <i className="ti ti-edit mr-1" />Bearbeiten
                  </button>
                  <button onClick={() => loadSessions(c.id)}
                    className="flex-1 text-sm border border-yoga-border2 rounded-full py-2 font-semibold hover:opacity-80 cursor-pointer text-yoga-text/70">
                    <i className="ti ti-calendar-event mr-1" />Termine
                  </button>
                  <button onClick={() => loadParticipants(c)}
                    className="flex-1 text-sm border border-yoga-border2 rounded-full py-2 font-semibold hover:opacity-80 cursor-pointer text-yoga-text/70">
                    <i className="ti ti-users mr-1" />Teilnehmer
                  </button>
                </div>
                {showRolloverButton(c) && (
                  <button onClick={async () => {
                    setFolgekursCourse(c)
                    setFolgekursStep('dates')
                    setFolgekursDateStart('')
                    setFolgekursDateEnd('')
                    setFolgekursExcluded([])
                    setFolgekursForm({
                      name: c.name,
                      weekday: c.weekday,
                      time_start: c.time_start,
                      duration_min: c.duration_min,
                      location: c.location,
                      description: c.description,
                      bring_along: c.bring_along,
                      difficulty: c.difficulty,
                      max_spots: c.max_spots,
                      total_units: c.total_units,
                    })
                    await loadFolgekursMembers(c.id)
                  }}
                    className="w-full mt-2 text-sm bg-yoga-green-bg text-yoga-green-text rounded-full py-2 font-semibold hover:opacity-80 border-0 cursor-pointer">
                    <i className="ti ti-arrows-transfer-down mr-1" />Folgekurs anlegen
                  </button>
                )}
                {/* Kurs abbrechen + Archivieren in einer Reihe, grau */}
                <div className="flex gap-2 mt-2">
                  {(c.enrollments || []).length > 0 && (
                    <button onClick={() => { setCancellingCourse(c); setCancelReason(''); setCancelRefundMode(null) }}
                      className="flex-1 text-xs text-yoga-text/50 border border-yoga-border rounded-full py-1.5 font-semibold border-0 cursor-pointer hover:opacity-80"
                      style={{ background: 'var(--yoga-gray)' }}>
                      <i className="ti ti-ban mr-1" />Abbrechen
                    </button>
                  )}
                  <button onClick={() => archiveCourse(c)}
                    className="flex-1 text-xs text-yoga-text/50 rounded-full py-1.5 font-semibold hover:opacity-80 cursor-pointer border-0"
                    style={{ background: 'var(--yoga-gray)' }}>
                    <i className="ti ti-archive mr-1" />Archivieren
                  </button>
                </div>
                {expandedCourse === c.id && courseSessions[c.id] && (
                  <div className="mt-2">
                    {courseSessions[c.id].map(s => (
                      <button key={s.id} onClick={() => router.push(`/admin/sessions/${s.id}`)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-yoga mb-1 text-left cursor-pointer border-0 hover:opacity-80 ${s.is_cancelled ? 'opacity-40' : ''}`}
                        style={{ background: 'var(--yoga-bg)' }}>
                        <span className="text-sm">
                          {new Date(s.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })}
                          {' · '}{s.time_start?.slice(0,5)} Uhr
                          {s.is_cancelled && (s.cancel_reason === 'excluded' ? ' · Ausgeschlossen' : ' · Abgesagt')}
                        </span>
                        <i className="ti ti-chevron-right text-yoga-text/30" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {courses.filter(c => !c.is_active).length > 0 && (
              <>
                <p className="section-label mt-4">Archivierte Kurse</p>
                {courses.filter(c => !c.is_active).map(c => (
                  <div key={c.id} className="card mb-2 opacity-70 relative">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold">{c.name}</div>
                        <div className="text-xs text-yoga-text/50">{c.weekday} · {c.time_start?.slice(0,5)} Uhr</div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          // Kurs reaktivieren + zukünftige Sessions reaktivieren
                          await supabase.from('courses').update({ is_active: true, is_cancelled: false }).eq('id', c.id)
                          const today = new Date().toISOString().split('T')[0]
                          await supabase.from('sessions').update({ is_cancelled: false })
                            .eq('course_id', c.id).gte('date', today)
                          loadData()
                        }}
                          className="text-xs bg-yoga-bg text-yoga-text border border-yoga-border2 rounded-full px-3 py-1.5 font-semibold cursor-pointer hover:opacity-80">
                          <i className="ti ti-refresh mr-1" />Reaktivieren
                        </button>
                        <button onClick={() => deleteCourse(c.id, c.name)}
                          className="text-xs bg-yoga-red-bg text-yoga-red-text rounded-full px-3 py-1.5 font-semibold border-0 cursor-pointer hover:opacity-80">
                          <i className="ti ti-trash mr-1" />Löschen
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        ) : (
          <>
            <button onClick={resetForm} className="flex items-center gap-1 text-sm text-yoga-text/60 mb-4 hover:opacity-80">
              <i className="ti ti-arrow-left" /> Zurück zur Kursübersicht
            </button>
            <h2 className="text-lg font-bold mb-4">{editCourse ? 'Kurs bearbeiten' : 'Neuer Kurs'}</h2>
            {editCourse && courses.find((c: any) => c.id === editCourse.id)?.enrollments?.length > 0 && (
              <div className="bg-yoga-amber-bg border border-yoga-amber-text/30 rounded-yoga p-3 mb-4">
                <p className="text-sm font-semibold text-yoga-amber-text">
                  <i className="ti ti-info-circle mr-1" />Kurs hat Teilnehmer
                </p>
                <p className="text-xs text-yoga-amber-text/80 mt-1">
                  Du kannst Name, Ort, Beschreibung, Uhrzeit und Dauer ändern. Wochentag und Datum bleiben unverändert.
                </p>
              </div>
            )}
            <form key={editCourse?.id || "new"} onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="field-label">Kursname *</label>
                <input className="field-input" value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})} required />
              </div>
              <label className="flex items-center gap-3 card cursor-pointer" onClick={() => setForm({...form, is_single: !form.is_single})}>
                <input type="checkbox" checked={form.is_single} readOnly className="w-5 h-5" />
                <span className="text-sm">Einzelne Ersatzstunde</span>
              </label>
              {!form.is_single && (
                <div>
                  <label className="field-label">Wochentag *</label>
                  <select className="field-input" value={form.weekday}
                    onChange={e => setForm({...form, weekday: e.target.value})}>
                    {WEEKDAYS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Uhrzeit *</label>
                  <input className="field-input" type="time" value={form.time_start}
                    onChange={e => setForm({...form, time_start: e.target.value})} required />
                </div>
                <div>
                  <label className="field-label">Dauer (Min.)</label>
                  <input className="field-input" type="number" value={form.duration_min}
                    onChange={e => setForm({...form, duration_min: parseInt(e.target.value)})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">{form.is_single ? 'Datum *' : 'Startdatum *'}</label>
                  <input className="field-input" type="date" value={form.date_start}
                    onChange={e => setForm({...form, date_start: e.target.value})} required />
                </div>
                {!form.is_single && (
                  <div>
                    <label className="field-label">Enddatum *</label>
                    <input className="field-input" type="date" value={form.date_end}
                      onChange={e => setForm({...form, date_end: e.target.value})} required />
                  </div>
                )}
              </div>

              {!form.is_single && (
                <div>
                  <label className="field-label">Anzahl Einheiten (wird automatisch berechnet)</label>
                  <input className="field-input bg-yoga-gray" type="number" value={form.total_units} readOnly
                    style={{ cursor: 'default', opacity: 0.7 }} />
                  {previewDates.length > 0 && (
                    <p className="text-xs text-yoga-text/50 mt-1">
                      {previewDates.length} Termine berechnet aus Start/Enddatum und Ausnahmen
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="field-label">Max. Teilnehmer</label>
                <input className="field-input" type="number" min={1} max={50} value={form.max_spots}
                  onChange={e => setForm({...form, max_spots: parseInt(e.target.value)})} />
              </div>
              <div>
                <label className="field-label">Ort</label>
                <input className="field-input" value={form.location}
                  onChange={e => setForm({...form, location: e.target.value})} />
              </div>
              <div>
                <label className="field-label">Beschreibung</label>
                <textarea className="field-input" rows={3} value={form.description}
                  onChange={e => setForm({...form, description: e.target.value})} />
              </div>
              <div>
                <label className="field-label">Was mitbringen?</label>
                <input className="field-input" value={form.bring_along}
                  onChange={e => setForm({...form, bring_along: e.target.value})}
                  placeholder="z.B. Matte, bequeme Kleidung" />
              </div>
              <div>
                <label className="field-label">Schwierigkeitsgrad</label>
                <select className="field-input" value={form.difficulty}
                  onChange={e => setForm({...form, difficulty: e.target.value})}>
                  {['Alle Level', 'Beginner', 'Geübte'].map(d => <option key={d}>{d}</option>)}
                </select>
              </div>

              {/* Termine – beim Anlegen UND Bearbeiten direkt in Liste klickbar */}
              {!form.is_single && (
                <div>
                  {/* Neuer Kurs: alle berechneten Termine mit Ein/Ausschließen */}
                  {!editCourse && previewDates.length > 0 && (() => {
                    const allDates = getDatesForCourse(form.weekday, form.date_start, form.date_end, 999, [])
                    return (
                      <div>
                        <p className="text-xs text-yoga-text/50 font-semibold mb-2">
                          TERMINE ({previewDates.length} aktiv von {allDates.length}):
                        </p>
                        <div className="bg-yoga-card border border-yoga-border rounded-yoga p-3 max-h-56 overflow-y-auto">
                          {allDates.map((d, i) => {
                            const isExcluded = excludedDates.includes(d)
                            return (
                              <div key={d} className={`flex items-center justify-between py-1.5 ${isExcluded ? 'opacity-50' : ''}`}>
                                <p className={`text-sm ${isExcluded ? 'line-through text-yoga-text/40' : 'text-yoga-text/80'}`}>
                                  {i+1}. {formatDate(d)}
                                </p>
                                <button type="button"
                                  onClick={() => isExcluded ? removeExcludedDate(d) : addExcludedDate(d)}
                                  className={`text-xs px-2 py-0.5 rounded-full border-0 cursor-pointer font-semibold ml-2 flex-shrink-0 ${isExcluded ? 'bg-yoga-green-bg text-yoga-green-text' : 'bg-yoga-red-bg text-yoga-red-text'}`}>
                                  {isExcluded ? 'Einschließen' : 'Ausschließen'}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Bestehende Termine beim Bearbeiten */}
                  {!!editCourse && (() => {
                    const hasEnrollments = courses.find((cc: any) => cc.id === editCourse.id)?.enrollments?.length > 0
                    return (
                      <div key={editCourse?.id}>
                        <p className="text-xs text-yoga-text/50 font-semibold mb-2">
                          TERMINE ({existingSessionDates.filter(d => !excludedDates.includes(d)).length} aktiv
                          {excludedDates.length > 0 ? `, ${excludedDates.length} abgesagt` : ''}):
                        </p>
                        {hasEnrollments && (
                          <div className="bg-yoga-amber-bg border border-yoga-amber-text/20 rounded-yoga p-2 mb-2">
                            <p className="text-xs text-yoga-amber-text">
                              <i className="ti ti-info-circle mr-1" />
                              Kurs hat Teilnehmer – Stunden über „Termine verwalten" absagen
                            </p>
                          </div>
                        )}
                        {existingSessionDates.length === 0 ? (
                          <p className="text-sm text-yoga-text/40 text-center py-3">Keine Termine vorhanden</p>
                        ) : (
                          <div className="bg-yoga-card border border-yoga-border rounded-yoga p-3 max-h-56 overflow-y-auto">
                            {existingSessionDates.map((d, i) => {
                              const isExcluded = excludedDates.includes(d)
                              return (
                                <div key={d} className={`flex items-center justify-between py-1.5 ${isExcluded ? 'opacity-50' : ''}`}>
                                  <p className={`text-sm ${isExcluded ? 'line-through text-yoga-text/40' : 'text-yoga-text/80'}`}>
                                    {i+1}. {formatDate(d)}
                                    {isExcluded && <span className="text-xs ml-1 text-yoga-text/40"> – ausgeschlossen</span>}
                                  </p>
                                  {/* Ausgeschlossene Sessions immer reaktivierbar, echte Absagen nur ohne Teilnehmer */}
                                  {(isExcluded || !hasEnrollments) && (
                                    <button type="button"
                                      onClick={() => isExcluded ? removeExcludedDate(d) : addExcludedDate(d)}
                                      className={`text-xs px-2 py-0.5 rounded-full border-0 cursor-pointer font-semibold ml-2 flex-shrink-0 ${isExcluded ? 'bg-yoga-green-bg text-yoga-green-text' : 'bg-yoga-amber-bg text-yoga-amber-text'}`}>
                                      {isExcluded ? 'Reaktivieren' : 'Ausschließen'}
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}

              {saveSuccess ? (
                <div className="btn-primary w-full text-center" style={{background:'var(--yoga-green-text)'}}>
                  Gespeichert!
                </div>
              ) : (
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Wird gespeichert...' : editCourse ? 'Änderungen speichern' : 'Kurs anlegen'}
                </button>
              )}
              <button type="button" onClick={resetForm} className="btn-ghost">
                {editCourse ? 'Schließen' : 'Abbrechen'}
              </button>
            </form>
          </>
        )}
      </div>
      {/* Kursabbruch Modal */}
      {cancellingCourse && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setCancellingCourse(null)}>
          <div className="bg-yoga-card w-full rounded-t-2xl p-5 pb-10 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-yoga-red-text"> Kurs abbrechen</h3>
              <button onClick={() => setCancellingCourse(null)} className="bg-transparent border-0 cursor-pointer text-yoga-text/40">
                <i className="ti ti-x text-xl" />
              </button>
            </div>
            <p className="text-sm text-yoga-text/60 mb-4">
              <strong>{cancellingCourse.name}</strong><br />
              Alle zukünftigen Stunden werden abgesagt. Alle Teilnehmer werden per Email informiert.
            </p>

            <label className="field-label">Grund (erscheint in der Email)</label>
            <textarea className="field-input mb-4" rows={3} placeholder="z.B. Krankheit, persönliche Gründe..."
              value={cancelReason} onChange={e => setCancelReason(e.target.value)} />

            <label className="field-label mb-2">Erstattung</label>
            <div className="space-y-2 mb-5">
              <button onClick={() => setCancelRefundMode('all_refund')}
                className={`w-full text-left p-3 rounded-yoga border-2 cursor-pointer transition-all ${cancelRefundMode === 'all_refund' ? 'border-yoga-text bg-yoga-bg' : 'border-yoga-border bg-transparent'}`}>
                <div className="text-sm font-semibold"> Alle bekommen Geld zurück</div>
                <div className="text-xs text-yoga-text/60 mt-0.5">Email: „Ich melde mich wegen der Erstattung"</div>
              </button>
              <button onClick={() => setCancelRefundMode('yogi_choice')}
                className={`w-full text-left p-3 rounded-yoga border-2 cursor-pointer transition-all ${cancelRefundMode === 'yogi_choice' ? 'border-yoga-text bg-yoga-bg' : 'border-yoga-border bg-transparent'}`}>
                <div className="text-sm font-semibold"> Teilnehmer entscheiden selbst</div>
                <div className="text-xs text-yoga-text/60 mt-0.5">Email mit Auswahl: Guthaben (2 Jahre) oder Geld zurück. 7 Tage Zeit.</div>
              </button>
            </div>

            <button onClick={cancelCourse}
              disabled={doingCancelCourse || !cancelReason.trim() || !cancelRefundMode}
              className="w-full btn-primary disabled:opacity-40 bg-yoga-red-text">
              {doingCancelCourse ? 'Wird abgebrochen...' : 'Kurs abbrechen & Yogis informieren'}
            </button>
          </div>
        </div>
      )}

      {/* Folgekurs anlegen Modal */}
      {folgekursCourse && folgekursForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setFolgekursCourse(null)}>
          <div className="bg-yoga-card w-full rounded-t-2xl p-5 pb-10 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">Folgekurs anlegen</h3>
              <button onClick={() => setFolgekursCourse(null)} className="bg-transparent border-0 cursor-pointer text-yoga-text/40">
                <i className="ti ti-x text-xl" />
              </button>
            </div>
            <p className="text-sm text-yoga-text/60 mb-1">
              Vorlage: <strong>{folgekursCourse.name}</strong>
            </p>
            <div className="bg-yoga-bg rounded-yoga p-3 mb-4 text-xs text-yoga-text/60 space-y-0.5">
              <div>Wochentag: <strong>{folgekursCourse.weekday}</strong></div>
              <div>Uhrzeit: <strong>{folgekursCourse.time_start?.slice(0,5)} Uhr</strong></div>
              <div>Dauer: <strong>{folgekursCourse.duration_min} Min.</strong></div>
              <div>Vorheriger Kurs endet: <strong>{new Date(folgekursCourse.date_end).toLocaleDateString('de-DE', { day:'numeric', month:'long', year:'numeric' })}</strong></div>
            </div>

            {/* Kursdetails */}
            <label className="field-label">Kursname</label>
            <input className="field-input mb-3" value={folgekursForm.name}
              onChange={e => setFolgekursForm((f: any) => ({ ...f, name: e.target.value }))} />

            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="field-label">Startdatum</label>
                <input type="date" className="field-input" value={folgekursDateStart}
                  onChange={e => setFolgekursDateStart(e.target.value)}
                  min={new Date().toISOString().split('T')[0]} />
              </div>
              <div>
                <label className="field-label">Enddatum</label>
                <input type="date" className="field-input" value={folgekursDateEnd}
                  onChange={e => setFolgekursDateEnd(e.target.value)}
                  min={folgekursDateStart || new Date().toISOString().split('T')[0]} />
              </div>
            </div>

            <label className="field-label">Uhrzeit</label>
            <input type="time" className="field-input mb-3" value={folgekursForm.time_start?.slice(0,5)}
              onChange={e => setFolgekursForm((f: any) => ({ ...f, time_start: e.target.value + ':00' }))} />

            <label className="field-label">Ort</label>
            <input className="field-input mb-3" value={folgekursForm.location || ''}
              onChange={e => setFolgekursForm((f: any) => ({ ...f, location: e.target.value }))} />

            <label className="field-label">Max. Teilnehmer</label>
            <input type="number" className="field-input mb-3" value={folgekursForm.max_spots || ''}
              onChange={e => setFolgekursForm((f: any) => ({ ...f, max_spots: parseInt(e.target.value) || null }))} />

            {/* Ausnahmetage */}
            {folgekursDateStart && folgekursDateEnd && (() => {
              const allDates = getDatesForCourse(folgekursForm.weekday, folgekursDateStart, folgekursDateEnd, 999, [])
              if (allDates.length === 0) return null
              return (
                <div className="mb-4">
                  <label className="field-label">Termine ({allDates.length - folgekursExcluded.length} aktiv)</label>
                  <div className="bg-yoga-bg border border-yoga-border rounded-yoga p-3 max-h-48 overflow-y-auto">
                    {allDates.map((d, i) => {
                      const excluded = folgekursExcluded.includes(d)
                      return (
                        <div key={d} className={`flex items-center justify-between py-1 ${excluded ? 'opacity-40' : ''}`}>
                          <span className={`text-sm ${excluded ? 'line-through text-yoga-text/40' : ''}`}>
                            {i+1}. {new Date(d).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short', year:'numeric' })}
                          </span>
                          <button type="button"
                            onClick={() => setFolgekursExcluded(prev => excluded ? prev.filter(x => x !== d) : [...prev, d])}
                            className={`text-xs px-2 py-0.5 rounded-full border-0 cursor-pointer font-semibold ${excluded ? 'bg-yoga-green-bg text-yoga-green-text' : 'bg-yoga-red-bg text-yoga-red-text'}`}>
                            {excluded ? 'Aktivieren' : 'Ausnahme'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* Teilnehmer */}
            <div className="border-t border-yoga-border pt-4 mt-2">
              <p className="text-sm font-semibold mb-2">Wer macht im Folgekurs mit?</p>
              <div className="flex gap-3 mb-3">
                <button onClick={() => setFolgekursSelected(new Set(folgekursMembers.map((m: any) => m.id)))}
                  className="text-xs text-yoga-green-text border-0 bg-transparent cursor-pointer">Alle auswählen</button>
                <button onClick={() => setFolgekursSelected(new Set())}
                  className="text-xs text-yoga-text/40 border-0 bg-transparent cursor-pointer">Alle abwählen</button>
              </div>
              {folgekursMembers.length === 0 && (
                <p className="text-sm text-yoga-text/40 py-2">Keine Teilnehmer im aktuellen Kurs</p>
              )}
              {folgekursMembers.map((m: any) => (
                <div key={m.id} className="flex items-center gap-3 py-2 border-b border-yoga-border cursor-pointer"
                  onClick={() => {
                    const s = new Set(folgekursSelected)
                    s.has(m.id) ? s.delete(m.id) : s.add(m.id)
                    setFolgekursSelected(s)
                  }}>
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0
                    ${folgekursSelected.has(m.id) ? 'bg-yoga-text border-yoga-text' : 'border-yoga-border2'}`}>
                    {folgekursSelected.has(m.id) && <i className="ti ti-check text-yoga-bg text-xs" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{m.first_name} {m.last_name}</p>
                    <p className="text-xs text-yoga-text/50">{m.email || 'Kein Login'}</p>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={doFolgekurs}
              disabled={folgekursLoading || !folgekursDateStart || !folgekursDateEnd || !folgekursForm.name}
              className="btn-primary w-full mt-5 disabled:opacity-40">
              {folgekursLoading ? 'Wird angelegt...' : 'Folgekurs anlegen'}
            </button>
          </div>
        </div>
      )}

      {/* Teilnehmer Modal */}
      {participantsCourse && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setParticipantsCourse(null)}>
          <div className="bg-yoga-card w-full rounded-t-2xl p-5 pb-10 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-bold">Teilnehmer</h3>
              <button onClick={() => setParticipantsCourse(null)} className="bg-transparent border-0 cursor-pointer text-yoga-text/40">
                <i className="ti ti-x text-xl" />
              </button>
            </div>
            <p className="text-sm text-yoga-text/50 mb-3">{participantsCourse.name} · {participants.length} Teilnehmer</p>
            <button onClick={() => { setShowAddYogiModal(true); setAddYogiSearch(''); setAddYogiResults([]) }}
              className="w-full btn-secondary text-sm mb-4 flex items-center justify-center gap-2">
              <i className="ti ti-user-plus" />Yogi hinzufügen
            </button>
            {participants.length === 0 ? (
              <p className="text-sm text-yoga-text/40 text-center py-6">Noch keine Teilnehmer eingeschrieben</p>
            ) : participants.map((p: any) => {
              const creditsLeft = p.credit ? Math.max(0, p.credit.total - p.credit.used) : null
              return (
                <button key={p.id}
                  onClick={() => { setParticipantsCourse(null); router.push(`/admin/yogis/${p.id}`) }}
                  className="w-full flex items-center justify-between py-3 border-b border-yoga-border text-left hover:opacity-70 transition-opacity bg-transparent border-x-0 border-t-0 cursor-pointer">
                  <div>
                    <div className="text-sm font-semibold flex items-center gap-2">
                      {p.first_name} {p.last_name}
                      {p.is_dummy && (
                        <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-normal">Dummy</span>
                      )}
                    </div>
                    <div className="text-xs text-yoga-text/50 mt-0.5">
                      {p.email || 'Kein Login'}
                      {(p.enrolled_from_unit > 1 || p.enrolled_until_unit) && (
                        ` · Einheit ${p.enrolled_from_unit ?? 1}${p.enrolled_until_unit ? `–${p.enrolled_until_unit}` : '+'}`
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                    {creditsLeft !== null && (
                      <div className="text-right">
                        <div className="text-sm font-semibold">{creditsLeft} Credits</div>
                        <div className="text-xs text-yoga-text/40">verbleibend</div>
                      </div>
                    )}
                    <i className="ti ti-chevron-right text-yoga-text/30" />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Yogi zu Kurs hinzufügen Modal */}
      {showAddYogiModal && participantsCourse && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-end" onClick={() => setShowAddYogiModal(false)}>
          <div className="bg-yoga-card w-full rounded-t-2xl p-5 pb-10 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">Yogi zu {participantsCourse.name} hinzufügen</h3>
              <button onClick={() => setShowAddYogiModal(false)} className="bg-transparent border-0 cursor-pointer text-yoga-text/40">
                <i className="ti ti-x text-xl" />
              </button>
            </div>
            <input className="field-input mb-3" placeholder="Name oder E-Mail..." autoFocus
              value={addYogiSearch} onChange={e => searchYogisForCourse(e.target.value)} />
            {addYogiSearch.length >= 2 && addYogiResults.length === 0 && (
              <p className="text-sm text-yoga-text/40 text-center py-3">Kein Yogi gefunden</p>
            )}
            {addYogiResults.map(yogi => {
              const now = new Date()
              const guthaben = (yogi.credits || []).reduce((sum: number, c: any) =>
                c.model === 'guthaben' && new Date(c.expires_at) > now ? sum + Math.max(0, c.total - c.used) : sum, 0)
              return (
                <div key={yogi.id} className="flex items-center justify-between py-3 border-b border-yoga-border">
                  <div>
                    <div className="text-sm font-semibold">
                      {yogi.first_name} {yogi.last_name}
                      {yogi.is_dummy && <span className="ml-2 text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">Dummy</span>}
                    </div>
                    <div className="text-xs text-yoga-text/50">{yogi.email || 'Kein Login'}</div>
                    {guthaben > 0 && (
                      <div className="text-xs text-yoga-amber-text mt-0.5">
                        {guthaben} Guthaben wird beim Hinzufügen verrechnet
                      </div>
                    )}
                  </div>
                  <button onClick={() => addYogiToCourse(yogi)} disabled={addingYogiToCourse}
                    className="text-xs bg-yoga-text text-yoga-bg rounded-full px-3 py-1.5 font-semibold border-0 cursor-pointer disabled:opacity-40">
                    {addingYogiToCourse ? '...' : 'Hinzufügen'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <BottomNav isAdmin />
    </div>
  )
}
