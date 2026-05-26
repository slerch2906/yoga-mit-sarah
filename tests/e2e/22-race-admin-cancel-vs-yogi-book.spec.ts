// Welle 5 Refactor (Sarah 2026-05-26): zusätzliche semantische Assertions
/**
 * Workflow: Race-Condition Admin sagt ab vs Yogi bucht parallel
 * Testfälle:
 *   - Session wird zwischen Yogi-Page-Load und Yogi-Klick "Buchen" cancelled
 *   - Yogi-Buchung darf NICHT durchgehen wenn Session bereits cancelled
 *   - Idealerweise zeigt UI sauberen Hinweis (kein 500)
 */
import { test, expect } from '@playwright/test'
import { SessionDetailPage } from '../page-objects/SessionDetailPage'
import { createTestCourse, giveYogiSingleCredit, E2E_PREFIX } from '../utils/seed'
import {
  getUserIdByEmail, getAdminClient, getActiveBooking, countActiveBookingsForSession,
} from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('Race: Admin sagt Session ab während Yogi auf Buchen-Seite ist', () => {
  test.use({ storageState: 'tests/.auth/yogi1.json' })

  let sessionId: string
  let courseId: string
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()
    await db.from('bookings').delete().eq('user_id', yogi1Id)
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')

    const course = await createTestCourse({
      name: `${E2E_PREFIX} Race-Cancel-Test`,
      sessionCount: 1,
      startDaysFromNow: 14,
    })
    courseId = course.courseId
    sessionId = course.sessionIds[0]

    await giveYogiSingleCredit(yogi1Id, 2)
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')
  })

  test('Yogi öffnet Page → Admin sagt ab → Yogi klickt Buchen → kein crash', async ({ page }) => {
    // Yogi lädt Detail-Page (Session noch aktiv)
    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(sessionId)

    // Buchen-Button sollte da sein
    const bookBtn = page.getByRole('button', { name: /für diese stunde eintragen|trotzdem eintragen/i })
    await expect(bookBtn).toBeVisible({ timeout: 8_000 })

    // ZWISCHENZEITLICH: Admin sagt Session ab (DB-Update)
    const db = await getAdminClient()
    await db.from('sessions').update({ is_cancelled: true }).eq('id', sessionId)

    // Yogi klickt nun Buchen
    await bookBtn.click({ force: true })

    // Erwartung: Entweder Page lädt neu mit "abgesagt"-Hinweis,
    // oder Buchung wird angelegt aber Session bleibt cancelled.
    // Wichtig: KEIN Crash, max_spots wird trotzdem nicht überschritten.
    await page.waitForTimeout(3_000)

    const count = await countActiveBookingsForSession(sessionId)
    expect(count, 'Cancelled Session sollte 0 aktive Buchungen haben').toBe(0)

    // Page sollte sauberen State zeigen (entweder Erfolg umgekehrt, oder Cancellation-Hinweis)
    // Test ist erfolgreich solange kein 500/crash
    await expect(page).toHaveURL(/\/kurse/)
    // Welle 5: kein Fehler-Banner ("Etwas ist schiefgelaufen" / "500") sichtbar
    await expect(
      page.getByText(/etwas ist schief|something went wrong|5\d\d\s|interner.*fehler/i)
    ).toHaveCount(0)
    // Welle 5: DB-Check Session ist tatsächlich cancelled
    const { data: sess } = await db.from('sessions')
      .select('is_cancelled').eq('id', sessionId).maybeSingle()
    expect(sess?.is_cancelled).toBe(true)
    // Welle 5: Credit von yogi1 ist NICHT verbraucht (Buchung ging nicht durch)
    const { data: cred } = await db.from('credits')
      .select('used').eq('user_id', yogi1Id).eq('model', 'single')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    expect(cred?.used, 'Credit darf bei Race-Cancel nicht verbraucht sein').toBe(0)
  })
})
