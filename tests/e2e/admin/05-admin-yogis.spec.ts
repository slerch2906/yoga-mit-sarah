/**
 * Workflow: Admin – Yogiverwaltung
 * Testfälle: Yogi einladen, Kursauswahl Dropdown, Credit vergeben
 */
import { test, expect } from '@playwright/test'
import { AdminYogisPage } from '../../page-objects/admin/AdminYogisPage'
import { createTestCourse, E2E_PREFIX } from '../../utils/seed'
import { getProfile } from '../../utils/db'
import { waitForEmail, clearInbox, emailContains } from '../../utils/mailtrap'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

const INVITE_EMAIL = `e2e.einladung.${Date.now()}@test.yogamitsarah.me`

test.beforeAll(async () => {
  if (process.env.MAILTRAP_API_TOKEN) {
    await clearInbox()
  }
})

test.describe('Admin Yogiverwaltung', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  test('Kursauswahl-Dropdown zeigt Wochentag und Startdatum', async ({ page }) => {
    const course = await createTestCourse({ name: `${E2E_PREFIX} Einladungstest-Kurs` })

    const yogisPage = new AdminYogisPage(page)
    await yogisPage.gotoEinladen()

    // Dropdown muss Kursname + Wochentag + Datum enthalten
    await yogisPage.expectCourseDropdownContains(E2E_PREFIX)
    // Optional: spezifisches Format prüfen ("· Donnerstag, ab")
    const dropdown = page.getByRole('combobox')
    const optionTexts = await dropdown.locator('option').allTextContents()
    const courseOption = optionTexts.find(t => t.includes(E2E_PREFIX))
    expect(
      courseOption,
      'Kurs-Dropdown-Option soll Wochentag und Datum enthalten'
    ).toMatch(/·.*\w+.*ab.*\d/)
  })

  test('Einladungslink erstellen → Link wird angezeigt', async ({ page }) => {
    const yogisPage = new AdminYogisPage(page)
    await yogisPage.gotoEinladen()

    await yogisPage.fillInviteForm({
      firstName: 'E2E',
      lastName: 'TestYogi',
      email: INVITE_EMAIL,
    })
    await yogisPage.submitInvite()
    await yogisPage.expectInviteLink()
  })

  test('Einladungs-Email kommt an (Mailtrap)', async ({ page }) => {
    if (!process.env.MAILTRAP_API_TOKEN) {
      test.skip(true, 'MAILTRAP_API_TOKEN nicht konfiguriert – Email-Test übersprungen')
      return
    }

    const email = await waitForEmail({
      to: INVITE_EMAIL,
      subjectContains: 'Einladung',
      timeoutMs: 20_000,
    })

    expect(
      emailContains(email, 'yoga'),
      'Einladungs-Email enthält keinen Yoga-Bezug'
    ).toBe(true)
  })

  test('Yogi-Profil: Yogi aus Liste gefunden', async ({ page }) => {
    const yogisPage = new AdminYogisPage(page)
    await yogisPage.goto()
    // E2E Test-Yogi1 muss in der Liste sichtbar sein
    await yogisPage.expectYogiVisible(
      process.env.TEST_YOGI1_EMAIL!.split('@')[0]
    )
  })
})
