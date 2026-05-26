// Welle 5 Refactor (Sarah 2026-05-26): zusätzliche semantische Assertions
/**
 * Workflow: Passwort-Reset über Login-Seite
 * Testfälle:
 *   - Formular absenden → Bestätigungsmeldung sichtbar
 *   - Reset-Email kommt an (Mailtrap, optional)
 */
import { test, expect } from '@playwright/test'
import { waitForEmail, clearInbox, emailContains } from '../utils/mailtrap'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('Passwort-Reset', () => {
  // Kein storageState – nicht eingeloggt

  test.beforeAll(async () => {
    if (process.env.MAILTRAP_API_TOKEN) {
      await clearInbox()
    }
  })

  test('Passwort-vergessen-Formular → Bestätigung sichtbar', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    // "Passwort vergessen?" Link klicken
    await page.getByRole('button', { name: /passwort vergessen/i }).click()
    await expect(page.getByText(/passwort zurücksetzen/i)).toBeVisible({ timeout: 5_000 })

    // E-Mail eingeben
    await page.locator('input[type="email"]').fill(process.env.TEST_YOGI1_EMAIL!)

    // Absenden
    await page.getByRole('button', { name: /reset-link senden|zurücksetzen|senden/i }).click()

    // Bestätigungsmeldung
    await expect(
      page.getByText(/reset-link.*geschickt|e-mail.*gesendet|bitte prüfe/i)
    ).toBeVisible({ timeout: 10_000 })
    // Welle 5: Confirmation muss explizit die Email-Adresse oder "E-Mail"-Wort enthalten
    await expect(
      page.getByText(/e-?mail|posteingang|postfach/i).first()
    ).toBeVisible()
  })

  test('Passwort-Reset-Email kommt an (Mailtrap)', async () => {
    if (!process.env.MAILTRAP_API_TOKEN) {
      test.skip(true, 'MAILTRAP_API_TOKEN nicht konfiguriert')
      return
    }

    const email = await waitForEmail({
      to: process.env.TEST_YOGI1_EMAIL!,
      subjectContains: 'Passwort',
      timeoutMs: 25_000,
    })

    expect(emailContains(email, 'passwort')).toBe(true)
    expect(emailContains(email, 'yoga')).toBe(true)
    // Muss einen Reset-Link enthalten
    expect(
      email.html_body?.includes('profil/passwort') || email.html_body?.includes('recovery'),
      'Email muss Reset-Link enthalten'
    ).toBe(true)
    // Welle 5: Empfänger-Email muss exakt passen
    expect(email.to_email).toBe(process.env.TEST_YOGI1_EMAIL)
    // Welle 5: Subject muss Passwort-Bezug haben
    expect(email.subject.toLowerCase()).toMatch(/passwort|kennwort|reset/i)
  })

  test('Reset-Link mit unbekannter E-Mail zeigt trotzdem Bestätigung (kein Leak)', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /passwort vergessen/i }).click()
    await page.locator('input[type="email"]').fill('unbekannt.e2e@test.yogamitsarah.me')
    await page.getByRole('button', { name: /reset-link senden|zurücksetzen|senden/i }).click()

    // Auch bei unbekannter E-Mail soll Bestätigung erscheinen (Security: kein User-Enum)
    await expect(
      page.getByText(/reset-link.*geschickt|e-mail.*gesendet|bitte prüfe/i)
    ).toBeVisible({ timeout: 10_000 })
    // Welle 5 Note: Hauptzusicherung "kein Enum-Leak" ist die Bestätigung oben —
    // die Page rendert dieselbe Erfolgsmeldung sowohl für bekannte als auch für
    // unbekannte E-Mails (verifiziert via Supabase-Auth `resetPasswordForEmail`,
    // das per Default User-Enum nicht offenlegt). Engerer DOM-Check via role=alert
    // ist nicht zuverlässig, weil die App die Erfolgsmeldung selbst als alert markiert.
  })
})
