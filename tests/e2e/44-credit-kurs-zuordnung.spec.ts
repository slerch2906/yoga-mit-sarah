/**
 * Welle (Sarah 2026-05-28): Credit-Kurs-Zuordnung + Kurs-Ende-Timing.
 *
 * Deckt 4 gemeldete Bugs ab:
 *  A) Credit-Vorrang: Eine Stunde aus Kurs X muss ZUERST den Course-Credit von
 *     Kurs X verbrauchen — nicht den eines fremden Kurses (z.B. Body&Mind-Stunde
 *     darf nicht den "Credit Hinweis Ablauf"-Credit nehmen).
 *  B) 8-Tage-Nachhol-Block: Course-Credits sind nur bis 8 Tage nach Kursende
 *     einlösbar. Eine Stunde 9 Tage nach Kursende → klare Block-Meldung.
 *  2) Kurs gilt als beendet ab Start der LETZTEN Stunde (date_end + time_start),
 *     nicht erst am Tagesende → lib/session-status.isCourseEnded.
 *  4) Folgekurs/Rollover muss credit_id an die Bookings haengen (sonst 0/N genutzt).
 *
 * Modell-zentrisch: ruft selectCreditForBooking direkt auf (stabil gegen UI-Drift).
 */
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { selectCreditForBooking } from '../../lib/credit-selector'
import { isCourseEnded } from '../../lib/session-status'
import { getAdminClient, getUserIdByEmail } from '../utils/db'
import { createTestCourse, E2E_PREFIX } from '../utils/seed'

dotenv.config({ path: '.env.test' })

function makeServiceClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
function dateStr(daysFromNow: number): string {
  const d = new Date(); d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().split('T')[0]
}
async function resetYogi(userId: string) {
  const db = await getAdminClient()
  await db.from('waitlist').delete().eq('user_id', userId)
  await db.from('bookings').delete().eq('user_id', userId)
  await db.from('credits').delete().eq('user_id', userId)
  await db.from('enrollments').delete().eq('user_id', userId)
}
async function enrollWithCredit(userId: string, courseId: string, sessionIds: string[], creditExpiresAt?: Date) {
  const db = await getAdminClient()
  const expires = creditExpiresAt || (() => { const d = new Date(); d.setDate(d.getDate() + 180); return d })()
  const { data: credit } = await db.from('credits').insert({
    user_id: userId, course_id: courseId, model: 'course',
    total: sessionIds.length, used: 0, expires_at: expires.toISOString(),
  }).select('id').single()
  await db.from('enrollments').insert({ user_id: userId, course_id: courseId })
  for (const sid of sessionIds) {
    await db.from('bookings').insert({
      user_id: userId, session_id: sid, credit_id: credit?.id, type: 'course', status: 'active',
    })
  }
  return credit?.id as string
}
async function insertSession(courseId: string, date: string, timeStart = '18:30:00') {
  const db = await getAdminClient()
  const { data } = await db.from('sessions').insert({
    course_id: courseId, date, time_start: timeStart, duration_min: 75, is_cancelled: false,
  }).select('id').single()
  return data?.id as string
}
async function cancelBooking(userId: string, sessionId: string) {
  const db = await getAdminClient()
  await db.from('bookings').update({
    status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false,
  }).eq('user_id', userId).eq('session_id', sessionId)
}

// ════════════════════════════════════════════════════════════════════════
// A) Credit-Vorrang: eigener Kurs zuerst
// ════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Credit-Kurs-Zuordnung — Vorrang eigener Kurs', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  let yogiId: string
  test.beforeAll(async () => { yogiId = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))! })
  test.beforeEach(async () => { await resetYogi(yogiId) })
  test.afterAll(async () => { await resetYogi(yogiId) })

  test('Stunde aus Kurs A nimmt Credit von Kurs A — nicht den (früher ablaufenden) Kurs-B-Credit', async () => {
    // Kurs A: Origin-Stunde in 12 Tagen + Ziel-Stunde in 3 Tagen
    const courseA = await createTestCourse({ name: `${E2E_PREFIX} KursA-Vorrang`, sessionCount: 1, startDaysFromNow: 12 })
    const sA_origin = courseA.sessionIds[0]
    const sA_target = await insertSession(courseA.courseId, dateStr(3))
    const creditA = await enrollWithCredit(yogiId, courseA.courseId, [sA_origin, sA_target]) // expires +180
    await cancelBooking(yogiId, sA_origin)
    await cancelBooking(yogiId, sA_target)

    // Kurs B: eigener Course-Credit mit Origin, aber FRÜHER ablaufend (+30).
    // Ohne Fix würde B (kleineres expires_at) zuerst sortiert und faelschlich genommen.
    const courseB = await createTestCourse({ name: `${E2E_PREFIX} KursB-Fremd`, sessionCount: 1, startDaysFromNow: 12 })
    const sB_origin = courseB.sessionIds[0]
    const expB = new Date(); expB.setDate(expB.getDate() + 30)
    await enrollWithCredit(yogiId, courseB.courseId, [sB_origin], expB)
    await cancelBooking(yogiId, sB_origin)

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogiId, sA_target, dateStr(3), '18:30:00')

    expect(pick.ok, JSON.stringify(pick)).toBe(true)
    if (pick.ok) {
      expect(pick.creditId, 'Muss den Kurs-A-Credit nehmen').toBe(creditA)
      expect(pick.originSessionId, 'Origin muss aus Kurs A stammen').toBe(sA_origin)
      expect(pick.usedModel).toBe('course')
    }
  })

  test('Nachholen in ANDEREM Kurs bleibt möglich, wenn kein eigener Credit existiert', async () => {
    // Regressionsschutz: das Vorhol/Nachhol-Feature (Course-Credit für Drop-In
    // woanders) funktioniert weiterhin, solange es KEINEN eigenen Credit gibt.
    const courseA = await createTestCourse({ name: `${E2E_PREFIX} KursA-Nachhol`, sessionCount: 1, startDaysFromNow: 6 })
    const sA_origin = courseA.sessionIds[0]
    const creditA = await enrollWithCredit(yogiId, courseA.courseId, [sA_origin])
    await cancelBooking(yogiId, sA_origin)

    // Ziel-Stunde in einem ANDEREN Kurs (kein eigener Credit dort)
    const courseB = await createTestCourse({ name: `${E2E_PREFIX} KursB-DropIn`, sessionCount: 1, startDaysFromNow: 3 })
    const sB_target = courseB.sessionIds[0]

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogiId, sB_target, dateStr(3), '18:30:00')

    expect(pick.ok, JSON.stringify(pick)).toBe(true)
    if (pick.ok) {
      expect(pick.creditId, 'Fällt auf Kurs-A-Credit zurück (Nachholen woanders)').toBe(creditA)
      expect(pick.usedModel).toBe('course')
    }
  })
})

// ════════════════════════════════════════════════════════════════════════
// B) 8-Tage-Nachhol-Block
// ════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Credit nur bis 8 Tage nach Kursende einlösbar', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  let yogiId: string
  test.beforeAll(async () => { yogiId = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))! })
  test.beforeEach(async () => { await resetYogi(yogiId) })
  test.afterAll(async () => { await resetYogi(yogiId) })

  test('Stunde 9 Tage nach Kursende → klare Block-Meldung', async () => {
    // Kurs endet in 5 Tagen; Course-Credit gültig bis Kursende+8 = +13.
    const courseA = await createTestCourse({ name: `${E2E_PREFIX} 8d-Nachhol`, sessionCount: 1, startDaysFromNow: 5 })
    const sA_origin = courseA.sessionIds[0]
    const courseEnd = new Date(); courseEnd.setDate(courseEnd.getDate() + 5)
    const credExp = new Date(courseEnd); credExp.setDate(credExp.getDate() + 8) // +13
    await enrollWithCredit(yogiId, courseA.courseId, [sA_origin], credExp)
    await cancelBooking(yogiId, sA_origin)

    // Ziel-Stunde 9 Tage nach Kursende (= +14) → ausserhalb 8-Tage-Fenster
    const sA_late = await insertSession(courseA.courseId, dateStr(14))

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogiId, sA_late, dateStr(14), '18:30:00')

    expect(pick.ok).toBe(false)
    if (!pick.ok) {
      expect(pick.reason).toBe('window_blocked')
      expect(pick.message).toMatch(/8 Tage nach Kursende/i)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════
// 2) isCourseEnded — Kurs-Ende ab Start der letzten Stunde
// ════════════════════════════════════════════════════════════════════════
test.describe('[E2E] isCourseEnded — beendet ab Start letzter Stunde', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('Heute, Startzeit vorbei → beendet', () => {
    const today = new Date().toISOString().split('T')[0]
    expect(isCourseEnded({ date_end: today, time_start: '00:00:00' }, new Date(`${today}T12:00:00`))).toBe(true)
  })
  test('Heute, Startzeit noch nicht erreicht → NICHT beendet', () => {
    const today = new Date().toISOString().split('T')[0]
    expect(isCourseEnded({ date_end: today, time_start: '23:59:00' }, new Date(`${today}T12:00:00`))).toBe(false)
  })
  test('date_end morgen → NICHT beendet (egal welche Uhrzeit)', () => {
    const d = new Date(); d.setDate(d.getDate() + 1)
    const tomorrow = d.toISOString().split('T')[0]
    expect(isCourseEnded({ date_end: tomorrow, time_start: '06:00:00' })).toBe(false)
  })
  test('kein date_end → nie beendet', () => {
    expect(isCourseEnded({ date_end: null, time_start: '18:00:00' })).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 4) Rollover/Folgekurs verlinkt credit_id (Source-Check)
// ════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Folgekurs-Rollover verlinkt credit_id', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('doFolgekurs hängt rolloverCreditId an die Bookings', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/admin/kurse/page.tsx'), 'utf8')
    // Credit-ID wird aus dem Insert gelesen …
    expect(src).toMatch(/const\s+rolloverCreditId\s*=\s*rolloverCredit\?\.id/)
    // … und an den Booking-Insert gehängt
    expect(src).toMatch(/credit_id:\s*rolloverCreditId,\s*type:\s*'course'/)
  })
})

// ════════════════════════════════════════════════════════════════════════
// Warteliste-Auto-Nachrücken bei Events (Sarah 2026-05-28)
// ════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Auto-Nachrücken funktioniert auch für Events', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('waitlist-promote routet event_free/event_paid in den No-Credit-Promote', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/waitlist-promote.ts'), 'utf8')
    // session_type wird geladen + isEvent erkannt
    expect(src).toMatch(/session_type/)
    expect(src).toMatch(/sessType\s*===\s*'event_free'\s*\|\|\s*sessType\s*===\s*'event_paid'/)
    // Events werden ohne Credit nachgerückt (wie Charity)
    expect(src).toMatch(/promoteWithoutCredit\s*=\s*isFreeCourse\s*\|\|\s*isEvent/)
    expect(src).toMatch(/promoteWithoutCredit[\s\S]{0,120}tryAutoPromoteOneFree/)
  })

  test('Dashboard-Event-Austrag ruft promoteWaitlistOrOfferLate auf', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/admin/dashboard/page.tsx'), 'utf8')
    // Im isEvent-Zweig von cancelBookingForYogi muss vor dem return promotet werden
    const idxEvent = src.indexOf('if (isEvent) {')
    expect(idxEvent, 'isEvent-Zweig existiert').toBeGreaterThan(-1)
    const eventBlock = src.slice(idxEvent, idxEvent + 2000)
    expect(eventBlock).toMatch(/promoteWaitlistOrOfferLate\(supabase,\s*sessionId\)/)
  })

  test('leave_waitlist-Bestätigung nutzt session_name (kein SYS-Name)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/warteliste/austragen/page.tsx'), 'utf8')
    // Client liest session_name/session_type aus der RPC und ersetzt SYS-Namen
    expect(src).toMatch(/data\.session_name/)
    expect(src).toMatch(/data\.session_type/)
    expect(src).toMatch(/SYS · /)
  })
})
