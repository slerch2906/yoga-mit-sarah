/**
 * Workflow: Registrierung über Einladungslink
 * Testfälle:
 *   - Gültiges Token → Formular sichtbar, Email vorausgefüllt
 *   - Bereits verwendetes Token → Fehlermeldung
 *   - Abgelaufenes Token → Fehlermeldung
 *   - Ungültiges Token → Fehlermeldung
 *   - Erfolgreiche Registrierung → Profil, Token used, optional Welcome-Email
 */
import { test, expect } from '@playwright/test'
import { getServiceClient, getAdminClient } from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

const INVITE_EMAIL_VALID   = `e2e.invite.valid.${Date.now()}@test.yogamitsarah.me`
const INVITE_EMAIL_USED    = `e2e.invite.used.${Date.now()}@test.yogamitsarah.me`
const INVITE_EMAIL_EXPIRED = `e2e.invite.expired.${Date.now()}@test.yogamitsarah.me`

const TOKEN_VALID   = `e2e-token-valid-${Date.now()}`
const TOKEN_USED    = `e2e-token-used-${Date.now()}`
const TOKEN_EXPIRED = `e2e-token-expired-${Date.now()}`

let adminUserId: string

test.beforeAll(async () => {
  const service = getServiceClient()
  const { data: existing } = await service.auth.admin.listUsers()
  adminUserId = existing?.users?.find(u => u.email === process.env.TEST_ADMIN_EMAIL!)?.id ?? ''

  const db = await getAdminClient()
  const now = new Date()
  const futureExpire = new Date(now.getTime() + 14 * 24 * 3600 * 1000)
  const pastExpire = new Date(now.getTime() - 1 * 24 * 3600 * 1000)

  // Gültige Einladung
  await db.from('invitations').insert({
    email: INVITE_EMAIL_VALID,
    first_name: 'E2E',
    last_name: 'Valid',
    token: TOKEN_VALID,
    invited_by: adminUserId,
    expires_at: futureExpire.toISOString(),
    used: false,
  })

  // Bereits verwendete Einladung
  await db.from('invitations').insert({
    email: INVITE_EMAIL_USED,
    first_name: 'E2E',
    last_name: 'Used',
    token: TOKEN_USED,
    invited_by: adminUserId,
    expires_at: futureExpire.toISOString(),
    used: true,
    accepted_at: new Date().toISOString(),
  })

  // Abgelaufene Einladung
  await db.from('invitations').insert({
    email: INVITE_EMAIL_EXPIRED,
    first_name: 'E2E',
    last_name: 'Expired',
    token: TOKEN_EXPIRED,
    invited_by: adminUserId,
    expires_at: pastExpire.toISOString(),
    used: false,
  })
})

test.afterAll(async () => {
  const db = await getAdminClient()
  // Einladungen löschen
  await db.from('invitations').delete().in('email', [
    INVITE_EMAIL_VALID, INVITE_EMAIL_USED, INVITE_EMAIL_EXPIRED,
  ])

  // Falls der "valid"-User wirklich angelegt wurde → wegräumen
  const service = getServiceClient()
  const { data: users } = await service.auth.admin.listUsers()
  const user = users?.users?.find(u => u.email === INVITE_EMAIL_VALID)
  if (user) {
    await db.from('profiles').delete().eq('id', user.id)
    await db.from('legal_acceptances').delete().eq('user_id', user.id)
    await db.from('admin_notifications').delete()
      .like('message', `%${INVITE_EMAIL_VALID}%`)
    await service.auth.admin.deleteUser(user.id)
  }
})

test.describe('Registrierung: Token-Validierung', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('Ungültiges Token → Fehlermeldung', async ({ page }) => {
    await page.goto('/register?token=nicht-existierendes-token-xyz')
    await page.waitForLoadState('networkidle')
    await expect(
      page.getByText(/einladungslink.*ungültig|nicht.*gültig/i)
    ).toBeVisible({ timeout: 10_000 })
  })

  test('Bereits verwendetes Token → "bereits verwendet"', async ({ page }) => {
    await page.goto(`/register?token=${TOKEN_USED}`)
    await page.waitForLoadState('networkidle')
    await expect(
      page.getByText(/bereits verwendet/i)
    ).toBeVisible({ timeout: 10_000 })
  })

  test('Abgelaufenes Token → "abgelaufen"', async ({ page }) => {
    await page.goto(`/register?token=${TOKEN_EXPIRED}`)
    await page.waitForLoadState('networkidle')
    await expect(
      page.getByText(/abgelaufen/i)
    ).toBeVisible({ timeout: 10_000 })
  })

  test('Kein Token → Weiterleitung zu /login', async ({ page }) => {
    await page.goto('/register')
    await page.waitForURL(/\/login/, { timeout: 10_000 })
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('Registrierung: Erfolgreicher Flow', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('Gültiges Token → Formular mit vorausgefüllter Email', async ({ page }) => {
    await page.goto(`/register?token=${TOKEN_VALID}`)
    await page.waitForLoadState('networkidle')

    // Begrüßung sichtbar
    await expect(page.getByText(/willkommen/i)).toBeVisible({ timeout: 10_000 })

    // Email vorausgefüllt
    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput).toHaveValue(INVITE_EMAIL_VALID)

    // Vorname / Nachname vorausgefüllt
    await expect(page.locator('input[placeholder="Anna"]')).toHaveValue('E2E')
    await expect(page.locator('input[placeholder="Müller"]')).toHaveValue('Valid')
  })

  test('Registrierung absenden → Profil angelegt, Token used=true', async ({ page }) => {
    await page.goto(`/register?token=${TOKEN_VALID}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/willkommen/i)).toBeVisible({ timeout: 10_000 })

    // Passwort eingeben
    await page.locator('input[type="password"]').fill('TestPass!2026')

    // Konto erstellen
    await page.getByRole('button', { name: /konto erstellen.*loslegen/i }).click()

    // Weiterleitung zu /rechtliches
    await page.waitForURL(/\/rechtliches/, { timeout: 30_000 })
    await page.waitForTimeout(1_500)

    // DB-Check
    const db = await getAdminClient()
    const { data: inv } = await db.from('invitations')
      .select('used, accepted_at').eq('token', TOKEN_VALID).maybeSingle()
    expect(inv?.used, 'Token muss als used markiert sein').toBe(true)
    expect(inv?.accepted_at, 'accepted_at muss gesetzt sein').toBeTruthy()

    // Profil angelegt
    const { data: prof } = await db.from('profiles')
      .select('first_name, last_name, email').eq('email', INVITE_EMAIL_VALID).maybeSingle()
    expect(prof, 'Profil muss in DB existieren').toBeTruthy()
    expect(prof?.first_name).toBe('E2E')
    expect(prof?.last_name).toBe('Valid')

    // Admin-Notification
    const { data: notif } = await db.from('admin_notifications')
      .select('*').eq('type', 'new_yogi_registered')
      .like('message', `%${INVITE_EMAIL_VALID}%`)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    expect(notif, 'Admin muss informiert sein').toBeTruthy()
  })
})
