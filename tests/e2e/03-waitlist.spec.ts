/**
 * Workflow: Warteliste & Nachrücken
 * Testfälle: Auf Warteliste setzen, Warteliste nachrücken, Benachrichtigung
 */
import { test, expect } from '@playwright/test'
import { SessionDetailPage } from '../page-objects/SessionDetailPage'
import { createFullCourse, giveYogiSingleCredit } from '../utils/seed'
import { getActiveBooking, getWaitlistEntry, getUserIdByEmail } from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

let fullSessionId: string
let notifySessionId: string
let yogi1Id: string
let yogi2Id: string

test.beforeAll(async () => {
  yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!

  // Ausgebuchten Kurs erstellen (Yogi1 belegt den einzigen Platz)
  const course = await createFullCourse(yogi1Id, yogi2Id)
  fullSessionId = course.sessionIds[0]

  // Separater Kurs für Benachrichtigungs-Test
  const course2 = await createFullCourse(yogi1Id, yogi2Id)
  notifySessionId = course2.sessionIds[0]

  // Yogi2 bekommt Credits für Warteliste
  await giveYogiSingleCredit(yogi2Id, 3)
})

// --- Yogi2 auf Warteliste ---
test.describe('Warteliste (Yogi2)', () => {
  test.use({ storageState: 'tests/.auth/yogi2.json' })

  test('Ausgebuchte Stunde → "Ausgebucht" Badge sichtbar', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(fullSessionId)
    await sessionPage.expectFullMessage()
    await sessionPage.expectNoBookButton()
  })

  test('Auf Warteliste eintragen → Eintrag in DB vorhanden', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(fullSessionId)
    await sessionPage.joinWaitlist()

    const entry = await getWaitlistEntry(yogi2Id, fullSessionId)
    expect(entry, 'Warteliste fehlgeschlagen: Kein Eintrag in der Datenbank').toBeTruthy()
    expect(entry?.type).toBe('waitlist')
  })
})

// --- Yogi1 meldet sich ab → Yogi2 rückt nach ---
test.describe('Warteliste Nachrücken (Yogi1)', () => {
  test.use({ storageState: 'tests/.auth/yogi1.json' })

  test('Yogi1 meldet sich ab → Yogi2 rückt nach → hat aktive Buchung', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(fullSessionId)
    await sessionPage.cancelBooking()

    // Kurz warten bis Trigger nachrückt
    await page.waitForTimeout(3_000)

    const booking = await getActiveBooking(yogi2Id, fullSessionId)
    expect(
      booking,
      'Workflow Warteliste fehlgeschlagen: Yogi2 ist nach Abmeldung von Yogi1 nicht nachgerückt.'
    ).toBeTruthy()
  })
})

// --- Benachrichtigungs-Typ ---
test.describe('Warteliste Benachrichtigung (Yogi2)', () => {
  test.use({ storageState: 'tests/.auth/yogi2.json' })

  test('Benachrichtigung eintragen → Typ notify in Datenbank', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(notifySessionId)
    await sessionPage.joinNotifyList()

    const entry = await getWaitlistEntry(yogi2Id, notifySessionId)
    expect(entry?.type, 'Benachrichtigungs-Eintrag hat falschen Typ').toBe('notify')
  })
})
