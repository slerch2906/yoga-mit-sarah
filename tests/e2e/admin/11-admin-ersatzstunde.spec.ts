/**
 * Workflow: Admin – Ersatzstunde anlegen nach Absage
 * Testfälle:
 *   - Admin sagt Stunde ab (ohne Ersatz) → Credit wird zurückgebucht
 *   - Admin legt nachträglich Ersatztermin an → Yogis werden automatisch eingebucht
 *   - Yogi hat Credit zwischenzeitlich verbraucht → wird übersprungen (nicht eingebucht)
 */
import { test, expect } from '@playwright/test'
import {
  createTestCourse, giveYogiSingleCredit, futureDateStr, E2E_PREFIX,
} from '../../utils/seed'
import {
  getUserIdByEmail, getAdminClient, getActiveBooking, getSingleCredit,
  countActiveBookingsForSession,
} from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('Ersatzstunde: Absage ohne Ersatz → Credit zurück', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let sessionId: string
  let yogi1Id: string
  let creditId: string | undefined

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')

    const course = await createTestCourse({ name: `${E2E_PREFIX} Ersatzstunde-Test`, sessionCount: 1 })
    sessionId = course.sessionIds[0]

    creditId = await giveYogiSingleCredit(yogi1Id, 3)

    // Yogi direkt in Session einbuchen
    await db.from('bookings').insert({
      user_id: yogi1Id,
      session_id: sessionId,
      credit_id: creditId,
      type: 'single',
      status: 'active',
    })
    await db.from('credits').update({ used: 1 }).eq('id', creditId)
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')
    await db.from('bookings').delete().eq('session_id', sessionId)
    // Replacement sessions that may have been created
    const { data: course } = await db.from('sessions').select('course_id').eq('id', sessionId).maybeSingle()
    if (course?.course_id) {
      const { data: allSessions } = await db.from('sessions').select('id').eq('course_id', course.course_id)
      const ids = (allSessions || []).map(s => s.id)
      if (ids.length > 0) await db.from('bookings').delete().in('session_id', ids)
      await db.from('sessions').delete().eq('course_id', course.course_id)
      await db.from('courses').delete().eq('id', course.course_id)
    }
  })

  test('Stunde absagen ohne Ersatz → Session cancelled, Credit zurückgebucht', async ({ page }) => {
    const creditBefore = await getSingleCredit(yogi1Id)
    expect(creditBefore?.used, 'Credit muss vorher verbraucht sein').toBe(1)

    await page.goto(`/admin/sessions/${sessionId}`)
    await page.waitForLoadState('networkidle')

    // Yogi in Teilnehmerliste sichtbar (Mobile + Desktop Layout möglich → .first())
    const yogiEmail = process.env.TEST_YOGI1_EMAIL!
    await expect(page.getByText(yogiEmail).first()).toBeVisible({ timeout: 8_000 })

    // Absage-Formular öffnen
    await page.getByRole('button', { name: /stunde absagen/i }).click()
    await expect(page.getByText(/stunde absagen/i).first()).toBeVisible({ timeout: 5_000 })

    // Kein Ersatztermin (Checkbox nicht angehakt lassen)
    await expect(page.getByText(/ohne ersatztermin/i)).toBeVisible({ timeout: 3_000 })

    // Absagen bestätigen
    page.on('dialog', d => d.accept())
    await page.getByRole('button', { name: /^absagen$/i }).click()
    await page.waitForTimeout(2_000)

    // Zurückgeleitet (router.back()) oder Session zeigt "abgesagt"
    // DB-Checks: Session cancelled
    const db = await getAdminClient()
    const { data: sess } = await db.from('sessions').select('is_cancelled').eq('id', sessionId).maybeSingle()
    expect(sess?.is_cancelled, 'Session muss als abgesagt markiert sein').toBe(true)

    // Buchung storniert
    const { data: booking } = await db.from('bookings')
      .select('status').eq('user_id', yogi1Id).eq('session_id', sessionId).maybeSingle()
    expect(booking?.status, 'Buchung muss storniert sein').toBe('cancelled')

    // Credit zurückgegeben
    const creditAfter = await getSingleCredit(yogi1Id)
    expect(creditAfter?.used, 'Credit muss zurückgebucht sein').toBe(0)
  })
})

test.describe('Ersatzstunde: Nachträglicher Ersatztermin → Yogis automatisch eingebucht', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let sessionId: string
  let yogi1Id: string
  let creditId: string | undefined

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')

    const course = await createTestCourse({ name: `${E2E_PREFIX} Ersatz-Auto-Test`, sessionCount: 1 })
    sessionId = course.sessionIds[0]

    creditId = await giveYogiSingleCredit(yogi1Id, 3)

    // Yogi einbuchen und Session direkt in DB absagen (Ausgangszustand: abgesagte Session mit stornierter Buchung)
    await db.from('bookings').insert({
      user_id: yogi1Id,
      session_id: sessionId,
      credit_id: creditId,
      type: 'single',
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    })
    // Credit bereits zurückgebucht (used = 0)
    await db.from('sessions').update({ is_cancelled: true }).eq('id', sessionId)
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')
    const { data: sess } = await db.from('sessions').select('course_id').eq('id', sessionId).maybeSingle()
    if (sess?.course_id) {
      const { data: allSessions } = await db.from('sessions').select('id').eq('course_id', sess.course_id)
      const ids = (allSessions || []).map(s => s.id)
      if (ids.length > 0) await db.from('bookings').delete().in('session_id', ids)
      await db.from('sessions').delete().eq('course_id', sess.course_id)
      await db.from('courses').delete().eq('id', sess.course_id)
    }
  })

  test('Ersatztermin anlegen → Yogi automatisch eingebucht, Credit verbraucht', async ({ page }) => {
    const creditBefore = await getSingleCredit(yogi1Id)
    expect(creditBefore?.used, 'Credit muss noch frei sein').toBe(0)

    await page.goto(`/admin/sessions/${sessionId}`)
    await page.waitForLoadState('networkidle')

    // Stunde zeigt "abgesagt"-Banner
    await expect(page.getByText(/stunde ist abgesagt/i).first()).toBeVisible({ timeout: 8_000 })

    // Ersatztermin-Button klicken
    await page.getByRole('button', { name: /ersatztermin nachträglich anlegen/i }).click()
    await expect(page.getByText(/datum/i).first()).toBeVisible({ timeout: 5_000 })

    // Datum und Zeit eingeben
    const replDate = futureDateStr(21)
    await page.locator('input[type="date"]').fill(replDate)
    await page.locator('input[type="time"]').fill('18:30')

    // Dialog akzeptieren (alert am Ende)
    page.on('dialog', d => d.accept())
    await page.getByRole('button', { name: /ersatztermin anlegen/i }).click()
    await page.waitForTimeout(3_000)

    // DB-Check: Replacement session exists
    const db = await getAdminClient()
    const { data: sess } = await db.from('sessions').select('course_id').eq('id', sessionId).maybeSingle()
    const { data: replacements } = await db.from('sessions')
      .select('id')
      .eq('course_id', sess!.course_id)
      .eq('is_cancelled', false)
      .neq('id', sessionId)
    expect(replacements?.length, 'Ersatz-Session muss angelegt worden sein').toBeGreaterThan(0)

    const replacementSessionId = replacements![0].id

    // Yogi in Ersatz-Session eingebucht
    const booking = await getActiveBooking(yogi1Id, replacementSessionId)
    expect(booking, 'Yogi muss in Ersatz-Session eingebucht sein').toBeTruthy()
    expect(booking!.status).toBe('active')

    // Credit verbraucht
    const creditAfter = await getSingleCredit(yogi1Id)
    expect(creditAfter?.used, 'Credit muss nach Einbuchen verbraucht sein').toBe(1)
  })
})

test.describe('Ersatzstunde: Yogi hat Credit bereits verbraucht → wird übersprungen', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let sessionId: string
  let session2Id: string
  let yogi2Id: string
  let creditId: string | undefined

  test.beforeAll(async () => {
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi2Id).eq('model', 'single')

    // Zwei Sessions anlegen – Yogi war in Session 1, Credit wurde zurückgebucht
    const course = await createTestCourse({ name: `${E2E_PREFIX} Ersatz-Skip-Test`, sessionCount: 2 })
    sessionId = course.sessionIds[0]
    session2Id = course.sessionIds[1]

    creditId = await giveYogiSingleCredit(yogi2Id, 3)

    // Yogi war in Session 1 (storniert), Session 1 abgesagt
    await db.from('bookings').insert({
      user_id: yogi2Id,
      session_id: sessionId,
      credit_id: creditId,
      type: 'single',
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    })
    await db.from('sessions').update({ is_cancelled: true }).eq('id', sessionId)

    // Yogi bucht sich zwischenzeitlich in Session 2 → Credit verbraucht (used = 1)
    await db.from('bookings').insert({
      user_id: yogi2Id,
      session_id: session2Id,
      credit_id: creditId,
      type: 'single',
      status: 'active',
    })
    await db.from('credits').update({ used: 1 }).eq('id', creditId)
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi2Id).eq('model', 'single')
    const { data: sess } = await db.from('sessions').select('course_id').eq('id', sessionId).maybeSingle()
    if (sess?.course_id) {
      const { data: allSessions } = await db.from('sessions').select('id').eq('course_id', sess.course_id)
      const ids = (allSessions || []).map(s => s.id)
      if (ids.length > 0) await db.from('bookings').delete().in('session_id', ids)
      await db.from('sessions').delete().eq('course_id', sess.course_id)
      await db.from('courses').delete().eq('id', sess.course_id)
    }
  })

  test('Yogi ohne verfügbaren Credit → Ersatztermin angelegt, Yogi übersprungen', async ({ page }) => {
    await page.goto(`/admin/sessions/${sessionId}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/stunde ist abgesagt/i).first()).toBeVisible({ timeout: 8_000 })

    await page.getByRole('button', { name: /ersatztermin nachträglich anlegen/i }).click()
    await expect(page.getByText(/datum/i).first()).toBeVisible({ timeout: 5_000 })

    const replDate = futureDateStr(28)
    await page.locator('input[type="date"]').fill(replDate)
    await page.locator('input[type="time"]').fill('18:30')

    let alertText = ''
    page.on('dialog', d => {
      alertText = d.message()
      d.accept()
    })
    await page.getByRole('button', { name: /ersatztermin anlegen/i }).click()
    await page.waitForTimeout(3_000)

    // Alert muss "nicht eingebucht" erwähnen
    expect(alertText).toMatch(/nicht eingebucht/i)
    expect(alertText).toMatch(/1 yogi/i)

    // DB-Check: Yogi NICHT in Ersatz-Session
    const db = await getAdminClient()
    const { data: sess } = await db.from('sessions').select('course_id').eq('id', sessionId).maybeSingle()
    const { data: replacements } = await db.from('sessions')
      .select('id')
      .eq('course_id', sess!.course_id)
      .eq('is_cancelled', false)
      .neq('id', sessionId)
      .neq('id', session2Id)
    expect(replacements?.length, 'Ersatz-Session muss angelegt worden sein').toBeGreaterThan(0)

    const replacementSessionId = replacements![0].id
    const booking = await getActiveBooking(yogi2Id, replacementSessionId)
    expect(booking, 'Yogi darf NICHT in Ersatz-Session eingebucht sein').toBeNull()

    // Credit unverändert (used = 1, in Session 2 verbraucht)
    const credit = await getSingleCredit(yogi2Id)
    expect(credit?.used, 'Credit darf nicht erneut verbraucht werden').toBe(1)
  })
})
