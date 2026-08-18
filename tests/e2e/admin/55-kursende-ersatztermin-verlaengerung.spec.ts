/**
 * Bugfix (Sarah 2026-08-18): Ersatztermin ans Kursende verlängert automatisch
 * courses.date_end + die 8-Tage-Nachholfrist bereits vergebener Kurs-Credits.
 *
 * Vorher: Wurde eine abgesagte Kursstunde durch einen Ersatztermin NACH dem
 * bisherigen Kursende ersetzt, blieb courses.date_end unverändert. Die
 * Nachholfrist der Yogis (courses.date_end + 8 Tage) war dadurch zu kurz —
 * die neue Ersatzstunde lag faktisch außerhalb des Fensters, obwohl der Kurs
 * dafür ja gerade verlängert werden sollte. Betroffen war zusätzlich
 * credits.expires_at (bei Vergabe einmalig eingefroren), das den Yogi schon
 * VOR der eigentlichen Fenster-Prüfung hart blockierte.
 *
 * Fix: DB-Trigger auf sessions (AFTER INSERT) hebt courses.date_end an, wenn
 * eine neue aktive Kursstunde nach dem bisherigen Kursende liegt, und
 * verlängert im selben Zug alle betroffenen Kurs-Credits.
 */
import { test, expect } from '@playwright/test'
import { createTestCourse, E2E_PREFIX } from '../../utils/seed'
import { getUserIdByEmail, getAdminClient } from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('[E2E] Ersatztermin verlängert Kursende + Credit-Nachholfrist', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let courseId: string
  let lastSessionId: string
  let yogi1Id: string
  let creditId: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'course')

    const course = await createTestCourse({
      name: `${E2E_PREFIX} Kursende-Verlaengerung-Test`, sessionCount: 2, startDaysFromNow: 7,
    })
    courseId = course.courseId
    lastSessionId = course.sessionIds[course.sessionIds.length - 1]
    const oldDateEndStr = course.sessionDates[course.sessionDates.length - 1]

    // Kurs-Credit mit "eingefrorenem" Ablaufdatum, exakt wie es die App bei
    // der Vergabe berechnet hätte: letzte Stunde + 8 Tage.
    const oldExpiry = new Date(oldDateEndStr)
    oldExpiry.setDate(oldExpiry.getDate() + 8)

    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: courseId, model: 'course',
      total: 2, used: 0, expires_at: oldExpiry.toISOString(),
    }).select('id').single()
    creditId = credit!.id

    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: courseId })
    for (const sid of course.sessionIds) {
      await db.from('bookings').insert({
        user_id: yogi1Id, session_id: sid, credit_id: creditId, type: 'course', status: 'active',
      })
    }
    await db.from('credits').update({ used: 2 }).eq('id', creditId)
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    const { data: sessions } = await db.from('sessions').select('id').eq('course_id', courseId)
    const ids = (sessions || []).map((s: any) => s.id)
    if (ids.length > 0) await db.from('bookings').delete().in('session_id', ids)
    await db.from('credits').delete().eq('id', creditId)
    await db.from('enrollments').delete().eq('course_id', courseId)
    await db.from('sessions').delete().eq('course_id', courseId)
    await db.from('courses').delete().eq('id', courseId)
  })

  test('Ersatztermin nach Kursende → date_end + Credit-Frist werden automatisch verlängert', async ({ page }) => {
    const db = await getAdminClient()
    const { data: courseBefore } = await db.from('courses').select('date_end').eq('id', courseId).single()
    const oldDateEnd = courseBefore!.date_end as string

    const replDate = new Date(oldDateEnd)
    replDate.setDate(replDate.getDate() + 7)
    const replDateStr = replDate.toISOString().split('T')[0]

    await page.goto(`/admin/sessions/${lastSessionId}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /stunde absagen/i }).click()
    await expect(page.getByText(/ersatztermin anbieten/i)).toBeVisible({ timeout: 5_000 })
    await page.getByText(/ersatztermin anbieten/i).click()

    await page.locator('input[type="date"]').fill(replDateStr)
    await page.locator('input[type="time"]').fill('18:00')

    page.on('dialog', d => d.accept())
    await page.getByRole('button', { name: /^absagen$/i }).click()
    await page.waitForTimeout(2_500)

    // Kursende muss auf das Ersatztermin-Datum angehoben sein.
    const { data: courseAfter } = await db.from('courses').select('date_end').eq('id', courseId).single()
    expect(courseAfter?.date_end, 'courses.date_end muss auf das Ersatztermin-Datum verlängert sein').toBe(replDateStr)

    // Der bereits vergebene Kurs-Credit muss mitverlängert worden sein — die
    // neue Nachholfrist (replDate + 8 Tage) muss jetzt VOR expires_at liegen,
    // nicht mehr davor abgeschnitten sein.
    const { data: creditAfter } = await db.from('credits').select('expires_at').eq('id', creditId).single()
    const expectedMinExpiry = new Date(replDateStr)
    expectedMinExpiry.setDate(expectedMinExpiry.getDate() + 8)
    expect(
      new Date(creditAfter!.expires_at).getTime(),
      'Kurs-Credit-Nachholfrist muss bis mindestens Ersatztermin+8 Tage reichen'
    ).toBeGreaterThanOrEqual(expectedMinExpiry.getTime())

    // audit_log dokumentiert die automatische Verlängerung.
    const { data: audit } = await db.from('audit_log')
      .select('*').eq('action', 'course_date_end_and_credits_extended')
      .eq('details->>course_id', courseId).maybeSingle()
    expect(audit, 'audit_log-Eintrag für die automatische Verlängerung fehlt').toBeTruthy()
  })
})
