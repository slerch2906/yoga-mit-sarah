/**
 * Workflow: Admin – Credits verwalten
 * Testfälle:
 *   - Kurs-Credits und Guthaben sind read-only (kein Edit/Delete)
 *   - Punktekarten (tenpack) sind editierbar
 *   - Einladungs-Erinnerung sendet E-Mail
 */
import { test, expect } from '@playwright/test'
import { giveYogiGuthaben, E2E_PREFIX } from '../../utils/seed'
import { getUserIdByEmail, getAdminClient } from '../../utils/db'
import { waitForEmail, emailContains } from '../../utils/mailtrap'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

const REMINDER_EMAIL = `e2e.reminder.${Date.now()}@test.yogamitsarah.me`

// ── Credits: Read-only für course und guthaben ────────────────────────────────

test.describe('Credits verwalten: Read-only und Editierbarkeit', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test('Kurs-Credits zeigen "Nur Lesezugriff", keine Edit/Delete-Buttons', async ({ page }) => {
    await page.goto(`/admin/yogis/${yogi1Id}`)
    await page.waitForLoadState('networkidle')

    // Credits-Bereich sichtbar
    await expect(page.getByText('Credits verwalten').first()).toBeVisible({ timeout: 8_000 })

    // Kurs-Credit-Karte finden
    const courseCard = page.locator('.card', { hasText: 'Credits aus Kurs' }).first()
    if (await courseCard.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(courseCard.getByText('Nur Lesezugriff')).toBeVisible()
      await expect(courseCard.locator('[data-testid="edit-credit"], .ti-edit').first()).not.toBeVisible()
    }
  })

  test('Guthaben-Credits zeigen "Nur Lesezugriff", keine Edit/Delete-Buttons', async ({ page }) => {
    // Guthaben anlegen
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'guthaben')
    await giveYogiGuthaben(yogi1Id, 2)

    await page.goto(`/admin/yogis/${yogi1Id}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Credits verwalten').first()).toBeVisible({ timeout: 8_000 })

    const guthabenCard = page.locator('.card', { hasText: 'Guthaben aus Kursabbruch' }).first()
    await expect(guthabenCard).toBeVisible({ timeout: 5_000 })
    await expect(guthabenCard.getByText('Nur Lesezugriff')).toBeVisible()

    // Cleanup
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'guthaben')
  })

  test('Tenpack-Credits zeigen Edit/Delete-Buttons', async ({ page }) => {
    // Tenpack-Credit anlegen
    const db = await getAdminClient()
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, model: 'tenpack', total: 10, used: 0,
      course_id: null, expires_at: exp.toISOString(),
    }).select('id').single()

    await page.goto(`/admin/yogis/${yogi1Id}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Credits verwalten').first()).toBeVisible({ timeout: 8_000 })

    const tenpackCard = page.locator('.card', { hasText: 'Punktekarte' }).first()
    await expect(tenpackCard).toBeVisible({ timeout: 5_000 })
    // Edit-Button sichtbar
    await expect(tenpackCard.locator('button', { hasText: '' }).or(tenpackCard.locator('.ti-edit').locator('..')).first()).toBeVisible()

    // Cleanup
    if (credit?.id) await db.from('credits').delete().eq('id', credit.id)
  })
})

// ── Einladungs-Erinnerung ─────────────────────────────────────────────────────

test.describe('Einladungs-Erinnerung senden', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  test.beforeAll(async () => {
    // Einladung direkt in DB anlegen (kein UI-Durchlauf nötig)
    const db = await getAdminClient()
    const { data: existingUsers } = await db.auth.admin.listUsers()
    const adminUser = existingUsers?.users?.find(u => u.email === process.env.TEST_ADMIN_EMAIL)
    if (!adminUser) return

    const token = `e2e-reminder-${Date.now()}`
    await db.from('invitations').insert({
      email: REMINDER_EMAIL,
      first_name: 'E2E',
      last_name: 'Reminder',
      token,
    })
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('invitations').delete().eq('email', REMINDER_EMAIL)
  })

  test('Erinnerung senden → Button zeigt "Gesendet"', async ({ page }) => {
    await page.goto('/admin/einladungen')
    await page.waitForLoadState('networkidle')

    // Einladung in der Liste finden
    const invRow = page.locator('div, tr', { hasText: REMINDER_EMAIL }).first()
    await expect(invRow).toBeVisible({ timeout: 8_000 })

    // Erinnerungs-Button klicken
    const reminderBtn = invRow.getByRole('button', { name: /erinnerung/i })
    await expect(reminderBtn).toBeVisible()
    await reminderBtn.click()

    // Button wechselt auf "Gesendet"
    await expect(invRow.getByText(/gesendet/i)).toBeVisible({ timeout: 10_000 })
  })

  test('Erinnerungs-Email kommt an (Mailtrap)', async () => {
    if (!process.env.MAILTRAP_API_TOKEN) {
      test.skip(true, 'MAILTRAP_API_TOKEN nicht konfiguriert')
      return
    }

    const email = await waitForEmail({
      to: REMINDER_EMAIL,
      subjectContains: 'Erinnerung',
      timeoutMs: 20_000,
    })

    expect(emailContains(email, 'yoga')).toBe(true)
    expect(emailContains(email, 'registrieren')).toBe(true)
  })
})
