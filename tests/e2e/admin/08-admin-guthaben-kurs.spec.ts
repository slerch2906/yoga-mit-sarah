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
    await page.waitForTimeout(2_000)

    // Guthaben muss verschwunden sein
    const guthabenCount = await countGuthabenCredits(yogi1Id)
    expect(guthabenCount, 'Guthaben-Credits müssen nach Verrechnung gelöscht sein').toBe(0)

    // Kurs-Credits müssen korrekt angelegt sein (used = total = sessionCount)
    const courseCredit = await getCourseCredit(yogi1Id, courseId)
    expect(courseCredit, 'Kurs-Credit muss angelegt sein').toBeTruthy()
    expect(courseCredit!.model).toBe('course')
    expect(courseCredit!.total, 'total muss der Sessionanzahl entsprechen').toBe(4)
    expect(courseCredit!.used, 'used muss gleich total sein (alle Sessions gebucht)').toBe(4)
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

    // Altes Guthaben + Credits bereinigen
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi2Id).eq('model', 'guthaben')
    await db.from('credits').delete().eq('user_id', yogi2Id).neq('model', 'course')

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

    // Auf Einbuchen klicken → Quick-Credit-Modal zeigt Guthaben-Warnung
    await page.getByRole('button', { name: /einbuchen/i }).first().click()

    await expect(
      page.getByText(/nur kurs-guthaben vorhanden/i)
    ).toBeVisible({ timeout: 5_000 })

    // Kein "Credit vergeben & einbuchen" Button sichtbar
    await expect(
      page.getByRole('button', { name: /credit vergeben.*einbuchen/i })
    ).not.toBeVisible()
  })
})
