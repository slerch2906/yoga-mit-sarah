import { Page, expect } from '@playwright/test'

export class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/login')
    await this.page.waitForLoadState('networkidle')
  }

  async login(email: string, password: string) {
    await this.page.getByPlaceholder(/e-mail|email/i).fill(email)
    await this.page.locator('input[type="password"]').fill(password)
    await this.page.getByRole('button', { name: /anmelden|einloggen|login/i }).click()
    await this.page.waitForURL(url => new URL(url).pathname !== '/login', { timeout: 15_000 })
  }

  async expectLoginError() {
    await expect(
      this.page.getByText(/falsch|ungültig|nicht gefunden|incorrect|invalid/i)
    ).toBeVisible()
  }

  async logout() {
    await this.page.goto('/profil')
    const logoutBtn = this.page.getByRole('button', { name: /ausloggen/i })
    await logoutBtn.waitFor({ timeout: 10_000 })
    await logoutBtn.click()
    await this.page.waitForURL(/\/login/, { timeout: 10_000 })
  }
}
