/**
 * Testdaten anlegen und bereinigen.
 * Alle Testdaten haben den Prefix [E2E] im Namen und e2e. in der E-Mail.
 */
import { createClient } from '@supabase/supabase-js'

export const E2E_PREFIX = '[E2E]'
export const E2E_EMAIL_PREFIX = 'e2e.'

function db() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

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
  const client = db()

  // Prüfen ob User schon existiert
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

  // Profil anlegen / aktualisieren
  const firstName = email.includes('admin') ? 'E2E' : 'Test'
  const lastName = email.includes('admin') ? 'Admin' : email.includes('yogi1') ? 'Yogi1' : 'Yogi2'

  await client.from('profiles').upsert({
    id: user.id,
    first_name: firstName,
    last_name: lastName,
    email,
    is_admin: isAdmin,
    legal_accepted_at: new Date().toISOString(),
    legal_version: '2025-12',
  }, { onConflict: 'id' })

  // AGB-Akzeptanz eintragen
  await client.from('legal_acceptances').upsert({
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
  const client = db()
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

  const { data: course, error } = await client.from('courses').insert({
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
  }).select('id').single()

  if (error || !course) throw new Error(`Testkurs konnte nicht erstellt werden: ${error?.message}`)

  const sessionRows = dates.map(date => ({
    course_id: course.id,
    date,
    time_start: '18:30:00',
    duration_min: 75,
    is_cancelled: false,
  }))

  const { data: sessions, error: sessErr } = await client
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
    maxSpots: 1,   // Nur 1 Platz → nach Yogi1 voll
    sessionCount: 2,
    startDaysFromNow: 14,
  })

  const client = db()

  // Yogi1 einbuchen (belegt den einzigen Platz)
  const expires = new Date()
  expires.setDate(expires.getDate() + 90)

  await client.from('credits').insert({
    user_id: yogi1Id,
    course_id: course.courseId,
    model: 'course',
    total: 2,
    used: 0,
    expires_at: expires.toISOString(),
  })

  await client.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })

  for (const sessionId of course.sessionIds) {
    await client.from('bookings').insert({
      user_id: yogi1Id,
      session_id: sessionId,
      type: 'course',
      status: 'active',
    })
  }

  return course
}

/** Einzelstunden-Credits für einen Yogi anlegen */
export async function giveYogiSingleCredit(userId: string, count = 5) {
  const client = db()
  const expires = new Date()
  expires.setFullYear(expires.getFullYear() + 1)
  const { data } = await client.from('credits').insert({
    user_id: userId,
    course_id: null,
    model: 'single',
    total: count,
    used: 0,
    expires_at: expires.toISOString(),
  }).select('id').single()
  return data?.id
}

// ── Bereinigung ───────────────────────────────────────────────────────────────

export async function cleanupAllE2EData() {
  const client = db()

  // Alle E2E-Kurse finden
  const { data: courses } = await client.from('courses')
    .select('id').like('name', `${E2E_PREFIX}%`)

  if (courses && courses.length > 0) {
    const courseIds = courses.map(c => c.id)

    // Sessions finden
    const { data: sessions } = await client.from('sessions')
      .select('id').in('course_id', courseIds)
    const sessionIds = sessions?.map(s => s.id) ?? []

    // Abhängige Daten löschen
    if (sessionIds.length > 0) {
      await client.from('waitlist').delete().in('session_id', sessionIds)
      await client.from('bookings').delete().in('session_id', sessionIds)
    }
    await client.from('enrollments').delete().in('course_id', courseIds)
    await client.from('credits').delete().in('course_id', courseIds)
    await client.from('sessions').delete().in('course_id', courseIds)
    await client.from('courses').delete().in('id', courseIds)
  }

  // E2E-Nutzer bereinigen (Credits, Bookings, Waitlist-Einträge)
  const e2eEmails = [
    process.env.TEST_ADMIN_EMAIL!,
    process.env.TEST_YOGI1_EMAIL!,
    process.env.TEST_YOGI2_EMAIL!,
  ].filter(Boolean)

  for (const email of e2eEmails) {
    const { data: profile } = await client.from('profiles').select('id').eq('email', email).maybeSingle()
    if (!profile) continue

    // Einzelstunden-Credits (ohne Kurs-Bindung) löschen
    await client.from('credits').delete().eq('user_id', profile.id).is('course_id', null)
    // Guthaben-Credits löschen
    await client.from('credits').delete().eq('user_id', profile.id).eq('model', 'guthaben')
    // Audit-Log-Einträge für diesen Nutzer löschen
    await client.from('audit_log').delete().eq('user_id', profile.id)
  }

  console.log('✅ Alle E2E-Testdaten bereinigt')
}
