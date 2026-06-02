/**
 * Regression: Admin-Guard darf NIE mehr still auf /kurse demoten (Sarah 2026-06-02).
 *
 * Hintergrund: app/admin/layout.tsx warf bei einem transienten Profil-Hänger
 * (totes Token / RLS-/Netz-Wackler) den Admin auf /kurse — ohne Sidebar und
 * ohne Logout (Sackgasse). Dieser Test stellt genau das nach und stellt sicher,
 * dass es behoben bleibt.
 */
import { test, expect } from '@playwright/test'

test.describe('Admin-Guard ist robust (keine Sackgasse)', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  test('Normalfall: /admin/dashboard zeigt Sidebar, kein Redirect auf /kurse', async ({ page }) => {
    await page.goto('/admin/dashboard')
    await expect(page).toHaveURL(/\/admin\/dashboard/)
    // Sidebar-Marker (nur im Admin-Layout vorhanden, ab 768px sichtbar)
    await expect(page.getByText('AGB-Nachweise')).toBeVisible()
    // Darf NICHT in der Yogi-Ansicht gelandet sein
    await expect(page.getByText('Hallo Yogi')).toHaveCount(0)
  })

  test('KERN: transienter Profil-Hänger → NICHT auf /kurse, sondern Recovery-Screen', async ({ page }) => {
    // Profil-Abfrage hart fehlschlagen lassen (simuliert RLS-/Netz-/Token-Hänger).
    // getUser() (/auth/v1/user) bleibt gültig → nur die profiles-Query kippt.
    await page.route('**/rest/v1/profiles*', route => route.abort())

    await page.goto('/admin/dashboard')

    // Recovery-Screen muss erscheinen (nach 2 Retries) …
    await expect(page.getByText('Sitzung konnte nicht geladen werden')).toBeVisible({ timeout: 16_000 })
    await expect(page.getByRole('button', { name: 'Neu anmelden' })).toBeVisible()
    // … und auf KEINEN Fall die Yogi-Sackgasse:
    await expect(page).not.toHaveURL(/\/kurse/)
    await expect(page.getByText('Hallo Yogi')).toHaveCount(0)
  })

  test('Sackgassen-Schutz: Admin auf /kurse hat am Desktop trotzdem Navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 }) // Laptop
    await page.goto('/kurse')
    // Admin-BottomNav muss jetzt auch am Desktop sichtbar sein → Weg zurück/Logout
    await expect(page.getByRole('link', { name: 'Einladen' })).toBeVisible()
  })
})
