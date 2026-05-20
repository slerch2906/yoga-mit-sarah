/**
 * Workflow: Meine Stunden (Yogi-Ansicht)
 * Testfälle: Credits-Übersicht, Kursname, ausgeschlossene Stunden
 */
import { test, expect } from '@playwright/test'
import { MeinePage } from '../page-objects/MeinePage'
import { createTestCourse, giveYogiSingleCredit, E2E_PREFIX } from '../utils/seed'
import { getUserIdByEmail } from '../utils/db'
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
  })

  test('Einzelstunden-Credits mit "Credits" (Mehrzahl) angezeigt', async ({ page }) => {
    await giveYogiSingleCredit(yogi1Id, 5)

    const meinePage = new MeinePage(page)
    await meinePage.goto()
    await meinePage.expectSingleCredits(5)
    // Prüfen: kein "5 Einzelstunden-Credit" ohne S
    await expect(page.getByText(/5 einzelstunden-credit[^s]/i)).not.toBeVisible()
  })

  test('Kurs-Credits zeigen Kursnamen', async ({ page }) => {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

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
  })

  test('Ausgeschlossene Stunden erscheinen NICHT in Meine', async ({ page }) => {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

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
    await expect(page.getByText(courseName)).toBeVisible()

    // Die ausgeschlossene Session (index 1) darf NICHT sichtbar sein
    const excludedDate = course.sessionDates[1]
    const day = new Date(excludedDate).getDate()
    // Ausgeschlossene Termine werden in Meine nicht gezeigt
    await meinePage.expectExcludedSessionNotVisible(String(day))
  })
})
