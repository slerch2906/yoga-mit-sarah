import { Page, expect } from '@playwright/test'

export class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/login')
    await this.page.waitForLoadState('networkidle')
  }

  async login(email: string, password: string) {
    await this.page.getByPlaceholder(/e-mail|email/i).fill(email)
    await this.page.getByPlaceholder(/passwort|password/i).fill(password)
    await this.page.getByRole('button', { name: /anmelden|einloggen|login/i }).click()
    await this.page.waitForURL(/\/(kurse|admin)/, { timeout: 15_000 })
  }

  async expectLoginError() {
    await expect(
      this.page.getByText(/falsch|ungültig|nicht gefunden|incorrect|invalid/i)
    ).toBeVisible()
  }

  async logout() {
    await this.page.goto('/profil')
    const logoutBtn = this.page.getByRole('button', { name: /abmelden|ausloggen|logout/i })
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click()
      await this.page.waitForURL(/login/)
    }
  }
}
