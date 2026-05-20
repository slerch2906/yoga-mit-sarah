/**
 * Workflow: Notify-Email Flow
 * Testfälle:
 *   - Yogi2 setzt sich auf Notify-Liste (kein Platz, aber benachrichtigen)
 *   - Yogi1 sagt ab → Notify-Eintrag wird verarbeitet (Email + Cleanup)
 *   - Notify-User wird NICHT automatisch eingebucht (anders als Warteliste)
 */
import { test, expect } from '@playwright/test'
import { SessionDetailPage } from '../page-objects/SessionDetailPage'
import { createFullCourse } from '../utils/seed'
import {
  getUserIdByEmail, getAdminClient, getWaitlistEntry, getActiveBooking,
} from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

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

test.describe('Notify-Email: Yogi2 setzt Notify-Eintrag', () => {
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

test.describe('Notify-Email: Yogi1 sagt ab → notify-Eintrag wird verarbeitet', () => {
  test.use({ storageState: 'tests/.auth/yogi1.json' })

  test('Yogi1 meldet sich ab → Notify wird gelöscht, Yogi2 NICHT auto-eingebucht', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(fullSessionId)
    await sessionPage.cancelBooking()

    // Trigger braucht kurz Zeit
    await page.waitForTimeout(3_000)

    // Da KEINE Warteliste vorhanden ist (nur notify), wird Yogi2 NICHT eingebucht
    const yogi2Booking = await getActiveBooking(yogi2Id, fullSessionId)
    expect(yogi2Booking, 'Notify-User darf nicht automatisch eingebucht werden').toBeNull()

    // Notify-Eintrag entfernt nach Email-Versand
    const notifyEntry = await getWaitlistEntry(yogi2Id, fullSessionId)
    expect(
      notifyEntry,
      'Notify-Eintrag muss nach Email-Versand entfernt sein',
    ).toBeNull()
  })
})
