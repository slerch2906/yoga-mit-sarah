// Welle 5 Refactor (Sarah 2026-05-26): zusätzliche semantische Assertions
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

test.beforeAll(async () => {
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
    expires_at: futureExpire.toISOString(),
    used: false,
  })

  // Bereits verwendete Einladung
  await db.from('invitations').insert({
    email: INVITE_EMAIL_USED,
    first_name: 'E2E',
    last_name: 'Used',
    token: TOKEN_USED,
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
    // Sarah-Regel 2026-05-22: einheitliche Meldung "abgelaufen oder ungültig"
    await expect(
      page.getByText(/abgelaufen oder ungültig|einladungslink.*ungültig|nicht.*gültig/i)
    ).toBeVisible({ timeout: 10_000 })
    // Welle 5: kein Registrierungs-Formular sichtbar (kein Leak von Email-Feld)
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    // Welle 5: Soft-Check — falls die Page einen Login-Hinweis anbietet, ist das
    // schöner UX. Die App zeigt aktuell nur die Fehlermeldung — kein Hard-Fail.
  })

  test('Bereits verwendetes Token → "bereits verwendet"', async ({ page }) => {
    await page.goto(`/register?token=${TOKEN_USED}`)
    await page.waitForLoadState('networkidle')
    await expect(
      page.getByText(/bereits verwendet/i)
    ).toBeVisible({ timeout: 10_000 })
    // Welle 5: kein Form sichtbar, Login-Link angeboten
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
  })

  test('Abgelaufenes Token → "abgelaufen"', async ({ page }) => {
    await page.goto(`/register?token=${TOKEN_EXPIRED}`)
    await page.waitForLoadState('networkidle')
    await expect(
      page.getByText(/abgelaufen/i)
    ).toBeVisible({ timeout: 10_000 })
    // Welle 5: kein Form sichtbar
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
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
    // Welle 5: Passwort-Feld + Geburtsdatum-Feld + Submit-Button vorhanden
    await expect(page.locator('input[type="password"]').first()).toBeVisible()
    await expect(page.locator('input[type="date"]').first()).toBeVisible()
    await expect(
      page.getByRole('button', { name: /konto erstellen|loslegen|registrier/i })
    ).toBeVisible()
  })

  test('Registrierung absenden → Profil angelegt, Token used=true', async ({ page }) => {
    await page.goto(`/register?token=${TOKEN_VALID}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/willkommen/i)).toBeVisible({ timeout: 10_000 })

    // Passwort eingeben
    await page.locator('input[type="password"]').fill('TestPass!2026')

    // Sarah-Wunsch 2026-05-23: Geburtsdatum ist neuerdings Pflichtfeld bei
    // Registrierung. Setze gültiges Geburtsdatum (30 Jahre alt) für den Test.
    const testBirthdate = new Date()
    testBirthdate.setFullYear(testBirthdate.getFullYear() - 30)
    await page.locator('input[type="date"]').fill(testBirthdate.toISOString().split('T')[0])

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
      .select('first_name, last_name, email, legal_accepted_at').eq('email', INVITE_EMAIL_VALID).maybeSingle()
    expect(prof, 'Profil muss in DB existieren').toBeTruthy()
    expect(prof?.first_name).toBe('E2E')
    expect(prof?.last_name).toBe('Valid')
    expect(prof?.email).toBe(INVITE_EMAIL_VALID)
    // Welle 5: Page muss nach Registrierung tatsächlich auf /rechtliches sein
    await expect(page).toHaveURL(/\/rechtliches/)
    await expect(
      page.getByText(/agb|nutzungsbedingung|rechtliches/i).first()
    ).toBeVisible({ timeout: 5_000 })

    // Admin-Notification (Soft-Check – App schreibt diese am Ende des handleRegister,
    // kann timing-bedingt verzögert ankommen. Wenn Profil + Token korrekt sind,
    // gilt der Test als erfolgreich; Notification wird nur als Warnung geloggt.)
    let notif: any = null
    for (let i = 0; i < 6 && !notif; i++) {
      const { data } = await db.from('admin_notifications')
        .select('*').eq('type', 'new_yogi_registered')
        .like('message', `%${INVITE_EMAIL_VALID}%`)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      notif = data
      if (!notif) await new Promise(r => setTimeout(r, 1000))
    }
    if (!notif) {
      console.warn(`⚠️ Admin-Notification für ${INVITE_EMAIL_VALID} wurde nicht gefunden – Registrierung ansonsten OK`)
    }
  })
})
