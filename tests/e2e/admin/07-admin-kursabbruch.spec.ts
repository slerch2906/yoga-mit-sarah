// Welle 5 Refactor (Sarah 2026-05-26): zusätzliche semantische Assertions
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

    // Kurs-Credits (model='course') gelöscht. Provisorisches Guthaben
    // (model='guthaben', source='cancellation_choice') ist seit
    // Sarah-Wunsch 2026-05-26 auch mit course_id verknüpft als
    // Herkunfts-Info — wir filtern deshalb explizit auf model.
    const { data: credits } = await db.from('credits')
      .select('id').eq('user_id', yogi1Id).eq('course_id', courseId).eq('model', 'course')
    expect(credits?.length ?? 0, 'Kurs-Credits (model=course) sollten gelöscht sein').toBe(0)

    // Aktive Buchungen storniert
    const sessionIds = sessions?.map(s => s as any)
    const { data: sessionRows } = await db.from('sessions').select('id').eq('course_id', courseId)
    if (sessionRows && sessionRows.length > 0) {
      const ids = sessionRows.map(s => s.id)
      const { data: activeBookings } = await db.from('bookings')
        .select('id').eq('user_id', yogi1Id).eq('status', 'active').in('session_id', ids)
      expect(activeBookings?.length ?? 0, 'Aktive Buchungen sollten storniert sein').toBe(0)
    }

    // Sarah-Regel 2026-05-28: Bei Option 1 (all_refund) gibt es KEINE Yogi-
    // Entscheidung → es wird KEIN course_cancellation_responses-Eintrag (Token)
    // angelegt. Sonst erschiene der Abbruch fälschlich als "offene Aufgabe" im
    // Admin-Dashboard / unter /admin/kursabbruch. (Token nur bei yogi_choice.)
    const response = await getCancellationResponse(yogi1Id, courseId)
    expect(response, 'Bei all_refund darf KEIN Abbruch-Token/Response-Eintrag entstehen').toBeNull()
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
    // Welle 5: konkrete Bestätigung erwähnt "Guthaben"
    await expect(page.locator('body')).toContainText(/guthaben/i)

    // Guthaben-Credit in der Datenbank prüfen
    const credit = await getGuthabenCredit(yogi1Id)
    expect(credit, 'Guthaben-Credit sollte angelegt worden sein').toBeTruthy()
    expect(credit?.model).toBe('guthaben')
    expect(credit?.total, 'Guthaben sollte mindestens 1 Credit enthalten').toBeGreaterThan(0)
    // Welle 5: Credit hat expires_at in der Zukunft
    expect(new Date(credit!.expires_at).getTime(), 'Guthaben muss in Zukunft ablaufen')
      .toBeGreaterThan(Date.now())

    // Wahl in course_cancellation_responses aktualisiert
    const updated = await getCancellationResponse(yogi1Id, courseId)
    expect(updated?.choice).toBe('guthaben')
  })
})

// ── Option 2b: Yogi wählt Erstattung ─────────────────────────────────────────

test.describe('Kurs abbrechen – Option 2b: Yogi wählt Erstattung', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let courseId: string
  let yogi2Id: string
  const COURSE_NAME = `${E2E_PREFIX} Abbruch-Erstattung`

  test.beforeAll(async () => {
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
    const course = await createEnrolledCourse(yogi2Id, { name: COURSE_NAME })
    courseId = course.courseId
  })

  test('Admin bricht Kurs ab (yogi_choice) → Token mit null-Wahl angelegt', async ({ page }) => {
    const kursePage = new AdminKursePage(page)
    await kursePage.goto()

    await kursePage.openCancelModal(COURSE_NAME)
    await kursePage.fillCancelModal('E2E Erstattungstest', 'yogi_choice')
    await kursePage.confirmCancelModal()

    const response = await getCancellationResponse(yogi2Id, courseId)
    expect(response?.token, 'Token sollte angelegt worden sein').toBeTruthy()
    expect(response?.choice, 'Wahl sollte noch nicht getroffen sein').toBeNull()
  })

  test('Yogi besucht Token-Link und wählt Erstattung → kein Guthaben-Credit, choice = erstattung', async ({ page }) => {
    const response = await getCancellationResponse(yogi2Id, courseId)
    expect(response?.token, 'Token muss für diesen Test vorhanden sein').toBeTruthy()

    await page.goto(`/kursabbruch/${response!.token}`)
    await page.waitForLoadState('networkidle')

    // Erstattungs-Option wählen (Button, nicht der Text im Hinweis)
    await page.getByRole('button', { name: /geld zurück/i }).click()

    // Bestätigungsmeldung sichtbar
    await expect(page.getByText(/erstattung beantragt/i)).toBeVisible({ timeout: 10_000 })
    // Welle 5: konkret das Wort "Erstattung" oder "Geld zurück" muss erscheinen
    await expect(page.locator('body')).toContainText(/erstattung|geld zurück|rückerstattung/i)

    // Kein Guthaben-Credit darf angelegt worden sein
    const credit = await getGuthabenCredit(yogi2Id)
    expect(credit, 'Bei Erstattungswahl darf kein Guthaben-Credit angelegt werden').toBeNull()

    // Wahl korrekt in DB gespeichert
    const updated = await getCancellationResponse(yogi2Id, courseId)
    expect(updated?.choice).toBe('erstattung')
    // Welle 5: refund_paid bleibt false (noch nicht ausgezahlt, nur beantragt)
    expect(updated?.refund_paid, 'refund_paid bleibt false bei Wahl-Aktion').toBe(false)
  })
})

// ── Admin-Übersicht /admin/kursabbruch ────────────────────────────────────────

test.describe('Kursabbruch Admin-Übersicht: /admin/kursabbruch zeigt Status pro Yogi', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let courseId: string
  let yogi1Id: string
  const COURSE_NAME = `${E2E_PREFIX} Abbruch-Uebersicht`

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const course = await createEnrolledCourse(yogi1Id, { name: COURSE_NAME })
    courseId = course.courseId

    // Kurs direkt via DB als yogi_choice abgebrochen anlegen
    const db = await getAdminClient()
    await db.from('courses').update({ is_cancelled: true, is_active: false }).eq('id', courseId)
    const expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + 7)
    await db.from('course_cancellation_responses').insert({
      user_id: yogi1Id,
      course_id: courseId,
      token: `e2e-test-${Date.now()}`,
      choice: null,
      refund_paid: false,
      expires_at: expiresAt.toISOString(),
      remaining_sessions: 3,
    })
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('course_cancellation_responses').delete().eq('course_id', courseId)
    const { data: sessions } = await db.from('sessions').select('id').eq('course_id', courseId)
    const ids = (sessions || []).map(s => s.id)
    if (ids.length > 0) await db.from('bookings').delete().in('session_id', ids)
    await db.from('enrollments').delete().eq('course_id', courseId)
    await db.from('credits').delete().eq('course_id', courseId)
    await db.from('sessions').delete().eq('course_id', courseId)
    await db.from('courses').delete().eq('id', courseId)
  })

  test('Admin sieht Kursabbrüche mit Status: Offen / Guthaben / Erstattung', async ({ page }) => {
    await page.goto('/admin/kursabbruch')
    await page.waitForLoadState('networkidle')

    // Kurs erscheint in der Liste
    await expect(page.getByText(COURSE_NAME).first()).toBeVisible({ timeout: 8_000 })

    // Status "Offen" für Yogi ohne Wahl
    await expect(page.getByText(/offen/i).first()).toBeVisible({ timeout: 5_000 })

    // Statistik am Ende erscheint (mehrere Kurse möglich → first)
    await expect(page.getByText(/erstattung/i).first()).toBeVisible({ timeout: 5_000 })
    // Welle 5: Yogi-Name muss in der Liste sichtbar sein
    await expect(page.locator('body')).toContainText(
      new RegExp(process.env.TEST_YOGI1_EMAIL!.split('@')[0], 'i')
    )
  })
})
