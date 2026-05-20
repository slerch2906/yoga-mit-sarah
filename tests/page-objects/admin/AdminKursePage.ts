import { Page, expect } from '@playwright/test'

export class AdminKursePage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/admin/kurse')
    await this.page.waitForLoadState('networkidle')
  }

  // ── Kurs finden ───────────────────────────────────────────────────────────

  async expectCourseVisible(name: string) {
    await expect(this.page.getByText(name).first()).toBeVisible()
  }

  async clickCourse(name: string) {
    await this.page.getByText(name).first().click()
    await this.page.waitForLoadState('networkidle')
  }

  // ── Kurs bearbeiten ───────────────────────────────────────────────────────

  async openEditModal(courseName: string) {
    const card = this.page.locator('div, section', { hasText: courseName }).first()
    await card.getByRole('button', { name: /bearbeiten/i }).click()
    await expect(this.page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
  }

  async saveEdit() {
    await this.page.getByRole('button', { name: /speichern|änderungen speichern/i }).click()
    await expect(
      this.page.getByText(/gespeichert|erfolgreich/i)
    ).toBeVisible({ timeout: 8_000 })
  }

  // ── Stunde absagen ────────────────────────────────────────────────────────

  async openTermine(courseName: string) {
    const card = this.page.locator('div, section', { hasText: courseName }).first()
    await card.getByRole('button', { name: /termine/i }).click()
    await this.page.waitForLoadState('networkidle')
  }

  async cancelSession(dateText: string, withReplacement = false) {
    const row = this.page.locator('div, tr', { hasText: dateText }).first()
    await row.getByRole('button', { name: /absagen|stornieren/i }).click()

    if (!withReplacement) {
      await this.page.getByRole('button', { name: /ohne ersatz|nur absagen/i }).click()
    }

    await expect(
      this.page.getByText(/abgesagt|wurde abgesagt/i).first()
    ).toBeVisible({ timeout: 8_000 })
  }

  // ── Stunde ausschließen ───────────────────────────────────────────────────

  async excludeSession(dateText: string) {
    const row = this.page.locator('div, tr, button', { hasText: dateText }).first()
    await row.getByRole('button', { name: /ausschließen|ausklammern/i }).click()
  }

  // ── Kurs archivieren ──────────────────────────────────────────────────────

  async archiveCourse(courseName: string) {
    const card = this.page.locator('div, section', { hasText: courseName }).first()
    await card.getByRole('button', { name: /archivieren/i }).click()
    const confirmBtn = this.page.getByRole('button', { name: /bestätigen|ja.*archivieren/i })
    if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBtn.click()
    }
    await expect(this.page.getByText(courseName)).not.toBeVisible({ timeout: 8_000 })
  }

  // ── Folgekurs (Rollover) ──────────────────────────────────────────────────

  async openRolloverModal(courseName: string) {
    const card = this.page.locator('div, section', { hasText: courseName }).first()
    await card.getByRole('button', { name: /folgekurs|rollover/i }).click()
    await expect(
      this.page.getByText(/folgekurs anlegen|rollover/i)
    ).toBeVisible({ timeout: 5_000 })
  }

  async fillRolloverDates(startDate: string, endDate: string) {
    await this.page.getByLabel(/startdatum|von/i).fill(startDate)
    await this.page.getByLabel(/enddatum|bis/i).fill(endDate)
  }

  async submitRollover() {
    await this.page.getByRole('button', { name: /anlegen|erstellen/i }).click()
    await expect(
      this.page.getByText(/angelegt|erstellt|erfolgreich/i)
    ).toBeVisible({ timeout: 15_000 })
  }

  // ── Kurs abbrechen ────────────────────────────────────────────────────────

  async cancelCourse(courseName: string, reason = 'E2E Testabbruch') {
    const card = this.page.locator('div, section', { hasText: courseName }).first()
    await card.getByRole('button', { name: /kurs abbrechen|abbruch/i }).click()

    const reasonInput = this.page.getByPlaceholder(/grund|begründung/i)
    if (await reasonInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await reasonInput.fill(reason)
    }

    await this.page.getByRole('button', { name: /bestätigen|kurs abbrechen/i }).click()
    await expect(
      this.page.getByText(/abgebrochen|archiviert|emails.*gesendet/i)
    ).toBeVisible({ timeout: 15_000 })
  }
}
