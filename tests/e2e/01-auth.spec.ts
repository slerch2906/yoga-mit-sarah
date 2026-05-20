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
    // Pathname muss /kurse sein (nicht nur URL-Domain die 'kurse' enthält)
    await expect(page).toHaveURL(url => new URL(url).pathname.startsWith('/kurse'))
  })

  test('Login mit falschem Passwort → Fehlermeldung', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await page.getByPlaceholder(/e-mail|email/i).fill(YOGI1.email)
    await page.locator('input[type="password"]').fill('falschesPasswort123!')
    await page.getByRole('button', { name: /anmelden|einloggen/i }).click()
    await login.expectLoginError()
    // User bleibt auf Login-Seite
    await expect(page).toHaveURL(/\/login/)
  })

  test('Passwort ändern → direkte Änderung ohne Reset-Link', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.login(YOGI1.email, YOGI1.password)

    // Direkt zur Passwort-Seite navigieren (vermeidet Button-Auswahl auf Profilseite)
    await page.goto('/profil/passwort')
    await page.waitForLoadState('networkidle')

    await page.locator('input[type="password"]').first().fill(YOGI1.password)
    await page.locator('input[type="password"]').nth(1).fill(YOGI1.password)
    await page.getByRole('button', { name: /speichern/i }).click()

    await expect(page.getByText(/passwort.*geändert|gespeichert|erfolgreich/i)).toBeVisible({ timeout: 10_000 })
  })

  test('Logout → Weiterleitung zu /login', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.login(YOGI1.email, YOGI1.password)
    await login.logout()
    await expect(page).toHaveURL(/login/)
  })

  test('Nach Logout kein Zugriff auf geschützte Seiten', async ({ page }) => {
    // Nicht eingeloggt → direkter Aufruf von /meine
    await page.goto('/meine')
    await expect(page).toHaveURL(/login/)
  })

  test('Yogi1-Session nach Auth-Tests erneuern', async ({ page, context }) => {
    // Der Logout-Test ruft signOut({ scope: 'global' }) auf, was alle Sessions invalidiert.
    // Deshalb muss yogi1.json hier neu gespeichert werden, damit folgende Testdateien funktionieren.
    const login = new LoginPage(page)
    await login.goto()
    await login.login(YOGI1.email, YOGI1.password)
    await expect(page).toHaveURL(url => new URL(url).pathname.startsWith('/kurse'))
    await context.storageState({ path: 'tests/.auth/yogi1.json' })
  })
})
