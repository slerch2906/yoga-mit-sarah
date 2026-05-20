/**
 * Workflow: Authentifizierung
 * Testfälle: Login, Logout, Passwort ändern
 */
import { test, expect } from '@playwright/test'
import { LoginPage } from '../page-objects/LoginPage'

const YOGI1 = {
  email: process.env.TEST_YOGI1_EMAIL!,
  password: process.env.TEST_YOGI1_PASSWORD!,
}

test.describe('Authentifizierung', () => {
  test.use({ storageState: { cookies: [], origins: [] } }) // Kein vorab-Login

  test('Login mit korrekten Daten → Weiterleitung zu /kurse', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.login(YOGI1.email, YOGI1.password)
    await expect(page).toHaveURL(/kurse/)
  })

  test('Login mit falschem Passwort → Fehlermeldung', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await page.getByPlaceholder(/e-mail|email/i).fill(YOGI1.email)
    await page.getByPlaceholder(/passwort|password/i).fill('falschesPasswort123!')
    await page.getByRole('button', { name: /anmelden|einloggen/i }).click()
    await login.expectLoginError()
    await expect(page).not.toHaveURL(/kurse/)
  })

  test('Passwort ändern → direkte Änderung ohne Reset-Link', async ({ page }) => {
    const login = new LoginPage(page)
    await login.login(YOGI1.email, YOGI1.password)

    await page.goto('/profil')
    await page.waitForLoadState('networkidle')

    // "Ändern"-Button → öffnet /profil/passwort (kein Email-Link!)
    await page.getByRole('button', { name: /ändern/i }).first().click()
    await expect(page).toHaveURL(/profil\/passwort/)

    // Neues Passwort eingeben (gleiches Passwort wie vorher – nur Flow testen)
    await page.getByLabel(/neues passwort/i).fill(YOGI1.password)
    await page.getByLabel(/bestätigen|wiederholen/i).fill(YOGI1.password)
    await page.getByRole('button', { name: /speichern/i }).click()

    await expect(page.getByText(/passwort.*geändert|erfolgreich/i)).toBeVisible({ timeout: 8_000 })
  })

  test('Logout → Weiterleitung zu /login', async ({ page }) => {
    const login = new LoginPage(page)
    await login.login(YOGI1.email, YOGI1.password)
    await login.logout()
    await expect(page).toHaveURL(/login/)
  })

  test('Nach Logout kein Zugriff auf geschützte Seiten', async ({ page }) => {
    // Nicht eingeloggt → direkter Aufruf von /meine
    await page.goto('/meine')
    await expect(page).toHaveURL(/login/)
  })
})
