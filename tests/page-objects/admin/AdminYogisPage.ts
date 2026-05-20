import { Page, expect } from '@playwright/test'

export class AdminYogisPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/admin/yogis')
    await this.page.waitForLoadState('networkidle')
  }

  async gotoEinladen() {
    await this.page.goto('/admin/einladen')
    await this.page.waitForLoadState('networkidle')
  }

  async expectYogiVisible(nameOrEmail: string) {
    await expect(this.page.getByText(nameOrEmail).first()).toBeVisible()
  }

  async clickYogi(nameOrEmail: string) {
    await this.page.getByText(nameOrEmail).first().click()
    await this.page.waitForLoadState('networkidle')
  }

  // ── Einladen ──────────────────────────────────────────────────────────────

  async fillInviteForm(options: {
    firstName: string
    lastName: string
    email: string
    courseId?: string
  }) {
    await this.page.getByLabel(/vorname/i).fill(options.firstName)
    await this.page.getByLabel(/nachname/i).fill(options.lastName)
    await this.page.getByLabel(/e-mail/i).fill(options.email)

    if (options.courseId) {
      await this.page.getByRole('combobox').selectOption(options.courseId)
    }
  }

  async submitInvite() {
    await this.page.getByRole('button', { name: /einlad|erstellen|senden/i }).click()
    await expect(
      this.page.getByText(/einladung.*erstellt|link.*kopier|erfolgreich/i)
    ).toBeVisible({ timeout: 10_000 })
  }

  async expectInviteLink() {
    await expect(
      this.page.getByText(/einladungslink|link/i)
    ).toBeVisible()
  }

  // ── Kurs-Dropdown ─────────────────────────────────────────────────────────

  async expectCourseDropdownContains(text: string) {
    const dropdown = this.page.getByRole('combobox')
    const options = await dropdown.locator('option').allTextContents()
    const found = options.some(o => o.toLowerCase().includes(text.toLowerCase()))
    expect(found, `Kurs-Dropdown enthält nicht: "${text}"`).toBe(true)
  }

  // ── Yogi-Profil ───────────────────────────────────────────────────────────

  async giveCredit(userId: string, count = 5) {
    // Navigiert zum Yogi-Profil und vergibt Credits
    await this.page.goto(`/admin/yogis/${userId}`)
    await this.page.waitForLoadState('networkidle')
    await this.page.getByRole('button', { name: /credit.*geben|credits.*vergeben/i }).click()
    const input = this.page.getByRole('spinbutton')
    await input.fill(String(count))
    await this.page.getByRole('button', { name: /speichern|vergeben|bestätigen/i }).click()
    await expect(
      this.page.getByText(/credit.*vergeben|erfolgreich/i)
    ).toBeVisible({ timeout: 8_000 })
  }
}
