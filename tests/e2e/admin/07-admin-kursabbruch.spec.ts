/**
 * Workflow: Admin – Kurs abbrechen
 * Testfälle: Option 1 (all_refund), Option 2 (yogi_choice) mit Guthaben-Wahl
 */
import { test, expect } from '@playwright/test'
import { AdminKursePage } from '../../page-objects/admin/AdminKursePage'
import { createEnrolledCourse, E2E_PREFIX } from '../../utils/seed'
import { getUserIdByEmail, getAdminClient, getCancellationResponse, getCourse, getEnrollment, getGuthabenCredit } from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

// ── Option 1: Alle bekommen Geld zurück ─────────────────────────────────────

test.describe('Kurs abbrechen – Option 1: Geld zurück (all_refund)', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let courseId: string
  let yogi1Id: string
  const COURSE_NAME = `${E2E_PREFIX} Abbruch-Opt1`

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const course = await createEnrolledCourse(yogi1Id, { name: COURSE_NAME })
    courseId = course.courseId
  })

  test('Admin bricht Kurs ab (all_refund) → Sessions storniert, Enrollment gelöscht, Credits weg', async ({ page }) => {
    const kursePage = new AdminKursePage(page)
    await kursePage.goto()

    await kursePage.openCancelModal(COURSE_NAME)
    await kursePage.fillCancelModal('E2E Testabbruch Option 1', 'all_refund')
    await kursePage.confirmCancelModal()

    const db = await getAdminClient()

    // Kurs als abgebrochen und inaktiv markiert
    const course = await getCourse(courseId)
    expect(course?.is_cancelled, 'Kurs sollte abgebrochen sein').toBe(true)
    expect(course?.is_active, 'Kurs sollte inaktiv sein').toBe(false)

    // Alle Sessions storniert
    const { data: sessions } = await db.from('sessions').select('is_cancelled').eq('course_id', courseId)
    expect(
      sessions?.every(s => s.is_cancelled),
      'Alle zukünftigen Sessions sollten storniert sein'
    ).toBe(true)

    // Enrollment gelöscht
    const enrollment = await getEnrollment(yogi1Id, courseId)
    expect(enrollment, 'Enrollment sollte gelöscht sein').toBeNull()

    // Kurs-Credits gelöscht
    const { data: credits } = await db.from('credits')
      .select('id').eq('user_id', yogi1Id).eq('course_id', courseId)
    expect(credits?.length ?? 0, 'Kurs-Credits sollten gelöscht sein').toBe(0)

    // Aktive Buchungen storniert
    const sessionIds = sessions?.map(s => s as any)
    const { data: sessionRows } = await db.from('sessions').select('id').eq('course_id', courseId)
    if (sessionRows && sessionRows.length > 0) {
      const ids = sessionRows.map(s => s.id)
      const { data: activeBookings } = await db.from('bookings')
        .select('id').eq('user_id', yogi1Id).eq('status', 'active').in('session_id', ids)
      expect(activeBookings?.length ?? 0, 'Aktive Buchungen sollten storniert sein').toBe(0)
    }

    // Token angelegt (wird für alle Modi erstellt)
    const response = await getCancellationResponse(yogi1Id, courseId)
    expect(response, 'Abbruch-Token sollte in der Datenbank vorhanden sein').toBeTruthy()
    expect(response?.token).toBeTruthy()
  })
})

// ── Option 2: Yogi entscheidet ────────────────────────────────────────────────

test.describe('Kurs abbrechen – Option 2: Yogi entscheidet (yogi_choice)', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let courseId: string
  let yogi1Id: string
  const COURSE_NAME = `${E2E_PREFIX} Abbruch-Opt2`

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const course = await createEnrolledCourse(yogi1Id, { name: COURSE_NAME })
    courseId = course.courseId
  })

  test('Admin bricht Kurs ab (yogi_choice) → Token mit null-Wahl angelegt', async ({ page }) => {
    const kursePage = new AdminKursePage(page)
    await kursePage.goto()

    await kursePage.openCancelModal(COURSE_NAME)
    await kursePage.fillCancelModal('E2E Testabbruch Option 2', 'yogi_choice')
    await kursePage.confirmCancelModal()

    const response = await getCancellationResponse(yogi1Id, courseId)
    expect(response?.token, 'Abbruch-Token sollte angelegt worden sein').toBeTruthy()
    expect(response?.choice, 'Wahl sollte noch nicht getroffen sein').toBeNull()
    expect(response?.remaining_sessions, 'Anzahl verbleibender Stunden sollte gesetzt sein').toBeGreaterThan(0)
  })

  test('Yogi besucht Token-Link und wählt Guthaben → Credit angelegt', async ({ page }) => {
    const response = await getCancellationResponse(yogi1Id, courseId)
    expect(response?.token, 'Token muss für diesen Test vorhanden sein').toBeTruthy()

    // Token-Seite aufrufen (keine Anmeldung nötig)
    await page.goto(`/kursabbruch/${response!.token}`)
    await page.waitForLoadState('networkidle')

    // Guthaben-Option wählen
    await page.getByText('Guthaben behalten').click()

    // Bestätigungsmeldung sichtbar
    await expect(page.getByText(/guthaben gespeichert/i)).toBeVisible({ timeout: 10_000 })

    // Guthaben-Credit in der Datenbank prüfen
    const credit = await getGuthabenCredit(yogi1Id)
    expect(credit, 'Guthaben-Credit sollte angelegt worden sein').toBeTruthy()
    expect(credit?.model).toBe('guthaben')
    expect(credit?.total, 'Guthaben sollte mindestens 1 Credit enthalten').toBeGreaterThan(0)

    // Wahl in course_cancellation_responses aktualisiert
    const updated = await getCancellationResponse(yogi1Id, courseId)
    expect(updated?.choice).toBe('guthaben')
  })
})
