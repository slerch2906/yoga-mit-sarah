import { Page, expect } from '@playwright/test'

export class MeinePage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/meine')
    await this.page.waitForLoadState('networkidle')
  }

  // ── Credits ───────────────────────────────────────────────────────────────

  async expectCreditCount(available: number, total: number) {
    // Prüft "X / Y genutzt" in der Credit-Übersicht
    await expect(
      this.page.getByText(new RegExp(`${total - available}.*/${total}.*genutzt|${available}.*frei`, 'i'))
    ).toBeVisible({ timeout: 5_000 })
  }

  async expectSingleCredits(count: number) {
    await expect(
      this.page.getByText(new RegExp(`${count}.*einzelstunden-credit`, 'i'))
    ).toBeVisible()
  }

  async expectGuthabenCredit() {
    await expect(
      this.page.getByText(/guthaben.*abgesagt|abgesagt.*kurs/i)
    ).toBeVisible()
  }

  async expectNoCredits() {
    // Sektion "Deine freien Credits" zeigt "Keine Credits" Empty-State (siehe app/meine/page.tsx)
    await expect(this.page.getByText(/keine credits/i)).toBeVisible()
  }

  async expectCreditHeading() {
    // Sektion heißt seit 2026-05-21 "Deine freien Credits" (vorher "Deine Credits")
    await expect(this.page.getByText(/deine freien credits/i)).toBeVisible()
  }

  // ── Kursstunden ───────────────────────────────────────────────────────────

  async expectSessionVisible(courseName: string) {
    await expect(this.page.getByText(courseName).first()).toBeVisible()
  }

  async expectSessionStatus(courseName: string, status: 'Angemeldet' | 'Abgemeldet' | 'Abgesagt') {
    const row = this.page.locator('div, button', { hasText: courseName }).first()
    await expect(row.getByText(status)).toBeVisible()
  }

  async expectExcludedSessionNotVisible(formattedDate: string) {
    // Ausgeschlossene Stunden sollen NICHT in Meine erscheinen
    await expect(
      this.page.locator('.text-sm.font-bold', { hasText: formattedDate })
    ).toHaveCount(0, { timeout: 5_000 })
  }
}
