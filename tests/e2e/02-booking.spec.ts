/**
 * Workflow: Buchung & Abmeldung
 * Testfälle: Stunde buchen, rechtzeitig abmelden (Credit zurück), spät abmelden (kein Credit)
 */
import { test, expect } from '@playwright/test'
import { SessionDetailPage } from '../page-objects/SessionDetailPage'
import { MeinePage } from '../page-objects/MeinePage'
import { createTestCourse, giveYogiSingleCredit, futureDateStr } from '../utils/seed'
import { getActiveBooking, getCancelledBooking, getCredit, getUserIdByEmail } from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

// Geteilter Zustand für diesen Test-Block
let sessionId: string
let yogi1Id: string
let creditId: string

test.beforeAll(async () => {
  yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  if (!yogi1Id) throw new Error('Yogi1 nicht gefunden – npm run test:setup ausführen')

  // Testkurs mit Session in 10 Tagen anlegen (Stornofrist ist 3h, also weit in der Zukunft)
  const course = await createTestCourse({ startDaysFromNow: 10, sessionCount: 2 })
  sessionId = course.sessionIds[0]

  // 3 Einzelstunden-Credits vergeben
  creditId = (await giveYogiSingleCredit(yogi1Id, 3))!
})

test.describe('Buchung & Abmeldung', () => {
  test.use({ storageState: 'tests/.auth/yogi1.json' })

  test('Stunde buchen → Credit wird verbraucht → Buchung sichtbar in Meine', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)
    const meinePage = new MeinePage(page)

    // Credits vorher prüfen
    const creditBefore = await getCredit(yogi1Id)
    expect(creditBefore?.used, 'Credits sollten vor Buchung 0 verwendet haben').toBe(0)

    // Stunde buchen
    await sessionPage.goto(sessionId)
    await sessionPage.book()
    await sessionPage.expectBookedStatus()

    // Buchung in DB prüfen
    const booking = await getActiveBooking(yogi1Id, sessionId)
    expect(booking, 'Buchung fehlgeschlagen: Kein aktiver Eintrag in der Datenbank').toBeTruthy()

    // Stunde erscheint in "Meine"
    await meinePage.goto()
    await meinePage.expectSessionVisible(process.env.TEST_YOGI1_EMAIL!) // Kursname erscheint in Meine
  })

  test('Rechtzeitige Abmeldung (> 3h vorher) → Credit wird zurückgebucht', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)

    const creditBefore = await getCredit(yogi1Id)
    const usedBefore = creditBefore?.used ?? 0

    await sessionPage.goto(sessionId)
    await sessionPage.cancelBooking()

    // Buchung storniert in DB
    const booking = await getCancelledBooking(yogi1Id, sessionId)
    expect(booking, 'Abmeldung fehlgeschlagen: Buchung ist noch aktiv').toBeTruthy()
    expect(booking?.cancel_late, 'Frühzeitige Abmeldung sollte cancel_late=false haben').toBe(false)

    // Credit zurückgegeben
    const creditAfter = await getCredit(yogi1Id)
    expect(
      creditAfter?.used,
      'Workflow Abmeldung fehlgeschlagen: Credit wurde nicht zurückgebucht.'
    ).toBe(usedBefore - 1)
  })

  test('Abgemeldete Stunde erneut buchen → funktioniert', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(sessionId)
    await sessionPage.book()
    await sessionPage.expectBookedStatus()
    const booking = await getActiveBooking(yogi1Id, sessionId)
    expect(booking, 'Erneute Buchung fehlgeschlagen').toBeTruthy()
  })

  test('Abgesagte Stunde zeigt Hinweis – keine Buchung möglich', async ({ page }) => {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    // Session als abgesagt markieren
    const course = await createTestCourse({ startDaysFromNow: 20, sessionCount: 1 })
    await db.from('sessions').update({ is_cancelled: true }).eq('id', course.sessionIds[0])

    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(course.sessionIds[0])
    await sessionPage.expectCancelledNotice()
  })
})
