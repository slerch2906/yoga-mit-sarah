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

  console.log('✅ Alle E2E-Testdaten bereinigt')
}
