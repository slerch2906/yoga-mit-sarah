// Welle 5 Refactor (Sarah 2026-05-26): zusätzliche semantische Assertions
/**
 * Workflow: Guthaben aus Kursabbruch → Verrechnung bei Kursanmeldung
 * Testfälle:
 *   A) Admin fügt Yogi mit Guthaben zu Kurs hinzu → Guthaben weg, Kurs-Credits korrekt
 *   B) Yogi mit nur Guthaben kann nicht in Einzelstunde eingebucht werden
 */
import { test, expect } from '@playwright/test'
import { createTestCourse, giveYogiGuthaben, E2E_PREFIX } from '../../utils/seed'
import { getUserIdByEmail, getGuthabenCredit, getCourseCredit, countGuthabenCredits, getAdminClient } from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

// ── A: Guthaben wird bei Kursanmeldung verrechnet ────────────────────────────

test.describe('Guthaben: Verrechnung bei Kursanmeldung (Admin)', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let courseId: string
  let yogi1Id: string
  const COURSE_NAME = `${E2E_PREFIX} Guthaben-Kurstest`

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!

    // Altes Guthaben bereinigen
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'guthaben')

    // Neuen Testkurs anlegen (kein Yogi eingebucht)
    const course = await createTestCourse({ name: COURSE_NAME, sessionCount: 4 })
    courseId = course.courseId

    // Yogi bekommt 3 Guthaben-Credits
    await giveYogiGuthaben(yogi1Id, 3)
  })

  test('Yogi hat Guthaben vor dem Hinzufügen', async () => {
    const credit = await getGuthabenCredit(yogi1Id)
    expect(credit, 'Guthaben-Credit muss vorhanden sein').toBeTruthy()
    expect(credit!.total).toBe(3)
    expect(credit!.model).toBe('guthaben')
  })

  test('Modal zeigt Guthaben-Hinweis beim Yogi', async ({ page }) => {
    await page.goto('/admin/kurse')
    await page.waitForLoadState('networkidle')

    // Kurs-Karte finden und Teilnehmer-Panel öffnen
    const courseCard = page.locator('.card', { hasText: COURSE_NAME }).first()
    await expect(courseCard).toBeVisible({ timeout: 10_000 })
    await courseCard.getByRole('button', { name: /teilnehmer/i }).click()
    await page.waitForLoadState('networkidle')

    // Yogi-hinzufügen-Modal öffnen
    await page.getByRole('button', { name: /yogi hinzufügen/i }).click()
    await expect(page.getByText(/yogi zu .* hinzufügen/i)).toBeVisible({ timeout: 5_000 })

    // Nach Yogi suchen (Email-Prefix genügt)
    const yogiEmailPrefix = process.env.TEST_YOGI1_EMAIL!.split('@')[0]
    await page.getByPlaceholder(/name oder e-mail/i).fill(yogiEmailPrefix)
    await page.waitForTimeout(800)

    // Guthaben-Hinweis muss sichtbar sein
    await expect(
      page.getByText(/guthaben wird beim hinzufügen verrechnet/i)
    ).toBeVisible({ timeout: 8_000 })
  })

  test('Admin fügt Yogi hinzu → Guthaben verrechnet, Kurs-Credits korrekt', async ({ page }) => {
    await page.goto('/admin/kurse')
    await page.waitForLoadState('networkidle')

    const courseCard = page.locator('.card', { hasText: COURSE_NAME }).first()
    await expect(courseCard).toBeVisible({ timeout: 10_000 })
    await courseCard.getByRole('button', { name: /teilnehmer/i }).click()
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /yogi hinzufügen/i }).click()
    await expect(page.getByText(/yogi zu .* hinzufügen/i)).toBeVisible({ timeout: 5_000 })

    const yogiEmailPrefix = process.env.TEST_YOGI1_EMAIL!.split('@')[0]
    await page.getByPlaceholder(/name oder e-mail/i).fill(yogiEmailPrefix)
    await page.waitForTimeout(800)

    // Auf Hinzufügen klicken
    await page.getByRole('button', { name: /^hinzufügen$/i }).first().click()
    // Confirmation-Alert wegklicken (neue Logik zeigt "X Stunden mit Guthaben verrechnet")
    page.on('dialog', d => d.accept())
    await page.waitForTimeout(2_500)

    // Neue Logik (Commit 8f8a58c): Guthaben wird VERRECHNET (used erhöht), nicht gelöscht.
    // Bei 3 Guthaben + 4-Stunden-Kurs: Guthaben.used=3, neuer Course-Credit für 1 Stunde.
    const { getAdminClient: getDb } = await import('../../utils/db')
    const db = await getDb()
    const { data: guthabenCreds } = await db.from('credits')
      .select('total, used').eq('user_id', yogi1Id).eq('model', 'guthaben')
    expect(guthabenCreds, 'Guthaben-Credit muss noch existieren (nicht gelöscht)').toBeTruthy()
    expect(guthabenCreds!.length, 'Guthaben-Eintrag bleibt erhalten').toBe(1)
    expect(guthabenCreds![0].used, '3 Guthaben verrechnet (used=3)').toBe(3)

    // Course-Credit nur noch für den ungedeckten Rest (4-3=1)
    const courseCredit = await getCourseCredit(yogi1Id, courseId)
    expect(courseCredit, 'Kurs-Credit muss angelegt sein').toBeTruthy()
    expect(courseCredit!.model).toBe('course')
    expect(courseCredit!.total, 'total = nur nicht durch Guthaben gedeckte Stunden (1)').toBe(1)
    expect(courseCredit!.used, 'used = 1 (1 Stunde mit neuem Credit gebucht)').toBe(1)
    // Welle 5: Enrollment ist angelegt
    const { data: enrollment } = await db.from('enrollments')
      .select('*').eq('user_id', yogi1Id).eq('course_id', courseId).maybeSingle()
    expect(enrollment, 'Yogi muss enrolled sein').toBeTruthy()
    // Welle 5: insgesamt 4 Bookings (eines für jede Course-Session)
    const { data: bookings } = await db.from('bookings')
      .select('id, status, type')
      .eq('user_id', yogi1Id)
      .in('session_id',
        (await db.from('sessions').select('id').eq('course_id', courseId)).data!.map((s: any) => s.id)
      )
    expect(bookings?.length, '4-Stunden-Kurs erzeugt 4 Buchungen').toBe(4)
    expect(bookings!.every(b => b.status === 'active'), 'Alle Buchungen aktiv').toBe(true)
    expect(bookings!.every(b => b.type === 'course'), 'Alle Buchungen type=course').toBe(true)
  })
})

// ── B: Yogi mit nur Guthaben kann nicht in Einzelstunde eingebucht werden ────

test.describe('Guthaben: Sperrung für Einzelstunden (Admin-Session)', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let sessionId: string
  let yogi2Id: string
  const COURSE_NAME = `${E2E_PREFIX} Guthaben-Einzeltest`

  test.beforeAll(async () => {
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!

    // Altes Guthaben + alle Credits + Buchungen bereinigen (Test-Isolation)
    const db = await getAdminClient()
    await db.from('bookings').delete().eq('user_id', yogi2Id)
    await db.from('credits').delete().eq('user_id', yogi2Id)
    await new Promise(r => setTimeout(r, 500))

    // Kurs anlegen und erste Session-ID ermitteln
    const course = await createTestCourse({ name: COURSE_NAME, sessionCount: 2 })
    sessionId = course.sessionIds[0]

    // Nur Guthaben geben, keine anderen Credits
    await giveYogiGuthaben(yogi2Id, 5)
  })

  test('Admin-Session zeigt Guthaben-Warnung statt Quick-Credit-Option', async ({ page }) => {
    await page.goto(`/admin/sessions/${sessionId}`)
    await page.waitForLoadState('networkidle')

    // Yogi hinzufügen Modal öffnen
    await page.getByRole('button', { name: /yogi hinzufügen/i }).click()
    await expect(page.getByText(/yogi hinzufügen/i).first()).toBeVisible({ timeout: 5_000 })

    // Yogi suchen
    const yogiEmailPrefix = process.env.TEST_YOGI2_EMAIL!.split('@')[0]
    await page.getByPlaceholder(/name oder e-mail/i).fill(yogiEmailPrefix)
    await page.waitForTimeout(800)

    // Guthaben-Hinweis in der Suchliste
    await expect(
      page.getByText(/guthaben.*nur für kurse/i)
    ).toBeVisible({ timeout: 5_000 })

    // Auf Einbuchen klicken → handleAddYogi fragt confirm() für Quick-Credit
    // → Modal zeigt Guthaben-Warnung
    page.once('dialog', d => d.accept())
    await page.getByRole('button', { name: /einbuchen/i }).first().click()

    await expect(
      page.getByText(/nur kurs-guthaben vorhanden/i)
    ).toBeVisible({ timeout: 5_000 })

    // Kein "Credit vergeben & einbuchen" Button sichtbar
    await expect(
      page.getByRole('button', { name: /credit vergeben.*einbuchen/i })
    ).not.toBeVisible()
    // Welle 5: DB-Check Yogi2 ist NICHT eingebucht
    const db2 = await getAdminClient()
    const { data: bk } = await db2.from('bookings')
      .select('id').eq('user_id', yogi2Id).eq('session_id', sessionId).eq('status', 'active').maybeSingle()
    expect(bk, 'Yogi mit nur Guthaben darf nicht eingebucht werden').toBeNull()
  })
})
