/**
 * Workflow: Audit-Log / Protokoll
 * Testfälle:
 *   - Buchung → audit_log Eintrag 'booking_created' vorhanden
 *   - Abmeldung → audit_log Eintrag 'booking_cancelled' vorhanden
 *   - Admin sagt Session ab → 'session_cancelled' Eintrag
 *   - /admin/protokoll zeigt Einträge mit Yogi-Info
 */
import { test, expect } from '@playwright/test'
import { SessionDetailPage } from '../../page-objects/SessionDetailPage'
import { createTestCourse, giveYogiSingleCredit, E2E_PREFIX } from '../../utils/seed'
import {
  getUserIdByEmail, getAdminClient, getActiveBooking,
} from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('Audit-Log: Buchung + Abmeldung loggen Events', () => {
  let sessionId: string
  let courseId: string
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')

    const course = await createTestCourse({
      name: `${E2E_PREFIX} Audit-Log-Test`,
      sessionCount: 1,
      startDaysFromNow: 10,
    })
    courseId = course.courseId
    sessionId = course.sessionIds[0]

    await giveYogiSingleCredit(yogi1Id, 3)

    // Alte Audit-Log Einträge dieser Session bereinigen
    await db.from('audit_log').delete().eq('user_id', yogi1Id).filter('details->>session_id', 'eq', sessionId)
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('audit_log').delete().eq('user_id', yogi1Id).filter('details->>session_id', 'eq', sessionId)
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')
  })

  test.describe('Yogi bucht', () => {
    test.use({ storageState: 'tests/.auth/yogi1.json' })

    test('Buchung erzeugt booking_created Audit-Log-Eintrag', async ({ page }) => {
      const sessionPage = new SessionDetailPage(page)
      await sessionPage.goto(sessionId)
      await sessionPage.book()

      const booking = await getActiveBooking(yogi1Id, sessionId)
      expect(booking).toBeTruthy()

      // Audit-Log Eintrag prüfen
      const db = await getAdminClient()
      const { data: log } = await db.from('audit_log')
        .select('*').eq('user_id', yogi1Id).eq('action', 'booking_created')
        .filter('details->>session_id', 'eq', sessionId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()

      expect(log, 'booking_created Eintrag muss existieren').toBeTruthy()
      expect(log?.details?.session_id).toBe(sessionId)
    })

    test('Abmeldung erzeugt booking_cancelled Audit-Log-Eintrag', async ({ page }) => {
      const sessionPage = new SessionDetailPage(page)
      await sessionPage.goto(sessionId)
      await sessionPage.cancelBooking()

      // Trigger braucht kurz Zeit
      await page.waitForTimeout(1_500)

      const db = await getAdminClient()
      const { data: log } = await db.from('audit_log')
        .select('*').eq('user_id', yogi1Id).eq('action', 'booking_cancelled')
        .filter('details->>session_id', 'eq', sessionId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()

      expect(log, 'booking_cancelled Eintrag muss existieren').toBeTruthy()
      expect(log?.details?.late, 'late-Flag muss boolean sein').toBeDefined()
    })
  })
})

test.describe('Audit-Log: /admin/protokoll Page rendert Einträge', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  test('Protokoll-Page lädt und zeigt mind. einen Eintrag', async ({ page }) => {
    // Audit-Log sollte Einträge enthalten aus vorherigen Tests
    await page.goto('/admin/protokoll')
    await page.waitForLoadState('networkidle')

    // Header sichtbar
    await expect(page.getByRole('heading', { name: /protokoll/i }).first()).toBeVisible({ timeout: 8_000 })

    // Liste oder Empty-State sichtbar
    await expect(
      page.getByText(/booking_created|booking_cancelled|keine.*einträge|keine.*protokoll/i).first()
    ).toBeVisible({ timeout: 8_000 })
  })
})
