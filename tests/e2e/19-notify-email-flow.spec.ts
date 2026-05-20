/**
 * Workflow: Notify-Email Flow
 * Testfälle:
 *   - Yogi setzt sich auf Notify-Liste (kein Platz, aber benachrichtigen)
 *   - Anderer Yogi sagt ab → Notify-Email sollte rausgehen (DB-Check)
 *   - Notify-Eintrag wird nach Versand gelöscht
 *
 * Hinweis: Wartelisten-Priorität ist bereits getestet in 03-waitlist.
 *          Dieser Test fokussiert: notify-Pfad funktioniert wenn KEINE Warteliste da ist.
 */
import { test, expect } from '@playwright/test'
import { SessionDetailPage } from '../page-objects/SessionDetailPage'
import { createFullCourse } from '../utils/seed'
import {
  getUserIdByEmail, getAdminClient, getWaitlistEntry, getActiveBooking,
} from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('Notify-Email: Flow ohne Warteliste', () => {
  let fullSessionId: string
  let yogi1Id: string
  let yogi2Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!

    // Voll ausgebuchten Kurs erzeugen (yogi1 belegt einzigen Platz)
    const course = await createFullCourse(yogi1Id, yogi2Id)
    fullSessionId = course.sessionIds[0]
  })

  test('Yogi2 setzt sich auf Notify (nicht Warteliste)', async ({ page }) => {
    await page.context().storageState({ path: 'tests/.auth/yogi2.json' }).catch(() => {})
  })

  test.describe('Yogi2 setzt Notify-Eintrag', () => {
    test.use({ storageState: 'tests/.auth/yogi2.json' })

    test('Notify-Eintrag in DB anlegen', async ({ page }) => {
      const sessionPage = new SessionDetailPage(page)
      await sessionPage.goto(fullSessionId)
      await sessionPage.joinNotifyList()

      const entry = await getWaitlistEntry(yogi2Id, fullSessionId)
      expect(entry?.type, 'Notify-Eintrag muss type=notify haben').toBe('notify')
      expect(entry?.position, 'Notify-Eintrag hat keine Position').toBeNull()
    })
  })

  test.describe('Yogi1 sagt ab → Notify-Eintrag wird verarbeitet', () => {
    test.use({ storageState: 'tests/.auth/yogi1.json' })

    test('Yogi1 meldet sich ab → notify-Eintrag wird gelöscht (Email gesendet)', async ({ page }) => {
      const sessionPage = new SessionDetailPage(page)
      await sessionPage.goto(fullSessionId)
      await sessionPage.cancelBooking()

      // Trigger braucht kurz Zeit
      await page.waitForTimeout(3_000)

      // Da KEINE Warteliste vorhanden ist (nur notify), wird Yogi2 NICHT eingebucht.
      // Aber: notify-Eintrag wird nach Email-Versand gelöscht.
      const yogi2Booking = await getActiveBooking(yogi2Id, fullSessionId)
      expect(yogi2Booking, 'Notify-User darf nicht automatisch eingebucht werden').toBeNull()

      // Notify-Eintrag entfernt (entweder gelöscht oder leer)
      const notifyEntry = await getWaitlistEntry(yogi2Id, fullSessionId)
      expect(
        notifyEntry,
        'Notify-Eintrag muss nach Email-Versand entfernt sein',
      ).toBeNull()
    })
  })
})
