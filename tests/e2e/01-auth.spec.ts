// Welle 5 Refactor (Sarah 2026-05-26): zusätzliche semantische Assertions
/**
 * Workflow: Authentifizierung
 * Testfälle: Login, Logout, Passwort ändern
 */
import { test, expect } from '@playwright/test'
import { LoginPage } from '../page-objects/LoginPage'
import { getServiceClient, getUserIdByEmail } from '../utils/db'

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
    // Welle 5: semantische Assertion — nach Login muss Kurse-Page klar identifizierbar sein
    await expect(page.locator('body')).toContainText(/kurse|stunde|woche|heute/i, { timeout: 8_000 })
    // Header/Hauptbereich darf kein Login-Formular mehr enthalten
    await expect(page.getByRole('button', { name: /anmelden|einloggen/i })).toHaveCount(0)
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
    // Welle 5: Fehlermeldung muss konkret semantisch sein (kein generisches "Fehler")
    await expect(
      page.getByText(/falsch|ungültig|nicht.*gefunden|invalid|incorrect/i).first()
    ).toBeVisible()
    // Login-Form muss noch da sein (Email-Feld nicht geleert)
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('Passwort ändern → direkte Änderung ohne Reset-Link', async ({ page }) => {
    // Sarah-Freigabe 2026-05-29: Der Test ändert das Test-Yogi-Passwort kurz auf einen
    // NEUEN Wert (Supabase lehnt "neu == alt" ab — daher schlug der Test bisher fehl) und
    // setzt es im finally sofort wieder zurück. Sarahs echter Account ist nie betroffen.
    const NEW_PW = `${YOGI1.password}_Neu9`
    const login = new LoginPage(page)
    try {
      await login.goto()
      await login.login(YOGI1.email, YOGI1.password)

      // Direkt zur Passwort-Seite navigieren (vermeidet Button-Auswahl auf Profilseite)
      await page.goto('/profil/passwort')
      await page.waitForLoadState('networkidle')

      await page.locator('input[type="password"]').first().fill(NEW_PW)
      await page.locator('input[type="password"]').nth(1).fill(NEW_PW)
      await page.getByRole('button', { name: /speichern/i }).click()

      await expect(page.getByText(/passwort.*geändert|gespeichert|erfolgreich/i)).toBeVisible({ timeout: 10_000 })
      // Welle 5: Bestätigung muss eindeutig auf Passwort-Aktion zeigen, nicht generisch
      await expect(
        page.getByText(/passwort|kennwort/i).first()
      ).toBeVisible()
    } finally {
      // Sicherheitsnetz: Test-Yogi-Passwort sofort wieder auf den .env.test-Wert setzen,
      // damit Logout-Test, Session-Erneuerung und alle folgenden Test-Dateien weiter
      // mit YOGI1.password einloggen können. Der Admin-Pfad (updateUserById) kennt die
      // "neu != alt"-Regel nicht, akzeptiert das Zurücksetzen also problemlos.
      const svc = getServiceClient()
      const uid = await getUserIdByEmail(YOGI1.email)
      if (uid) await svc.auth.admin.updateUserById(uid, { password: YOGI1.password })
    }
  })

  test('Logout → Weiterleitung zu /login', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.login(YOGI1.email, YOGI1.password)
    await login.logout()
    await expect(page).toHaveURL(/login/)
    // Welle 5: Login-Form muss tatsächlich sichtbar sein nach Logout
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('button', { name: /anmelden|einloggen/i })).toBeVisible()
  })

  test('Nach Logout kein Zugriff auf geschützte Seiten', async ({ page }) => {
    // Nicht eingeloggt → direkter Aufruf von /meine
    await page.goto('/meine')
    await expect(page).toHaveURL(/login/)
    // Welle 5: Geschützte Seite darf NICHT durchscheinen (kein "Meine Stunden"-Heading)
    await expect(page.getByRole('heading', { name: /meine stunden|deine credits/i })).toHaveCount(0)
    // Login-Form sichtbar
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 5_000 })
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
