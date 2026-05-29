'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Email } from '@/lib/email'
import { promoteWaitlistOrOfferLate } from '@/lib/waitlist-promote'
import { selectCreditForBooking } from '@/lib/credit-selector'
import { escapeForOrFilter } from '@/lib/search-sanitize'
import { isCourseEnded } from '@/lib/session-status'
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
  date_start: '', date_end: '', is_single: false,
  is_free: false, image_url: '',
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
  const [uploadingImage, setUploadingImage] = useState(false)
  const [form, setForm] = useState(emptyForm)
  // Welle 2 (Sarah 2026-05-26): zweite Sektion "Geplante Stunden & Events" mit
  // Sessions der vier SYS-Container. session_type unterscheidet single /
  // event_free / event_paid.
  const [containerSessions, setContainerSessions] = useState<any[]>([])
  const [containerIds, setContainerIds] = useState<{ single: string; eventFree: string; eventCredit: string; eventPaid: string } | null>(null)
  const [showSingleForm, setShowSingleForm] = useState(false)
  const [showEventForm, setShowEventForm] = useState(false)
  // Welle 2.11 (Sarah 2026-05-26): Session-Bearbeiten geht jetzt im Modal
  // (statt /admin/sessions/[id]?edit=1 Seite). Editing-State markiert UPDATE.
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  // Welle 2.11: Teilnehmer-Modal fuer Sessions (analog participantsCourse).
  // Welle 4.6: Teilnehmer-Modal jetzt vollstaendig — Yogi hinzufuegen +
  // Austragen direkt im Modal. /admin/sessions/[id] entfaellt fuer
  // Events/Einzelstunden komplett.
  const [participantsSession, setParticipantsSession] = useState<any>(null)
  const [sessionBookings, setSessionBookings] = useState<any[]>([])
  // Welle 6 (Sarah 2026-05-27, Item 11): Warteliste-Yogis + Notify-Subscriber
  // im Teilnehmer-Modal anzeigen (eigene Sektionen).
  const [sessionWaitlist, setSessionWaitlist] = useState<any[]>([])
  const [showSessionAddYogi, setShowSessionAddYogi] = useState(false)
  const [sessionAddYogiSearch, setSessionAddYogiSearch] = useState('')
  const [sessionAddYogiResults, setSessionAddYogiResults] = useState<any[]>([])
  const [sessionAddingYogi, setSessionAddingYogi] = useState(false)
  // Welle 6 (Sarah 2026-05-27): Numerische Form-Felder duerfen leer (`''`) sein
  // damit Sarah die Default-Werte loeschen kann ohne dass automatisch "0"
  // springt. Validierung beim Submit.
  const [singleForm, setSingleForm] = useState<{
    name: string; date: string; time_start: string;
    duration_min: number | ''; max_spots: number | '';
    location: string; description: string; bring_along: string; difficulty: string;
  }>({
    name: '', date: '', time_start: '18:00', duration_min: 75, max_spots: 12,
    location: '', description: '',
    bring_along: '', difficulty: 'Alle Level',
  })
  const [eventForm, setEventForm] = useState<{
    name: string; date: string; time_start: string;
    duration_min: number | ''; max_spots: number | '';
    location: string; description: string; bring_along: string; difficulty: string;
    payment_type: 'free' | 'paid'; price_eur: string; image_url: string;
  }>({
    name: '', date: '', time_start: '18:00', duration_min: 75, max_spots: 12,
    location: '', description: '',
    bring_along: '', difficulty: 'Alle Level',
    // Welle 2.5 (Sarah 2026-05-26): Event-Form hat NUR noch 'free' | 'paid'.
    // Credit-Verbrauch ist semantisch identisch mit "Einzelstunde anlegen" und
    // wird daher aus dem Event-Form entfernt. Container SYS · Events (Credit)
    // bleibt in der DB (kein Schema-Change) — wird nur nicht mehr genutzt.
    payment_type: 'free' as 'free' | 'paid',
    price_eur: '',
    image_url: '',
  })
  const [savingSingleOrEvent, setSavingSingleOrEvent] = useState(false)
  const [uploadingEventImage, setUploadingEventImage] = useState(false)
  // Welle 6 (Sarah 2026-05-27): "Teilen"-Dropdown auf Event-Karten —
  // statt separatem Sprechblase-Button. Speichert die geoeffnete Session-ID.
  const [shareMenuOpen, setShareMenuOpen] = useState<string | null>(null)
  // Welle 6 (Sarah 2026-05-27): Direktes Absage-Modal fuer Events/Einzelstunden
  // (Item 2). Frueher leitete der Absagen-Button auf /admin/sessions/[id] weiter,
  // Sarah wollte aber direkt das Grund-Eingabe-Modal. Speichert die Session +
  // Eingabe-State.
  const [cancellingSession, setCancellingSession] = useState<any>(null)
  const [cancelSessionReason, setCancelSessionReason] = useState('')
  const [doingCancelSession, setDoingCancelSession] = useState(false)
  // Welle 6 (Sarah 2026-05-27): Mehr-Menue ("…") auf laufenden Kurs-Karten —
  // versteckt den Loesch-Button hinter einem Mehr-Icon. Speichert Kurs-ID.
  const [moreMenuOpen, setMoreMenuOpen] = useState<string | null>(null)
  // Welle 6: 2-stufiges Confirm-Modal fuer Lösch-Aktion bei laufenden Kursen.
  // Stufe 1: Bestaetigung mit Yogi-Count. Stufe 2: Eingabe Kursname.
  const [deleteCourseModal, setDeleteCourseModal] = useState<{ course: any; step: 1 | 2; nameInput: string; yogiCount: number } | null>(null)
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  // Welle 2.5 (Sarah 2026-05-26): History-Push beim Öffnen eines Formulars,
  // damit Handy-Swipe-Back ODER Browser-Back-Button das Formular schließt
  // (statt zur Dashboard-Seite zurückzugehen).
  // Welle 3.5 (Sarah 2026-05-26): erweitert auf ALLE Modals dieser Seite —
  // Teilnehmer-Modals, Folgekurs-Modal, Abbrechen-Modal, Yogi-hinzufügen.
  // Welle 6 (Sarah 2026-05-27, Item 3 Fix): Effekt darf nur an BOOLEANS haengen,
  // nicht an den Modal-Objekten selbst — sonst feuert er bei jedem
  // setParticipantsSession({...prev, ...}) erneut und schliesst sich (popstate-Cleanup).
  const anyModalOpen = showForm || showSingleForm || showEventForm
    || !!participantsCourse || !!participantsSession
    || !!folgekursCourse || !!cancellingCourse
    || showAddYogiModal
  useEffect(() => {
    if (!anyModalOpen) return
    window.history.pushState({ modalOpen: true }, '', window.location.pathname)
    const onPop = () => {
      setShowForm(false); setShowSingleForm(false); setShowEventForm(false)
      setEditingSessionId(null)
      setParticipantsCourse(null); setParticipantsSession(null); setSessionBookings([]); setSessionWaitlist([])
      setFolgekursCourse(null); setCancellingCourse(null)
      setShowAddYogiModal(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [anyModalOpen])

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
    // Welle 1 (Sarah 2026-05-26): SYS-Container-Kurse (Einzelstunden/Events)
    // sind in den Admin-Kurslisten unsichtbar — sie sind nur DB-Container.
    const { data } = await supabase.from('courses')
      .select('*, sessions(date, is_cancelled, cancel_reason), enrollments(id, end_date, end_reason)')
      .eq('is_system_container', false)
      .order('date_start', { ascending: true })
    const withParticipants = (data || []).map((c: any) => {
      // Counter zeigt NUR aktiv eingebuchte Kurs-Teilnehmer (enrollments OHNE
      // end_date in der Vergangenheit). Drop-Ins (Einzelstunden-Buchungen in
      // einzelne Sessions des Kurses) zählen hier explizit NICHT mit — die sind
      // Stunden-Gäste, keine Kurs-Teilnehmer. Sarah-Klarstellung 21.5.
      // Sarah-BugFix 2026-05-26: beendete enrollments (z.B. krankheitsbedingt
      // ausgetragen) belegen KEINEN Platz mehr.
      const todayStr = new Date().toISOString().slice(0, 10)
      const enrolledCount = (c.enrollments || []).filter((e: any) =>
        !e.end_date || e.end_date > todayStr
      ).length
      const isOverbooked = c.max_spots != null && enrolledCount > c.max_spots
      return { ...c, participant_count: enrolledCount, is_overbooked: isOverbooked }
    })
    setCourses(withParticipants)

    // Welle 2 (2026-05-26): Container-Kurs-IDs + deren Sessions ("Geplante Stunden & Events")
    const { data: containers } = await supabase.from('courses')
      .select('id, name')
      .eq('is_system_container', true)
    if (containers) {
      const find = (substr: string) => containers.find((c: any) => c.name.toLowerCase().includes(substr))?.id || ''
      setContainerIds({
        single: find('einzelstunden'),
        eventFree: find('kostenlos'),
        eventCredit: find('credit'),
        eventPaid: find('bezahlt'),
      })
    }
    // Sessions: alle die NICHT 'course_session' sind (= aus Containern)
    const { data: cs } = await supabase.from('sessions')
      .select('id, name, date, time_start, duration_min, max_spots, location, description, session_type, price_eur, image_url, is_cancelled, is_open, course_id, external_participants_count, bookings!bookings_session_id_fkey(id, status)')
      .neq('session_type', 'course_session')
      .order('date', { ascending: true })
    // Welle 3.5 (Sarah 2026-05-26): Abgesagte Sessions NICHT mehr rausfiltern —
    // sie sollen in einer eigenen Sektion "Abgesagte Stunden & Events" sichtbar
    // bleiben, damit Admin sie loeschen/archivieren kann.
    setContainerSessions(cs || [])
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
      is_free: course.is_free || false,
      image_url: course.image_url || '',
    })
    setShowForm(true)
  }

  function resetForm() {
    setShowForm(false); setEditCourse(null)
    setExcludedDates([]); setExistingSessionDates([])
    setPreviewDates([]); setForm(emptyForm)
  }

  // Welle 2 (Sarah 2026-05-26): Einzelstunde anlegen (in SYS-Container "Einzelstunden")
  // Welle 2.11: bei editingSessionId UPDATE statt INSERT
  async function handleSaveSingle() {
    if (!containerIds?.single) { alert('Container fehlt'); return }
    if (!singleForm.name || !singleForm.date || !singleForm.time_start) { alert('Pflichtfelder fehlen'); return }
    // Welle 6: Numerische Felder muessen beim Submit gesetzt sein.
    const _dur = typeof singleForm.duration_min === 'number' ? singleForm.duration_min : NaN
    const _max = typeof singleForm.max_spots === 'number' ? singleForm.max_spots : NaN
    if (!_dur || _dur <= 0) { alert('Bitte Dauer in Minuten angeben.'); return }
    if (!_max || _max <= 0) { alert('Bitte max. Teilnehmer angeben.'); return }
    setSavingSingleOrEvent(true)
    try {
      const payload = {
        date: singleForm.date,
        time_start: singleForm.time_start,
        duration_min: _dur,
        name: singleForm.name.trim(),
        location: singleForm.location || null,
        description: singleForm.description || null,
        max_spots: _max,
        bring_along: singleForm.bring_along || null,
        difficulty: singleForm.difficulty || null,
      }
      if (editingSessionId) {
        await supabase.from('sessions').update(payload).eq('id', editingSessionId)
        await supabase.from('audit_log').insert({
          action: 'single_session_updated',
          details: { session_id: editingSessionId, name: singleForm.name, date: singleForm.date, time: singleForm.time_start, max_spots: singleForm.max_spots }
        })
      } else {
        await supabase.from('sessions').insert({
          course_id: containerIds.single,
          session_type: 'single',
          ...payload,
        })
        await supabase.from('audit_log').insert({
          action: 'single_session_created',
          details: { name: singleForm.name, date: singleForm.date, time: singleForm.time_start, max_spots: singleForm.max_spots }
        })
      }
      setShowSingleForm(false)
      setEditingSessionId(null)
      setSingleForm({ name: '', date: '', time_start: '18:00', duration_min: 75, max_spots: 12, location: '', description: '', bring_along: '', difficulty: 'Alle Level' })
      await loadData()
    } catch (e: any) {
      alert('Fehler: ' + (e?.message || e))
    } finally {
      setSavingSingleOrEvent(false)
    }
  }

  // Welle 2.5 (Sarah 2026-05-26): Event anlegen — payment_type ist nur noch
  // 'free' | 'paid'. Credit-Verbrauch ist semantisch "Einzelstunde anlegen"
  // und wurde aus dem Event-Form entfernt.
  async function handleSaveEvent() {
    const containerLookup: Record<'free'|'paid', string | undefined> = {
      free: containerIds?.eventFree,
      paid: containerIds?.eventPaid,
    }
    const courseId = containerLookup[eventForm.payment_type]
    if (!courseId) { alert('Container fehlt'); return }
    if (!eventForm.name || !eventForm.date || !eventForm.time_start) { alert('Pflichtfelder fehlen'); return }
    // Welle 6: Numerische Felder muessen beim Submit gesetzt sein.
    const _evDur = typeof eventForm.duration_min === 'number' ? eventForm.duration_min : NaN
    const _evMax = typeof eventForm.max_spots === 'number' ? eventForm.max_spots : NaN
    if (!_evDur || _evDur <= 0) { alert('Bitte Dauer in Minuten angeben.'); return }
    if (!_evMax || _evMax <= 0) { alert('Bitte max. Teilnehmer angeben.'); return }
    if (eventForm.payment_type === 'paid') {
      // Welle S2/M12 (Sarah 2026-05-27): Deutsches Komma "5,50" → "5.50"
      // normalisieren, sonst kuerzt parseFloat stillschweigend auf 5.
      const normalized = String(eventForm.price_eur).replace(',', '.')
      const p = parseFloat(normalized)
      if (isNaN(p) || p <= 0) { alert('Bitte gültigen Preis eingeben (z.B. 5.50 oder 5,50)'); return }
    }
    setSavingSingleOrEvent(true)
    try {
      const sessionType = eventForm.payment_type === 'free' ? 'event_free' : 'event_paid'
      const payload = {
        date: eventForm.date,
        time_start: eventForm.time_start,
        duration_min: _evDur,
        name: eventForm.name.trim(),
        location: eventForm.location || null,
        description: eventForm.description || null,
        max_spots: _evMax,
        image_url: eventForm.image_url || null,
        // Welle S2/M12: gleiches Normalisieren wie oben in der Validierung.
        price_eur: eventForm.payment_type === 'paid' ? parseFloat(String(eventForm.price_eur).replace(',', '.')) : null,
        bring_along: eventForm.bring_along || null,
        difficulty: eventForm.difficulty || null,
      }
      if (editingSessionId) {
        // Welle 2.11: Bei Event-Update auch course_id mitschreiben falls payment_type wechselt
        await supabase.from('sessions').update({ ...payload, course_id: courseId, session_type: sessionType }).eq('id', editingSessionId)
        await supabase.from('audit_log').insert({
          action: 'event_updated',
          details: { session_id: editingSessionId, name: eventForm.name, payment_type: eventForm.payment_type, date: eventForm.date, max_spots: eventForm.max_spots, price_eur: payload.price_eur }
        })
      } else {
        await supabase.from('sessions').insert({
          course_id: courseId,
          session_type: sessionType,
          ...payload,
        })
        await supabase.from('audit_log').insert({
          action: 'event_created',
          details: { name: eventForm.name, payment_type: eventForm.payment_type, date: eventForm.date, max_spots: eventForm.max_spots, price_eur: payload.price_eur }
        })
      }
      setShowEventForm(false)
      setEditingSessionId(null)
      setEventForm({ name: '', date: '', time_start: '18:00', duration_min: 75, max_spots: 12, location: '', description: '', bring_along: '', difficulty: 'Alle Level', payment_type: 'free', price_eur: '', image_url: '' })
      await loadData()
    } catch (e: any) {
      alert('Fehler: ' + (e?.message || e))
    } finally {
      setSavingSingleOrEvent(false)
    }
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
      is_free: form.is_free,
      image_url: form.image_url || null,
    }

    if (editCourse) {
      // Prüfen ob User im Kurs sind (mit Profile-Daten für evtl. Email)
      const { data: enrollments } = await supabase
        .from('enrollments')
        .select('id, user_id, profile:profiles(email, first_name, is_dummy)')
        .eq('course_id', editCourse.id)

      if (enrollments && enrollments.length > 0) {
        const oldTime = editCourse.time_start
        const oldMaxSpots = editCourse.max_spots
        const timeChanged = oldTime !== courseData.time_start
        // Sarah-Wunsch 2026-05-25: Wenn max_spots erhoeht wird, Wartelisten-Yogis
        // der ZUKUENFTIGEN Sessions automatisch nachruecken.
        const spotsIncreased = courseData.max_spots > (oldMaxSpots || 0)

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
          is_free: courseData.is_free,
          image_url: courseData.image_url,
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

        // Sarah-Wunsch 2026-05-25: Wenn max_spots erhoeht wurde, Wartelisten
        // der ZUKUENFTIGEN Sessions automatisch nachruecken (so viele wie
        // jetzt Platz ist). promoteWaitlistOrOfferLate macht das pro Session.
        if (spotsIncreased) {
          const today = new Date().toISOString().split('T')[0]
          const { data: futureSessions } = await supabase.from('sessions')
            .select('id').eq('course_id', editCourse.id)
            .eq('is_cancelled', false).gte('date', today)
          // promoteWaitlistOrOfferLate fuellt pro Session genau EINEN Platz.
          // Mehrere neue Plaetze pro Session → mehrfach aufrufen (loop bis Promote=noop).
          for (const s of (futureSessions || []) as any[]) {
            // Pro Session: so oft promoten bis kein Yogi mehr nachrueckt
            let safetyMax = 50 // gegen Endlos-Schleife
            while (safetyMax-- > 0) {
              const result = await promoteWaitlistOrOfferLate(supabase, s.id)
              if (result.mode === 'noop' || result.mode === 'late-offer-sent') break
            }
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
              // WICHTIG: cancel_reason='excluded' muss zwingend gesetzt sein, damit /meine + UI
              // zwischen "Ausgeschlossen" (nicht anzeigen) und "Abgesagt" (rot anzeigen) unterscheidet.
              cancel_reason: excludedDates.includes(date) ? 'excluded' : null,
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
      // Welle 4.7 (Sarah 2026-05-26): Audit-Spur fuer Kurs-Neuanlage.
      await supabase.from('audit_log').insert({
        action: 'course_created',
        details: {
          course_id: course.id, name: course.name,
          weekday: courseData.weekday, time_start: courseData.time_start,
          date_start: courseData.date_start, date_end: courseData.date_end,
          total_units: courseData.total_units, max_spots: courseData.max_spots,
          is_single: courseData.is_single, is_free: courseData.is_free,
        }
      })
    }

    // Welle 4.7: Audit-Spur fuer Kurs-Update (separater Eintrag, wenn editCourse).
    if (editCourse) {
      await supabase.from('audit_log').insert({
        action: 'course_updated',
        details: {
          course_id: editCourse.id, name: courseData.name,
          time_start: courseData.time_start, duration_min: courseData.duration_min,
          max_spots: courseData.max_spots, location: courseData.location,
        }
      })
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
    // Welle 4.7 (Sarah 2026-05-26): Audit-Spur fuer Kurs-Freigabe/Sperre.
    await supabase.from('audit_log').insert({
      action: 'course_open_toggled',
      details: { course_id: id, is_open: !currentlyOpen }
    })
    loadData()
  }

  // Welle 2.7 (Sarah 2026-05-26): Frei/Gesperrt-Pille fuer Einzelstunden + Events.
  // sessions.is_open ist eigenes Flag (NULL/true = offen). Container-Kurse erlauben
  // keine globale Sperre — daher pro Session.
  async function toggleSessionOpen(sessionId: string, currentlyOpen: boolean) {
    await supabase.from('sessions').update({ is_open: !currentlyOpen }).eq('id', sessionId)
    // Welle 6A (Sarah 2026-05-27, Item 12): name fuer Yogi-Protokoll
    const sess = containerSessions.find((s: any) => s.id === sessionId)
    await supabase.from('audit_log').insert({
      action: 'session_open_toggled',
      details: {
        session_id: sessionId, new_value: !currentlyOpen,
        name: sess?.name || null,
        session_date: sess?.date, session_time: sess?.time_start,
      },
    })
    loadData()
  }

  // Welle 2.9 (Sarah 2026-05-26): External-Counter inline auf der Card.
  // Optimistisch updaten + audit_log Eintrag wenn sich Wert geaendert hat.
  async function updateExternalCount(sessionId: string, newValue: number) {
    const v = Math.max(0, Math.floor(newValue))
    // Optimistic UI
    setContainerSessions(prev => prev.map((s: any) =>
      s.id === sessionId ? { ...s, external_participants_count: v } : s
    ))
    const current = containerSessions.find((s: any) => s.id === sessionId)
    const old = current?.external_participants_count ?? 0
    if (old === v) return
    await supabase.from('sessions').update({ external_participants_count: v }).eq('id', sessionId)
    // Welle 6A (Sarah 2026-05-27, Item 12): name fuer klares Audit-Protokoll
    await supabase.from('audit_log').insert({
      action: 'external_participants_changed',
      details: {
        session_id: sessionId, old, new: v,
        name: current?.name || null,
        session_date: current?.date, session_time: current?.time_start,
      },
    })
  }

  // Welle 6 (Sarah 2026-05-27, Item 2): Einzelstunde/Event direkt aus der
  // Kurs-Liste absagen — ohne Umweg ueber /admin/sessions/[id]. Modal nimmt
  // einen Grund entgegen, storniert alle aktiven Bookings, sendet Mails,
  // schreibt Audit. Logik gespiegelt aus /admin/sessions/[id]/handleCancelSession
  // aber ohne Ersatztermin-Logik (gibts bei Einzelstunden/Events nicht).
  async function cancelEventOrSingle() {
    if (!cancellingSession) return
    setDoingCancelSession(true)
    try {
      const sess = cancellingSession
      const sessType: string = sess.session_type
      // Aktive Buchungen laden
      const { data: actBookings } = await supabase.from('bookings')
        .select('id, user_id, credit_id, profile:profiles(email, first_name)')
        .eq('session_id', sess.id).eq('status', 'active')
      // Session als abgesagt markieren
      await supabase.from('sessions').update({
        is_cancelled: true,
        cancel_reason: cancelSessionReason || 'Abgesagt',
      }).eq('id', sess.id)
      // Bookings stornieren
      for (const b of (actBookings || []) as any[]) {
        await supabase.from('bookings').update({
          status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false, cancelled_by: 'admin',
        }).eq('id', b.id)
        if (b.profile?.email) {
          try {
            await Email.sessionCancelled({
              email: b.profile.email,
              firstName: b.profile.first_name || 'Yogi',
              courseName: sess.name || '',
              date: sess.date || '',
              timeStart: sess.time_start || '',
              reason: cancelSessionReason || undefined,
              sessionType: sessType,
            })
          } catch (e) { /* nicht-blockierend */ }
        }
        // Sarah-Wunsch 2026-05-28: zusätzlich zur Mail eine In-App-Benachrichtigung
        // im Yogi-Kalender (weißer, wegklickbarer Banner) — nur für Events.
        // event_paid → "Gebühr wird zurückerstattet!"; event_free → kein Bezahl-Hinweis.
        if ((sessType === 'event_free' || sessType === 'event_paid') && b.user_id) {
          try {
            await supabase.from('yogi_notifications').insert({
              user_id: b.user_id,
              type: 'event_cancelled',
              payload: {
                title: sess.name || '',
                reason: cancelSessionReason || null,
                date: sess.date || null,
                time_start: sess.time_start || null,
                session_type: sessType,
              },
            })
          } catch (e) { /* nicht-blockierend */ }
        }
      }
      // Warteliste leeren
      await supabase.from('waitlist').delete().eq('session_id', sess.id)
      // Audit
      await supabase.from('audit_log').insert({
        action: 'session_cancelled',
        details: {
          session_id: sess.id, session_type: sessType,
          name: sess.name, session_date: sess.date, session_time: sess.time_start,
          reason: cancelSessionReason || null,
          affected_yogis: (actBookings || []).length,
          source: 'admin_kurse_card',
        }
      })
      setCancellingSession(null)
      setCancelSessionReason('')
      loadData()
    } finally {
      setDoingCancelSession(false)
    }
  }

  // Welle 2.9: Loeschen einer Einzelstunde/eines Events von der Karte aus.
  // Schutz: wenn aktive Bookings existieren, erst absagen lassen.
  async function deleteContainerSession(sessionId: string, participantCount: number) {
    // Sarah-Wunsch 2026-05-28: Teilnehmer-abhaengiger Hinweis.
    // Teilnehmer (intern ODER extern) vorhanden → erst absagen. Sonst hart loeschen.
    if (participantCount > 0) {
      alert('Du hast noch Teilnehmer in dieser Stunde.\n\nSage sie zuerst ab (Teilnehmer müssen informiert werden), dann kannst du sie löschen.')
      return
    }
    if (!confirm('Du hast keine Teilnehmer. Willst du diese Stunde endgültig (hart) löschen?\n\nDiese Aktion kann nicht rückgängig gemacht werden.')) return
    await supabase.from('waitlist').delete().eq('session_id', sessionId)
    await supabase.from('bookings').delete().eq('session_id', sessionId)
    // Welle 6A (Sarah 2026-05-27, Item 12): Session-Snapshot vor delete fuer Audit
    const _sessBeforeDel = containerSessions.find((s: any) => s.id === sessionId)
    await supabase.from('sessions').delete().eq('id', sessionId)
    await supabase.from('audit_log').insert({
      action: 'single_or_event_deleted',
      details: {
        session_id: sessionId, deleted_from: 'admin_kurse_card',
        name: _sessBeforeDel?.name || null,
        session_type: _sessBeforeDel?.session_type || null,
        session_date: _sessBeforeDel?.date, session_time: _sessBeforeDel?.time_start,
      },
    })
    loadData()
  }

  async function loadSessions(courseId: string) {
    // Toggle: wenn bereits expanded → einklappen
    if (expandedCourse === courseId) { setExpandedCourse(null); return }
    if (!courseSessions[courseId]) {
      // cancel_reason MUSS mitgeladen werden, sonst kann UI nicht zwischen
      // "Ausgeschlossen" und "Abgesagt" unterscheiden.
      // replacement_session_id: zeigt von ABGESAGT auf neue Ersatz-Session → daraus
      // können wir ableiten welche Sessions SELBST Ersatzstunden sind (=Ziel einer Verlinkung).
      const { data } = await supabase.from('sessions')
        .select('id, date, time_start, is_cancelled, cancel_reason, replacement_session_id')
        .eq('course_id', courseId).order('date')
      // Sessions die Ziel eines replacement-Links sind → "is_replacement"
      const replacementTargets = new Set(
        (data || []).filter((s: any) => s.replacement_session_id).map((s: any) => s.replacement_session_id)
      )
      // Plus: pro Ersatzstunde merken wir uns das Original-Datum für die UI
      const originLookup: Record<string, any> = {}
      for (const s of (data || []) as any[]) {
        if (s.replacement_session_id) originLookup[s.replacement_session_id] = { date: s.date, time_start: s.time_start }
      }
      const enriched = (data || []).map((s: any) => ({
        ...s,
        is_replacement: replacementTargets.has(s.id),
        original_session: originLookup[s.id] || null,
      }))
      setCourseSessions(prev => ({ ...prev, [courseId]: enriched }))
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

    // Sarah-Regel 2026-05-22: Cascade-Stornierung von Ersatz-Buchungen.
    // Alle aktiven Buchungen finden, deren origin_session_id auf eine der gerade
    // stornierten zukünftigen Sessions zeigt — diese Vorhol-Stunden basieren auf
    // einem nun ungültig gewordenen Anspruch und müssen mitsterben.
    // WICHTIG: nur Buchungen deren EIGENE Session noch zukünftig ist (sonst:
    // bereits besuchte Vorholstunde → bleibt bestehen, keine rückwirkende Änderung).
    if ((futureSessions || []).length > 0) {
      const futureSessionIds = (futureSessions || []).map((s: any) => s.id)
      const { data: dependentBookings } = await supabase.from('bookings')
        .select('id, user_id, session:sessions!bookings_session_id_fkey(id, date, time_start, course:courses(name)), profile:profiles(email, first_name)')
        .in('origin_session_id', futureSessionIds)
        .eq('status', 'active')
      const toCancel = ((dependentBookings || []) as any[]).filter(b => b.session?.date && b.session.date >= today)
      const freedVorholSessionIds: string[] = []
      for (const b of toCancel) {
        await supabase.from('bookings').update({
          status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false, cancelled_by: 'admin'
        }).eq('id', b.id)
        if (b.session?.id) freedVorholSessionIds.push(b.session.id)
        // Sarah-Regel 2026-05-28: KEINE separate Absage-Mail pro Vorhol-/Nachhol-
        // stunde beim Kursabbruch. Diese Stunden basieren auf Credits des
        // abgebrochenen Kurses und werden ersatzlos gelöscht — der Yogi bekommt
        // dafür die Erstattung/das Guthaben (siehe course_cancelled-Mail). Die alte
        // Mail behauptete fälschlich "Dein Credit wird gutgeschrieben" → entfernt.
      }
      if (toCancel.length > 0) {
        await supabase.from('audit_log').insert({
          action: 'cascade_replacement_cancelled',
          details: {
            course_id: cancellingCourse.id,
            course_name: cancellingCourse.name,
            cancelled_booking_count: toCancel.length,
          }
        })
      }
      // Sarah-Wunsch 2026-05-28: durch die Cascade frei gewordene (Vorhol-)Stunden
      // — oft in ANDEREN Kursen — auch nachrücken lassen.
      const uniqueFreed = Array.from(new Set(freedVorholSessionIds))
      for (const sid of uniqueFreed) {
        try { await promoteWaitlistOrOfferLate(supabase, sid) } catch (e) { console.error('promote (cascade):', e) }
      }
    }

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

      const futureSessionIds = (futureSessions || []).map((s: any) => s.id)

      // === SNAPSHOT vor Cancel: was hat der Yogi für die zukünftigen Stunden bezahlt? ===
      // Pro aktiver Future-Booking schauen: zeigt credit_id auf model='guthaben' oder
      // auf model='course' (oder NULL/anderes). Daraus ergibt sich:
      //  - guthabenBreakdown: pro Altguthaben-Credit, wieviel verrechnet wurde
      //  - newCreditsCount: wieviel der Yogi NEU für diesen Kurs bezahlt hat
      // Dieser Snapshot ist die Wahrheit für die spätere Choice-Logik.
      const guthabenCounts = new Map<string, number>()
      if (futureSessionIds.length > 0) {
        const { data: futureBookings } = await supabase.from('bookings')
          .select('credit_id, credit:credits(id, model)')
          .eq('user_id', prof.id)
          .in('session_id', futureSessionIds)
          .eq('status', 'active')
        for (const b of (futureBookings || []) as any[]) {
          if (b.credit?.model === 'guthaben' && b.credit_id) {
            guthabenCounts.set(b.credit_id, (guthabenCounts.get(b.credit_id) ?? 0) + 1)
          }
        }
      }
      const guthabenBreakdown = Array.from(guthabenCounts.entries())
        .map(([credit_id, count]) => ({ credit_id, count }))
      // Sarah-Regel 2026-05-28: Die Gutschrift/Auszahlung ist IMMER die Anzahl
      // der ZUKÜNFTIGEN Kursstunden (remainingCount) — unabhängig davon, ob der
      // Yogi einzelne Credits dieses Kurses zwischenzeitlich in Drop-In-/Vorhol-
      // Stunden "geparkt" hatte (die werden unten ausgetragen). Vorher zählte die
      // Logik nur die noch aktiv gebuchten Future-Kursstunden → zu wenig
      // (Screenshot mail@: 4 statt 6). Der mit ALTEM Guthaben gedeckte Anteil geht
      // zurück aufs alte Guthaben (guthabenBreakdown), der Rest ist neu.
      const totalGuthabenReused = Array.from(guthabenCounts.values()).reduce((a, b) => a + b, 0)
      const newCreditsCount = Math.max(0, remainingCount - totalGuthabenReused)

      // Bookings stornieren (Trigger feuert → setzt credit.used neu)
      if (futureSessionIds.length > 0) {
        await supabase.from('bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: 'admin' })
          .eq('user_id', prof.id).in('session_id', futureSessionIds)
      }

      // Course-Credits dieses Kurses löschen (FK erst entkoppeln)
      const { data: yogiCredits } = await supabase.from('credits')
        .select('id').eq('user_id', prof.id).eq('course_id', cancellingCourse.id)
      if (yogiCredits && yogiCredits.length > 0) {
        const cIds = yogiCredits.map((cc: any) => cc.id)
        // Sarah-Regel 2026-05-28: Alle Stunden, die der Yogi mit FREIEN Credits
        // dieses Kurses gebucht hat (Drop-In/Vorhol in ANDEREN Stunden), werden
        // beim Kursabbruch ausgetragen — ihr Anspruch steckt ja bereits in der
        // vollen remainingCount-Gutschrift oben. Nur ZUKÜNFTIGE austragen
        // (vergangene Stunden wurden bereits besucht). Freie Plätze → Warteliste.
        const todayIso = new Date().toISOString().split('T')[0]
        const { data: creditBookings } = await supabase.from('bookings')
          .select('id, session:sessions!bookings_session_id_fkey(id, date)')
          .eq('user_id', prof.id).eq('status', 'active').in('credit_id', cIds)
        const futureDropIns = (creditBookings || []).filter((b: any) => b.session?.date && b.session.date >= todayIso)
        if (futureDropIns.length > 0) {
          await supabase.from('bookings')
            .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), credit_id: null, cancelled_by: 'admin' })
            .in('id', futureDropIns.map((b: any) => b.id))
          for (const sid of Array.from(new Set(futureDropIns.map((b: any) => b.session.id)))) {
            try { await promoteWaitlistOrOfferLate(supabase, sid as string) } catch (e) { console.error('promote (dropin-cascade):', e) }
          }
        }
        // Übrige (vergangene) Bookings entkoppeln, dann Course-Credits löschen.
        await supabase.from('bookings').update({ credit_id: null })
          .eq('user_id', prof.id).in('credit_id', cIds)
        // Sarah-Fix 2026-05-28: Auch enrollments.credit_id entkoppeln, BEVOR die
        // Course-Credits geloescht werden. Sonst blockiert der FK
        // enrollments_credit_id_fkey den DELETE still (kein Error-Check) → der
        // alte Course-Credit bleibt mit used=0 (Trigger) erhalten und der Yogi
        // hat den Kurs-Credit DOPPELT (alt + neues Guthaben aus Abbruch).
        await supabase.from('enrollments').update({ credit_id: null })
          .eq('user_id', prof.id).in('credit_id', cIds)
        // Sarah-Fix 2026-05-29 (Fall 2): GLEICHES SCHUTZMUSTER wie in deleteCourse.
        // Guthaben (Krankheits-/Kursabbruch-Guthaben, model='guthaben') NICHT
        // mitloeschen, auch wenn es an diesem Kurs haengt — es ist fuer JEDEN Kurs
        // einloesbar (10 Mon. / 2 Jahre) und muss erhalten bleiben. Daher nur die
        // Herkunfts-Verknuepfung loesen (course_id=null); der Kurstitel bleibt in
        // source_course_name stehen. Nur die kursgebundenen Credits (model != guthaben)
        // werden geloescht. Vorher wurden ALLE Credits dieses Kurses geloescht →
        // Guthaben des Yogi konnte beim Kursabbruch verschwinden.
        await supabase.from('credits').update({ course_id: null })
          .eq('user_id', prof.id).eq('course_id', cancellingCourse.id).eq('model', 'guthaben')
        const { error: credDelErr } = await supabase.from('credits').delete()
          .eq('user_id', prof.id).eq('course_id', cancellingCourse.id).neq('model', 'guthaben')
        if (credDelErr) console.error('cancelCourse: Course-Credit-Loeschung fehlgeschlagen:', credDelErr)
      }

      // Enrollment löschen → verschwindet aus "Meine"
      await supabase.from('enrollments').delete()
        .eq('user_id', prof.id).eq('course_id', cancellingCourse.id)

      // Dummy: fertig, kein Token/Email
      if (prof.is_dummy) continue

      // Provisorisches Guthaben für die "neu bezahlten" Anteile — wird beim Cancel
      // direkt sichtbar in /meine, damit Yogi seinen vollen Anspruch sieht (alle 4
      // abgesagten Stunden statt nur das auto-refundete Altguthaben). Bei Choice
      // "Erstattung" wird dieser Credit wieder gelöscht; bei Choice "Guthaben"
      // bleibt er als finale Gutschrift.
      // Bug-Fix (Sarah 2026-05-28): NUR bei 'yogi_choice' (Option 2) anlegen. Bei
      // 'all_refund' (Option 1, "alle bekommen Geld zurück") gibt es keinen
      // Wahl-Flow, der das provisorische Guthaben je wieder entfernt — es bliebe
      // dauerhaft fälschlich beim Yogi hängen. Bei Option 1 bekommt der Yogi sein
      // Geld zurück, es darf also gar kein Guthaben angelegt/angezeigt werden.
      let provisionalCreditId: string | null = null
      if (newCreditsCount > 0 && cancelRefundMode === 'yogi_choice') {
        const expiry2y = new Date()
        expiry2y.setFullYear(expiry2y.getFullYear() + 2)
        // Sarah-Wunsch 2026-05-26: course_id mitspeichern (Herkunftsangabe
        // fuer die Credit-Karte: "Guthaben aus Kursabbruch · Kurs: X
        // abgebrochen am ...").
        const { data: provCred } = await supabase.from('credits').insert({
          user_id: prof.id,
          course_id: cancellingCourse.id,
          // Sarah-Fix 2026-05-29: Kurstitel dauerhaft mitspeichern. Bleibt erhalten,
          // auch wenn der Quell-Kurs spaeter geloescht wird (course_id wird dann
          // entkoppelt, der Titel steht weiter in source_course_name).
          source_course_name: cancellingCourse.name,
          model: 'guthaben',
          source: 'cancellation_choice',
          total: newCreditsCount,
          used: 0,
          expires_at: expiry2y.toISOString(),
        }).select('id').single()
        provisionalCreditId = provCred?.id || null
      }

      // Token + Antwort-Snapshot NUR bei 'yogi_choice' (Option 2) anlegen.
      // Bug-Fix (Sarah 2026-05-28): Bei 'all_refund' (Option 1, "alle bekommen
      // Geld zurück") gibt es KEINE Yogi-Entscheidung → es darf keine offene
      // Aufgabe in course_cancellation_responses (choice=null) entstehen, sonst
      // taucht der Abbruch fälschlich im Admin-Dashboard / unter /admin/kursabbruch
      // als "Offen" auf. Den Refund-Überblick bekommt Sarah über die Admin-
      // Zusammenfassungs-Mail (adminCourseCancelledSummary, unten).
      let token: string | null = null
      if (cancelRefundMode === 'yogi_choice') {
        token = crypto.randomUUID().replace(/-/g, '')
        await supabase.from('course_cancellation_responses').insert({
          course_id: cancellingCourse.id,
          user_id: prof.id,
          token,
          expires_at: expiresAt.toISOString(),
          remaining_sessions: remainingCount,
          guthaben_breakdown: guthabenBreakdown,
          new_credits_count: newCreditsCount,
          provisional_credit_id: provisionalCreditId,
        })
      }

      // Email senden (via lib/email.ts mit korrektem x-function-secret Header)
      if (prof.email) {
        await Email.courseCancelled({
          email: prof.email,
          firstName: prof.first_name || 'Yogi',
          courseName: cancellingCourse.name,
          reason: cancelReason,
          remainingSessions: remainingCount,
          refundMode: cancelRefundMode!,
          guthabenUrl: cancelRefundMode === 'yogi_choice' && token ? `${appUrl}/kursabbruch/${token}` : null,
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
    // ───────────────────────────────────────────────────────────────────────
    // Sarah-Wunsch 2026-05-24 (Sicherheits-Regel uniform):
    // Auch Archivieren erst 9 Tage NACH date_end erlauben — gleiche Logik
    // wie deleteCourse. Damit ist es technisch unmöglich, dass ein archivierter
    // Kurs Yogi-Credits "versteckt" oder unzugänglich macht solange die
    // Credits noch gültig sind (8 Tage nach Kursende).
    //
    // Reine Code-Analyse: Archivieren macht aktuell NUR is_active=false und
    // löscht KEINE Credits. Aber als safe Default + uniforme Logik mit Löschen.
    //
    // Sarah-Fix 2026-05-29: Ein Kurs OHNE Teilnehmer kann der Admin IMMER
    // sofort archivieren — unabhängig vom Datum. Die 9-Tage-Sperre (Credit-
    // Schutz) greift nur, wenn es überhaupt etwas zu schützen gibt. "Keine
    // Teilnehmer" = keine aktiven Buchungen, keine Enrollments, keine noch
    // einlösbaren Credits. Exakt dieselbe Ausnahme wie in deleteCourse().
    // ───────────────────────────────────────────────────────────────────────
    const { data: aSessions } = await supabase.from('sessions').select('id').eq('course_id', courseObj.id)
    const aSessionIds = (aSessions || []).map((s: any) => s.id)
    let aActiveBookingsCount = 0
    if (aSessionIds.length > 0) {
      const { count } = await supabase.from('bookings')
        .select('id', { count: 'exact', head: true })
        .in('session_id', aSessionIds).eq('status', 'active')
      aActiveBookingsCount = count || 0
    }
    const { count: aEnrollCount } = await supabase.from('enrollments')
      .select('id', { count: 'exact', head: true }).eq('course_id', courseObj.id)
    const { data: aCourseCredits } = await supabase.from('credits')
      .select('total, used, model').eq('course_id', courseObj.id)
    // Guthaben (Krankheits-/Kursabbruch-Guthaben) NICHT als "schützenswert"
    // zählen — es ist kursunabhängig einlösbar und übersteht Löschung/Archiv.
    const aUsableCreditsCount = (aCourseCredits || [])
      .filter((c: any) => c.model !== 'guthaben' && (c.total - c.used) > 0).length
    const aHasParticipants = aActiveBookingsCount > 0 || (aEnrollCount || 0) > 0 || aUsableCreditsCount > 0

    if (aHasParticipants && courseObj.date_end) {
      const dateEnd = new Date(courseObj.date_end)
      const earliestArchive = new Date(dateEnd.getTime() + 9 * 24 * 60 * 60 * 1000)
      const now = new Date()
      if (now < earliestArchive) {
        const daysLeft = Math.ceil((earliestArchive.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        alert(
          `Kurs kann erst ab dem 9. Tag nach Kursende archiviert werden.\n\n` +
          `Kursende: ${dateEnd.toLocaleDateString('de-DE')}\n` +
          `Frühestes Archivierungs-Datum: ${earliestArchive.toLocaleDateString('de-DE')}\n` +
          `Noch ${daysLeft} Tag${daysLeft === 1 ? '' : 'e'} warten.\n\n` +
          `Grund: Yogi-Credits sind bis 8 Tage nach Kursende gültig.\n` +
          `Bis dahin muss der Kurs aktiv bleiben damit Yogis ihre Credits ` +
          `noch nutzen können.\n\n` +
          `Wenn du Stunden absagen willst: nutze "Stunde absagen" pro Session.\n` +
          `Wenn der Kurs als ganzer ausfällt: nutze "Kurs abbrechen" (Yogis ` +
          `wählen Guthaben oder Erstattung).`
        )
        return
      }
    }

    // Safety-Net: noch gültige Credits mit Restbestand? (Guthaben ausgenommen —
    // es übersteht Archivierung/Löschung und ist kursunabhängig einlösbar.)
    const { data: validCredits } = await supabase.from('credits')
      .select('id, total, used, expires_at')
      .eq('course_id', courseObj.id)
      .neq('model', 'guthaben')
      .gt('expires_at', new Date().toISOString())
    if (validCredits && validCredits.length > 0) {
      const stillUsable = validCredits.filter(c => (c.total - c.used) > 0)
      if (stillUsable.length > 0) {
        alert(
          `Kurs kann nicht archiviert werden: ${stillUsable.length} Yogi${stillUsable.length === 1 ? ' hat' : 's haben'} ` +
          `noch gültige Credits aus diesem Kurs.\n\n` +
          `Bitte erst Credits verbrauchen, ablaufen lassen oder als Guthaben umwandeln.`
        )
        return
      }
    }

    // Ab hier: alle Schutz-Bedingungen erfüllt → Standard-Confirm
    const today = new Date().toISOString().split('T')[0]
    const futureSessions = (courseObj.sessions || [])
      .filter((s: any) => s.date >= today && !s.is_cancelled)
    const enrolledCount = courseObj.participant_count
      ?? (courseObj.enrollments?.length ?? 0)

    let confirmMsg: string
    if (futureSessions.length === 0 && enrolledCount === 0) {
      confirmMsg = 'Kurs archivieren?'
    } else {
      const parts: string[] = []
      if (futureSessions.length > 0) {
        parts.push(`${futureSessions.length} zukünftige ${futureSessions.length === 1 ? 'Stunde' : 'Stunden'}`)
      }
      if (enrolledCount > 0) {
        parts.push(`${enrolledCount} ${enrolledCount === 1 ? 'angemeldeten Yogi' : 'angemeldete Yogis'}`)
      }
      confirmMsg = `Dieser Kurs hat noch ${parts.join(' und ')}.\n\nTrotzdem archivieren?`
    }

    if (!confirm(confirmMsg)) return
    await supabase.from('courses').update({ is_active: false }).eq('id', courseObj.id)
    // Welle 4.7 (Sarah 2026-05-26): Audit-Spur fuer Archivieren.
    await supabase.from('audit_log').insert({
      action: 'course_archived',
      details: { course_id: courseObj.id, course_name: courseObj.name }
    })
    loadData()
  }

  async function deleteCourse(courseId: string, name: string) {
    // ───────────────────────────────────────────────────────────────────────
    // Sarah-KRITISCH 2026-05-24: Kurs-Löschung darf NUR möglich sein, wenn alle
    // möglicherweise noch gültigen Yogi-Credits dieses Kurses abgelaufen sind.
    // Regel: Credits gelten bis 8 Tage NACH Kursende (date_end). Daher Kurs erst
    // ab dem 9. Tag nach date_end löschbar (1 Tag Puffer = 9 Tage gesamt).
    //
    // Zusätzliche Sicherheits-Prüfung: gibt es noch CREDITS mit expires_at in
    // der Zukunft (egal welcher Kurs sie zugeordnet sind)? Wenn ja → blockieren,
    // auch wenn date_end-Regel bestanden wurde (z.B. manuell verlängert).
    // ───────────────────────────────────────────────────────────────────────
    const { data: course } = await supabase.from('courses')
      .select('date_end').eq('id', courseId).single()

    // Sarah-Fix 2026-05-28: Ein Kurs OHNE Teilnehmer kann der Admin IMMER
    // sofort löschen — die 9-Tage-Sperre (Credit-Schutz) greift nur, wenn es
    // ueberhaupt etwas zu schuetzen gibt. "Keine Teilnehmer" = keine aktiven
    // Enrollments, keine aktiven Buchungen, keine (verbleibenden) Credits.
    const { data: cSessions } = await supabase.from('sessions').select('id').eq('course_id', courseId)
    const cSessionIds = (cSessions || []).map((s: any) => s.id)
    let activeBookingsCount = 0
    if (cSessionIds.length > 0) {
      const { count } = await supabase.from('bookings')
        .select('id', { count: 'exact', head: true })
        .in('session_id', cSessionIds).eq('status', 'active')
      activeBookingsCount = count || 0
    }
    const { count: enrollCount } = await supabase.from('enrollments')
      .select('id', { count: 'exact', head: true }).eq('course_id', courseId)
    const { data: courseCredits } = await supabase.from('credits')
      .select('total, used, model').eq('course_id', courseId)
    // Sarah-Fix 2026-05-29: Guthaben (Krankheits-/Kursabbruch-Guthaben) NICHT als
    // "schuetzenswert" zaehlen — es wird beim Loeschen NICHT geloescht, sondern
    // entkoppelt (course_id=null) und bleibt fuer JEDEN Kurs einloesbar erhalten.
    // Nur kursgebundene Course-Credits (model='course') wuerden verloren gehen.
    const usableCreditsCount = (courseCredits || [])
      .filter((c: any) => c.model !== 'guthaben' && (c.total - c.used) > 0).length
    const hasParticipants = activeBookingsCount > 0 || (enrollCount || 0) > 0 || usableCreditsCount > 0

    if (hasParticipants && course?.date_end) {
      const dateEnd = new Date(course.date_end)
      const earliestDelete = new Date(dateEnd.getTime() + 9 * 24 * 60 * 60 * 1000)
      const now = new Date()
      if (now < earliestDelete) {
        const daysLeft = Math.ceil((earliestDelete.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        alert(
          `Kurs kann erst ab dem 9. Tag nach Kursende gelöscht werden.\n\n` +
          `Kursende: ${dateEnd.toLocaleDateString('de-DE')}\n` +
          `Frühestes Löschdatum: ${earliestDelete.toLocaleDateString('de-DE')}\n` +
          `Noch ${daysLeft} Tag${daysLeft === 1 ? '' : 'e'} warten.\n\n` +
          `Grund: Yogi-Credits sind bis 8 Tage nach Kursende gültig.\n` +
          `Sie würden sonst mit dem Kurs gelöscht werden.`
        )
        return
      }
    }

    // Safety-Net: gibt es trotzdem noch GÜLTIGE Credits für diesen Kurs?
    // (z.B. wenn Sarah expires_at manuell verlängert hat)
    const { data: validCredits } = await supabase.from('credits')
      .select('id, user_id, expires_at, total, used')
      .eq('course_id', courseId)
      .neq('model', 'guthaben') // Guthaben ueberlebt das Loeschen (wird entkoppelt) → kein Block
      .gt('expires_at', new Date().toISOString())
    if (validCredits && validCredits.length > 0) {
      const stillUsable = validCredits.filter(c => (c.total - c.used) > 0)
      if (stillUsable.length > 0) {
        alert(
          `Kurs kann nicht gelöscht werden: ${stillUsable.length} Yogi${stillUsable.length === 1 ? ' hat' : 's haben'} ` +
          `noch gültige Credits aus diesem Kurs.\n\n` +
          `Bitte erst Credits verbrauchen, ablaufen lassen oder als Guthaben umwandeln.`
        )
        return
      }
    }

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
    // Sarah-Fix 2026-05-29: Guthaben (Krankheits-/Kursabbruch-Guthaben) NICHT
    // mitloeschen! Es ist fuer JEDEN Kurs einloesbar (10 Mon. / 2 Jahre gueltig)
    // und muss erhalten bleiben, wenn der Quell-Kurs geloescht wird. Daher nur
    // die Herkunfts-Verknuepfung loesen (course_id=null) — der Kurstitel bleibt
    // dauerhaft in source_course_name stehen, damit die Karte weiter
    // "aus Kurs: X" anzeigen kann. Nur kursgebundene Credits werden geloescht.
    await supabase.from('credits').update({ course_id: null })
      .eq('course_id', courseId).eq('model', 'guthaben')
    await supabase.from('credits').delete()
      .eq('course_id', courseId).neq('model', 'guthaben')
    await supabase.from('invitations').delete().eq('course_id', courseId)
    // course_cancellation_responses (Yogi-Wahl-Tokens nach Kursabbruch) auch löschen,
    // sonst blockiert FK constraint den courses.delete bei archivierten Kursen
    await supabase.from('course_cancellation_responses').delete().eq('course_id', courseId)
    const { error: deleteError } = await supabase.from('courses').delete().eq('id', courseId)
    if (deleteError) {
      alert('Fehler beim Löschen: ' + deleteError.message)
      return
    }
    // Welle 4.7 (Sarah 2026-05-26): Audit-Spur fuer Kurs-Komplettloeschung
    // (massive Datenmutation — ohne Trail rechtlich problematisch).
    await supabase.from('audit_log').insert({
      action: 'course_deleted',
      details: {
        course_id: courseId, course_name: name,
        sessions_count: (sessions || []).length,
      }
    })
    loadData()
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>

  // Rollover: 3 Wochen vor Kursende = anzeigen
  function getCourseStatus(course: any): string {
    if (course.is_cancelled) return 'abgebrochen'
    const today = new Date().toISOString().split('T')[0]
    if (!course.is_active) return 'beendet'
    if (course.date_start > today) return 'geplant'
    // Sarah-Regel 2026-05-28: beendet ab Start der letzten Stunde (date_end +
    // course.time_start), nicht erst am Tagesende.
    if (isCourseEnded(course)) return 'beendet'
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
    // Welle S2/M10 (Sarah 2026-05-27): Sonderzeichen aus dem PostgREST-OR-
    // Filter rausziehen, sonst crasht "O'Brien" oder ein %-Zeichen den Query.
    const safeQ = escapeForOrFilter(q)
    if (safeQ.length < 2) { setAddYogiResults([]); return }
    const { data } = await supabase.from('profiles')
      .select('id, first_name, last_name, email, is_dummy, credits(*)')
      .eq('is_admin', false)
      .or(`first_name.ilike.%${safeQ}%,last_name.ilike.%${safeQ}%,email.ilike.%${safeQ}%`)
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

    // Welle 6 (Sarah 2026-05-27, Item 7): Dummys bekommen Enrollment + Bookings
    // OHNE Credit (kein Credit-Anlegen, kein credit_id-Link). Sie sind reine
    // Anzeige-Platzhalter und sollen den Credit-Topf nicht verbrauchen.
    if (yogi.is_dummy) {
      // Welle S3/M14 (Sarah 2026-05-27): vorher 1-2 sequentielle Round-Trips
      // pro Session. Jetzt 1× existierende Bookings laden, dann Bulk-Insert
      // + Bulk-Update statt N+1.
      const sessionIds = sessionList.map((s: any) => s.id)
      const { data: existingDummy } = sessionIds.length > 0
        ? await supabase.from('bookings').select('id, session_id')
            .eq('user_id', yogi.id).in('session_id', sessionIds)
        : { data: [] as any[] }
      const existingMap: Record<string, string> = {}
      for (const ex of (existingDummy || []) as any[]) existingMap[ex.session_id] = ex.id

      const toInsert: any[] = []
      const toUpdateIds: string[] = []
      for (const s of sessionList) {
        const exId = existingMap[s.id]
        if (exId) toUpdateIds.push(exId)
        else toInsert.push({
          user_id: yogi.id, session_id: s.id,
          credit_id: null, type: 'course', status: 'active',
        })
      }
      await Promise.all([
        toInsert.length > 0
          ? supabase.from('bookings').insert(toInsert)
          : Promise.resolve(),
        toUpdateIds.length > 0
          ? supabase.from('bookings').update({
              status: 'active', credit_id: null,
              cancelled_at: null, cancel_late: false, type: 'course',
            }).in('id', toUpdateIds)
          : Promise.resolve(),
      ])
      await supabase.from('audit_log').insert({
        action: 'yogi_enrolled_by_admin',
        details: {
          target_user_id: yogi.id, course_id: course.id,
          credits: 0, guthaben_verrechnet: 0, neue_credits: 0,
          is_dummy: true,
        },
      })
      setAddingYogiToCourse(false)
      setShowAddYogiModal(false)
      setAddYogiSearch('')
      setAddYogiResults([])
      loadParticipants(course)
      return
    }

    // Verfügbares Guthaben (auto-verrechnen)
    const nowIso = new Date().toISOString()
    const { data: guthabenCredits } = await supabase.from('credits')
      .select('*').eq('user_id', yogi.id).eq('model', 'guthaben')
      .gt('expires_at', nowIso).order('expires_at')
    const availableGuthaben = (guthabenCredits || []).filter((g: any) => (g.total - g.used) > 0)
    const totalGuthaben = availableGuthaben.reduce((s: number, g: any) => s + (g.total - g.used), 0)
    const guthabenUsable = Math.min(totalGuthaben, sessionCount)
    const newCreditsNeeded = sessionCount - guthabenUsable

    // Sarah-Regel 2026-05-28: Beim Einbuchen mit Guthaben wird das Guthaben in
    // KURS-CREDITS des NEUEN Kurses UMGEWANDELT. Es wird genau EIN Course-Credit
    // über ALLE Stunden (sessionCount) angelegt; alle Bookings referenzieren ihn.
    // Das verbrauchte Guthaben wird dauerhaft abgezogen (used += verbraucht).
    // Vorher hingen die guthaben-gedeckten Bookings direkt am Guthaben-Credit →
    // (a) es erschien KEIN Kurs-Credit unter "Meine" und (b) beim Abmelden einer
    // Stunde wurde das Guthaben fälschlich zurückgebucht statt ein Kurs-Credit frei.
    let newCourseCreditId: string | null = null
    if (sessionCount > 0) {
      const { data: cc } = await supabase.from('credits').insert({
        user_id: yogi.id, course_id: course.id, model: 'course',
        total: sessionCount, used: 0, expires_at: expiresAt.toISOString(),
      }).select().single()
      newCourseCreditId = cc?.id || null
      // Welle 4.7 (Sarah 2026-05-26): Audit-Spur fuer Course-Credit-Anlage.
      if (newCourseCreditId) {
        await supabase.from('audit_log').insert({
          action: 'credit_assigned',
          details: {
            target_user_id: yogi.id, credit_id: newCourseCreditId,
            amount: sessionCount, model: 'course',
            guthaben_converted: guthabenUsable, newly_paid: newCreditsNeeded,
            course_id: course.id, expires_at: expiresAt.toISOString(),
            source: 'admin_added_yogi_to_course',
          }
        })
      }
    }

    // Verbrauchtes Guthaben dauerhaft abziehen (Umwandlung in Kurs-Credits).
    // Bookings referenzieren NICHT das Guthaben, daher fasst der
    // recalc_credit_used-Trigger das Guthaben nicht an — used bleibt stabil.
    let _remainingToConsume = guthabenUsable
    for (const g of (availableGuthaben as any[])) {
      if (_remainingToConsume <= 0) break
      const free = g.total - g.used
      const take = Math.min(free, _remainingToConsume)
      if (take > 0) {
        await supabase.from('credits').update({ used: g.used + take }).eq('id', g.id)
        _remainingToConsume -= take
      }
    }

    // Alle Bookings referenzieren den NEUEN Kurs-Credit (kein Guthaben mehr).
    const creditPerSession: (string | null)[] = sessionList.map(() => newCourseCreditId)

    // Welle S3/M14 (Sarah 2026-05-27): N+1-Loop entfernt.
    // Vorher 1-2 sequentielle Round-Trips pro Session. Jetzt:
    // 1× existierende Bookings laden, dann Bulk-Insert + Updates parallel.
    const sessionIds = sessionList.map((s: any) => s.id)
    const { data: existingBookings } = sessionIds.length > 0
      ? await supabase.from('bookings').select('id, session_id')
          .eq('user_id', yogi.id).in('session_id', sessionIds)
      : { data: [] as any[] }
    const existingBookingMap: Record<string, string> = {}
    for (const ex of (existingBookings || []) as any[]) existingBookingMap[ex.session_id] = ex.id

    const toInsert: any[] = []
    const updatePromises: any[] = []
    for (let i = 0; i < sessionList.length; i++) {
      const s = sessionList[i]
      const creditId = creditPerSession[i]
      const exId = existingBookingMap[s.id]
      if (exId) {
        // Update muss pro Booking-ID mit individuellem credit_id passieren.
        updatePromises.push(
          supabase.from('bookings').update({
            status: 'active', credit_id: creditId,
            cancelled_at: null, cancel_late: false, type: 'course',
          }).eq('id', exId)
        )
      } else {
        toInsert.push({
          user_id: yogi.id, session_id: s.id,
          credit_id: creditId, type: 'course', status: 'active',
        })
      }
    }
    await Promise.all([
      toInsert.length > 0 ? supabase.from('bookings').insert(toInsert) : Promise.resolve(),
      ...updatePromises,
    ])

    // Admin-Info wenn Guthaben verrechnet (Buchhaltungs-Info)
    if (guthabenUsable > 0) {
      try {
        await Email.adminGuthabenVerrechnet({
          yogiName: `${yogi.first_name || ''} ${yogi.last_name || ''}`.trim(),
          yogiEmail: yogi.email || '',
          courseName: course.name,
          guthabenAmount: guthabenUsable,
          courseTotal: sessionCount,
          newCreditsCount: newCreditsNeeded,
          guthabenRemaining: totalGuthaben - guthabenUsable,
        })
      } catch(e) {}
    }

    // Yogi-Email
    if (yogi.email && !yogi.is_dummy) {
      try {
        const firstSession = sessionList[0]?.date
        await Email.yogiEnrolledByAdmin({
          email: yogi.email,
          firstName: yogi.first_name || 'Yogi',
          courseName: course.name,
          weekday: course.weekday,
          timeStart: course.time_start,
          durationMin: course.duration_min || 75,
          totalUnits: course.total_units || sessionCount,  // Gesamt-Kurs (alle Einheiten)
          remainingUnits: sessionCount,                    // verbleibende für Yogi ab heute
          dateStart: course.date_start,
          firstSessionDate: firstSession,
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
      .select('user_id, enrolled_from_unit, enrolled_until_unit, end_date, profile:profiles(id, first_name, last_name, email, is_dummy), credits(total, used, expires_at, course_id)')
      .eq('course_id', course.id)
    // Sarah-Fix 2026-05-28: Beendete Enrollments (z.B. krankheitsbedingt
    // ausgetragen) sind KEINE aktiven Teilnehmer mehr — exakt dieselbe
    // Filter-Regel wie der Kurskarten-Counter (loadData), damit die
    // Teilnehmer-Anzeige ueber alle Quellen hinweg konsistent ist.
    const todayStr = new Date().toISOString().slice(0, 10)
    const activeEnrollments = (data || []).filter((e: any) => !e.end_date || e.end_date > todayStr)
    const members = (activeEnrollments).map((e: any) => ({
      ...e.profile,
      enrolled_from_unit: e.enrolled_from_unit,
      enrolled_until_unit: e.enrolled_until_unit,
      credit: (e.credits || []).find((c: any) => c.course_id === course.id),
    })).filter(Boolean)
    setParticipants(members)
    setParticipantsCourse(course)
  }

  // Welle 2.11 (Sarah 2026-05-26): Session-Bearbeiten direkt im Modal
  // (statt /admin/sessions/[id]?edit=1 Seite). Diese Funktion bestimmt anhand
  // session_type ob singleForm oder eventForm geoeffnet wird, und befuellt es.
  function startEditSession(s: any) {
    setEditingSessionId(s.id)
    if (s.session_type === 'single') {
      setSingleForm({
        name: s.name || '',
        date: s.date,
        time_start: s.time_start?.slice(0, 5) || '18:00',
        duration_min: s.duration_min || 75,
        max_spots: s.max_spots || 12,
        location: s.location || '',
        description: s.description || '',
        bring_along: s.bring_along || '',
        difficulty: s.difficulty || 'Alle Level',
      })
      setShowSingleForm(true)
    } else {
      // event_free | event_paid
      const payment_type: 'free' | 'paid' = s.session_type === 'event_paid' ? 'paid' : 'free'
      setEventForm({
        name: s.name || '',
        date: s.date,
        time_start: s.time_start?.slice(0, 5) || '18:00',
        duration_min: s.duration_min || 75,
        max_spots: s.max_spots || 12,
        location: s.location || '',
        description: s.description || '',
        bring_along: s.bring_along || '',
        difficulty: s.difficulty || 'Alle Level',
        payment_type,
        price_eur: s.price_eur != null ? String(s.price_eur) : '',
        image_url: s.image_url || '',
      })
      setShowEventForm(true)
    }
  }

  // Welle 2.11: Teilnehmer-Modal Loader fuer Sessions
  // Welle 6 (Sarah 2026-05-27, Item 11): zusaetzlich Warteliste + Notify-Yogis
  // laden, damit Sarah im Modal alle 3 Gruppen auf einen Blick sieht.
  async function loadSessionParticipants(s: any) {
    const [{ data: bookings }, { data: wl }] = await Promise.all([
      supabase.from('bookings')
        .select('id, status, type, user_id, created_at, profile:profiles(id, first_name, last_name, email, is_dummy)')
        .eq('session_id', s.id)
        .eq('status', 'active')
        .order('created_at'),
      supabase.from('waitlist')
        .select('id, user_id, position, type, created_at, profile:profiles(id, first_name, last_name, email, is_dummy)')
        .eq('session_id', s.id)
        .order('position', { ascending: true, nullsFirst: false })
        .order('created_at'),
    ])
    setSessionBookings(bookings || [])
    setSessionWaitlist(wl || [])
    setParticipantsSession(s)
  }

  // Welle 4.6 (Sarah 2026-05-26): Yogi-Suche im Session-Teilnehmer-Modal
  async function searchYogisForSession(q: string) {
    setSessionAddYogiSearch(q)
    if (q.length < 2) { setSessionAddYogiResults([]); return }
    // Welle S2/M10 (Sarah 2026-05-27): Sonderzeichen-Sanitize gegen
    // PostgREST-OR-Filter-Crash.
    const safeQ = escapeForOrFilter(q)
    if (safeQ.length < 2) { setSessionAddYogiResults([]); return }
    const { data } = await supabase.from('profiles')
      .select('id, first_name, last_name, email, is_dummy, credits(*)')
      .eq('is_admin', false)
      .or(`first_name.ilike.%${safeQ}%,last_name.ilike.%${safeQ}%,email.ilike.%${safeQ}%`)
      .limit(8)
    const bookedIds = sessionBookings.map((b: any) => b.user_id)
    setSessionAddYogiResults((data || []).filter(y => !bookedIds.includes(y.id)))
  }

  // Welle 4.6: Yogi direkt im Modal hinzufuegen (Credit-Safety analog
  // /admin/sessions/[id] handleAddYogi).
  async function addYogiToSessionFromModal(yogi: any) {
    if (!participantsSession) return
    setSessionAddingYogi(true)
    const session = participantsSession
    const sessionType: string = session.session_type || 'course_session'
    const isFreeEvent = sessionType === 'event_free'
    const isPaidEvent = sessionType === 'event_paid'
    // Welle 6 (Sarah 2026-05-27, Item 7): Dummys ohne Credit-Check.
    const isDummy = !!yogi.is_dummy
    const skipCreditLogic = isFreeEvent || isPaidEvent || isDummy

    if (skipCreditLogic) {
      // Events: credit_id=null, kein Credit-Abzug
      const { error } = await supabase.from('bookings').upsert({
        user_id: yogi.id, session_id: session.id,
        credit_id: null, type: 'single', status: 'active',
        origin_session_id: null, cancelled_at: null, cancel_late: false,
      }, { onConflict: 'user_id,session_id' })
      if (error) { setSessionAddingYogi(false); alert('Buchung konnte nicht angelegt werden.'); return }
      if (yogi.email && !yogi.is_dummy) {
        try {
          const eventLabel = isFreeEvent
            ? `${session.name} (kostenlos)`
            : `${session.name} (${session.price_eur} € — bitte bar mitbringen oder vorab überweisen)`
          await Email.bookingConfirmed({
            email: yogi.email, firstName: yogi.first_name || 'Yogi',
            courseName: eventLabel, date: session.date,
            timeStart: session.time_start, durationMin: session.duration_min || 75,
            isSingle: true, sessionType,
          })
        } catch (e) { /* nicht-blockierend */ }
      }
      await supabase.from('audit_log').insert({
        action: 'admin_added_yogi_to_event',
        // Welle 6A (Sarah 2026-05-27): name + session_date/time fuer Yogi-Protokoll
        details: { user_id: yogi.id, session_id: session.id, session_type: sessionType,
                   credit_used: false, price_eur: isPaidEvent ? session.price_eur : null,
                   name: session.name || null,
                   is_dummy: isDummy || undefined,
                   session_date: session.date, session_time: session.time_start }
      })
    } else {
      // Einzelstunde / course_session → Credit-Logik
      const pick = await selectCreditForBooking(supabase, yogi.id, session.id, session.date, session.time_start)
      if (!pick.ok) {
        alert(`${pick.message}\n\nBitte vergib zuerst Credits ueber die Yogi-Detail-Seite.`)
        setSessionAddingYogi(false)
        return
      }
      const { error } = await supabase.from('bookings').upsert({
        user_id: yogi.id, session_id: session.id,
        credit_id: pick.creditId, type: pick.type || 'single', status: 'active',
        origin_session_id: pick.originSessionId || null,
        cancelled_at: null, cancel_late: false,
      }, { onConflict: 'user_id,session_id' })
      if (error) { setSessionAddingYogi(false); alert('Buchung konnte nicht angelegt werden.'); return }
      if (yogi.email && !yogi.is_dummy) {
        try {
          await Email.bookingConfirmed({
            email: yogi.email, firstName: yogi.first_name || 'Yogi',
            courseName: session.name || '', date: session.date,
            timeStart: session.time_start, durationMin: session.duration_min || 75,
            isSingle: true, sessionType,
          })
        } catch(e) {}
      }
      await supabase.from('audit_log').insert({
        action: 'admin_added_yogi_to_session',
        // Welle 6A (Sarah 2026-05-27, Item 12): name + session_date/time fuer
        // Yogi-Protokoll — sonst steht da "SYS · Einzelstunden" statt echter Titel.
        details: { user_id: yogi.id, session_id: session.id, session_type: sessionType,
                   name: session.name || null,
                   session_date: session.date, session_time: session.time_start }
      })
    }
    setShowSessionAddYogi(false)
    setSessionAddYogiSearch('')
    setSessionAddYogiResults([])
    setSessionAddingYogi(false)
    // Reload Modal-Daten
    loadSessionParticipants(session)
    loadData()
  }

  // Welle 6 (Sarah 2026-05-27, Item 10/11): Waitlist-Yogi aus dem Modal
  // nachruecken. Bei event_free/event_paid darf auch ueberbuchung erlaubt sein.
  // Bei Dummys: kein Credit. Sonst credit_id=null (Admin-Override) + spaeter
  // Credit-Korrektur via Yogi-Detail.
  async function promoteWaitlistFromModal(wlEntry: any) {
    if (!participantsSession) return
    const sess = participantsSession
    const sessType: string = sess.session_type || 'course_session'
    const isEvent = sessType === 'event_free' || sessType === 'event_paid'
    const isDummyWl = !!wlEntry.profile?.is_dummy
    // Booking anlegen — Event ohne Credit; sonst try Credit, fallback null
    let creditId: string | null = null
    if (!isEvent && !isDummyWl) {
      try {
        const pick = await selectCreditForBooking(supabase, wlEntry.user_id, sess.id, sess.date, sess.time_start)
        if (pick.ok) creditId = pick.creditId
      } catch (e) { /* Fallback ohne credit */ }
    }
    const { error } = await supabase.from('bookings').upsert({
      user_id: wlEntry.user_id, session_id: sess.id,
      credit_id: creditId, type: 'single', status: 'active',
      origin_session_id: null, cancelled_at: null, cancel_late: false,
    }, { onConflict: 'user_id,session_id' })
    if (error) { alert('Buchung konnte nicht angelegt werden: ' + error.message); return }
    await supabase.from('waitlist').delete().eq('id', wlEntry.id)
    // Audit + Mail (was_overbooking = aktuell schon ueber max_spots)
    const totalNow = sessionBookings.length + (sess.external_participants_count || 0)
    const wasOverbooking = sess.max_spots != null && totalNow >= sess.max_spots
    await supabase.from('audit_log').insert({
      action: 'admin_promoted_waitlist_yogi',
      details: {
        user_id: wlEntry.user_id, session_id: sess.id, session_type: sessType,
        credit_used: !!creditId, was_overbooking: wasOverbooking,
        name: sess.name || null,
        session_date: sess.date, session_time: sess.time_start,
        source: 'admin_kurse_modal',
      },
    })
    // Welle 6: Yogi-Mail "waitlist-promoted" — wir nutzen das vorhandene
    // bookingConfirmed (Edge Function deployed, kein neuer Case). Yogi sieht
    // direkt "du bist eingebucht".
    if (wlEntry.profile?.email && !isDummyWl) {
      try {
        await Email.bookingConfirmed({
          email: wlEntry.profile.email,
          firstName: wlEntry.profile.first_name || 'Yogi',
          courseName: sess.name || '',
          date: sess.date, timeStart: sess.time_start,
          durationMin: sess.duration_min || 75,
          isSingle: true, sessionType: sessType,
        })
      } catch (e) { /* nicht-blockierend */ }
    }
    loadSessionParticipants(sess)
    loadData()
  }

  // Welle 4.6: Yogi austragen direkt im Modal (Event: direkt-Confirm,
  // Single: 3h-Frist-Confirm wenn applicable).
  async function cancelBookingFromModal(bookingId: string, userId: string) {
    if (!participantsSession) return
    const session = participantsSession
    const sessionType: string = session.session_type || 'course_session'
    const isEvent = sessionType === 'event_free' || sessionType === 'event_paid'
    const isPaidEvent = sessionType === 'event_paid'

    let confirmText = 'Yogi austragen?'
    if (isEvent) {
      confirmText = 'Yogi aus dem Event austragen?'
      if (isPaidEvent) {
        const sessionStart = new Date(`${session.date}T${session.time_start}`).getTime()
        const within7d = (sessionStart - Date.now()) <= 7 * 24 * 60 * 60 * 1000 && sessionStart > Date.now()
        if (within7d) {
          confirmText = `Yogi aus dem Event austragen?\n\n⚠️ Innerhalb der 7-Tage-Stornofrist — eine eventuell schon geleistete Bezahlung (${session.price_eur || '?'} €) musst du extern erstatten.`
        }
      }
    } else {
      const sessionStart = new Date(`${session.date}T${session.time_start}`).getTime()
      const within3h = (sessionStart - Date.now()) <= 3 * 60 * 60 * 1000 && sessionStart > Date.now()
      if (within3h) {
        confirmText = `Innerhalb der 3-Stunden-Frist!\n\nWenn du jetzt austraegst, verfaellt der Credit des Yogi.\nTrotzdem austragen?`
      }
    }
    if (!confirm(confirmText)) return

    // Welle 6A (Sarah 2026-05-27): within_7d für event_paid in Audit + Session-Name
    // (sonst zeigt Yogi-Protokoll "SYS · Events" statt des echten Titels).
    let within7d = false
    if (isPaidEvent) {
      const sessionStart = new Date(`${session.date}T${session.time_start}`).getTime()
      within7d = (sessionStart - Date.now()) <= 7 * 24 * 60 * 60 * 1000 && sessionStart > Date.now()
    }
    await supabase.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false, cancelled_by: 'admin',
    }).eq('id', bookingId)
    await supabase.from('audit_log').insert({
      action: 'booking_cancelled_by_admin',
      details: { booking_id: bookingId, session_id: session.id, user_id: userId,
                 target_user_id: userId,
                 session_type: sessionType, credit_returned: !isEvent, within_3h: false,
                 within_7d: within7d,
                 // Welle 6A: echter Titel für SYS-Container-Sessions
                 name: session.name || null,
                 session_date: session.date, session_time: session.time_start }
    })
    // Bug-Fix (Sarah 2026-05-28): Auch dieser Austrag-Pfad (Teilnehmer-Modal auf
    // der Kurse-Seite) muss die Warteliste nachrücken lassen — fehlte bisher, so
    // dass bei Events/Stunden niemand nachrückte obwohl ein Platz frei wurde.
    try { await promoteWaitlistOrOfferLate(supabase, session.id) } catch (e) { console.error('promote (kurse-participant):', e) }
    loadSessionParticipants(session)
    loadData()
  }

  // Welle 4.6 (Sarah 2026-05-26): Sprechblase-Promote auch fuer Events/Singles
  // (vorher nur in /admin/sessions/[id] und nur fuer Charity). Postet die
  // Session in das App-Banner ('admin_announcement') das alle Yogis sehen.
  async function promoteSessionToSpeechbubble(s: any) {
    const sessType = s.session_type
    const isEventFree = sessType === 'event_free'
    const isEventPaid = sessType === 'event_paid'
    const isSingle = sessType === 'single'
    const isCharitySession = s.course?.is_free
    const sessionDate = new Date(s.date)
    const isThisYear = sessionDate.getFullYear() === new Date().getFullYear()
    const dateFormatted = sessionDate.toLocaleDateString('de-DE',
      isThisYear
        ? { weekday: 'long', day: 'numeric', month: 'long' }
        : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const timeStr = s.time_start?.slice(0, 5)
    const sessionName = s.name || s.course?.name || 'Stunde'
    let message = ''
    if (isEventPaid) {
      message = `Event: ${sessionName} am ${dateFormatted} um ${timeStr} Uhr — ${s.price_eur} €`
    } else if (isEventFree) {
      message = `Kostenloses Event: ${sessionName} am ${dateFormatted} um ${timeStr} Uhr`
    } else if (isCharitySession) {
      message = `${sessionName} am ${dateFormatted} um ${timeStr} Uhr — kostenlos!`
    } else if (isSingle) {
      message = `Einzelstunde: ${sessionName} am ${dateFormatted} um ${timeStr} Uhr`
    } else {
      message = `${sessionName} am ${dateFormatted} um ${timeStr} Uhr`
    }
    if (!confirm(`In Sprechblase für alle Yogis posten?\n\n"${message}"`)) return
    const { error } = await supabase.from('admin_announcement')
      .update({
        message, is_active: true,
        link_url: `/kurse/${s.id}`, link_label: isEventPaid || isEventFree ? 'Zum Event' : 'Zur Stunde',
        updated_at: new Date().toISOString(),
      }).eq('id', 1)
    if (error) alert('Fehler: ' + error.message)
    else alert('In der Sprechblase für alle Yogis gepostet.')
  }

  // Welle 2.11: Teilen-Button auf Karte (Web Share / Copy-Link Fallback).
  // Welle 4.6: bei Events/Charity zusaetzlich Sprechblase-Option anbieten.
  async function shareSession(s: any) {
    const url = `${window.location.origin}/kurse/${s.id}`
    const title = s.name || 'Yoga-Stunde'
    const dateStr = new Date(s.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' })
    const text = `${title} · ${dateStr} · ${s.time_start?.slice(0, 5)} Uhr`
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url })
      } catch { /* User abgebrochen */ }
    } else {
      try {
        await navigator.clipboard.writeText(`${text}\n${url}`)
        alert('Link kopiert!')
      } catch {
        alert(url)
      }
    }
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
      // Bug-Fix (Sarah 2026-05-28): Credit-ID merken und an die Bookings haengen.
      // Vorher wurde der Credit zwar angelegt, aber die Bookings bekamen KEIN
      // credit_id → der Trigger trg_sync_credit_used konnte nie hochzaehlen →
      // Anzeige blieb "0/3 genutzt" obwohl 3 Stunden gebucht waren.
      const { data: rolloverCredit } = await supabase.from('credits').insert({
        user_id: userId, course_id: newCourse.id,
        model: 'course', total: credits, used: 0,
        expires_at: expiresAt.toISOString()
      }).select('id').single()
      const rolloverCreditId = rolloverCredit?.id || null

      // Sessions buchen — credit_id verlinken (damit credits.used korrekt zaehlt)
      for (const sessionId of sessionIds) {
        const { data: existing } = await supabase.from('bookings')
          .select('id').eq('user_id', userId).eq('session_id', sessionId).maybeSingle()
        if (!existing) {
          await supabase.from('bookings').insert({
            user_id: userId, session_id: sessionId,
            credit_id: rolloverCreditId, type: 'course', status: 'active'
          })
        } else {
          // Falls Buchung schon existiert (z.B. erneuter Rollover): credit_id
          // nachziehen, sofern noch keiner gesetzt ist.
          await supabase.from('bookings').update({ credit_id: rolloverCreditId })
            .eq('id', existing.id).is('credit_id', null)
        }
      }

      // Email senden — Folgekurs: total = credits (= alle Sessions), remaining = credits
      // (Yogi steigt von Anfang an im Folgekurs ein, daher total = remaining)
      if (member.email) {
        await Email.yogiEnrolledByAdmin({
          email: member.email,
          firstName: member.first_name || 'Yogi',
          courseName: targetCourse.name,
          weekday: targetCourse.weekday,
          timeStart: targetCourse.time_start,
          durationMin: targetCourse.duration_min || 75,
          totalUnits: targetCourse.total_units || credits,
          remainingUnits: credits,
          dateStart: targetCourse.date_start,
          firstSessionDate: targetCourse.date_start,
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

  // Welle 2.5 (Sarah 2026-05-26): Render-Helper für Kurs-Card (aktive + beendete
  // Sektion teilen sich exakt das gleiche Markup). `isEnded` nur fuer data-attr.
  function renderCourseCard(c: any, isEnded: boolean) {
    // Welle 6 (Sarah 2026-05-27, Item 1): "laufender Kurs" = is_active &&
    // !is_cancelled && date_end >= today. Bei diesem Zustand soll der
    // Loesch-Button NICHT direkt sichtbar sein, sondern nur ueber ein "…"-Menue.
    // Sarah-Regel 2026-05-28: läuft = noch nicht beendet (letzte Stunde noch
    // nicht begonnen) statt date_end >= heute.
    const isRunning = c.is_active && !c.is_cancelled && !isCourseEnded(c)
    const courseYogiCount = c.participant_count ?? (c.enrollments?.length || 0)
    return (
      <div key={c.id} className="card mb-3 relative" data-course-card={isEnded ? 'ended' : 'active'}>
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
              Teilnehmer:{' '}
              <strong className={c.is_overbooked ? 'text-yoga-red-text' : ''}>
                {c.participant_count ?? (c.enrollments || []).length}
              </strong>
              {c.max_spots ? `/${c.max_spots}` : ''}
              {c.is_overbooked && (
                <span className="ml-1 text-xs font-semibold text-yoga-red-text">· überbucht</span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`badge ${c.is_single ? 'badge-wait' : 'badge-free'}`}>
              {c.is_single ? 'Einzelstunde' : 'Kurs'}
            </span>
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
          {/* Sarah-Wunsch 2026-05-28: "…"-Overflow-Menü am Reihen-Ende (gleiche
              Höhe wie die Buttons, runder Icon-Button). Abbrechen → Archivieren
              → Löschen. Pillen bleiben dadurch ganz rechts in der Kopfzeile. */}
          <div className="relative flex-shrink-0">
            <button onClick={() => setMoreMenuOpen(moreMenuOpen === c.id ? null : c.id)}
              className="text-sm border border-yoga-border2 rounded-full py-2 px-3 font-semibold hover:opacity-80 cursor-pointer text-yoga-text/70 flex items-center justify-center"
              title="Mehr Optionen" aria-label="Mehr Optionen">
              <i className="ti ti-dots-vertical text-base" />
            </button>
            {moreMenuOpen === c.id && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMoreMenuOpen(null)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-yoga-border rounded-yoga shadow-lg min-w-[200px] overflow-hidden">
                  {courseYogiCount > 0 && !c.is_cancelled && (
                    <button onClick={() => { setMoreMenuOpen(null); setCancellingCourse(c); setCancelReason(''); setCancelRefundMode(null) }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-yoga-gray cursor-pointer border-0 bg-transparent flex items-center gap-2 text-yoga-text/80">
                      <i className="ti ti-ban" />Abbrechen
                    </button>
                  )}
                  <button onClick={() => { setMoreMenuOpen(null); archiveCourse(c) }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-yoga-gray cursor-pointer border-0 bg-transparent flex items-center gap-2 text-yoga-text/80">
                    <i className="ti ti-archive" />Archivieren
                  </button>
                  <button onClick={() => {
                      setMoreMenuOpen(null)
                      if (courseYogiCount > 0) {
                        alert('Du hast noch Teilnehmer in diesem Kurs.\n\nSage ihn zuerst ab (Teilnehmer müssen informiert werden), dann kannst du ihn löschen.')
                        return
                      }
                      setDeleteCourseModal({ course: c, step: 1, nameInput: '', yogiCount: courseYogiCount })
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-yoga-gray cursor-pointer border-0 bg-transparent flex items-center gap-2 text-yoga-red-text">
                    <i className="ti ti-trash" />Löschen
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        {showRolloverButton(c) && (
          <button onClick={async () => {
            setFolgekursCourse(c)
            setFolgekursStep('dates')
            setFolgekursDateStart('')
            setFolgekursDateEnd('')
            setFolgekursExcluded([])
            setFolgekursForm({
              name: c.name, weekday: c.weekday, time_start: c.time_start,
              duration_min: c.duration_min, location: c.location, description: c.description,
              bring_along: c.bring_along, difficulty: c.difficulty,
              max_spots: c.max_spots, total_units: c.total_units,
            })
            await loadFolgekursMembers(c.id)
          }}
            className="w-full mt-2 text-sm bg-yoga-green-bg text-yoga-green-text rounded-full py-2 font-semibold hover:opacity-80 border-0 cursor-pointer">
            <i className="ti ti-arrows-transfer-down mr-1" />Folgekurs anlegen
          </button>
        )}
        {/* Sarah-Wunsch 2026-05-28: Abbrechen + Archivieren sind jetzt im
            "…"-Menü oben rechts (zusammen mit Löschen). */}
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
                  {s.is_replacement && (
                    <span className="text-yoga-text font-semibold">
                      {' · Ersatzstunde'}
                      {s.original_session && (
                        <span className="text-yoga-text/55 font-normal">
                          {' (für '}{new Date(s.original_session.date).toLocaleDateString('de-DE', { day:'numeric', month:'short' })}{')'}
                        </span>
                      )}
                    </span>
                  )}
                </span>
                <i className="ti ti-chevron-right text-yoga-text/30" />
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Kurse verwalten" isAdmin />
      <div className="px-4 py-4">
        {(!showForm && !showSingleForm && !showEventForm) ? (
          <>
            {/* Welle 2 (Sarah 2026-05-26): 3 Buttons nebeneinander — Kurs, Einzelstunde, Event.
                Auf kleinen Screens als Stack. Icons: ti-school / ti-yoga / ti-confetti. */}
            <div className="grid grid-cols-3 max-md:grid-cols-1 gap-2 mb-4">
              <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
                Neuer Kurs
              </button>
              <button onClick={() => setShowSingleForm(true)} className="btn-primary text-sm">
                Neue Stunde
              </button>
              <button onClick={() => setShowEventForm(true)} className="btn-primary text-sm">
                Neues Event
              </button>
            </div>
            {/* Welle 2.5 (Sarah 2026-05-26): Klar getrennte Reihenfolge —
                1) Aktive Kurse (nur noch nicht beendete)
                2) Geplante Stunden & Events (Container-Sessions weiter unten)
                3) Beendete Kurse (eigene Sektion ganz unten)
                Aktive + Beendete teilen die GLEICHE Render-Logik via inline Helper. */}
            <p className="section-label">Aktive Kurse</p>
            {(() => {
              // Sarah-Regel 2026-05-28: aktiv = noch nicht beendet (letzte Stunde
              // noch nicht begonnen).
              const activeCourses = courses.filter(c => c.is_active && !isCourseEnded(c) && !c.is_cancelled)
              if (activeCourses.length === 0) {
                return <p className="text-sm text-yoga-text/40 text-center py-4">Keine aktiven Kurse</p>
              }
              return null
            })()}
            {courses
              .filter(c => c.is_active && !isCourseEnded(c) && !c.is_cancelled)
              .map(c => renderCourseCard(c, false))}

            {/* Welle 2 (Sarah 2026-05-26): zweite Sektion — Sessions aus den
                SYS-Containern (Einzelstunden, Events kostenlos/bezahlt).
                Chronologisch, nur Anzeige + Detail-Navigation.
                Welle 2.10 (Sarah 2026-05-26): Aufgeteilt in "Geplante" (date >= heute)
                und "Beendete Stunden & Events" (date < heute, eigene Sektion unten). */}
            <p className="section-label mt-6">Geplante Stunden & Events</p>
            {(() => {
              // Welle 4.5 (Sarah 2026-05-26): "geplant" heisst sessionStart >= now
              // (nicht mehr nur Datum-Vergleich). Heutiges 18-Uhr-Event ist um
              // 19 Uhr in "Beendete", nicht erst morgen.
              const nowMs = Date.now()
              const isUpcoming = (s: any) => new Date(`${s.date}T${s.time_start}`).getTime() >= nowMs
              const upcoming = containerSessions.filter((s: any) => isUpcoming(s) && !s.is_cancelled)
              if (upcoming.length === 0) {
                return <p className="text-sm text-yoga-text/40 text-center py-4">Noch keine geplanten Stunden oder Events</p>
              }
              return null
            })()}
            {containerSessions
              .filter((s: any) => {
                const nowMs = Date.now()
                return new Date(`${s.date}T${s.time_start}`).getTime() >= nowMs && !s.is_cancelled
              })
              .map((s: any) => {
                const activeBookings = (s.bookings || []).filter((b: any) => b.status === 'active').length
                const ext = s.external_participants_count || 0
                const totalCount = activeBookings + ext
                const overbooked = s.max_spots != null && totalCount > s.max_spots
                // Welle 4.5 (Sarah 2026-05-26): Externe Teilnehmer nur bei Events,
                // NICHT bei Einzelstunden ('single'). Bei Einzelstunden gibt es
                // logisch keine "externen" — entweder Yogi ist gebucht oder nicht.
                const isEventType = s.session_type === 'event_free' || s.session_type === 'event_paid'
                // Type-Badge wie der "Kurs/Einzelstunde"-Badge bei Kursen.
                const typeBadge = s.session_type === 'single' ? { label: 'Einzelstunde', cls: 'badge-wait' }
                  : s.session_type === 'event_free' ? { label: 'Kostenlos', cls: 'badge-free' }
                  : s.session_type === 'event_paid' ? { label: `${s.price_eur} €`, cls: 'badge-wait' }
                  : { label: s.session_type, cls: 'badge-wait' }
                const isOpen = s.is_open !== false
                // Welle 2.9 (Sarah 2026-05-26): Layout 1:1 wie Kurs-Card oben drueber.
                // - Header: Name + Typ-Badge links, Frei/Gesperrt-Pille + Typ-Pille rechts oben (gleiche Groesse via "badge"-Klasse)
                // - 3 Buttons: Bearbeiten / Teilnehmer / Loeschen
                // - External-Counter +/- inline ueber Teilnehmer-Zeile
                return (
                  <div key={s.id} className="card mb-3 relative">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <div className="text-base font-bold truncate">{s.name || '—'}</div>
                        </div>
                        <div className="text-sm text-yoga-text/50">
                          {new Date(s.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' })}
                          {' · '}{s.time_start?.slice(0,5)} Uhr · {s.duration_min} min
                        </div>
                        {/* Welle 6 (Sarah 2026-05-27): Externe-Counter +/-
                            VON DER KARTE entfernt — nur noch im Teilnehmer-Modal.
                            Karte zeigt aber weiterhin die Summe (interne + externe)
                            damit Sarah auf einen Blick "ueberbucht" sieht.
                            Bei Einzelstunden gibt es keine externe Logik. */}
                        <div className="text-sm text-yoga-text/60 mt-0.5">
                          Teilnehmer:{' '}
                          <strong className={overbooked ? 'text-yoga-red-text' : ''}>{totalCount}</strong>
                          {s.max_spots ? `/${s.max_spots}` : ''}
                          {overbooked && <span className="ml-1 text-xs font-semibold text-yoga-red-text">· überbucht</span>}
                          {isEventType && ext > 0 && (
                            <span className="text-xs text-yoga-text/50 ml-1">· {ext} extern</span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        {/* Typ-Pille rechts oben (gleicher 'badge'-Stil wie 'Kurs' bei Kursen) */}
                        <span className={`badge ${typeBadge.cls}`}>{typeBadge.label}</span>
                        {/* Frei/Gesperrt-Pille — toggle (gleicher Stil wie bei Kursen) */}
                        <button onClick={() => toggleSessionOpen(s.id, isOpen)}
                          className={`badge border-0 cursor-pointer hover:opacity-80 ${
                            isOpen ? 'bg-yoga-green-bg text-yoga-green-text' : 'bg-yoga-amber-bg text-yoga-amber-text'
                          }`}
                          title={isOpen ? 'Klicken zum Sperren' : 'Klicken zum Freigeben'}>
                          <i className={`ti ${isOpen ? 'ti-lock-open' : 'ti-lock'} text-xs mr-0.5`} />
                          {isOpen ? 'Frei' : 'Gesperrt'}
                        </button>
                      </div>
                    </div>
                    {/* Welle 2.11 (Sarah 2026-05-26): Bild raus aus Karte —
                        zeigen wir nur noch im Bearbeiten-Modal. Karte bleibt
                        kompakt und einheitlich. */}
                    {/* Buttons-Reihe 1: Bearbeiten / Teilnehmer / Teilen
                        Welle 2.11: Bearbeiten + Teilnehmer oeffnen jetzt Modals
                        (statt /admin/sessions/[id] Seite). Teilen-Button neu
                        auf der Karte (analog Kurs-Detail "Stunde teilen"). */}
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => startEditSession(s)}
                        className="flex-1 text-sm border border-yoga-border2 rounded-full py-2 font-semibold hover:opacity-80 cursor-pointer">
                        <i className="ti ti-edit mr-1" />Bearbeiten
                      </button>
                      <button onClick={() => loadSessionParticipants(s)}
                        className="flex-1 text-sm border border-yoga-border2 rounded-full py-2 font-semibold hover:opacity-80 cursor-pointer text-yoga-text/70">
                        <i className="ti ti-users mr-1" />Teilnehmer
                      </button>
                      {/* Welle 6 (Sarah 2026-05-27): einzelner "Teilen"-Button mit
                          Popover-Dropdown — ersetzt den separaten Sprechblase-Button.
                          Optionen: Sprechblase / Extern teilen. */}
                      <div className="relative flex-1">
                        <button onClick={() => setShareMenuOpen(shareMenuOpen === s.id ? null : s.id)}
                          className="w-full text-sm border border-yoga-border2 rounded-full py-2 font-semibold hover:opacity-80 cursor-pointer text-yoga-text/70">
                          <i className="ti ti-share mr-1" />Teilen
                        </button>
                        {shareMenuOpen === s.id && (
                          <>
                            {/* Click-Outside-Fang */}
                            <div className="fixed inset-0 z-40" onClick={() => setShareMenuOpen(null)} />
                            <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-yoga-border rounded-yoga shadow-lg min-w-[180px] overflow-hidden">
                              {(isEventType || s.course?.is_free) && (
                                <button onClick={() => { setShareMenuOpen(null); promoteSessionToSpeechbubble(s) }}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-yoga-gray cursor-pointer border-0 bg-transparent flex items-center gap-2">
                                  <i className="ti ti-bullhorn text-yoga-green-text" />
                                  In Sprechblase teilen
                                </button>
                              )}
                              <button onClick={() => { setShareMenuOpen(null); shareSession(s) }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-yoga-gray cursor-pointer border-0 bg-transparent flex items-center gap-2">
                                <i className="ti ti-external-link text-yoga-text/60" />
                                Extern teilen
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                      {/* Sarah-Wunsch 2026-05-28: "…"-Overflow-Menü am Reihen-Ende
                          (gleiche Höhe, runder Icon-Button). Absagen → Löschen.
                          Pillen bleiben dadurch ganz rechts in der Kopfzeile. */}
                      <div className="relative flex-shrink-0">
                        <button onClick={() => setMoreMenuOpen(moreMenuOpen === s.id ? null : s.id)}
                          className="text-sm border border-yoga-border2 rounded-full py-2 px-3 font-semibold hover:opacity-80 cursor-pointer text-yoga-text/70 flex items-center justify-center"
                          title="Mehr Optionen" aria-label="Mehr Optionen">
                          <i className="ti ti-dots-vertical text-base" />
                        </button>
                        {moreMenuOpen === s.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setMoreMenuOpen(null)} />
                            <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-yoga-border rounded-yoga shadow-lg min-w-[200px] overflow-hidden">
                              {(activeBookings > 0 || ext > 0) && (
                                <button onClick={() => { setMoreMenuOpen(null); setCancellingSession(s); setCancelSessionReason('') }}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-yoga-gray cursor-pointer border-0 bg-transparent flex items-center gap-2 text-yoga-text/80">
                                  <i className="ti ti-ban" />Absagen
                                </button>
                              )}
                              <button onClick={() => { setMoreMenuOpen(null); deleteContainerSession(s.id, activeBookings + ext) }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-yoga-gray cursor-pointer border-0 bg-transparent flex items-center gap-2 text-yoga-red-text">
                                <i className="ti ti-trash" />Löschen
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}

            {/* Welle 2.10 (Sarah 2026-05-26): Beendete Stunden & Events —
                Container-Sessions deren date < heute. Eigene Sektion analog
                "Beendete Kurse". Wenn null: Sektion komplett ausgeblendet
                (kein leerer Header). Card-Layout identisch zur "Geplante"-
                Sektion, nur dezent via opacity-70 abgeblendet. Bearbeiten/
                Absagen-Buttons fallen weg (keine sinnvolle Aktion mehr in
                der Vergangenheit), nur Teilnehmer + Löschen bleiben. */}
            {(() => {
              // Welle 4.5 (Sarah 2026-05-26): "beendet" heisst sessionStart < now
              // (Stunde hat begonnen — egal ob heute oder gestern).
              const nowMs = Date.now()
              const endedSessions = containerSessions.filter((s: any) =>
                new Date(`${s.date}T${s.time_start}`).getTime() < nowMs && !s.is_cancelled
              )
              if (endedSessions.length === 0) return null
              return <>
                <p className="section-label mt-6">Beendete Stunden & Events</p>
                {endedSessions.map((s: any) => {
                  const activeBookings = (s.bookings || []).filter((b: any) => b.status === 'active').length
                  const ext = s.external_participants_count || 0
                  const totalCount = activeBookings + ext
                  const typeBadge = s.session_type === 'single' ? { label: 'Einzelstunde', cls: 'badge-wait' }
                    : s.session_type === 'event_free' ? { label: 'Kostenlos', cls: 'badge-free' }
                    : s.session_type === 'event_paid' ? { label: `${s.price_eur} €`, cls: 'badge-wait' }
                    : { label: s.session_type, cls: 'badge-wait' }
                  return (
                    <div key={s.id} className="card mb-3 opacity-70" data-ended-session>
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <div className="text-base font-bold truncate">{s.name || '—'}</div>
                          </div>
                          <div className="text-sm text-yoga-text/50">
                            {new Date(s.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' })}
                            {' · '}{s.time_start?.slice(0,5)} Uhr · {s.duration_min} min
                          </div>
                          <div className="text-sm text-yoga-text/60 mt-0.5">
                            Teilnehmer: <strong>{totalCount}</strong>{s.max_spots ? `/${s.max_spots}` : ''}
                            {ext > 0 && <span className="text-xs text-yoga-text/50 ml-1">· {ext} extern</span>}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <span className={`badge ${typeBadge.cls}`}>{typeBadge.label}</span>
                          <span className="badge bg-yoga-gray text-yoga-text/50 border-0">
                            <i className="ti ti-check text-xs mr-0.5" />Beendet
                          </span>
                        </div>
                      </div>
                      {/* Beendet: nur Teilnehmer-Ansicht + Löschen
                          Welle 3.6: Tailwind-Klasse statt CSS-Var. */}
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => loadSessionParticipants(s)}
                          className="flex-1 text-sm border border-yoga-border2 rounded-full py-2 font-semibold hover:opacity-80 cursor-pointer text-yoga-text/70">
                          <i className="ti ti-users mr-1" />Teilnehmer
                        </button>
                        <button onClick={() => deleteContainerSession(s.id, activeBookings)}
                          className="flex-1 text-sm rounded-full py-2 font-semibold hover:opacity-80 cursor-pointer border-0 text-yoga-red-text bg-yoga-red-bg">
                          <i className="ti ti-trash mr-1" />Löschen
                        </button>
                      </div>
                    </div>
                  )
                })}
              </>
            })()}

            {/* Welle 3.5 (Sarah 2026-05-26): Abgesagte Stunden & Events —
                eigene Sektion. Hotfix Welle 4.5: KEINE durchgestrichenen Titel
                (Sarah-Wunsch). Differenzierung via text-yoga-text/60 (gedimmt)
                + rote „Abgesagt"-Pille + opacity-70 auf der ganzen Karte.
                Wenn null: Sektion ausgeblendet. */}
            {(() => {
              const cancelledSessions = containerSessions.filter((s: any) => s.is_cancelled)
              if (cancelledSessions.length === 0) return null
              return <>
                <p className="section-label mt-6">Abgesagte Stunden & Events</p>
                {cancelledSessions.map((s: any) => {
                  const activeBookings = (s.bookings || []).filter((b: any) => b.status === 'active').length
                  const typeBadge = s.session_type === 'single' ? { label: 'Einzelstunde', cls: 'badge-wait' }
                    : s.session_type === 'event_free' ? { label: 'Kostenlos', cls: 'badge-free' }
                    : s.session_type === 'event_paid' ? { label: `${s.price_eur} €`, cls: 'badge-wait' }
                    : { label: s.session_type, cls: 'badge-wait' }
                  return (
                    <div key={s.id} className="card mb-3 opacity-70" data-cancelled-session>
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <div className="text-base font-bold truncate text-yoga-text/60">{s.name || '—'}</div>
                          </div>
                          <div className="text-sm text-yoga-text/50">
                            {new Date(s.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' })}
                            {' · '}{s.time_start?.slice(0,5)} Uhr · {s.duration_min} min
                          </div>
                          {s.cancel_reason && (
                            <div className="text-xs text-yoga-text/50 mt-0.5 italic">Grund: {s.cancel_reason}</div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <span className={`badge ${typeBadge.cls}`}>{typeBadge.label}</span>
                          <span className="badge bg-yoga-red-bg text-yoga-red-text border-0">
                            <i className="ti ti-ban text-xs mr-0.5" />Abgesagt
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => loadSessionParticipants(s)}
                          className="flex-1 text-sm border border-yoga-border2 rounded-full py-2 font-semibold hover:opacity-80 cursor-pointer text-yoga-text/70">
                          <i className="ti ti-users mr-1" />Teilnehmer
                        </button>
                        <button onClick={() => deleteContainerSession(s.id, activeBookings)}
                          className="flex-1 text-sm bg-yoga-red-bg text-yoga-red-text rounded-full py-2 font-semibold hover:opacity-80 cursor-pointer border-0">
                          <i className="ti ti-trash mr-1" />Endgültig löschen
                        </button>
                      </div>
                    </div>
                  )
                })}
              </>
            })()}

            {/* Welle 2.5 (Sarah 2026-05-26): Beendete Kurse — eigene Sektion
                unten, gleiche Card-Logik wie aktive. */}
            {(() => {
              // Sarah-Regel 2026-05-28: beendet = letzte Stunde hat begonnen
              // (date_end + course.time_start) ODER abgebrochen.
              const ended = courses.filter(c => c.is_active && (isCourseEnded(c) || c.is_cancelled))
              if (ended.length === 0) return null
              return <>
                <p className="section-label mt-6">Beendete Kurse</p>
                {ended.map(c => renderCourseCard(c, true))}
              </>
            })()}

            {/* Sarah 2026-05-28: Inaktive Kurse splitten — vom Admin ABGEBROCHENE
                Kurse (is_cancelled) bekommen eine eigene Sektion "Abgebrochene
                Kurse", regulär ARCHIVIERTE (is_active=false, nicht abgebrochen)
                bleiben unter "Archivierte Kurse". Gleiche Card-Logik. */}
            {(() => {
              const inactive = courses.filter(c => !c.is_active)
              const abgebrochen = inactive.filter(c => c.is_cancelled)
              const archiviert = inactive.filter(c => !c.is_cancelled)
              const renderInactiveCard = (c: any) => (
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
              )
              return <>
                {abgebrochen.length > 0 && (
                  <>
                    <p className="section-label mt-6">Abgebrochene Kurse</p>
                    {abgebrochen.map(renderInactiveCard)}
                  </>
                )}
                {archiviert.length > 0 && (
                  <>
                    <p className="section-label mt-6">Archivierte Kurse</p>
                    {archiviert.map(renderInactiveCard)}
                  </>
                )}
              </>
            })()}
          </>
        ) : showSingleForm ? (
          <>
            <button onClick={() => {
              setShowSingleForm(false)
              setEditingSessionId(null)
              setSingleForm({ name: '', date: '', time_start: '18:00', duration_min: 75, max_spots: 12, location: '', description: '', bring_along: '', difficulty: 'Alle Level' })
            }} className="flex items-center gap-1 text-sm text-yoga-text/60 mb-4 hover:opacity-80">
              <i className="ti ti-arrow-left" /> Zurück zur Übersicht
            </button>
            <h2 className="text-lg font-bold mb-4">{editingSessionId ? 'Einzelstunde bearbeiten' : 'Einzelstunde anlegen'}</h2>
            <form onSubmit={(e) => { e.preventDefault(); handleSaveSingle() }} className="space-y-3">
              <div>
                <label className="field-label">Name *</label>
                <input className="field-input" value={singleForm.name}
                  onChange={e => setSingleForm({ ...singleForm, name: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Datum *</label>
                  <input className="field-input" type="date" value={singleForm.date}
                    onChange={e => setSingleForm({ ...singleForm, date: e.target.value })} required />
                </div>
                <div>
                  <label className="field-label">Uhrzeit *</label>
                  <input className="field-input" type="time" value={singleForm.time_start}
                    onChange={e => setSingleForm({ ...singleForm, time_start: e.target.value })} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Dauer (Min.)</label>
                  {/* Welle 6 (Sarah 2026-05-27): leer ('') ist erlaubter Zwischenstand
                      damit Default-Wert geloescht und neu getippt werden kann. */}
                  <input className="field-input" type="number" min={1}
                    value={singleForm.duration_min === '' ? '' : singleForm.duration_min}
                    onChange={e => setSingleForm({ ...singleForm, duration_min: e.target.value === '' ? '' : parseInt(e.target.value) })} />
                </div>
                <div>
                  <label className="field-label">Max. Teilnehmer</label>
                  <input className="field-input" type="number" min={1} max={50}
                    value={singleForm.max_spots === '' ? '' : singleForm.max_spots}
                    onChange={e => setSingleForm({ ...singleForm, max_spots: e.target.value === '' ? '' : parseInt(e.target.value) })} />
                </div>
              </div>
              <div>
                <label className="field-label">Ort</label>
                <input className="field-input" value={singleForm.location}
                  onChange={e => setSingleForm({ ...singleForm, location: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Beschreibung</label>
                <textarea className="field-input" rows={3} value={singleForm.description}
                  onChange={e => setSingleForm({ ...singleForm, description: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Was mitbringen</label>
                <input className="field-input" value={singleForm.bring_along}
                  onChange={e => setSingleForm({ ...singleForm, bring_along: e.target.value })}
                  placeholder="z.B. Matte, bequeme Kleidung" />
              </div>
              <div>
                <label className="field-label">Schwierigkeitsgrad</label>
                {/* Welle 6 (Sarah 2026-05-27): identisch zu Kurs-Form — 3 Optionen. */}
                <select className="field-input" value={singleForm.difficulty}
                  onChange={e => setSingleForm({ ...singleForm, difficulty: e.target.value })}>
                  {['Alle Level', 'Beginner', 'Geübte'].map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <button type="submit" className="btn-primary" disabled={savingSingleOrEvent}>
                {savingSingleOrEvent ? 'Wird gespeichert...' : editingSessionId ? 'Speichern' : 'Anlegen'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => {
                setShowSingleForm(false)
                setEditingSessionId(null)
                setSingleForm({ name: '', date: '', time_start: '18:00', duration_min: 75, max_spots: 12, location: '', description: '', bring_along: '', difficulty: 'Alle Level' })
              }}>Abbrechen</button>
            </form>
          </>
        ) : showEventForm ? (
          <>
            <button onClick={() => {
              setShowEventForm(false)
              setEditingSessionId(null)
              setEventForm({ name: '', date: '', time_start: '18:00', duration_min: 75, max_spots: 12, location: '', description: '', bring_along: '', difficulty: 'Alle Level', payment_type: 'free', price_eur: '', image_url: '' })
            }} className="flex items-center gap-1 text-sm text-yoga-text/60 mb-4 hover:opacity-80">
              <i className="ti ti-arrow-left" /> Zurück zur Übersicht
            </button>
            <h2 className="text-lg font-bold mb-4">{editingSessionId ? 'Event bearbeiten' : 'Event anlegen'}</h2>
            <form onSubmit={(e) => { e.preventDefault(); handleSaveEvent() }} className="space-y-3">
              <div>
                <label className="field-label">Name *</label>
                <input className="field-input" value={eventForm.name}
                  onChange={e => setEventForm({ ...eventForm, name: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Datum *</label>
                  <input className="field-input" type="date" value={eventForm.date}
                    onChange={e => setEventForm({ ...eventForm, date: e.target.value })} required />
                </div>
                <div>
                  <label className="field-label">Uhrzeit *</label>
                  <input className="field-input" type="time" value={eventForm.time_start}
                    onChange={e => setEventForm({ ...eventForm, time_start: e.target.value })} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Dauer (Min.)</label>
                  {/* Welle 6 (Sarah 2026-05-27): leer ('') ist erlaubter Zwischenstand */}
                  <input className="field-input" type="number" min={1}
                    value={eventForm.duration_min === '' ? '' : eventForm.duration_min}
                    onChange={e => setEventForm({ ...eventForm, duration_min: e.target.value === '' ? '' : parseInt(e.target.value) })} />
                </div>
                <div>
                  <label className="field-label">Max. Teilnehmer</label>
                  <input className="field-input" type="number" min={1} max={200}
                    value={eventForm.max_spots === '' ? '' : eventForm.max_spots}
                    onChange={e => setEventForm({ ...eventForm, max_spots: e.target.value === '' ? '' : parseInt(e.target.value) })} />
                </div>
              </div>
              <div>
                <label className="field-label">Ort</label>
                <input className="field-input" value={eventForm.location}
                  onChange={e => setEventForm({ ...eventForm, location: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Beschreibung</label>
                <textarea className="field-input" rows={3} value={eventForm.description}
                  onChange={e => setEventForm({ ...eventForm, description: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Was mitbringen</label>
                <input className="field-input" value={eventForm.bring_along}
                  onChange={e => setEventForm({ ...eventForm, bring_along: e.target.value })}
                  placeholder="z.B. Matte, bequeme Kleidung" />
              </div>
              <div>
                <label className="field-label">Schwierigkeitsgrad</label>
                {/* Welle 6 (Sarah 2026-05-27): identisch zu Kurs-Form — 3 Optionen. */}
                <select className="field-input" value={eventForm.difficulty}
                  onChange={e => setEventForm({ ...eventForm, difficulty: e.target.value })}>
                  {['Alle Level', 'Beginner', 'Geübte'].map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              {/* Bild-Upload — gleiche Logik wie Block-Kurs-Form */}
              <div>
                <label className="field-label">Bild (optional)</label>
                {eventForm.image_url && (
                  <div className="mb-2 flex items-center gap-3">
                    <img src={eventForm.image_url} alt="Vorschau" className="w-20 h-20 rounded-yoga object-cover border border-yoga-border" />
                    <button type="button" className="btn-secondary text-xs"
                      onClick={() => setEventForm({ ...eventForm, image_url: '' })}>
                      Entfernen
                    </button>
                  </div>
                )}
                <input className="field-input text-sm" type="file" accept="image/jpeg,image/png,image/webp"
                  disabled={uploadingEventImage}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]; if (!file) return
                    if (file.size > 5 * 1024 * 1024) { alert('Bild zu groß (max 5 MB)'); return }
                    setUploadingEventImage(true)
                    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
                    const path = `event-${Date.now()}.${ext}`
                    const { error: upErr } = await supabase.storage.from('course-images').upload(path, file, { upsert: true })
                    if (upErr) { alert('Upload-Fehler: ' + upErr.message); setUploadingEventImage(false); return }
                    const { data: urlData } = supabase.storage.from('course-images').getPublicUrl(path)
                    setEventForm({ ...eventForm, image_url: urlData.publicUrl })
                    setUploadingEventImage(false)
                    e.target.value = ''
                  }} />
                {uploadingEventImage && <p className="text-xs text-yoga-text/50 mt-1">Wird hochgeladen…</p>}
                <p className="text-xs text-yoga-text/50 mt-1">JPG/PNG/WebP · max 5 MB</p>
              </div>
              {/* Welle 2.5: 2 Radio-Optionen — Credit-Verbrauch entfernt
                  (das ist "Einzelstunde anlegen"). */}
              <div>
                <label className="field-label">Bezahlung</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 card cursor-pointer">
                    <input type="radio" name="event_payment_type" value="free"
                      checked={eventForm.payment_type === 'free'}
                      onChange={() => setEventForm({ ...eventForm, payment_type: 'free' })}
                      className="w-5 h-5" />
                    <span className="text-sm">Kostenlos</span>
                  </label>
                  <label className="flex items-center gap-3 card cursor-pointer">
                    <input type="radio" name="event_payment_type" value="paid"
                      checked={eventForm.payment_type === 'paid'}
                      onChange={() => setEventForm({ ...eventForm, payment_type: 'paid' })}
                      className="w-5 h-5" />
                    <span className="text-sm">Bezahlt</span>
                  </label>
                </div>
              </div>
              {eventForm.payment_type === 'paid' && (
                <div>
                  <label className="field-label">Preis *</label>
                  <div className="relative">
                    <input className="field-input pr-10" type="number" min={0.01} step={0.01}
                      value={eventForm.price_eur}
                      onChange={e => setEventForm({ ...eventForm, price_eur: e.target.value })}
                      required />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-yoga-text/60">€</span>
                  </div>
                </div>
              )}
              <button type="submit" className="btn-primary" disabled={savingSingleOrEvent}>
                {savingSingleOrEvent ? 'Wird gespeichert...' : editingSessionId ? 'Speichern' : 'Anlegen'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => {
                setShowEventForm(false)
                setEditingSessionId(null)
                setEventForm({ name: '', date: '', time_start: '18:00', duration_min: 75, max_spots: 12, location: '', description: '', bring_along: '', difficulty: 'Alle Level', payment_type: 'free', price_eur: '', image_url: '' })
              }}>Abbrechen</button>
            </form>
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
              {/* Welle 2.5 (Sarah 2026-05-26): "Einzelne Stunde" + "Kostenlos"
                  Checkboxen sowie Bild-Upload aus Block-Kurs-Form entfernt.
                  Einzelstunden/Events haben eigene Buttons in der Übersicht.
                  DB-Spalten is_single/is_free/image_url bleiben für Bestand
                  unverändert (Default in emptyForm: false bzw. ''). */}
              <div>
                <label className="field-label">Wochentag *</label>
                <select className="field-input" value={form.weekday}
                  onChange={e => setForm({...form, weekday: e.target.value})}>
                  {WEEKDAYS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Uhrzeit *</label>
                  <input className="field-input" type="time" value={form.time_start}
                    onChange={e => setForm({...form, time_start: e.target.value})} required />
                </div>
                <div>
                  <label className="field-label">Dauer (Min.)</label>
                  {/* Welle 6: leer = NaN-fallback verhindern, beim Submit (form.duration_min)
                      ist required-Pruefung in handleSave. Empty bleibt '' im UI. */}
                  <input className="field-input" type="number" min={1}
                    value={(form.duration_min as any) === '' ? '' : form.duration_min}
                    onChange={e => setForm({...form, duration_min: (e.target.value === '' ? ('' as any) : parseInt(e.target.value))})} />
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
                {/* Welle 6: leer als Zwischenstand erlaubt. */}
                <input className="field-input" type="number" min={1} max={50}
                  value={(form.max_spots as any) === '' ? '' : form.max_spots}
                  onChange={e => setForm({...form, max_spots: (e.target.value === '' ? ('' as any) : parseInt(e.target.value))})} />
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
      {/* Welle 6 (Sarah 2026-05-27, Item 2): Direkt-Absage-Modal fuer
          Einzelstunden/Events von der Kurs-Liste aus (kein /admin/sessions/[id]
          Umweg mehr). Grund-Eingabe + Submit. */}
      {cancellingSession && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end modal-overlay" onClick={() => { if (!doingCancelSession) setCancellingSession(null) }}>
          <div className="bg-yoga-card w-full rounded-t-2xl p-5 pb-10 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-yoga-red-text">
                {cancellingSession.session_type === 'single' ? 'Einzelstunde absagen' : 'Event absagen'}
              </h3>
              <button onClick={() => setCancellingSession(null)} disabled={doingCancelSession}
                className="bg-transparent border-0 cursor-pointer text-yoga-text/40 disabled:opacity-40">
                <i className="ti ti-x text-xl" />
              </button>
            </div>
            <p className="text-sm text-yoga-text/60 mb-4">
              <strong>{cancellingSession.name || '—'}</strong><br />
              {new Date(cancellingSession.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' })}
              {' · '}{cancellingSession.time_start?.slice(0, 5)} Uhr
              <br />
              Alle eingebuchten Yogis werden per E-Mail informiert.
              {cancellingSession.session_type === 'event_paid' && (
                <span className="block mt-2 text-yoga-amber-text text-xs">
                  Hinweis: Eine eventuell schon geleistete Bezahlung musst du extern (PayPal/Bar) erstatten.
                </span>
              )}
            </p>
            <label className="field-label">Grund (optional, erscheint in der E-Mail)</label>
            <textarea className="field-input mb-4" rows={3}
              placeholder="z.B. Krankheit, Wetter..."
              value={cancelSessionReason}
              onChange={e => setCancelSessionReason(e.target.value)} />
            <button onClick={cancelEventOrSingle} disabled={doingCancelSession}
              className="w-full btn-primary bg-yoga-red-text disabled:opacity-40">
              {doingCancelSession ? 'Wird abgesagt...' :
                cancellingSession.session_type === 'single' ? 'Einzelstunde absagen' : 'Event absagen'}
            </button>
          </div>
        </div>
      )}

      {/* Welle 6 (Sarah 2026-05-27, Item 1): 2-stufiges Lösch-Modal fuer
          laufende Kurse — Stufe 1 Bestaetigung + Yogi-Count, Stufe 2
          Eingabe des Kursnamens als doppelte Sicherheit. */}
      {deleteCourseModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end modal-overlay"
          onClick={() => setDeleteCourseModal(null)}>
          <div className="bg-yoga-card w-full rounded-t-2xl p-5 pb-10 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-yoga-red-text">Kurs endgültig löschen</h3>
              <button onClick={() => setDeleteCourseModal(null)}
                className="bg-transparent border-0 cursor-pointer text-yoga-text/40">
                <i className="ti ti-x text-xl" />
              </button>
            </div>
            {deleteCourseModal.step === 1 ? (
              <>
                <p className="text-sm text-yoga-text/70 mb-4 leading-snug">
                  Kurs <strong>„{deleteCourseModal.course.name}"</strong> wirklich löschen?
                  <br />
                  Es sind aktuell <strong>{deleteCourseModal.yogiCount}</strong>{' '}
                  {deleteCourseModal.yogiCount === 1 ? 'Yogi eingebucht' : 'Yogis eingebucht'}.
                </p>
                <p className="text-xs text-yoga-text/50 mb-4">
                  Achtung: Sessions, Buchungen und Enrollments werden ebenfalls gelöscht.
                  Diese Aktion kann nicht rückgängig gemacht werden.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setDeleteCourseModal(null)} className="btn-ghost flex-1 text-sm">
                    Abbrechen
                  </button>
                  <button
                    onClick={() => setDeleteCourseModal({ ...deleteCourseModal, step: 2 })}
                    className="flex-1 btn-primary bg-yoga-red-text text-sm">
                    Weiter
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-yoga-text/70 mb-2 leading-snug">
                  Tippe den Kursnamen zum Bestätigen:
                </p>
                <p className="text-xs text-yoga-text/50 mb-3 italic">„{deleteCourseModal.course.name}"</p>
                <input className="field-input mb-4"
                  value={deleteCourseModal.nameInput}
                  onChange={e => setDeleteCourseModal({ ...deleteCourseModal, nameInput: e.target.value })}
                  placeholder="Kursname eingeben..."
                  autoFocus />
                <div className="flex gap-2">
                  <button onClick={() => setDeleteCourseModal(null)} className="btn-ghost flex-1 text-sm">
                    Abbrechen
                  </button>
                  <button
                    onClick={async () => {
                      const c = deleteCourseModal.course
                      setDeleteCourseModal(null)
                      await deleteCourse(c.id, c.name)
                    }}
                    disabled={deleteCourseModal.nameInput !== deleteCourseModal.course.name}
                    className="flex-1 btn-primary bg-yoga-red-text text-sm disabled:opacity-40">
                    Endgültig löschen
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Kursabbruch Modal */}
      {cancellingCourse && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end modal-overlay" onClick={() => setCancellingCourse(null)}>
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end modal-overlay" onClick={() => setFolgekursCourse(null)}>
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end modal-overlay" onClick={() => setParticipantsCourse(null)}>
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
                        <span className="text-xs bg-yoga-text text-white rounded-full px-2 py-0.5 font-normal">Dummy</span>
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

      {/* Welle 2.11 (Sarah 2026-05-26): Session-Teilnehmer-Modal
          Welle 3.5: zeigt jetzt auch externe Teilnehmer mit +/- Buttons. */}
      {participantsSession && (() => {
        const ext = participantsSession.external_participants_count || 0
        const internal = sessionBookings.length
        const total = internal + ext
        const cap = participantsSession.max_spots
        // Welle 4.6 (Sarah 2026-05-26): Externe Counter NUR bei Events sichtbar.
        const sessType = participantsSession.session_type
        const isEventType = sessType === 'event_free' || sessType === 'event_paid'
        return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end modal-overlay" onClick={() => { setParticipantsSession(null); setSessionBookings([]); setSessionWaitlist([]); setShowSessionAddYogi(false) }}>
          <div className="bg-yoga-card w-full rounded-t-2xl p-5 pb-10 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-bold">Teilnehmer</h3>
              <button onClick={() => { setParticipantsSession(null); setSessionBookings([]); setSessionWaitlist([]); setShowSessionAddYogi(false) }} className="bg-transparent border-0 cursor-pointer text-yoga-text/40">
                <i className="ti ti-x text-xl" />
              </button>
            </div>
            <p className="text-sm text-yoga-text/50 mb-3">
              {participantsSession.name || '—'} · {new Date(participantsSession.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' })} · {participantsSession.time_start?.slice(0,5)} Uhr
            </p>

            {/* Welle 3.5: Counter-Übersicht. Welle 4.6: Externe-Counter nur bei Events. */}
            <div className="bg-yoga-gray rounded-yoga p-3 mb-4">
              <div className="text-sm font-semibold mb-1">
                {total}{cap ? ` / ${cap}` : ''} Teilnehmer gesamt
              </div>
              <div className="text-xs text-yoga-text/60 mb-2">
                {internal} eingebucht{ext > 0 ? ` · ${ext} extern` : ''}
              </div>
              {isEventType && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-yoga-text/60">Externe Teilnehmer:</span>
                  <button type="button"
                    onClick={async () => {
                      await updateExternalCount(participantsSession.id, Math.max(0, ext - 1))
                      setParticipantsSession((prev: any) => prev ? { ...prev, external_participants_count: Math.max(0, ext - 1) } : prev)
                    }}
                    disabled={ext <= 0}
                    className="w-7 h-7 rounded-full border border-yoga-border2 text-yoga-text/70 text-sm font-bold cursor-pointer hover:opacity-80 disabled:opacity-30 flex items-center justify-center bg-transparent">−</button>
                  <strong className="text-sm w-5 text-center">{ext}</strong>
                  <button type="button"
                    onClick={async () => {
                      await updateExternalCount(participantsSession.id, ext + 1)
                      setParticipantsSession((prev: any) => prev ? { ...prev, external_participants_count: ext + 1 } : prev)
                    }}
                    className="w-7 h-7 rounded-full border border-yoga-border2 text-yoga-text/70 text-sm font-bold cursor-pointer hover:opacity-80 flex items-center justify-center bg-transparent">+</button>
                </div>
              )}
            </div>

            {/* Welle 4.6: Yogi hinzufügen Button direkt im Modal */}
            <button onClick={() => { setShowSessionAddYogi(true); setSessionAddYogiSearch(''); setSessionAddYogiResults([]) }}
              className="w-full btn-secondary text-sm mb-4 flex items-center justify-center gap-2">
              <i className="ti ti-user-plus" />Yogi hinzufügen
            </button>

            <p className="section-label">Eingebuchte Yogis ({internal})</p>
            {sessionBookings.length === 0 ? (
              <p className="text-sm text-yoga-text/40 text-center py-6">Noch keine Buchungen</p>
            ) : sessionBookings.map((b: any) => (
              <div key={b.id} className="flex items-center justify-between py-3 border-b border-yoga-border gap-2">
                <button
                  onClick={() => { setParticipantsSession(null); setSessionBookings([]); setSessionWaitlist([]); router.push(`/admin/yogis/${b.profile.id}`) }}
                  className="flex-1 text-left hover:opacity-70 transition-opacity bg-transparent border-0 cursor-pointer min-w-0">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    {b.profile?.first_name} {b.profile?.last_name}
                    {b.profile?.is_dummy && (
                      <span className="text-xs bg-yoga-text text-white rounded-full px-2 py-0.5 font-normal">Dummy</span>
                    )}
                  </div>
                  <div className="text-xs text-yoga-text/50 mt-0.5 truncate">{b.profile?.email || 'Kein Login'}</div>
                </button>
                {/* Welle 4.6: Austragen pro Yogi-Zeile */}
                <button onClick={() => cancelBookingFromModal(b.id, b.user_id)}
                  className="text-xs bg-yoga-red-bg text-yoga-red-text rounded-full px-2.5 py-1 cursor-pointer font-semibold flex-shrink-0 border-0 hover:opacity-80">
                  Austragen
                </button>
              </div>
            ))}

            {/* Welle 6 (Sarah 2026-05-27, Item 11): Warteliste-Sektion.
                Yogis mit position != null = "auf der Warteliste".
                Yogis mit position == null oder type='notify' = "Benachrichtigung aktiviert". */}
            {(() => {
              const onWaitlist = sessionWaitlist.filter((w: any) => w.type !== 'notify' && w.position != null)
              const onNotify = sessionWaitlist.filter((w: any) => w.type === 'notify' || w.position == null)
              return (
                <>
                  {onWaitlist.length > 0 && (
                    <>
                      <p className="section-label mt-4">Auf der Warteliste ({onWaitlist.length})</p>
                      {onWaitlist.map((w: any) => (
                        <div key={w.id} className="flex items-center justify-between py-3 border-b border-yoga-border gap-2">
                          <button
                            onClick={() => { setParticipantsSession(null); setSessionBookings([]); setSessionWaitlist([]); router.push(`/admin/yogis/${w.profile?.id || w.user_id}`) }}
                            className="flex-1 text-left hover:opacity-70 transition-opacity bg-transparent border-0 cursor-pointer min-w-0">
                            <div className="text-sm font-semibold flex items-center gap-2">
                              {w.position != null && <span className="text-xs text-yoga-text/50 font-normal">#{w.position}</span>}
                              <span className="truncate">{w.profile?.first_name} {w.profile?.last_name}</span>
                              {w.profile?.is_dummy && (
                                <span className="text-xs bg-yoga-text text-white rounded-full px-2 py-0.5 font-normal">Dummy</span>
                              )}
                            </div>
                            <div className="text-xs text-yoga-text/50 mt-0.5 truncate">{w.profile?.email || 'Kein Login'}</div>
                          </button>
                          {/* Welle 6 Item 10: "Nachrücken" — auch bei Überbuchung
                              fuer event_free erlaubt. */}
                          <button onClick={() => promoteWaitlistFromModal(w)}
                            className="text-xs bg-yoga-text text-yoga-bg rounded-full px-2.5 py-1 cursor-pointer font-semibold flex-shrink-0 border-0 hover:opacity-80">
                            Nachrücken
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                  {onNotify.length > 0 && (
                    <>
                      <p className="section-label mt-4">Benachrichtigung aktiviert ({onNotify.length})</p>
                      {onNotify.map((w: any) => (
                        <div key={w.id} className="flex items-center justify-between py-3 border-b border-yoga-border gap-2">
                          <button
                            onClick={() => { setParticipantsSession(null); setSessionBookings([]); setSessionWaitlist([]); router.push(`/admin/yogis/${w.profile?.id || w.user_id}`) }}
                            className="flex-1 text-left hover:opacity-70 transition-opacity bg-transparent border-0 cursor-pointer min-w-0">
                            <div className="text-sm font-semibold flex items-center gap-2">
                              <span className="truncate">{w.profile?.first_name} {w.profile?.last_name}</span>
                              {w.profile?.is_dummy && (
                                <span className="text-xs bg-yoga-text text-white rounded-full px-2 py-0.5 font-normal">Dummy</span>
                              )}
                            </div>
                            <div className="text-xs text-yoga-text/50 mt-0.5 truncate">{w.profile?.email || 'Kein Login'}</div>
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )
            })()}
            {/* Welle 4.6: "Stunde verwalten" Link ENTFERNT — alles im Modal */}
          </div>

          {/* Welle 4.6: Yogi-Suche Sub-Modal (innerhalb Teilnehmer-Modal) */}
          {showSessionAddYogi && (
            <div className="fixed inset-0 bg-black/50 z-[70] flex items-end modal-overlay" onClick={() => setShowSessionAddYogi(false)}>
              <div className="bg-yoga-card w-full rounded-t-2xl p-5 pb-10 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold">Yogi hinzufügen</h3>
                  <button onClick={() => setShowSessionAddYogi(false)} className="bg-transparent border-0 cursor-pointer text-yoga-text/40">
                    <i className="ti ti-x text-xl" />
                  </button>
                </div>
                <input className="field-input mb-3" placeholder="Name oder E-Mail..." autoFocus
                  value={sessionAddYogiSearch} onChange={e => searchYogisForSession(e.target.value)} />
                {sessionAddYogiSearch.length >= 2 && sessionAddYogiResults.length === 0 && (
                  <p className="text-sm text-yoga-text/40 text-center py-3">Kein Yogi gefunden</p>
                )}
                {sessionAddYogiResults.map(yogi => (
                  <div key={yogi.id} className="flex items-center justify-between py-3 border-b border-yoga-border">
                    <div>
                      <div className="text-sm font-semibold">
                        {yogi.first_name} {yogi.last_name}
                        {yogi.is_dummy && <span className="ml-2 text-xs bg-yoga-text text-white rounded-full px-2 py-0.5">Dummy</span>}
                      </div>
                      <div className="text-xs text-yoga-text/50">{yogi.email || 'Kein Login'}</div>
                    </div>
                    <button onClick={() => addYogiToSessionFromModal(yogi)} disabled={sessionAddingYogi}
                      className="text-xs bg-yoga-text text-yoga-bg rounded-full px-3 py-1.5 font-semibold border-0 cursor-pointer disabled:opacity-40">
                      {sessionAddingYogi ? '...' : 'Hinzufügen'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        )
      })()}

      {/* Yogi zu Kurs hinzufügen Modal */}
      {showAddYogiModal && participantsCourse && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-end modal-overlay" onClick={() => setShowAddYogiModal(false)}>
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
                      {yogi.is_dummy && <span className="ml-2 text-xs bg-yoga-text text-white rounded-full px-2 py-0.5">Dummy</span>}
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
