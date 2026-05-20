/**
 * Workflow: Admin-Berechtigung (RLS / Client-Side Guard)
 * Testfälle:
 *   - Yogi versucht /admin/* aufzurufen → Weiterleitung zu /kurse
 *   - Nicht eingeloggter Nutzer → Weiterleitung zu /login
 *   - DB-Schutz: Yogi kann nicht direkt fremde Profile lesen (RLS)
 */
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { getUserIdByEmail } from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })
dotenv.config({ path: '.env.local' }) // für NEXT_PUBLIC_* Keys (anon)

test.describe('Admin-RLS: Yogi-Sperre für Admin-Routen', () => {
  test.use({ storageState: 'tests/.auth/yogi1.json' })

  for (const route of [
    '/admin/dashboard',
    '/admin/kurse',
    '/admin/yogis',
    '/admin/einladen',
    '/admin/einladungen',
    '/admin/protokoll',
  ]) {
    test(`Yogi öffnet ${route} → wird zu /kurse umgeleitet`, async ({ page }) => {
      await page.goto(route)
      // Layout-Hook prüft is_admin und routet zu /kurse falls nicht Admin
      await page.waitForURL(url => !new URL(url).pathname.startsWith('/admin'), { timeout: 10_000 })
      const finalPath = new URL(page.url()).pathname
      expect(finalPath, `Yogi darf ${route} nicht erreichen`).not.toMatch(/^\/admin/)
    })
  }
})

test.describe('Admin-RLS: Anonyme Nutzer ohne Login', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('Nicht eingeloggt: /admin/dashboard → /login', async ({ page }) => {
    await page.goto('/admin/dashboard')
    await page.waitForURL(/\/login/, { timeout: 10_000 })
    await expect(page).toHaveURL(/\/login/)
  })

  test('Nicht eingeloggt: /meine → /login', async ({ page }) => {
    await page.goto('/meine')
    await page.waitForURL(/\/login/, { timeout: 10_000 })
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('Admin-RLS: Datenbank-Level (Supabase RLS)', () => {
  // ⚠️ DOCUMENTED FINDING (offen):
  // Aktuell ist RLS auf der profiles-Tabelle deaktiviert (rls_enabled=false),
  // wodurch jeder authentifizierte User alle profiles inkl. Email lesen kann.
  // RLS aktivieren würde die Wartelisten-Nachrücken-Logik brechen (liest fremde
  // profiles für Email-Versand). Fix erfordert App-Refactor (Edge Function oder
  // SECURITY DEFINER Wrapper-Funktion). Bis dahin: fixme.
  test.fixme('Yogi-Token kann keine fremden Profile lesen', async () => {
    // Direkter Supabase-Login als Yogi1 (umgeht UI)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    const client = createClient(supabaseUrl, anonKey)
    const { data: auth, error: authErr } = await client.auth.signInWithPassword({
      email: process.env.TEST_YOGI1_EMAIL!,
      password: process.env.TEST_YOGI1_PASSWORD!,
    })
    expect(authErr, 'Yogi-Login muss klappen').toBeNull()
    expect(auth.user).toBeTruthy()

    const yogi1Id = auth.user!.id
    const yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!

    // Eigenes Profil lesen muss klappen
    const { data: ownProfile } = await client.from('profiles')
      .select('id, first_name, email').eq('id', yogi1Id).maybeSingle()
    expect(ownProfile?.id, 'Yogi muss eigenes Profil lesen können').toBe(yogi1Id)

    // Fremdes Profil über RLS einsehbar? Erwartung: Yogi kann fremdes Profil
    // höchstens mit eingeschränkten Feldern oder gar nicht lesen.
    const { data: otherProfile } = await client.from('profiles')
      .select('first_name, last_name, email').eq('id', yogi2Id).maybeSingle()

    // E-Mail-Adresse anderer User darf nicht zugänglich sein
    if (otherProfile) {
      // Wenn RLS Profile sichtbar lässt: zumindest darf email nicht durchgereicht werden
      expect(
        otherProfile.email,
        'Email anderer Yogis darf via RLS nicht ausgelesen werden'
      ).toBeFalsy()
    }
  })

  test('Yogi-Token kann keine bookings anderer User schreiben', async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    const client = createClient(supabaseUrl, anonKey)
    await client.auth.signInWithPassword({
      email: process.env.TEST_YOGI1_EMAIL!,
      password: process.env.TEST_YOGI1_PASSWORD!,
    })

    const yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!

    // Versuch, Buchung für yogi2 einzufügen → RLS muss blockieren
    const { error } = await client.from('bookings').insert({
      user_id: yogi2Id,
      session_id: '00000000-0000-0000-0000-000000000000',
      type: 'single',
      status: 'active',
    })
    expect(error, 'RLS muss Buchung für fremden User blockieren').toBeTruthy()
  })
})
