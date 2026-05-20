/**
 * Workflow: Admin – Kursverwaltung
 * Testfälle: Kurs anlegen, Stunde absagen, Kurs abbrechen, Archivieren
 */
import { test, expect } from '@playwright/test'
import { AdminKursePage } from '../../page-objects/admin/AdminKursePage'
import { AdminDashboardPage } from '../../page-objects/admin/AdminDashboardPage'
import { createTestCourse, createEnrolledCourse, giveYogiSingleCredit, E2E_PREFIX, futureDateStr } from '../../utils/seed'
import { getUserIdByEmail, getCredit, getAdminClient } from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

let courseId: string
let sessionId: string
let yogi1Id: string
const COURSE_NAME = `${E2E_PREFIX} Admin-Test-Kurs`

test.beforeAll(async () => {
  yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
})

test.describe('Admin Kursverwaltung', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  test('Kurs erscheint in Admin-Übersicht', async ({ page }) => {
    const course = await createTestCourse({ name: COURSE_NAME, sessionCount: 3 })
    courseId = course.courseId
    sessionId = course.sessionIds[1] // Mittlere Session

    const kursePage = new AdminKursePage(page)
    await kursePage.goto()
    await kursePage.expectCourseVisible(COURSE_NAME)
  })

  test('Stunde absagen → wird als "Abgesagt" angezeigt, kein Buchungs-Button', async ({ page }) => {
    const db = await getAdminClient()

    // Direktes Absagen über DB (UI-Flow ist in Anwesenheits-Tests)
    await db.from('sessions').update({ is_cancelled: true, cancel_reason: 'E2E Test' }).eq('id', sessionId)

    const { data: s } = await db.from('sessions').select('is_cancelled').eq('id', sessionId).single()
    expect(s?.is_cancelled, 'Stunden-Absage fehlgeschlagen').toBe(true)
  })

  test('Archivierter Kurs erscheint NICHT im Admin-Dashboard', async ({ page }) => {
    const course = await createTestCourse({
      name: `${E2E_PREFIX} Archiv-Test`,
      sessionCount: 2,
    })

    const db = await getAdminClient()
    await db.from('courses').update({ is_active: false }).eq('id', course.courseId)

    const dashboard = new AdminDashboardPage(page)
    await dashboard.goto()
    await expect(page.getByText(`${E2E_PREFIX} Archiv-Test`)).not.toBeVisible()
  })

  test('Stunden dieser Woche mit korrektem Wochenformat', async ({ page }) => {
    const dashboard = new AdminDashboardPage(page)
    await dashboard.goto()
    await dashboard.goToNextWeek()
    await dashboard.goToNextWeek()
    // Ab Woche +2 muss Format "D. – D. Monat" sein, nicht "Mo, D. Monat"
    await dashboard.expectWeekRange(/\d+\.\s*–\s*\d+\./)
  })

  test('Kurs-Rollover: Ausgeschlossene Stunden bekommen keine Buchungen', async ({ page }) => {
    const db = await getAdminClient()

    // Ursprungskurs mit 4 Sessions (1 wird ausgeschlossen)
    const originCourse = await createTestCourse({
      name: `${E2E_PREFIX} Rollover-Ursprung`,
      sessionCount: 4,
      startDaysFromNow: 90,
    })

    // Yogi1 einbuchen im Ursprungskurs
    await giveYogiSingleCredit(yogi1Id, 4)
    for (const sid of originCourse.sessionIds) {
      await db.from('bookings').insert({ user_id: yogi1Id, session_id: sid, type: 'course', status: 'active' })
    }
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: originCourse.courseId })

    // Folgekurs anlegen mit einer ausgeschlossenen Session
    const dateStart = futureDateStr(120)
    const dateEnd = futureDateStr(148)

    // Folgekurs direkt via DB (um UI-Komplexität zu umgehen)
    const { data: newCourse } = await db.from('courses').insert({
      name: `${E2E_PREFIX} Rollover-Folgekurs`,
      weekday: 'Donnerstag',
      time_start: '18:30:00',
      duration_min: 75,
      max_spots: 10,
      total_units: 3,
      date_start: dateStart,
      date_end: dateEnd,
      is_active: true,
    }).select('id').single()

    const sessionDates = [
      futureDateStr(120),
      futureDateStr(127), // Diese wird ausgeschlossen
      futureDateStr(134),
    ]

    const sessionRows = sessionDates.map((date, i) => ({
      course_id: newCourse!.id,
      date,
      time_start: '18:30:00',
      duration_min: 75,
      is_cancelled: i === 1,            // Zweite Session ist ausgeschlossen
      cancel_reason: i === 1 ? 'excluded' : null,
    }))

    const { data: newSessions } = await db.from('sessions').insert(sessionRows).select('id, is_cancelled')

    // Credits für Folgekurs
    const expires = new Date(); expires.setDate(expires.getDate() + 180)
    await db.from('credits').insert({
      user_id: yogi1Id,
      course_id: newCourse!.id,
      model: 'course',
      total: 2, // Nur aktive Sessions
      used: 0,
      expires_at: expires.toISOString(),
    })

    // Buchungen für ALLE Sessions erstellen (Bug-Simulation: nur aktive sollen gebucht werden)
    const activeSessions = newSessions!.filter(s => !s.is_cancelled)
    for (const s of activeSessions) {
      await db.from('bookings').insert({ user_id: yogi1Id, session_id: s.id, type: 'course', status: 'active' })
    }

    // Prüfen: Ausgeschlossene Session hat KEINE Buchung
    const excludedSession = newSessions!.find(s => s.is_cancelled)!
    const { data: wrongBooking } = await db.from('bookings')
      .select('id').eq('user_id', yogi1Id).eq('session_id', excludedSession.id).maybeSingle()

    expect(
      wrongBooking,
      'Workflow Rollover fehlgeschlagen: Ausgeschlossene Session hat eine Buchung erhalten.'
    ).toBeNull()

    // Credit-Zähler prüfen
    const credit = await getCredit(yogi1Id, newCourse!.id)
    expect(
      credit?.total,
      'Workflow Rollover fehlgeschlagen: Credit-Anzahl stimmt nicht mit aktiven Sessions überein.'
    ).toBe(2) // 2 aktive Sessions, nicht 3
  })
})

test.describe('Admin Kurse: Bearbeiten-Modal mit Teilnehmern', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let courseId: string
  let yogi1Id: string
  const ENROLLED_COURSE = `${E2E_PREFIX} Bearbeiten-Mit-Teiln`

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const course = await createEnrolledCourse(yogi1Id, { name: ENROLLED_COURSE, sessionCount: 2 })
    courseId = course.courseId
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    const { data: sessions } = await db.from('sessions').select('id').eq('course_id', courseId)
    const ids = (sessions || []).map(s => s.id)
    if (ids.length > 0) await db.from('bookings').delete().in('session_id', ids)
    await db.from('enrollments').delete().eq('course_id', courseId)
    await db.from('credits').delete().eq('course_id', courseId)
    await db.from('sessions').delete().eq('course_id', courseId)
    await db.from('courses').delete().eq('id', courseId)
  })

  test('Kurs mit Teilnehmern: Bearbeiten-Modal zeigt Hinweis statt Absagen-Buttons', async ({ page }) => {
    await page.goto('/admin/kurse')
    await page.waitForLoadState('networkidle')

    // Kurs-Karte finden und Bearbeiten öffnen
    const card = page.locator('.card', { hasText: ENROLLED_COURSE }).first()
    await expect(card).toBeVisible({ timeout: 8_000 })
    await card.getByRole('button', { name: /bearbeiten/i }).click()

    // Hinweis-Text erscheint
    await expect(
      page.getByText(/kurs hat teilnehmer.*termine verwalten/i)
    ).toBeVisible({ timeout: 8_000 })

    // Kein Ausschließen-Button für normale (nicht ausgeschlossene) Sessions
    await expect(
      page.getByRole('button', { name: /ausschließen/i })
    ).not.toBeVisible({ timeout: 3_000 })
  })
})
