/**
 * Workflow: Single-Course (is_single=true / Drop-in)
 * Testfälle:
 *   - Yogi kann Einzelstunde buchen mit single-Credit (kein Enrollment)
 *   - is_single=true Kurs hat KEINE wiederkehrenden Sessions
 *   - Yogi taucht in Session-Detailseite auf (nicht in Kursliste/Enrollment)
 */
import { test, expect } from '@playwright/test'
import { SessionDetailPage } from '../page-objects/SessionDetailPage'
import { giveYogiSingleCredit, futureDateStr, E2E_PREFIX } from '../utils/seed'
import {
  getUserIdByEmail, getAdminClient, getActiveBooking,
} from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('Single-Course: Einzelstunden-Buchung ohne Enrollment', () => {
  test.use({ storageState: 'tests/.auth/yogi1.json' })

  let sessionId: string
  let courseId: string
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()

    // Sauberer Stand für yogi1
    await db.from('bookings').delete().eq('user_id', yogi1Id)
    await db.from('enrollments').delete().eq('user_id', yogi1Id)
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')

    // is_single Kurs anlegen (Drop-in)
    const dateStr = futureDateStr(10)
    const { data: course } = await db.from('courses').insert({
      name: `${E2E_PREFIX} Drop-in-Test`,
      weekday: new Date(dateStr).toLocaleDateString('de-DE', { weekday: 'long' }),
      time_start: '18:30:00',
      duration_min: 75,
      max_spots: 8,
      total_units: 1,
      date_start: dateStr,
      date_end: dateStr,
      is_active: true,
      is_single: true,
      is_open: true,
    }).select('id').single()
    courseId = course!.id

    const { data: sess } = await db.from('sessions').insert({
      course_id: courseId,
      date: dateStr,
      time_start: '18:30:00',
      duration_min: 75,
      is_cancelled: false,
    }).select('id').single()
    sessionId = sess!.id

    await giveYogiSingleCredit(yogi1Id, 2)
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')
  })

  test('Drop-in Stunde buchen → Buchung type=single, KEIN Enrollment', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(sessionId)
    await sessionPage.book()

    // DB-Check: Buchung mit type='single'
    const booking = await getActiveBooking(yogi1Id, sessionId)
    expect(booking, 'Buchung muss vorhanden sein').toBeTruthy()
    expect(booking?.type, 'Drop-in muss type=single haben').toBe('single')

    // DB-Check: KEIN Enrollment (Drop-in ist nicht Kurs-Anmeldung)
    const db = await getAdminClient()
    const { data: enrollment } = await db.from('enrollments')
      .select('*').eq('user_id', yogi1Id).eq('course_id', courseId).maybeSingle()
    expect(enrollment, 'Drop-in-Buchung darf KEIN Enrollment erzeugen').toBeNull()
  })
})
