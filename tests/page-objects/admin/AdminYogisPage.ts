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
    await this.page.getByPlaceholder('Anna', { exact: true }).first().fill(options.firstName)
    await this.page.getByPlaceholder('Müller', { exact: true }).first().fill(options.lastName)
    await this.page.getByPlaceholder('anna@beispiel.de', { exact: true }).first().fill(options.email)

    if (options.courseId) {
      await this.page.getByRole('combobox').selectOption(options.courseId)
    }
  }

  async submitInvite() {
    await this.page.getByRole('button', { name: /einladungslink/i }).click()
    // 2026-08-21: Ohne .first() traf dieser Ausdruck nach einer ERFOLGREICHEN
    // Einladung drei Elemente gleichzeitig (Seitenueberschrift "Einladung
    // erstellt", Panel-Ueberschrift "Einladung erstellt!" und den Knopf "Link
    // kopieren") — Playwright bricht dann mit einem Eindeutigkeits-Fehler ab.
    // Der Test schlug also ausgerechnet dann fehl, wenn alles funktioniert hat.
    await expect(
      this.page.getByText(/einladung.*erstellt|link.*kopier|erfolgreich/i).first()
    ).toBeVisible({ timeout: 10_000 })
  }

  async expectInviteLink() {
    await expect(
      this.page.getByRole('button', { name: /link kopieren/i })
    ).toBeVisible({ timeout: 8_000 })
  }

  // ── Kurs-Dropdown ─────────────────────────────────────────────────────────

  async expectCourseDropdownContains(text: string) {
    // 2026-08-21: Das Dropdown wird erst nach der Hydration per Supabase-Query
    // gefuellt — `networkidle` ist da schon vorbei. Ein einmaliges Auslesen war
    // deshalb flaky (mal leer, mal befuellt). Jetzt wird gepollt.
    const dropdown = this.page.getByRole('combobox')
    await expect
      .poll(
        async () => {
          const options = await dropdown.locator('option').allTextContents()
          return options.some(o => o.toLowerCase().includes(text.toLowerCase()))
        },
        { message: `Kurs-Dropdown enthält nicht: "${text}"`, timeout: 10_000 }
      )
      .toBe(true)
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
