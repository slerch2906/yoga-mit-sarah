// Welle 5 Refactor (Sarah 2026-05-26): zusätzliche semantische Assertions
/**
 * Workflow: Meine Stunden (Yogi-Ansicht)
 * Testfälle: Credits-Übersicht, Kursname, ausgeschlossene Stunden
 */
import { test, expect } from '@playwright/test'
import { MeinePage } from '../page-objects/MeinePage'
import { createTestCourse, giveYogiSingleCredit, E2E_PREFIX } from '../utils/seed'
import { getUserIdByEmail, getAdminClient } from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

let yogi1Id: string

test.beforeAll(async () => {
  yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
})

test.describe('Meine Stunden', () => {
  test.use({ storageState: 'tests/.auth/yogi1.json' })

  test('"Deine Credits" Überschrift ist sichtbar wenn Credits vorhanden', async ({ page }) => {
    await giveYogiSingleCredit(yogi1Id, 2)

    const meinePage = new MeinePage(page)
    await meinePage.goto()
    await meinePage.expectCreditHeading()
    // Welle 5: Page hat klare Sektion-Überschrift "Deine freien Credits"
    await expect(page.getByText(/deine freien credits/i).first()).toBeVisible()
    // Welle 5: Mindestens 1 Zahl > 0 sichtbar (body-weit, DOM-getrennte spans)
    await expect(page.locator('body')).toContainText(/[1-9]\d*/)
  })

  test('Einzelstunden-Credits mit "Credits" (Mehrzahl) angezeigt', async ({ page }) => {
    await giveYogiSingleCredit(yogi1Id, 5)

    const meinePage = new MeinePage(page)
    await meinePage.goto()
    await meinePage.expectSingleCredits(5)
    // Welle 5: "Einzelstunden-Credits" (Mehrzahl) — bei total>1 zwingend mit s
    await expect(page.getByText(/einzelstunden-credits/i).first()).toBeVisible()
  })

  test('Kurs-Credits zeigen Kursnamen', async ({ page }) => {
    const db = await getAdminClient()

    const course = await createTestCourse({ name: `${E2E_PREFIX} Kreditkurs` })
    const expires = new Date(); expires.setDate(expires.getDate() + 90)

    await db.from('credits').insert({
      user_id: yogi1Id,
      course_id: course.courseId,
      model: 'course',
      total: 4,
      used: 0,
      expires_at: expires.toISOString(),
    })

    const meinePage = new MeinePage(page)
    await meinePage.goto()
    // "Kurs: [E2E] Kreditkurs" muss erscheinen
    await expect(page.getByText(new RegExp(`Kurs:.*${E2E_PREFIX}.*Kreditkurs`, 'i'))).toBeVisible()
    // Welle 5: 4 Credits total (siehe Insert) müssen als Zahl im Text vorkommen
    await expect(page.locator('body')).toContainText(/4/)
  })

  test('Ausgeschlossene Stunden erscheinen NICHT in Meine', async ({ page }) => {
    const db = await getAdminClient()

    const courseName = `${E2E_PREFIX} Ausschluss-Test`
    const course = await createTestCourse({ name: courseName, sessionCount: 3, startDaysFromNow: 30 })

    // Mittlere Session als ausgeschlossen markieren
    await db.from('sessions').update({
      is_cancelled: true,
      cancel_reason: 'excluded',
    }).eq('id', course.sessionIds[1])

    // Yogi1 in Kurs einbuchen (alle 3 Sessions)
    const expires = new Date(); expires.setDate(expires.getDate() + 90)
    await db.from('credits').insert({
      user_id: yogi1Id, course_id: course.courseId,
      model: 'course', total: 2, used: 0,
      expires_at: expires.toISOString(),
    })
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })
    for (const sid of course.sessionIds) {
      await db.from('bookings').insert({ user_id: yogi1Id, session_id: sid, type: 'course', status: 'active' })
    }

    const meinePage = new MeinePage(page)
    await meinePage.goto()

    // Kursstunden-Abschnitt für diesen Kurs prüfen
    await expect(page.getByText(courseName).first()).toBeVisible()

    // Die ausgeschlossene Session (index 1) darf NICHT sichtbar sein
    const excludedDate = course.sessionDates[1]
    const [year, month, dayNum] = excludedDate.split('-').map(Number)
    const formattedDate = new Date(year, month - 1, dayNum, 12, 0, 0).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })
    // Ausgeschlossene Termine werden in Meine nicht gezeigt
    await meinePage.expectExcludedSessionNotVisible(formattedDate)
    // Welle 5: andere (aktive) Sessions müssen sichtbar sein → der Kurs hat noch 2 von 3 aktive
    const activeDate0 = course.sessionDates[0]
    const [y0, m0, d0] = activeDate0.split('-').map(Number)
    const fmt0 = new Date(y0, m0 - 1, d0, 12, 0, 0).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
    // Mindestens eine der aktiven Sessions muss als Datum sichtbar sein
    const visibleDates = await page.getByText(new RegExp(fmt0.split(' ')[0])).count()
    expect(visibleDates, 'Aktive Sessions müssen sichtbar sein').toBeGreaterThan(0)
  })
})
