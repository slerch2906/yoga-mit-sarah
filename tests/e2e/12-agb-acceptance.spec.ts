/**
 * Workflow: AGB-Akzeptanz (legal_accepted_at)
 * Testfälle:
 *   - Yogi ohne AGB-Akzeptanz → Redirect zu /rechtliches bei Buchungs-Aufruf
 *   - Nach AGB-Akzeptanz → Zugriff auf /kurse möglich
 */
import { test, expect } from '@playwright/test'
import { getUserIdByEmail, getAdminClient } from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('AGB-Akzeptanz: Blockiert Buchungen ohne Zustimmung', () => {
  test.use({ storageState: 'tests/.auth/yogi1.json' })

  let yogi1Id: string
  let originalLegalAcceptedAt: string | null = null

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!

    // Aktuellen Stand sichern und legal_accepted_at auf null setzen
    const db = await getAdminClient()
    const { data: prof } = await db.from('profiles')
      .select('legal_accepted_at').eq('id', yogi1Id).single()
    originalLegalAcceptedAt = prof?.legal_accepted_at ?? null

    await db.from('profiles').update({ legal_accepted_at: null }).eq('id', yogi1Id)
  })

  test.afterAll(async () => {
    // AGB-Akzeptanz wiederherstellen
    const db = await getAdminClient()
    await db.from('profiles').update({
      legal_accepted_at: originalLegalAcceptedAt || new Date().toISOString(),
    }).eq('id', yogi1Id)
  })

  test('Aufruf /meine ohne AGB-Akzeptanz → Weiterleitung zu /rechtliches', async ({ page }) => {
    await page.goto('/meine')
    // useLegalCheck-Hook leitet via window.location.href weiter
    await page.waitForURL(/\/rechtliches/, { timeout: 10_000 })
    await expect(page).toHaveURL(/\/rechtliches/)
  })

  test('Aufruf /profil ohne AGB-Akzeptanz → Weiterleitung zu /rechtliches', async ({ page }) => {
    await page.goto('/profil')
    await page.waitForURL(/\/rechtliches/, { timeout: 10_000 })
    await expect(page).toHaveURL(/\/rechtliches/)
  })

  test('Rechtliches-Seite zeigt Pflichtfelder', async ({ page }) => {
    await page.goto('/rechtliches')
    await page.waitForLoadState('networkidle')

    // Mindestens eine Checkbox und Submit-Button sichtbar
    await expect(page.locator('input[type="checkbox"]').first()).toBeVisible({ timeout: 8_000 })
  })
})

test.describe('AGB-Akzeptanz: Nach Akzeptanz wieder Vollzugriff', () => {
  test.use({ storageState: 'tests/.auth/yogi1.json' })

  test('Mit gültiger legal_accepted_at → /meine erreichbar', async ({ page }) => {
    // Stelle sicher dass AGB akzeptiert ist
    const yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()
    await db.from('profiles').update({
      legal_accepted_at: new Date().toISOString(),
    }).eq('id', yogi1Id)

    await page.goto('/meine')
    await page.waitForLoadState('networkidle')
    // Kein Redirect zu /rechtliches
    await expect(page).toHaveURL(/\/meine/)
  })
})
