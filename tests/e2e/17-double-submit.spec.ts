// Welle 5 Refactor (Sarah 2026-05-26): zusätzliche semantische Assertions
/**
 * Workflow: Schutz gegen Doppel-Klick / Double-Submit
 * Testfälle:
 *   - Schneller Doppelklick auf "Eintragen" → nur EINE Buchung in DB
 *   - Button wird nach Klick deaktiviert (actionLoading)
 */
import { test, expect } from '@playwright/test'
import { SessionDetailPage } from '../page-objects/SessionDetailPage'
import { createTestCourse, giveYogiSingleCredit, E2E_PREFIX } from '../utils/seed'
import {
  getUserIdByEmail, getAdminClient, countActiveBookingsForSession,
} from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('Double-Submit-Schutz: Buchung', () => {
  test.use({ storageState: 'tests/.auth/yogi1.json' })

  let sessionId: string
  let courseId: string
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!

    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')

    const course = await createTestCourse({
      name: `${E2E_PREFIX} Double-Submit-Test`,
      maxSpots: 5,
      sessionCount: 1,
      startDaysFromNow: 14,
    })
    courseId = course.courseId
    sessionId = course.sessionIds[0]

    await giveYogiSingleCredit(yogi1Id, 5)
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')
  })

  test('Schneller Doppelklick → nur EINE aktive Buchung in DB', async ({ page }) => {
    await page.goto(`/kurse/${sessionId}`)
    await page.waitForLoadState('networkidle')

    const bookBtn = page.getByRole('button', { name: /für diese stunde eintragen|trotzdem eintragen/i })
    await expect(bookBtn).toBeVisible({ timeout: 8_000 })

    // Erste UND zweite Klick fast gleichzeitig
    await Promise.all([
      bookBtn.click({ force: true }),
      bookBtn.click({ force: true, trial: false }).catch(() => {}),
    ])

    // Warten bis Bestätigungsseite / Bestätigung-Heading erscheint
    await page.waitForTimeout(2_500)

    // DB-Check: NUR eine aktive Buchung
    const count = await countActiveBookingsForSession(sessionId)
    expect(count, 'Doppelklick darf nur EINE Buchung erzeugen').toBe(1)
    // Welle 5: Credit-used Invariante — Doppelklick darf NIE > 1 verbrauchen.
    // Soft-Lower-Bound: trg_sync_credit_used kann async sein → mindestens nicht > 1.
    const db2 = await getAdminClient()
    const { data: cred } = await db2.from('credits')
      .select('used').eq('user_id', yogi1Id).eq('model', 'single')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    expect(cred?.used ?? 0, 'Credit darf NIE > 1 verbraucht sein bei Doppelklick').toBeLessThanOrEqual(1)
  })

  test('Buchung-Button ist nach Klick deaktiviert (actionLoading)', async ({ page }) => {
    // Erstmal alte Buchung aufräumen, damit der Test wieder klickbar ist
    const db = await getAdminClient()
    await db.from('bookings').delete().eq('session_id', sessionId)

    // Credit zurücksetzen
    const { data: credit } = await db.from('credits')
      .select('*').eq('user_id', yogi1Id).eq('model', 'single')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (credit) await db.from('credits').update({ used: 0 }).eq('id', credit.id)

    await page.goto(`/kurse/${sessionId}`)
    await page.waitForLoadState('networkidle')

    const bookBtn = page.getByRole('button', { name: /für diese stunde eintragen|trotzdem eintragen/i })
    await expect(bookBtn).toBeVisible({ timeout: 8_000 })

    // Klick → Button muss kurz disabled werden
    await bookBtn.click()

    // Innerhalb der nächsten 500ms: Button entweder disabled oder verschwunden
    // (router.push zur Bestätigungsseite)
    const isDisabledOrGone = await Promise.race([
      bookBtn.isDisabled().catch(() => true),
      page.waitForURL(/bestaetigung|kurse/, { timeout: 3_000 }).then(() => true).catch(() => false),
    ])

    expect(isDisabledOrGone, 'Button muss nach Klick disabled/weg sein').toBe(true)
  })
})
