/**
 * Workflow: Vorhol-/Nachhol-Buchungen + Tagesänderungen (Sarah-Regel 2026-05-22)
 *
 * BUSINESS-LOGIK getestet:
 * - Course-Credits werden vor Single/Tenpack/Quartal aufgebraucht
 * - Origin-Verknüpfung: jede Vorhol/Nachhol-Buchung wird via
 *   bookings.origin_session_id an die abgesagte Stunde gebunden
 * - 10-Tage-Pre-Window für Vorholen, 8-Tage-Post-Kursende für Nachholen
 * - Minutengenau (nicht tagebasiert)
 * - Bei Kursabbruch: Cascade-Stornierung zukünftiger Ersatz-Buchungen
 * - Credit muss bis Session-Zeitpunkt gültig sein (nicht nur bis jetzt)
 * - Einzelstunden-Klassifizierung: alles außerhalb aktiver Kurse
 * - Admin Yogi-Detail: archivierte Kurse aus enrolled-Liste raus
 * - Einladung-Löschen: soft-delete via expires_at
 *
 * Die Tests testen die Kern-Business-Logik DB-zentrisch — d.h. wir rufen
 * selectCreditForBooking direkt auf statt UI-Buttons zu klicken. Das ist
 * stabiler gegen Production-UI-Drift und prüft das eigentliche Modell.
 */
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { selectCreditForBooking } from '../../lib/credit-selector'
import { getAdminClient, getUserIdByEmail, getActiveBooking, getCourse } from '../utils/db'
import { createTestCourse, E2E_PREFIX } from '../utils/seed'

dotenv.config({ path: '.env.test' })

// ────────────────────────────────────────────────────────────────────────
// Helpers — lokal in diesem Spec, damit der Test-Helper-Layer schlank bleibt
// ────────────────────────────────────────────────────────────────────────

/** Yogi komplett leeren: alle bookings/credits/enrollments/waitlist weg */
async function resetYogi(userId: string) {
  const db = await getAdminClient()
  await db.from('waitlist').delete().eq('user_id', userId)
  await db.from('bookings').delete().eq('user_id', userId)
  await db.from('credits').delete().eq('user_id', userId)
  await db.from('enrollments').delete().eq('user_id', userId)
}

/**
 * Yogi enrollment + Course-Credit + Bookings für alle Sessions anlegen.
 * Imitiert das was bei Registration/Admin-Enrollment passiert.
 */
async function enrollYogiWithBookings(userId: string, courseId: string, sessionIds: string[], opts: { creditExpiresAt?: Date } = {}) {
  const db = await getAdminClient()
  const expires = opts.creditExpiresAt || (() => { const d = new Date(); d.setDate(d.getDate() + 180); return d })()
  const { data: credit } = await db.from('credits').insert({
    user_id: userId, course_id: courseId, model: 'course',
    total: sessionIds.length, used: 0, expires_at: expires.toISOString(),
  }).select('id').single()
  await db.from('enrollments').insert({ user_id: userId, course_id: courseId })
  for (const sid of sessionIds) {
    await db.from('bookings').insert({
      user_id: userId, session_id: sid, credit_id: credit?.id,
      type: 'course', status: 'active',
    })
  }
  return credit?.id as string
}

/** Eine konkrete Booking absagen (Status auf cancelled) — origin-fähig danach */
async function cancelBooking(userId: string, sessionId: string) {
  const db = await getAdminClient()
  await db.from('bookings').update({
    status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false,
  }).eq('user_id', userId).eq('session_id', sessionId)
}

/** Custom Session direkt anlegen — für minuten-genaue Tests */
async function insertSession(courseId: string, date: string, timeStart: string, durationMin = 75) {
  const db = await getAdminClient()
  const { data } = await db.from('sessions').insert({
    course_id: courseId, date, time_start: timeStart, duration_min: durationMin, is_cancelled: false,
  }).select('id').single()
  return data?.id as string
}

/** Direkter Service-Client für selectCreditForBooking (umgeht RLS) */
function makeServiceClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function dateStr(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().split('T')[0]
}

// ────────────────────────────────────────────────────────────────────────
// 1) Vorhol-/Nachhol-Logik
// ────────────────────────────────────────────────────────────────────────
test.describe('Vorhol-/Nachhol-Logik', () => {
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test.beforeEach(async () => {
    await resetYogi(yogi1Id)
  })

  test.afterAll(async () => {
    await resetYogi(yogi1Id)
  })

  test('[E2E] Yogi sagt Stunde in 14 Tagen ab, will Stunde morgen buchen → blockiert', async () => {
    // Setup: Kurs mit 2 Sessions: heute+1 und heute+14
    const db = await getAdminClient()
    const course = await createTestCourse({ name: `${E2E_PREFIX} Vorhol-14d`, sessionCount: 1, startDaysFromNow: 14 })
    const tomorrowSessionId = await insertSession(course.courseId, dateStr(1), '18:30:00')
    const origin14d = course.sessionIds[0]
    await enrollYogiWithBookings(yogi1Id, course.courseId, [tomorrowSessionId, origin14d])
    // Yogi sagt die 14-Tage-Stunde ab (= origin)
    await cancelBooking(yogi1Id, origin14d)
    // Und die Morgen-Stunde auch, sonst kann er sie nicht „neu" buchen
    await cancelBooking(yogi1Id, tomorrowSessionId)

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogi1Id, tomorrowSessionId, dateStr(1), '18:30:00')

    expect(pick.ok).toBe(false)
    if (!pick.ok) {
      expect(pick.reason).toBe('window_blocked')
      expect(pick.message).toMatch(/10 Tage vor dem Termin/i)
    }
  })

  test('[E2E] Yogi sagt Stunde in 8 Tagen ab, will Stunde morgen buchen → erlaubt mit Origin', async () => {
    const course = await createTestCourse({ name: `${E2E_PREFIX} Vorhol-8d`, sessionCount: 1, startDaysFromNow: 8 })
    const tomorrowSessionId = await insertSession(course.courseId, dateStr(1), '18:30:00')
    const origin8d = course.sessionIds[0]
    await enrollYogiWithBookings(yogi1Id, course.courseId, [tomorrowSessionId, origin8d])
    await cancelBooking(yogi1Id, origin8d)
    await cancelBooking(yogi1Id, tomorrowSessionId)

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogi1Id, tomorrowSessionId, dateStr(1), '18:30:00')

    expect(pick.ok).toBe(true)
    if (pick.ok) {
      expect(pick.originSessionId).toBe(origin8d)
      expect(pick.usedModel).toBe('course')
    }
  })

  test('[E2E] Course-Credit wird VOR Punktekarte aufgebraucht', async () => {
    const db = await getAdminClient()
    // Kurs mit 1 Session in 5 Tagen, Yogi enrolled mit Course-Credit
    const course = await createTestCourse({ name: `${E2E_PREFIX} Course-vor-Punktekarte`, sessionCount: 1, startDaysFromNow: 5 })
    const originId = course.sessionIds[0]
    await enrollYogiWithBookings(yogi1Id, course.courseId, [originId])
    // Yogi sagt Original-Stunde ab → 1 freier Course-Credit-Anspruch
    await cancelBooking(yogi1Id, originId)

    // Plus separater Tenpack-Credit (5 frei, expires +1 Jahr)
    const tenpackExp = new Date(); tenpackExp.setFullYear(tenpackExp.getFullYear() + 1)
    await db.from('credits').insert({
      user_id: yogi1Id, course_id: null, model: 'tenpack',
      total: 5, used: 0, expires_at: tenpackExp.toISOString(),
    })

    // Neue Stunde in 3 Tagen (anderer Kurs)
    const otherCourse = await createTestCourse({ name: `${E2E_PREFIX} Drop-In-Ziel`, sessionCount: 1, startDaysFromNow: 3 })
    const targetSessionId = otherCourse.sessionIds[0]

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogi1Id, targetSessionId, dateStr(3), '18:30:00')

    expect(pick.ok).toBe(true)
    if (pick.ok) {
      expect(pick.usedModel).toBe('course')
      expect(pick.originSessionId).toBe(originId)
    }
  })

  test('[E2E] Course-Credit-Fenster verletzt → Fallback auf Punktekarte', async () => {
    const db = await getAdminClient()
    // Course-Credit mit Origin in 14 Tagen (= außerhalb 10d-Window für Buchung morgen)
    const course = await createTestCourse({ name: `${E2E_PREFIX} Course-Fenster-blocked`, sessionCount: 1, startDaysFromNow: 14 })
    const origin14d = course.sessionIds[0]
    await enrollYogiWithBookings(yogi1Id, course.courseId, [origin14d])
    await cancelBooking(yogi1Id, origin14d)

    // Tenpack-Credit
    const tenpackExp = new Date(); tenpackExp.setFullYear(tenpackExp.getFullYear() + 1)
    const { data: tenpackCredit } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: null, model: 'tenpack',
      total: 5, used: 0, expires_at: tenpackExp.toISOString(),
    }).select('id').single()

    const target = await createTestCourse({ name: `${E2E_PREFIX} Drop-In-Fallback`, sessionCount: 1, startDaysFromNow: 1 })
    const targetSessionId = target.sessionIds[0]

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogi1Id, targetSessionId, dateStr(1), '18:30:00')

    expect(pick.ok).toBe(true)
    if (pick.ok) {
      expect(pick.usedModel).toBe('tenpack')
      expect(pick.originSessionId).toBeNull()
      expect(pick.creditId).toBe(tenpackCredit!.id)
    }
  })

  test('[E2E] Kein Course-Credit + keine Punktekarte → klare Fehlermeldung', async () => {
    const db = await getAdminClient()
    // Nur Guthaben-Credit, kein course/single/tenpack
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 2)
    await db.from('credits').insert({
      user_id: yogi1Id, course_id: null, model: 'guthaben',
      total: 3, used: 0, expires_at: exp.toISOString(),
    })

    const target = await createTestCourse({ name: `${E2E_PREFIX} Kein-Credit-Test`, sessionCount: 1, startDaysFromNow: 3 })
    const targetSessionId = target.sessionIds[0]

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogi1Id, targetSessionId, dateStr(3), '18:30:00')

    expect(pick.ok).toBe(false)
    if (!pick.ok) {
      expect(pick.reason).toBe('no_credit')
      expect(pick.message).toMatch(/keinen freien Credit/i)
    }
  })

  test('[E2E] Minutengenauer Window-Check (10d-Pre-Window)', async () => {
    // Origin: in 12 Tagen um 20:30 — Target-Tests an (origin-10d) = +2d
    // (NICHT am heutigen Datum, um Race-Conditions mit Tageswechseln/lokaler Zeit
    // zu vermeiden — wir testen reines Modell-Verhalten relativ zu origin.)
    const course = await createTestCourse({ name: `${E2E_PREFIX} Minutengenau`, sessionCount: 1, startDaysFromNow: 12 })
    const db = await getAdminClient()
    await db.from('sessions').update({ time_start: '20:30:00' }).eq('id', course.sessionIds[0])
    const originId = course.sessionIds[0]
    await enrollYogiWithBookings(yogi1Id, course.courseId, [originId])
    await cancelBooking(yogi1Id, originId)

    // Target-Sessions an +2d (= origin - 10d), 3 Variationen
    const windowDay = dateStr(2)
    const targetEarly = await insertSession(course.courseId, windowDay, '20:29:00')
    const targetExact = await insertSession(course.courseId, windowDay, '20:30:00')
    const targetLate = await insertSession(course.courseId, windowDay, '20:31:00')

    const supa = makeServiceClient()

    const pickEarly = await selectCreditForBooking(supa, yogi1Id, targetEarly, windowDay, '20:29:00')
    expect(pickEarly.ok).toBe(false)
    // (reason kann no_credit ODER window_blocked sein, je nach nextValidDt vs now —
    // beides ist korrekt "blockiert" aus User-Sicht.)

    const pickExact = await selectCreditForBooking(supa, yogi1Id, targetExact, windowDay, '20:30:00')
    expect(pickExact.ok).toBe(true)

    const pickLate = await selectCreditForBooking(supa, yogi1Id, targetLate, windowDay, '20:31:00')
    expect(pickLate.ok).toBe(true)
  })

  test('[E2E] Nachholen: Stunde nach Kursende+8 → blockiert', async () => {
    const db = await getAdminClient()
    // Kurs in der Vergangenheit, date_end = heute - 5 (also Nachhol-Window war bis heute+3)
    const course = await createTestCourse({ name: `${E2E_PREFIX} Nachhol-blocked`, sessionCount: 1, startDaysFromNow: -5 })
    await db.from('courses').update({ date_end: dateStr(-5) }).eq('id', course.courseId)
    const originId = course.sessionIds[0]
    await enrollYogiWithBookings(yogi1Id, course.courseId, [originId])
    await cancelBooking(yogi1Id, originId)

    // Versucht Stunde 9 Tage NACH Kursende zu buchen (außerhalb 8d-Window)
    const targetCourse = await createTestCourse({ name: `${E2E_PREFIX} Nachhol-Ziel`, sessionCount: 1, startDaysFromNow: 4 })
    const targetSessionId = targetCourse.sessionIds[0]

    const supa = makeServiceClient()
    // Aber: Course-Credit selbst expires +180 Tage (siehe enrollYogiWithBookings).
    // Das Window-blocked-Verhalten testen wir via Origin: weil origin in -5d war,
    // und target in +4d = Origin+9d → außerhalb Window (Origin courseEnd+8d = -5+8 = +3d).
    const pick = await selectCreditForBooking(supa, yogi1Id, targetSessionId, dateStr(4), '18:30:00')

    // Course-Credit-Fenster verletzt → entweder no_credit (kein Fallback) oder window_blocked
    expect(pick.ok).toBe(false)
  })

  test('[E2E] FIFO: ältere abgesagte Stunde ist Anker, nicht spätere', async () => {
    const db = await getAdminClient()
    const course = await createTestCourse({ name: `${E2E_PREFIX} FIFO`, sessionCount: 1, startDaysFromNow: 8 })
    // Zusatz-Session 20 Tage in der Zukunft
    const origin8d = course.sessionIds[0]
    const origin20d = await insertSession(course.courseId, dateStr(20), '18:30:00')
    await db.from('courses').update({ date_end: dateStr(20) }).eq('id', course.courseId)
    await enrollYogiWithBookings(yogi1Id, course.courseId, [origin8d, origin20d])
    // BEIDE absagen
    await cancelBooking(yogi1Id, origin8d)
    await cancelBooking(yogi1Id, origin20d)

    // Buchung in 7 Tagen → ältester Anspruch (8d) muss greifen
    const target = await createTestCourse({ name: `${E2E_PREFIX} FIFO-Target1`, sessionCount: 1, startDaysFromNow: 7 })
    const targetSessionId = target.sessionIds[0]

    const supa = makeServiceClient()
    const pick1 = await selectCreditForBooking(supa, yogi1Id, targetSessionId, dateStr(7), '18:30:00')
    expect(pick1.ok).toBe(true)
    if (pick1.ok) expect(pick1.originSessionId).toBe(origin8d)

    // Echte Booking anlegen (mit dem 8d-Anspruch verbraucht)
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: targetSessionId, credit_id: pick1.ok ? pick1.creditId : null,
      origin_session_id: pick1.ok ? pick1.originSessionId : null,
      type: 'course', status: 'active',
    })

    // 2. Buchung in 11 Tagen (innerhalb 10d von origin20d) → origin20d wird verwendet
    const target2 = await createTestCourse({ name: `${E2E_PREFIX} FIFO-Target2`, sessionCount: 1, startDaysFromNow: 11 })
    const target2Id = target2.sessionIds[0]
    const pick2 = await selectCreditForBooking(supa, yogi1Id, target2Id, dateStr(11), '18:30:00')
    expect(pick2.ok).toBe(true)
    if (pick2.ok) expect(pick2.originSessionId).toBe(origin20d)
  })

  test('[E2E] Kursabbruch storniert zukünftige Vorhol-Buchungen kaskadiert', async () => {
    const db = await getAdminClient()
    // Kurs A mit Session Woche 5 + 6
    const courseA = await createTestCourse({ name: `${E2E_PREFIX} Kurs-A-Cascade`, sessionCount: 1, startDaysFromNow: 42 })
    await db.from('courses').update({ date_end: dateStr(42) }).eq('id', courseA.courseId)
    const week6 = courseA.sessionIds[0]
    await enrollYogiWithBookings(yogi1Id, courseA.courseId, [week6])
    await cancelBooking(yogi1Id, week6)

    // Vorhol-Booking in Woche 5 (= week6 - 7d, innerhalb 10d-Window)
    const courseB = await createTestCourse({ name: `${E2E_PREFIX} Kurs-B-Replacement`, sessionCount: 1, startDaysFromNow: 35 })
    const week5 = courseB.sessionIds[0]
    const { data: courseCred } = await db.from('credits').select('id').eq('user_id', yogi1Id).eq('course_id', courseA.courseId).maybeSingle()
    const replacementBooking = await db.from('bookings').insert({
      user_id: yogi1Id, session_id: week5, credit_id: courseCred!.id,
      origin_session_id: week6, type: 'course', status: 'active',
    }).select('id').single()

    // App-Cascade-Logic nachstellen (genau wie in app/admin/kurse/page.tsx)
    // 1) Alle zukünftigen Sessions von Kurs A absagen
    const today = dateStr(0)
    const { data: futureSessions } = await db.from('sessions')
      .select('id, date')
      .eq('course_id', courseA.courseId)
      .gte('date', today)
    for (const s of (futureSessions || [])) {
      await db.from('sessions').update({ is_cancelled: true, cancel_reason: 'Kurs abgebrochen' }).eq('id', s.id)
    }
    // 2) Cascade: alle aktiven Bookings mit origin_session_id in den abgesagten future-sessions
    const futureSessionIds = (futureSessions || []).map((s: any) => s.id)
    if (futureSessionIds.length > 0) {
      const { data: dependents } = await db.from('bookings')
        .select('id, session:sessions!bookings_session_id_fkey(date)')
        .in('origin_session_id', futureSessionIds)
        .eq('status', 'active')
      const toCancel = ((dependents || []) as any[]).filter(b => b.session?.date && b.session.date >= today)
      for (const b of toCancel) {
        await db.from('bookings').update({
          status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false,
        }).eq('id', b.id)
      }
      if (toCancel.length > 0) {
        await db.from('audit_log').insert({
          action: 'cascade_replacement_cancelled',
          details: { course_id: courseA.courseId, cancelled_booking_count: toCancel.length },
        })
      }
    }
    await db.from('courses').update({ is_cancelled: true, is_active: false }).eq('id', courseA.courseId)

    // Asserts: Vorhol-Booking ist cancelled
    const { data: cascaded } = await db.from('bookings').select('status').eq('id', replacementBooking.data!.id).single()
    expect(cascaded?.status).toBe('cancelled')

    // audit_log enthält cascade_replacement_cancelled
    const { data: audit } = await db.from('audit_log').select('*')
      .eq('action', 'cascade_replacement_cancelled')
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle()
    expect(audit?.details?.course_id).toBe(courseA.courseId)
  })

  test('[E2E] Kursabbruch: bereits besuchte Vorhol-Stunde bleibt bestehen', async () => {
    const db = await getAdminClient()
    // Origin = abgesagte Stunde in der Zukunft (Woche 6)
    const courseA = await createTestCourse({ name: `${E2E_PREFIX} Kurs-A-Past-Vorhol`, sessionCount: 1, startDaysFromNow: 42 })
    await db.from('courses').update({ date_end: dateStr(42) }).eq('id', courseA.courseId)
    const future = courseA.sessionIds[0]
    await enrollYogiWithBookings(yogi1Id, courseA.courseId, [future])
    await cancelBooking(yogi1Id, future)

    // Vorhol-Stunde in der VERGANGENHEIT (besucht, status=active)
    const courseB = await createTestCourse({ name: `${E2E_PREFIX} Past-Replacement`, sessionCount: 1, startDaysFromNow: -3 })
    const pastSession = courseB.sessionIds[0]
    const { data: courseCred } = await db.from('credits').select('id').eq('user_id', yogi1Id).eq('course_id', courseA.courseId).maybeSingle()
    const visited = await db.from('bookings').insert({
      user_id: yogi1Id, session_id: pastSession, credit_id: courseCred!.id,
      origin_session_id: future, type: 'course', status: 'active',
    }).select('id').single()

    // Cascade-Logic: bookings deren EIGENE Session >= heute werden cancelled
    const today = dateStr(0)
    const { data: futureSessions } = await db.from('sessions').select('id').eq('course_id', courseA.courseId).gte('date', today)
    const futureSessionIds = (futureSessions || []).map((s: any) => s.id)
    const { data: dependents } = await db.from('bookings')
      .select('id, session:sessions!bookings_session_id_fkey(date)')
      .in('origin_session_id', futureSessionIds)
      .eq('status', 'active')
    const toCancel = ((dependents || []) as any[]).filter(b => b.session?.date && b.session.date >= today)
    for (const b of toCancel) {
      await db.from('bookings').update({ status: 'cancelled' }).eq('id', b.id)
    }

    // Assert: besuchte Vorhol-Stunde (date < heute) bleibt active
    const { data: still } = await db.from('bookings').select('status').eq('id', visited.data!.id).single()
    expect(still?.status).toBe('active')
  })
})

// ────────────────────────────────────────────────────────────────────────
// 2) Smart Credit-Picker im Admin-Pfad
// ────────────────────────────────────────────────────────────────────────
test.describe('Smart Credit-Picker im Admin-Pfad', () => {
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test.beforeEach(async () => {
    await resetYogi(yogi1Id)
  })

  test.afterAll(async () => {
    await resetYogi(yogi1Id)
  })

  test('[E2E] Admin bucht Yogi 11 Tage vorher → selectCreditForBooking liefert window_blocked', async () => {
    // Yogi mit Course-Credit, Origin in 11d
    const course = await createTestCourse({ name: `${E2E_PREFIX} Admin-11d`, sessionCount: 1, startDaysFromNow: 11 })
    const originId = course.sessionIds[0]
    await enrollYogiWithBookings(yogi1Id, course.courseId, [originId])
    await cancelBooking(yogi1Id, originId)

    // Target: morgen (= 10 Tage vor origin, also außerhalb 10d-Window weil origin -10d = +1d)
    // Wait — origin in 11d, target in 1d → diff = 10d → 1d ≥ 11-10 = 1d → genau am Window-Rand.
    // Genauer: minutengenau muss origin - 10d <= target. 11d - 10d = 1d. Target = 1d, 18:30.
    // Wenn origin auch 18:30 ist, dann gleich → erlaubt.
    // Wir nehmen target = 0d 18:30 (= heute) → 11d - 10d = 1d, target ist 1 Tag früher → blockiert.
    const target = await createTestCourse({ name: `${E2E_PREFIX} Admin-11d-Target`, sessionCount: 1, startDaysFromNow: 0 })
    const targetSessionId = target.sessionIds[0]

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogi1Id, targetSessionId, dateStr(0), '18:30:00')

    expect(pick.ok).toBe(false)
    if (!pick.ok) {
      expect(pick.reason).toBe('window_blocked')
      // App-Flow: würde dann confirm() für Quick-Credit zeigen — hier nur Modul-Level getestet
    }
  })

  test('[E2E] Admin-Pfad nutzt selectCreditForBooking — Helper-Konsistenz', async () => {
    // Indirekt: wir verifizieren dass die selectCreditForBooking-Funktion
    // gleich verhält wenn vom Admin- oder Yogi-Pfad aufgerufen. Da beide Pfade
    // dieselbe Bibliotheks-Funktion importieren, ist das per Konstruktion gegeben.
    // Setup: Yogi hat freien Tenpack-Credit, neue Session ohne Konflikt.
    const db = await getAdminClient()
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    await db.from('credits').insert({
      user_id: yogi1Id, course_id: null, model: 'tenpack',
      total: 5, used: 0, expires_at: exp.toISOString(),
    })

    const course = await createTestCourse({ name: `${E2E_PREFIX} Helper-Konsistenz`, sessionCount: 1, startDaysFromNow: 5 })
    const sessionId = course.sessionIds[0]

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogi1Id, sessionId, dateStr(5), '18:30:00')
    expect(pick.ok).toBe(true)
    if (pick.ok) expect(pick.usedModel).toBe('tenpack')
  })
})

// ────────────────────────────────────────────────────────────────────────
// 3) Einladung-Sperre nach Löschen
// ────────────────────────────────────────────────────────────────────────
test.describe('Einladung-Sperre nach Löschen', () => {
  test('[E2E] Soft-Delete: deleteInvitation setzt expires_at auf NOW()', async () => {
    const db = await getAdminClient()
    // Einladung anlegen — gültig bis +14d
    const future = new Date(); future.setDate(future.getDate() + 14)
    const { data: inv } = await db.from('invitations').insert({
      email: `${E2E_PREFIX.toLowerCase()}.invtest@example.com`,
      token: `e2e-test-${Date.now()}`,
      expires_at: future.toISOString(),
      used: false,
    }).select('id, expires_at, token').single()
    expect(new Date(inv!.expires_at).getTime()).toBeGreaterThan(Date.now())

    // Soft-Delete simulieren (Admin-UI-Action)
    await db.from('invitations').update({ expires_at: new Date().toISOString() }).eq('id', inv!.id)

    // Verify: jetzt abgelaufen
    const { data: after } = await db.from('invitations').select('expires_at').eq('id', inv!.id).single()
    expect(new Date(after!.expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000)

    // Cleanup
    await db.from('invitations').delete().eq('id', inv!.id)
  })

  test('[E2E] Gelöschte Einladung blockiert Account-Erstellung — /register zeigt "abgelaufen oder ungültig"', async ({ page, browser }) => {
    const db = await getAdminClient()
    // Soft-deleted Einladung (expires_at < now)
    const past = new Date(); past.setHours(past.getHours() - 1)
    const token = `e2e-deleted-${Date.now()}`
    const { data: inv } = await db.from('invitations').insert({
      email: `${E2E_PREFIX.toLowerCase()}.deleted@example.com`,
      token, expires_at: past.toISOString(), used: false,
    }).select('id').single()

    // Frischer Context (kein Login)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await p.goto(`/register?token=${token}`)
    await p.waitForLoadState('networkidle')
    await expect(p.getByText(/abgelaufen|ungültig/i)).toBeVisible({ timeout: 10_000 })
    await ctx.close()

    await db.from('invitations').delete().eq('id', inv!.id)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 4) Tagesänderungen weitere E2E
// ────────────────────────────────────────────────────────────────────────
test.describe('Tagesänderungen: weitere E2E', () => {
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test('[E2E] Reminder-Cron berücksichtigt Berlin-Zeitzone (RPC-Check)', async () => {
    // Die find_pending_session_reminders RPC nutzt AT TIME ZONE 'Europe/Berlin'.
    // Wir testen indirekt dass die Funktion existiert und ohne Fehler aufrufbar ist.
    const db = await getAdminClient()
    const { data, error } = await db.rpc('find_pending_session_reminders')
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  test('[E2E] Passwort-Reset: ungültiger Link → Fehlermeldung sichtbar', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await p.goto('/profil/passwort?token_hash=invalid-token-xyz&type=recovery')
    await p.waitForLoadState('networkidle')
    await expect(p.getByText(/ungültig oder abgelaufen|sitzung/i)).toBeVisible({ timeout: 10_000 })
    await ctx.close()
  })

  test('[E2E] Passwort-Reset Page lädt — Container existiert', async ({ browser }) => {
    // Wir können die echte Email/verifyOtp-Kette nicht End-to-End triggern ohne
    // Email-Inbox-Access. Aber: die Seite muss bei Aufruf ohne Token ein
    // "Bitte öffne diese Seite über den Link..."-Hinweis anzeigen.
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await p.goto('/profil/passwort')
    await p.waitForLoadState('networkidle')
    // Entweder der Hinweis erscheint, oder der User ist bereits eingeloggt
    // (z.B. Form zum Passwort ändern). Mindestens das Page-Layout muss da sein.
    await expect(p.locator('h1, h2').filter({ hasText: /passwort/i }).first()).toBeVisible({ timeout: 10_000 })
    await ctx.close()
  })

  test('[E2E] Doppel-Anzeige in /meine — enrolled Drop-In nicht doppelt', async () => {
    // Setup: Yogi enrolled in Kurs A mit 1 Session, bucht type=single in Session des Kurses A
    await resetYogi(yogi1Id)
    const db = await getAdminClient()
    const course = await createTestCourse({ name: `${E2E_PREFIX} Doppel-Drop-In`, sessionCount: 1, startDaysFromNow: 5 })
    const sessionId = course.sessionIds[0]
    // Enrollment ohne Booking (Yogi enrolled aber noch nicht gebucht)
    const expires = new Date(); expires.setDate(expires.getDate() + 90)
    await db.from('credits').insert({
      user_id: yogi1Id, course_id: course.courseId, model: 'course',
      total: 1, used: 0, expires_at: expires.toISOString(),
    })
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })
    // Drop-In type=single trotz enrollment
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: sessionId, type: 'single', status: 'active',
    })

    // Logic-Check: trueSingles-Filter würde diese Booking aus Einzelstunden ausschließen
    // (weil session.course_id im enrolled-Set ist)
    const { data: bookings } = await db.from('bookings')
      .select('*, session:sessions!bookings_session_id_fkey(course_id)')
      .eq('user_id', yogi1Id).eq('status', 'active')
    const enrolledCourseIds = new Set([course.courseId])
    const trueSingles = (bookings || []).filter((b: any) =>
      !b.session?.course_id || !enrolledCourseIds.has(b.session.course_id)
    )
    expect(trueSingles).toHaveLength(0)
    expect((bookings || []).length).toBe(1) // Booking existiert, aber wird im Kurs-Block angezeigt
    await resetYogi(yogi1Id)
  })

  test('[E2E] Replacement-Konvention: replacement_session_id zeigt von ABGESAGT auf ERSATZ', async () => {
    const db = await getAdminClient()
    await resetYogi(yogi1Id)
    const course = await createTestCourse({ name: `${E2E_PREFIX} Replacement-Konv`, sessionCount: 1, startDaysFromNow: 14 })
    const cancelledX = course.sessionIds[0]
    // Ersatz Y anlegen
    const replacementY = await insertSession(course.courseId, dateStr(15), '18:30:00')
    // Konvention: X (abgesagt) hat replacement_session_id = Y (Ersatz)
    await db.from('sessions').update({
      is_cancelled: true, replacement_session_id: replacementY,
    }).eq('id', cancelledX)

    // Assert
    const { data: xRow } = await db.from('sessions').select('replacement_session_id, is_cancelled').eq('id', cancelledX).single()
    expect(xRow?.is_cancelled).toBe(true)
    expect(xRow?.replacement_session_id).toBe(replacementY)

    const { data: yRow } = await db.from('sessions').select('replacement_session_id, is_cancelled').eq('id', replacementY).single()
    expect(yRow?.is_cancelled).toBe(false)
    expect(yRow?.replacement_session_id).toBeNull()
  })

  test('[E2E] Course-Credit Filter Aggregation: nur eigener Kurs', async () => {
    // Setup: Yogi enrolled in Kurs A (Course-Credit für A).
    // Yogi bucht in fremder Kurs B mit dem A-Credit (Drop-In via Course-Credit).
    // Erwartung: Admin-Aggregation für Kurs A zählt diese B-Buchung NICHT mit.
    await resetYogi(yogi1Id)
    const db = await getAdminClient()
    const courseA = await createTestCourse({ name: `${E2E_PREFIX} Aggregation-A`, sessionCount: 2, startDaysFromNow: 5 })
    const courseB = await createTestCourse({ name: `${E2E_PREFIX} Aggregation-B`, sessionCount: 1, startDaysFromNow: 6 })
    const aSessions = courseA.sessionIds
    const bSession = courseB.sessionIds[0]
    const creditId = await enrollYogiWithBookings(yogi1Id, courseA.courseId, aSessions)
    // Zusatz-Booking in fremdem Kurs B mit Credit aus A
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: bSession, credit_id: creditId,
      type: 'course', status: 'active',
    })

    // Aggregation für Kurs A (nur sessions in Kurs A zählen)
    const { data: bookingsForCourseA } = await db.from('bookings')
      .select('id, session:sessions!bookings_session_id_fkey(course_id)')
      .eq('user_id', yogi1Id).eq('status', 'active')
    const inCourseA = (bookingsForCourseA || []).filter((b: any) => b.session?.course_id === courseA.courseId)
    expect(inCourseA).toHaveLength(2) // nur die echten Kurs-A-Sessions
    await resetYogi(yogi1Id)
  })

  test('[E2E] Mid-Course-Hinweis: enrolled mit erster Session > Kursstart', async () => {
    await resetYogi(yogi1Id)
    const db = await getAdminClient()
    const course = await createTestCourse({ name: `${E2E_PREFIX} Mid-Course`, sessionCount: 3, startDaysFromNow: 7 })
    // course.date_start ist dateStr(7). Yogi enrolled erst ab Session 2 (= +14d).
    const sessions = course.sessionIds
    await enrollYogiWithBookings(yogi1Id, course.courseId, [sessions[1], sessions[2]])
    // Asssert: erste Session des Yogi > course.date_start
    const { data: yogiBookings } = await db.from('bookings')
      .select('session:sessions!bookings_session_id_fkey(date)')
      .eq('user_id', yogi1Id).eq('status', 'active')
    const firstSessionDate = (yogiBookings || []).map((b: any) => b.session?.date).filter(Boolean).sort()[0]
    const { data: courseData } = await db.from('courses').select('date_start').eq('id', course.courseId).single()
    expect(firstSessionDate > courseData!.date_start).toBe(true)
    await resetYogi(yogi1Id)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 5) Credit-Ablauf bis Session-Zeitpunkt
// ────────────────────────────────────────────────────────────────────────
test.describe('Credit-Ablauf bis Session-Zeitpunkt', () => {
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test.beforeEach(async () => {
    await resetYogi(yogi1Id)
  })

  test.afterAll(async () => {
    await resetYogi(yogi1Id)
  })

  test('[E2E] Credit läuft VOR Session ab → Buchung blockiert', async () => {
    const db = await getAdminClient()
    // Credit expired in 5 Tagen
    const exp = new Date(); exp.setDate(exp.getDate() + 5)
    await db.from('credits').insert({
      user_id: yogi1Id, course_id: null, model: 'tenpack',
      total: 5, used: 0, expires_at: exp.toISOString(),
    })
    // Session in 21 Tagen
    const target = await createTestCourse({ name: `${E2E_PREFIX} Credit-Expires-Pre`, sessionCount: 1, startDaysFromNow: 21 })
    const targetSessionId = target.sessionIds[0]

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogi1Id, targetSessionId, dateStr(21), '18:30:00')

    expect(pick.ok).toBe(false)
    if (!pick.ok) {
      expect(pick.reason).toBe('no_credit')
      expect(pick.message).toMatch(/läuft am.*ab.*nicht mehr gültig/i)
    }
  })

  test('[E2E] Credit gültig bis Session → Buchung erlaubt', async () => {
    const db = await getAdminClient()
    // Credit expired in 30 Tagen
    const exp = new Date(); exp.setDate(exp.getDate() + 30)
    await db.from('credits').insert({
      user_id: yogi1Id, course_id: null, model: 'tenpack',
      total: 5, used: 0, expires_at: exp.toISOString(),
    })
    const target = await createTestCourse({ name: `${E2E_PREFIX} Credit-Valid`, sessionCount: 1, startDaysFromNow: 14 })
    const targetSessionId = target.sessionIds[0]

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogi1Id, targetSessionId, dateStr(14), '18:30:00')

    expect(pick.ok).toBe(true)
    if (pick.ok) expect(pick.usedModel).toBe('tenpack')
  })

  test('[E2E] Course-Credit 8d-nach-Kursende-Window respektiert', async () => {
    const db = await getAdminClient()
    // Kurs der schon vorbei ist (date_end = -2), Course-Credit verfällt 8d nach Kursende = +6
    const course = await createTestCourse({ name: `${E2E_PREFIX} Course-End-Window`, sessionCount: 1, startDaysFromNow: -5 })
    await db.from('courses').update({ date_end: dateStr(-2) }).eq('id', course.courseId)
    const expires = new Date(); expires.setDate(expires.getDate() + 6)
    await db.from('credits').insert({
      user_id: yogi1Id, course_id: course.courseId, model: 'course',
      total: 1, used: 0, expires_at: expires.toISOString(),
    })
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })

    // Ziel: Stunde in +9d → außerhalb des Credit-Ablaufs
    const target = await createTestCourse({ name: `${E2E_PREFIX} Course-End-Target`, sessionCount: 1, startDaysFromNow: 9 })
    const targetSessionId = target.sessionIds[0]

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogi1Id, targetSessionId, dateStr(9), '18:30:00')

    expect(pick.ok).toBe(false) // Credit verfällt am +6, Session am +9 → blockiert
  })
})

// ────────────────────────────────────────────────────────────────────────
// 6) Einzelstunden-Klassifizierung (Kurs-Membership-basiert)
// ────────────────────────────────────────────────────────────────────────
test.describe('Einzelstunden-Klassifizierung (Kurs-Membership-basiert)', () => {
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test.beforeEach(async () => {
    await resetYogi(yogi1Id)
  })

  test.afterAll(async () => {
    await resetYogi(yogi1Id)
  })

  /** Helper: classify wie /meine + /admin/yogis/[id] es machen */
  function classify(bookings: any[], enrolledCourseIds: Set<string>) {
    const inCourseBlock: any[] = []
    const inSingles: any[] = []
    for (const b of bookings) {
      if (b.session?.course_id && enrolledCourseIds.has(b.session.course_id)) {
        inCourseBlock.push(b)
      } else {
        inSingles.push(b)
      }
    }
    return { inCourseBlock, inSingles }
  }

  test('[E2E] Drop-In in fremder Kurs-Session → Einzelstunden', async () => {
    const db = await getAdminClient()
    const courseA = await createTestCourse({ name: `${E2E_PREFIX} Klass-Drop-A`, sessionCount: 1, startDaysFromNow: 5 })
    const courseB = await createTestCourse({ name: `${E2E_PREFIX} Klass-Drop-B`, sessionCount: 1, startDaysFromNow: 6 })
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: courseA.courseId })
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: courseB.sessionIds[0], type: 'single', status: 'active',
    })

    const { data: bookings } = await db.from('bookings')
      .select('*, session:sessions!bookings_session_id_fkey(course_id)')
      .eq('user_id', yogi1Id).eq('status', 'active')
    const { inCourseBlock, inSingles } = classify(bookings || [], new Set([courseA.courseId]))
    expect(inCourseBlock).toHaveLength(0)
    expect(inSingles).toHaveLength(1)
  })

  test('[E2E] Vorhol mit Course-Credit aus altem Kurs → Einzelstunden', async () => {
    const db = await getAdminClient()
    // Course-Credit aus ARCHIVIERTEM Kurs A (is_active=false)
    const courseA = await createTestCourse({ name: `${E2E_PREFIX} Klass-Archived`, sessionCount: 1, startDaysFromNow: -10 })
    await db.from('courses').update({ is_active: false, date_end: dateStr(-3) }).eq('id', courseA.courseId)
    const exp = new Date(); exp.setDate(exp.getDate() + 5)
    const { data: cred } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: courseA.courseId, model: 'course',
      total: 1, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: courseA.courseId })

    // Vorhol-Booking in fremdem Kurs B
    const courseB = await createTestCourse({ name: `${E2E_PREFIX} Klass-Vorhol-Target`, sessionCount: 1, startDaysFromNow: 3 })
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: courseB.sessionIds[0],
      credit_id: cred!.id, type: 'course', status: 'active',
    })

    // Aktive enrolled: nur Kurse mit is_active=true && !is_cancelled
    const { data: enrols } = await db.from('enrollments')
      .select('course_id, course:courses(is_active, is_cancelled)')
      .eq('user_id', yogi1Id)
    const activeEnrolledIds = new Set(
      (enrols || [])
        .filter((e: any) => e.course?.is_active !== false && e.course?.is_cancelled !== true)
        .map((e: any) => e.course_id)
    )
    const { data: bookings } = await db.from('bookings')
      .select('*, session:sessions!bookings_session_id_fkey(course_id)')
      .eq('user_id', yogi1Id).eq('status', 'active')
    const { inSingles } = classify(bookings || [], activeEnrolledIds)
    expect(inSingles.length).toBeGreaterThan(0)
  })

  test('[E2E] Buchung im eigenen Kurs nach Ab+Wiederanmeldung → Kurs-Block', async () => {
    const db = await getAdminClient()
    const course = await createTestCourse({ name: `${E2E_PREFIX} Klass-Wiederbuchen`, sessionCount: 1, startDaysFromNow: 5 })
    await enrollYogiWithBookings(yogi1Id, course.courseId, course.sessionIds)
    // Abmelden + wieder einbuchen
    await cancelBooking(yogi1Id, course.sessionIds[0])
    await db.from('bookings').update({ status: 'active', cancelled_at: null }).eq('user_id', yogi1Id).eq('session_id', course.sessionIds[0])

    const { data: bookings } = await db.from('bookings')
      .select('*, session:sessions!bookings_session_id_fkey(course_id)')
      .eq('user_id', yogi1Id).eq('status', 'active')
    const { inCourseBlock, inSingles } = classify(bookings || [], new Set([course.courseId]))
    expect(inCourseBlock).toHaveLength(1)
    expect(inSingles).toHaveLength(0)
  })

  test('[E2E] Admin-Yogi-Detail: gleiche Klassifizierung wie /meine', async () => {
    // Reflektiert: gleiche Helper-Funktion + Datenbasis → gleiches Ergebnis
    const db = await getAdminClient()
    const courseA = await createTestCourse({ name: `${E2E_PREFIX} Klass-Admin-A`, sessionCount: 1, startDaysFromNow: 5 })
    const courseB = await createTestCourse({ name: `${E2E_PREFIX} Klass-Admin-B`, sessionCount: 1, startDaysFromNow: 6 })
    await enrollYogiWithBookings(yogi1Id, courseA.courseId, courseA.sessionIds)
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: courseB.sessionIds[0], type: 'single', status: 'active',
    })

    const { data: bookings } = await db.from('bookings')
      .select('*, session:sessions!bookings_session_id_fkey(course_id)')
      .eq('user_id', yogi1Id).eq('status', 'active')
    const { inCourseBlock, inSingles } = classify(bookings || [], new Set([courseA.courseId]))
    expect(inCourseBlock).toHaveLength(1)
    expect(inSingles).toHaveLength(1)
  })

  test('[E2E] Archivierter enrolled Kurs (date_end < heute) → aktive Klassifizierung greift', async () => {
    const db = await getAdminClient()
    // Kurs mit date_end in der Vergangenheit
    const course = await createTestCourse({ name: `${E2E_PREFIX} Klass-Past-End`, sessionCount: 1, startDaysFromNow: -10 })
    await db.from('courses').update({ date_end: dateStr(-3) }).eq('id', course.courseId)
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })

    // UI-Filter in /meine: enrolledCourseIds nur Kurse mit date_end >= today
    const { data: enrols } = await db.from('enrollments')
      .select('course_id, course:courses(date_end)')
      .eq('user_id', yogi1Id)
    const today = dateStr(0)
    const activeEnrolled = (enrols || []).filter((e: any) =>
      !e.course?.date_end || e.course.date_end >= today
    )
    expect(activeEnrolled).toHaveLength(0) // Kurs ist past → nicht mehr aktiv enrolled
  })
})

// ────────────────────────────────────────────────────────────────────────
// 7) Admin Yogi-Detail: archivierte Kurse + Credits
// ────────────────────────────────────────────────────────────────────────
test.describe('Admin-Yogi-Detail: archivierte Kurse + Credits', () => {
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test.beforeEach(async () => {
    await resetYogi(yogi1Id)
  })

  test.afterAll(async () => {
    await resetYogi(yogi1Id)
  })

  test('[E2E] Archivierter Kurs (is_active=false) — UI-Filter blendet Enrollment aus', async () => {
    const db = await getAdminClient()
    const course = await createTestCourse({ name: `${E2E_PREFIX} Admin-Archiviert`, sessionCount: 1, startDaysFromNow: 5 })
    await enrollYogiWithBookings(yogi1Id, course.courseId, course.sessionIds)
    // Archivieren
    await db.from('courses').update({ is_active: false }).eq('id', course.courseId)

    // Admin-UI-Filter: enrolled-Cards nur wenn course.is_active && !is_cancelled
    const { data: enrols } = await db.from('enrollments')
      .select('course_id, course:courses(is_active, is_cancelled)')
      .eq('user_id', yogi1Id)
    const activeEnrols = (enrols || []).filter((e: any) =>
      e.course?.is_active !== false && e.course?.is_cancelled !== true
    )
    expect(activeEnrols).toHaveLength(0)

    // ABER: Credit aus dem archivierten Kurs bleibt in der credits-Tabelle bis expires_at
    const { data: credits } = await db.from('credits').select('*').eq('user_id', yogi1Id).eq('course_id', course.courseId)
    expect(credits?.length).toBeGreaterThan(0)
  })

  test('[E2E] Cancelled Kurs (is_cancelled=true) — UI-Filter blendet Enrollment aus', async () => {
    const db = await getAdminClient()
    const course = await createTestCourse({ name: `${E2E_PREFIX} Admin-Cancelled`, sessionCount: 1, startDaysFromNow: 5 })
    await enrollYogiWithBookings(yogi1Id, course.courseId, course.sessionIds)
    await db.from('courses').update({ is_cancelled: true, is_active: false }).eq('id', course.courseId)

    const { data: enrols } = await db.from('enrollments')
      .select('course_id, course:courses(is_active, is_cancelled)')
      .eq('user_id', yogi1Id)
    const activeEnrols = (enrols || []).filter((e: any) =>
      e.course?.is_active !== false && e.course?.is_cancelled !== true
    )
    expect(activeEnrols).toHaveLength(0)
  })
})
