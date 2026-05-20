import { Page, expect } from '@playwright/test'

export class AdminDashboardPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/admin/dashboard')
    await this.page.waitForLoadState('networkidle')
  }

  async expectSessionVisible(courseName: string) {
    await expect(this.page.getByText(courseName).first()).toBeVisible()
  }

  async clickSession(courseName: string) {
    await this.page.getByText(courseName).first().click()
    await this.page.waitForLoadState('networkidle')
  }

  async goToNextWeek() {
    const btn = this.page.locator('button', { hasText: 'Vor' }).first()
    await btn.waitFor({ state: 'visible', timeout: 10_000 })
    await btn.click()
    await this.page.waitForLoadState('networkidle')
  }

  async expectWeekRange(pattern: RegExp) {
    await expect(this.page.getByText(pattern).first()).toBeVisible()
  }

  async expectStats(options: { bookings?: number }) {
    if (options.bookings !== undefined) {
      await expect(this.page.getByText(String(options.bookings))).toBeVisible()
    }
  }
}
