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

  async openCancelModal(courseName: string) {
    const card = this.page.locator('.card', { hasText: courseName }).first()
    await card.getByRole('button', { name: /abbrechen/i }).click()
    await expect(this.page.getByText('Kurs abbrechen').first()).toBeVisible({ timeout: 5_000 })
  }

  async fillCancelModal(reason: string, mode: 'all_refund' | 'yogi_choice') {
    await this.page.getByPlaceholder(/z\.B\. Krankheit/i).fill(reason)
    if (mode === 'all_refund') {
      await this.page.getByText('Alle bekommen Geld zurück').click()
    } else {
      await this.page.getByText('Teilnehmer entscheiden selbst').click()
    }
  }

  async confirmCancelModal() {
    // The app calls alert() after ALL DB operations complete, so waiting for the
    // dialog event guarantees the DB is fully updated before we proceed.
    const dialogPromise = this.page.waitForEvent('dialog', { timeout: 30_000 })
    await this.page.getByRole('button', { name: /kurs abbrechen.*yogis informieren/i }).click()
    const dialog = await dialogPromise
    await dialog.accept()
    await this.page.waitForTimeout(500)
  }
}
