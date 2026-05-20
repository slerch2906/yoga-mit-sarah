/**
 * Workflow: Admin – Einzelstunde verwalten
 * Testfälle:
 *   - Yogi mit freien Credits einbuchen → erscheint in Teilnehmerliste
 *   - Yogi wieder austragen → verschwindet aus Liste, Credit zurück
 *   - Yogi ohne Credits: Quick-Credit vergeben und einbuchen
 *   - Yogi mit nur Guthaben: Einbuchen blockiert mit Hinweis
 */
import { test, expect } from '@playwright/test'
import { createTestCourse, giveYogiSingleCredit, giveYogiGuthaben, E2E_PREFIX } from '../../utils/seed'
import { getUserIdByEmail, getAdminClient, getActiveBooking, getCancelledBooking, getSingleCredit } from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('Admin Session: Yogi einbuchen und austragen', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let sessionId: string
  let yogi1Id: string
  let creditId: string | undefined

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!

    // Sauberer Ausgangszustand
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')

    // Testkurs mit einer Session
    const course = await createTestCourse({ name: `${E2E_PREFIX} Session-Test`, sessionCount: 1 })
    sessionId = course.sessionIds[0]

    // Yogi bekommt 3 Einzelstunden-Credits
    creditId = await giveYogiSingleCredit(yogi1Id, 3)
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')
    await db.from('bookings').delete().eq('session_id', sessionId)
  })

  test('Yogi mit freien Credits einbuchen → erscheint als Teilnehmer', async ({ page }) => {
    await page.goto(`/admin/sessions/${sessionId}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /yogi hinzufügen/i }).click()
    await expect(page.getByText(/yogi hinzufügen/i).first()).toBeVisible({ timeout: 5_000 })

    const yogiEmailPrefix = process.env.TEST_YOGI1_EMAIL!.split('@')[0]
    await page.getByPlaceholder(/name oder e-mail/i).fill(yogiEmailPrefix)
    await page.waitForTimeout(800)

    // Credits sichtbar und > 0
    await expect(page.getByText(/\d+ credits/i).first()).toBeVisible({ timeout: 5_000 })

    // Einbuchen
    await page.getByRole('button', { name: /einbuchen/i }).first().click()
    await page.waitForTimeout(1_500)

    // Yogi erscheint in Teilnehmerliste
    const yogiEmail = process.env.TEST_YOGI1_EMAIL!
    await expect(page.getByText(yogiEmail)).toBeVisible({ timeout: 8_000 })

    // DB-Check: Buchung angelegt
    const booking = await getActiveBooking(yogi1Id, sessionId)
    expect(booking, 'Aktive Buchung muss in DB vorhanden sein').toBeTruthy()
    expect(booking!.status).toBe('active')
  })

  test('Yogi austragen → verschwindet aus Liste, Credit zurückgegeben', async ({ page }) => {
    // Aktive Buchung vorhanden (aus vorherigem Test)
    const bookingBefore = await getActiveBooking(yogi1Id, sessionId)
    expect(bookingBefore).toBeTruthy()

    const db = await getAdminClient()
    const creditBefore = await db.from('credits').select('used').eq('id', bookingBefore!.credit_id).maybeSingle()
    const usedBefore = creditBefore.data?.used ?? 0

    await page.goto(`/admin/sessions/${sessionId}`)
    await page.waitForLoadState('networkidle')

    // Austragen-Button klicken (confirm-Dialog)
    page.on('dialog', d => d.accept())
    const yogiEmail = process.env.TEST_YOGI1_EMAIL!
    const yogiRow = page.locator('div', { hasText: yogiEmail }).first()
    await expect(yogiRow).toBeVisible({ timeout: 8_000 })
    await yogiRow.getByRole('button', { name: /austragen/i }).click()
    await page.waitForTimeout(1_500)

    // Yogi nicht mehr in Liste
    await expect(page.getByText(yogiEmail)).not.toBeVisible({ timeout: 5_000 })

    // DB-Check: Credit zurückgegeben
    const creditAfter = await db.from('credits').select('used').eq('id', bookingBefore!.credit_id).maybeSingle()
    expect(creditAfter.data?.used, 'Credit muss zurückgegeben sein').toBe(Math.max(0, usedBefore - 1))
  })

  test('Wiederholtes Einbuchen nach Austragen funktioniert (kein Unique-Constraint-Fehler)', async ({ page }) => {
    // Stunde muss noch eine stornierte Buchung haben
    const cancelled = await getCancelledBooking(yogi1Id, sessionId)
    expect(cancelled, 'Stornierte Buchung sollte vorhanden sein').toBeTruthy()

    await page.goto(`/admin/sessions/${sessionId}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /yogi hinzufügen/i }).click()
    await expect(page.getByText(/yogi hinzufügen/i).first()).toBeVisible({ timeout: 5_000 })

    const yogiEmailPrefix = process.env.TEST_YOGI1_EMAIL!.split('@')[0]
    await page.getByPlaceholder(/name oder e-mail/i).fill(yogiEmailPrefix)
    await page.waitForTimeout(800)

    await page.getByRole('button', { name: /einbuchen/i }).first().click()
    await page.waitForTimeout(1_500)

    // Yogi erscheint wieder in Teilnehmerliste
    const yogiEmail = process.env.TEST_YOGI1_EMAIL!
    await expect(page.getByText(yogiEmail)).toBeVisible({ timeout: 8_000 })

    const booking = await getActiveBooking(yogi1Id, sessionId)
    expect(booking, 'Aktive Buchung nach erneutem Einbuchen').toBeTruthy()
  })
})

test.describe('Admin Session: Guthaben-Warnung bei Einzelstunden', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let sessionId: string
  let yogi2Id: string

  test.beforeAll(async () => {
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!

    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi2Id)

    const course = await createTestCourse({ name: `${E2E_PREFIX} Guthaben-Session-Test`, sessionCount: 1 })
    sessionId = course.sessionIds[0]

    await giveYogiGuthaben(yogi2Id, 3)
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi2Id).eq('model', 'guthaben')
    await db.from('bookings').delete().eq('session_id', sessionId)
  })

  test('Yogi mit nur Guthaben: Quick-Credit-Modal zeigt Guthaben-Warnung', async ({ page }) => {
    await page.goto(`/admin/sessions/${sessionId}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /yogi hinzufügen/i }).click()
    await expect(page.getByText(/yogi hinzufügen/i).first()).toBeVisible({ timeout: 5_000 })

    const yogiEmailPrefix = process.env.TEST_YOGI2_EMAIL!.split('@')[0]
    await page.getByPlaceholder(/name oder e-mail/i).fill(yogiEmailPrefix)
    await page.waitForTimeout(800)

    // Guthaben-Hinweis in Suchliste
    await expect(page.getByText(/guthaben.*nur für kurse/i)).toBeVisible({ timeout: 5_000 })

    // Einbuchen klicken → Guthaben-Modal
    await page.getByRole('button', { name: /einbuchen/i }).first().click()
    await expect(page.getByText(/nur kurs-guthaben vorhanden/i)).toBeVisible({ timeout: 5_000 })

    // Kein "Credit vergeben & einbuchen" Button
    await expect(page.getByRole('button', { name: /credit vergeben.*einbuchen/i })).not.toBeVisible()
  })
})
