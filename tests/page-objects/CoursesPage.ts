import { Page, expect } from '@playwright/test'

export class CoursesPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/kurse')
    await this.page.waitForLoadState('networkidle')
  }

  /** Navigiert zur nächsten Woche */
  async goToNextWeek() {
    await this.page.getByRole('button', { name: /nächste/i }).click()
    await this.page.waitForLoadState('networkidle')
  }

  /** Klickt auf eine Stunde anhand des Kursnamens */
  async clickSession(courseName: string) {
    await this.page.getByText(courseName).first().click()
    await this.page.waitForURL(/\/kurse\/[a-f0-9-]+/)
    await this.page.waitForLoadState('networkidle')
  }

  /** Navigiert direkt zur Session-Detailseite */
  async gotoSession(sessionId: string) {
    await this.page.goto(`/kurse/${sessionId}`)
    await this.page.waitForLoadState('networkidle')
  }

  /** Prüft die "x Stunden in dieser Woche"-Anzeige */
  async expectBookedCountBadge(count: number) {
    await expect(this.page.getByText(new RegExp(`Du hast ${count} Stunde`, 'i'))).toBeVisible()
  }

  /** Prüft ob die Session-Karte das Badge zeigt */
  async expectBadge(courseName: string, badge: 'Angemeldet' | 'Ausgebucht' | RegExp) {
    const card = this.page.locator('button', { hasText: courseName }).first()
    await expect(card).toBeVisible()
    const badgeText = typeof badge === 'string' ? new RegExp(badge) : badge
    await expect(card.getByText(badgeText)).toBeVisible()
  }
}
