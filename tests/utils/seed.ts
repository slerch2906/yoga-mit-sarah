/**
 * Testdaten anlegen und bereinigen.
 * Alle Testdaten haben den Prefix [E2E] im Namen.
 */
import { createClient } from '@supabase/supabase-js'
import { getServiceClient, getAdminClient } from './db'

export const E2E_PREFIX = '[E2E]'
export const E2E_EMAIL_PREFIX = 'e2e.'

// ── Datum-Hilfsfunktionen ─────────────────────────────────────────────────────

/** Datum x Tage in der Zukunft als YYYY-MM-DD */
export function futureDateStr(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().split('T')[0]
}

/** Wochentag auf Deutsch */
function weekdayDE(dateStr: string): string {
  const day = new Date(dateStr).toLocaleDateString('de-DE', { weekday: 'long' })
  return day.charAt(0).toUpperCase() + day.slice(1)
}

// ── Auth-Nutzer anlegen ───────────────────────────────────────────────────────

export async function ensureTestUser(email: string, password: string, isAdmin = false) {
  const client = getServiceClient()

  const { data: existingUsers } = await client.auth.admin.listUsers()
  let user = existingUsers?.users?.find(u => u.email === email)

  if (!user) {
    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error) throw new Error(`Konnte Testnutzer ${email} nicht erstellen: ${error.message}`)
    user = data.user
  }

  if (!user?.id) throw new Error(`User-ID für ${email} nicht gefunden`)

  const firstName = email.includes('admin') ? 'E2E' : 'Test'
  const lastName = email.includes('admin') ? 'Admin' : email.includes('yogi1') ? 'Yogi1' : 'Yogi2'

  // Als dieser User einloggen um Profil anzulegen (RLS: auth.uid() = id)
  const userClient = getServiceClient()
  const { error: signInErr } = await userClient.auth.signInWithPassword({ email, password })
  if (signInErr) throw new Error(`Login für ${email} fehlgeschlagen: ${signInErr.message}`)

  await userClient.from('profiles').upsert({
    id: user.id,
    first_name: firstName,
    last_name: lastName,
    email,
    is_admin: isAdmin,
    is_dummy: false,
    legal_accepted_at: new Date().toISOString(),
    legal_version: '2025-12',
  }, { onConflict: 'id' })

  await userClient.from('legal_acceptances').upsert({
    user_id: user.id,
    version: '2025-12',
    full_name: `${firstName} ${lastName}`,
  }, { onConflict: 'user_id' })

  return user.id
}

// ── Testkurs anlegen ──────────────────────────────────────────────────────────

export interface TestCourse {
  courseId: string
  sessionIds: string[]
  sessionDates: string[]
}

export async function createTestCourse(options: {
  name?: string
  maxSpots?: number
  sessionCount?: number
  startDaysFromNow?: number
} = {}): Promise<TestCourse> {
  const db = await getAdminClient()
  const {
    name = `${E2E_PREFIX} Testkurs`,
    maxSpots = 3,
    sessionCount = 4,
    startDaysFromNow = 7,
  } = options

  const dates: string[] = []
  for (let i = 0; i < sessionCount; i++) {
    dates.push(futureDateStr(startDaysFromNow + i * 7))
  }

  const dateStart = dates[0]
  const dateEnd = dates[dates.length - 1]

  const { data: course, error } = await db.from('courses').insert({
    name,
    weekday: weekdayDE(dateStart),
    time_start: '18:30:00',
    duration_min: 75,
    max_spots: maxSpots,
    total_units: sessionCount,
    date_start: dateStart,
    date_end: dateEnd,
    location: 'E2E Teststudio',
    is_active: true,
    is_single: false,
    is_open: true,
  }).select('id').single()

  if (error || !course) throw new Error(`Testkurs konnte nicht erstellt werden: ${error?.message}`)

  const sessionRows = dates.map(date => ({
    course_id: course.id,
    date,
    time_start: '18:30:00',
    duration_min: 75,
    is_cancelled: false,
  }))

  const { data: sessions, error: sessErr } = await db
    .from('sessions').insert(sessionRows).select('id, date')
  if (sessErr || !sessions) throw new Error(`Sessions konnten nicht erstellt werden: ${sessErr?.message}`)

  return {
    courseId: course.id,
    sessionIds: sessions.map(s => s.id),
    sessionDates: sessions.map(s => s.date),
  }
}

/** Kurs anlegen der voll ausgebucht ist (für Wartelisten-Tests) */
export async function createFullCourse(yogi1Id: string, yogi2Id: string): Promise<TestCourse> {
  const course = await createTestCourse({
    name: `${E2E_PREFIX} Ausgebuchter Kurs`,
    maxSpots: 1,
    sessionCount: 2,
    startDaysFromNow: 14,
  })

  const db = await getAdminClient()
  const expires = new Date()
  expires.setDate(expires.getDate() + 90)

  await db.from('credits').insert({
    user_id: yogi1Id,
    course_id: course.courseId,
    model: 'course',
    total: 2,
    used: 0,
    expires_at: expires.toISOString(),
  })

  await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })

  for (const sessionId of course.sessionIds) {
    await db.from('bookings').insert({
      user_id: yogi1Id,
      session_id: sessionId,
      type: 'course',
      status: 'active',
    })
  }

  return course
}

/** Kurs mit einem eingebuchten Yogi anlegen (für Kursabbruch-Tests) */
export async function createEnrolledCourse(userId: string, options: {
  name?: string
  sessionCount?: number
} = {}): Promise<TestCourse> {
  const course = await createTestCourse({
    name: options.name || `${E2E_PREFIX} Abbruch-Kurs`,
    maxSpots: 5,
    sessionCount: options.sessionCount || 3,
    startDaysFromNow: 14,
  })

  const db = await getAdminClient()
  const expires = new Date()
  expires.setDate(expires.getDate() + 180)

  await db.from('credits').insert({
    user_id: userId,
    course_id: course.courseId,
    model: 'course',
    total: course.sessionIds.length,
    used: 0,
    expires_at: expires.toISOString(),
  })

  await db.from('enrollments').insert({ user_id: userId, course_id: course.courseId })

  for (const sessionId of course.sessionIds) {
    await db.from('bookings').insert({
      user_id: userId,
      session_id: sessionId,
      type: 'course',
      status: 'active',
    })
  }

  return course
}

/** Guthaben-Credits (aus Kursabbruch) für einen Yogi anlegen */
export async function giveYogiGuthaben(userId: string, amount: number) {
  const db = await getAdminClient()
  const expires = new Date()
  expires.setFullYear(expires.getFullYear() + 2)
  const { data } = await db.from('credits').insert({
    user_id: userId,
    course_id: null,
    model: 'guthaben',
    total: amount,
    used: 0,
    expires_at: expires.toISOString(),
  }).select('id').single()
  return data?.id
}

/** Einzelstunden-Credits für einen Yogi anlegen */
export async function giveYogiSingleCredit(userId: string, count = 5) {
  const db = await getAdminClient()
  const expires = new Date()
  expires.setFullYear(expires.getFullYear() + 1)
  const { data } = await db.from('credits').insert({
    user_id: userId,
    course_id: null,
    model: 'single',
    total: count,
    used: 0,
    expires_at: expires.toISOString(),
  }).select('id').single()
  return data?.id
}

// ── System-Container ──────────────────────────────────────────────────────────

/**
 * Stellt sicher, dass die SYS-Container-Kurse existieren (Sarah 2026-08-21).
 *
 * Einzelstunden und Events haengen technisch an unsichtbaren "Container"-Kursen.
 * Auf Prod entstehen die automatisch, sobald man die erste Einzelstunde bzw. das
 * erste Event anlegt. Auf Staging waren sie NIE vorhanden, weil dort nie eine
 * ueber die Oberflaeche erstellt wurde — dadurch schlugen rund ein Dutzend Tests
 * fehl, die Events/Einzelstunden anlegen wollen (course_id war undefined →
 * Session-Insert lieferte null → "Cannot read properties of null").
 *
 * Idempotent: legt nur an, was fehlt. Namen und Felder entsprechen exakt dem
 * Prod-Bestand, damit die Tests dieselbe Ausgangslage vorfinden.
 */
export async function ensureSystemContainers() {
  // Service-Client: Stammdaten-Setup ist unabhaengig von RLS-Regeln fuer Admins.
  const db = getServiceClient()
  const { data: existing } = await db.from('courses')
    .select('id, name').eq('is_system_container', true)
  const have = new Set((existing || []).map((c: any) => c.name))

  const CONTAINERS = [
    { name: 'SYS · Einzelstunden',    total_units: 0 },
    { name: 'SYS · Events (kostenlos)', total_units: 1 },
    { name: 'SYS · Events (Credit)',    total_units: 1 },
    { name: 'SYS · Events (bezahlt)',   total_units: 2 },
  ]

  const missing = CONTAINERS.filter(c => !have.has(c.name))
  if (missing.length === 0) return

  const today = new Date().toISOString().slice(0, 10)
  await db.from('courses').insert(missing.map(c => ({
    name: c.name,
    weekday: 'Montag',
    time_start: '00:00:00',
    duration_min: 60,
    max_spots: 99,
    total_units: c.total_units,
    date_start: today,
    date_end: today,
    is_active: true,
    is_single: false,
    is_open: false,
    is_free: false,
    is_system_container: true,
  })))
  console.log(`  ✓ SYS-Container ergaenzt: ${missing.map(c => c.name).join(', ')}`)
}

/**
 * Stellt die uebrigen Stammdaten sicher, die auf Prod existieren, auf Staging
 * aber nie angelegt wurden (Sarah 2026-08-21). Gleiche Ursache wie bei den
 * SYS-Containern: entsteht auf Prod durch normale Nutzung, auf Staging nie.
 *
 *  - agb_versions: ohne Eintraege schlagen alle AGB-/Re-Acceptance-Tests fehl
 *  - admin_announcement: Single-Row-Tabelle (id=1) fuer die Sarah-Sprechblase
 *
 * Idempotent — legt nur an, was fehlt, und ueberschreibt nichts.
 */
export async function ensureBaselineData() {
  // Service-Client (nicht der Admin-Client): admin_announcement erlaubt per RLS
  // kein INSERT durch angemeldete Admins — die Zeile entsteht auf Prod ueber eine
  // Migration. Fuer Stammdaten im Test-Setup ist die Service-Rolle korrekt.
  const db = getServiceClient()

  // AGB-Versionen (Wortlaut identisch zum Prod-Bestand)
  const { data: agb } = await db.from('agb_versions').select('sort_order')
  if (!agb || agb.length === 0) {
    await db.from('agb_versions').insert([
      { label: 'Dezember 2025', changelog: 'Erste Version der AGB.', sort_order: 1 },
      {
        label: 'Juni 2026',
        changelog: 'Stornofrist für Kurse vereinfacht: kostenfreie Stornierung bis 14 Tage vor '
          + 'Kursbeginn — danach gilt „gebucht ist gebucht" (volle Kursgebühr). Ersatzteilnehmer '
          + 'jederzeit möglich. (Die frühere 30-€-Zwischenstufe im Fenster 13–7 Tage entfällt.)',
        sort_order: 2,
      },
    ])
    console.log('  ✓ agb_versions ergaenzt (Dezember 2025 + Juni 2026)')
  }

  // Sprechblasen-Zeile (Single-Row, id=1) — inaktiv, damit nichts angezeigt wird.
  // message ist NOT NULL → leerer String statt null.
  const { data: ann } = await db.from('admin_announcement').select('id').limit(1)
  if (!ann || ann.length === 0) {
    const { error } = await db.from('admin_announcement')
      .insert({ id: 1, message: '', is_active: false })
    if (error) console.warn('  ! admin_announcement konnte nicht angelegt werden:', error.message)
    else console.log('  ✓ admin_announcement-Zeile ergaenzt (inaktiv)')
  }

  // Testnutzer auf die AKTUELLE AGB-Version heben (Sarah 2026-08-21).
  // Die App leitet jeden Nutzer mit veralteter agb_version zwangsweise auf
  // /rechtliches um. ensureTestUser setzt agb_version nicht — solange die
  // Tabelle leer war, fiel das nicht auf. Sobald es mehr als eine Version gibt,
  // landen sonst ALLE UI-Tests auf der Rechtliches-Seite statt auf ihrem Ziel.
  // Deshalb hier zentral nachziehen, passend zur jeweils hoechsten Version.
  const { data: cur } = await db.from('agb_versions')
    .select('sort_order, label').order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const currentOrder = (cur as any)?.sort_order
  if (currentOrder) {
    const emails = [
      process.env.TEST_ADMIN_EMAIL, process.env.TEST_YOGI1_EMAIL, process.env.TEST_YOGI2_EMAIL,
    ].filter(Boolean) as string[]
    const { error } = await db.from('profiles')
      .update({ agb_version: currentOrder, legal_accepted_at: new Date().toISOString() })
      .in('email', emails)
    if (error) console.warn('  ! agb_version der Testnutzer nicht gesetzt:', error.message)
    else console.log(`  ✓ Testnutzer auf AGB-Version ${currentOrder} gesetzt`)
  }
}

// ── Bereinigung ───────────────────────────────────────────────────────────────

export async function cleanupAllE2EData() {
  const db = await getAdminClient()

  const { data: courses } = await db.from('courses')
    .select('id').like('name', `${E2E_PREFIX}%`)

  if (courses && courses.length > 0) {
    const courseIds = courses.map(c => c.id)

    const { data: sessions } = await db.from('sessions')
      .select('id').in('course_id', courseIds)
    const sessionIds = sessions?.map(s => s.id) ?? []

    if (sessionIds.length > 0) {
      await db.from('waitlist').delete().in('session_id', sessionIds)
      await db.from('bookings').delete().in('session_id', sessionIds)
    }
    await db.from('enrollments').delete().in('course_id', courseIds)
    await db.from('credits').delete().in('course_id', courseIds)
    await db.from('course_cancellation_responses').delete().in('course_id', courseIds)
    await db.from('sessions').delete().in('course_id', courseIds)
    await db.from('courses').delete().in('id', courseIds)
  }

  const e2eEmails = [
    process.env.TEST_ADMIN_EMAIL!,
    process.env.TEST_YOGI1_EMAIL!,
    process.env.TEST_YOGI2_EMAIL!,
  ].filter(Boolean)

  for (const email of e2eEmails) {
    const { data: profile } = await db.from('profiles').select('id').eq('email', email).maybeSingle()
    if (!profile) continue
    await db.from('credits').delete().eq('user_id', profile.id).is('course_id', null)
    await db.from('course_cancellation_responses').delete().eq('user_id', profile.id)
    await db.from('audit_log').delete().eq('user_id', profile.id)
  }

  // Sarah-Wunsch 2026-05-26 Welle 2.10: admin_notifications aus Tests blieben
  // im Dashboard sichtbar — Sarah musste sie manuell wegklicken. Jetzt zentral
  // im Teardown loeschen (greift breit auf alle E2E-Marker).
  await db.from('admin_notifications').delete()
    .or(`message.ilike.%[E2E]%,message.ilike.%e2e.%,message.ilike.%Test Yogi%,message.ilike.%e2e-%`)

  console.log('✅ Alle E2E-Testdaten bereinigt (inkl. admin_notifications)')
}
