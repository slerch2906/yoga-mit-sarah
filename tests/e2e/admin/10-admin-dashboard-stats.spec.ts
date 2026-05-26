// Welle 5 Refactor (Sarah 2026-05-26): zusätzliche semantische Assertions
/**
 * Workflow: Admin Dashboard – Stats-Kacheln
 * Testfälle:
 *   - Buchungen-Kachel klickbar → öffnet Detailseite mit Buchungsliste
 *   - Abmeldungen-Kachel klickbar → öffnet Detailseite
 *   - Warteliste-Kachel klickbar → öffnet Detailseite mit Warteliste
 */
import { test, expect } from '@playwright/test'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('Admin Dashboard: Stats-Kacheln', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  test('Buchungen-Kachel öffnet Detailseite /admin/stats/buchungen', async ({ page }) => {
    await page.goto('/admin/dashboard')
    await page.waitForLoadState('networkidle')

    // Kachel sichtbar
    const tile = page.getByRole('button', { name: /buchungen/i }).first()
    await expect(tile).toBeVisible({ timeout: 8_000 })

    // Klick navigiert zur Detailseite
    await tile.click()
    await expect(page).toHaveURL(/\/admin\/stats\/buchungen/, { timeout: 8_000 })
    await page.waitForLoadState('networkidle')

    // Seite lädt ohne Fehler
    await expect(page.getByText(/buchungen/i).first()).toBeVisible({ timeout: 5_000 })
    // Welle 5: Page hat Header/Heading (nicht nur Body-Text)
    await expect(
      page.getByRole('heading', { name: /buchungen/i }).first()
    ).toBeVisible({ timeout: 5_000 })
    // Welle 5: Keine Crash-Indikatoren
    await expect(page.getByText(/500|something went wrong|interner.*fehler/i)).toHaveCount(0)
  })

  test('Abmeldungen-Kachel öffnet Detailseite /admin/stats/abmeldungen', async ({ page }) => {
    await page.goto('/admin/dashboard')
    await page.waitForLoadState('networkidle')

    const tile = page.getByRole('button', { name: /abmeldungen/i }).first()
    await expect(tile).toBeVisible({ timeout: 8_000 })

    await tile.click()
    await expect(page).toHaveURL(/\/admin\/stats\/abmeldungen/, { timeout: 8_000 })
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/abmeldungen/i).first()).toBeVisible({ timeout: 5_000 })
    // Welle 5: Heading + keine Crash-Indikatoren
    await expect(
      page.getByRole('heading', { name: /abmeldungen/i }).first()
    ).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/500|something went wrong/i)).toHaveCount(0)
  })

  test('Warteliste-Kachel öffnet Detailseite /admin/stats/warteliste', async ({ page }) => {
    await page.goto('/admin/dashboard')
    await page.waitForLoadState('networkidle')

    const tile = page.getByRole('button', { name: /warteliste/i }).first()
    await expect(tile).toBeVisible({ timeout: 8_000 })

    await tile.click()
    await expect(page).toHaveURL(/\/admin\/stats\/warteliste/, { timeout: 8_000 })
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/warteliste/i).first()).toBeVisible({ timeout: 5_000 })
    // Zeigt entweder Einträge oder "Keine Einträge"
    await expect(
      page.getByText(/keine einträge/i).or(page.locator('.card')).first()
    ).toBeVisible({ timeout: 5_000 })
    // Welle 5: Heading
    await expect(
      page.getByRole('heading', { name: /warteliste/i }).first()
    ).toBeVisible({ timeout: 5_000 })
  })
})
