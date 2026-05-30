/**
 * Coverage-Gaps — BROWSER-Ebene (Sarah 2026-05-30).
 * Echte Klick→Konsequenz-Tests durch die UI für die Standard-User-Stories, die
 * bisher nur per Source-Smoke oder gar nicht abgesichert waren:
 *   #1  Einladung MIT Kurs → Registrierung → automatische Einbuchung (DER Live-Bug)
 *   #2  Neue AGB-Version → bestehender Yogi wird beim /profil-Aufruf zur Re-Akzeptanz umgeleitet
 *   #9  Profil-Benachrichtigungseinstellung umschalten → persistiert in der DB
 *   #5  Admin-Dashboard-Kacheln zeigen die Buchungen DIESER Woche (funktional)
 */
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { getAdminClient, getServiceClient, getUserIdByEmail } from '../utils/db'
import { createTestCourse, E2E_PREFIX } from '../utils/seed'
import { LoginPage } from '../page-objects/LoginPage'

dotenv.config({ path: '.env.test' })

function svc() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
function berlinToday(): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const g = (t: string) => p.find(x => x.type === t)!.value
  return `${g('year')}-${g('month')}-${g('day')}`
}
async function resetYogi(userId: string) {
  const db = await getAdminClient()
  await db.from('waitlist').delete().eq('user_id', userId)
  await db.from('bookings').delete().eq('user_id', userId)
  await db.from('credits').delete().eq('user_id', userId)
  await db.from('enrollments').delete().eq('user_id', userId)
}

// ════════════════════════════════════════════════════════════════════════════
// Gap #1: Einladung MIT Kurs → Registrierung bucht den Yogi automatisch ein
//   GENAU DER Live-Bug vom 30.05.: read_invitation_by_token lieferte
//   credits_to_assign nicht → Register-Seite übersprang Enrollment + Buchungen.
//   Dieser End-to-End-Test (echte Registrierung durch die UI) hätte ihn gefangen.
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Coverage: Einladung mit Kurs → Auto-Einbuchung', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  const EMAIL = `e2e.invitecourse.${Date.now()}@test.yogamitsarah.me`
  const TOKEN = `e2e-invcourse-${Date.now()}`
  let courseId: string
  let sessionIds: string[] = []
  let newUserId = ''

  test.beforeAll(async () => {
    const db = await getAdminClient()
    const course = await createTestCourse({ name: `${E2E_PREFIX} Einladung-Auto`, sessionCount: 4, startDaysFromNow: 7 })
    courseId = course.courseId
    sessionIds = course.sessionIds
    await db.from('invitations').insert({
      token: TOKEN, email: EMAIL, first_name: 'E2E', last_name: 'AutoBook',
      course_id: courseId, credits_to_assign: 4, used: false,
      expires_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    })
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('invitations').delete().eq('token', TOKEN)
    const service = getServiceClient()
    const { data: users } = await service.auth.admin.listUsers()
    const user = users?.users?.find(u => u.email === EMAIL)
    if (user) {
      await db.from('bookings').delete().eq('user_id', user.id)
      await db.from('credits').delete().eq('user_id', user.id)
      await db.from('enrollments').delete().eq('user_id', user.id)
      await db.from('legal_acceptances').delete().eq('user_id', user.id)
      await db.from('profiles').delete().eq('id', user.id)
      await db.from('admin_notifications').delete().like('message', `%${EMAIL}%`)
      try { await service.auth.admin.deleteUser(user.id) } catch {}
    }
  })

  test('[E2E] Registrierung über Einladungslink → Enrollment + 4 Credits + 4 Buchungen', async ({ page }) => {
    await page.goto(`/register?token=${TOKEN}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/willkommen/i)).toBeVisible({ timeout: 10_000 })
    // Hinweis "Du wirst direkt in … eingebucht" muss erscheinen (Kurs-Einladung erkannt)
    await expect(page.getByText(/direkt in.*eingebucht/i)).toBeVisible({ timeout: 5_000 })

    await page.locator('input[type="password"]').fill('TestPass!2026')
    const bd = new Date(); bd.setFullYear(bd.getFullYear() - 30)
    await page.locator('input[type="date"]').fill(bd.toISOString().split('T')[0])
    await page.getByRole('button', { name: /konto erstellen.*loslegen/i }).click()

    await page.waitForURL(/\/rechtliches/, { timeout: 30_000 })
    await page.waitForTimeout(2_000) // Enrollment/Buchungen laufen nach signUp asynchron

    const db = await getAdminClient()
    newUserId = (await getUserIdByEmail(EMAIL))!
    expect(newUserId, 'Profil/User wurde angelegt').toBeTruthy()

    // KERN: Enrollment angelegt
    const { data: enr } = await db.from('enrollments').select('id').eq('user_id', newUserId).eq('course_id', courseId)
    expect((enr || []).length, 'Yogi ist im Kurs eingeschrieben').toBe(1)

    // Credit (model=course, total=4) angelegt
    const { data: crd } = await db.from('credits').select('total, model').eq('user_id', newUserId).eq('course_id', courseId).maybeSingle()
    expect(crd, 'Kurs-Credit angelegt').toBeTruthy()
    expect(crd?.model).toBe('course')
    expect(crd?.total).toBe(4)

    // KERN: aktive Buchungen für ALLE 4 zukünftigen Stunden (das ging beim Live-Bug verloren)
    const { data: bks } = await db.from('bookings').select('id, status, type, session_id')
      .eq('user_id', newUserId).in('session_id', sessionIds)
    const active = (bks || []).filter(b => b.status === 'active')
    expect(active.length, 'Yogi ist in alle 4 Kursstunden eingebucht').toBe(4)
    expect(active.every(b => b.type === 'course'), 'Buchungen sind vom Typ course').toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Gap #2: Neue AGB-Version → bestehender Yogi wird beim /profil-Aufruf
//   zur Re-Akzeptanz nach /rechtliches umgeleitet.
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Coverage: AGB-Re-Akzeptanz → Redirect', () => {
  // Frischer Login statt gespeichertem storageState: spät im Suite-Lauf ist die
  // yogi1-Session sonst evtl. abgelaufen → /profil würde auf /login statt
  // /rechtliches leiten (Flake). Frischer Login garantiert eine gültige Session.
  test.use({ storageState: { cookies: [], origins: [] } })

  let yogi1Id: string
  let originalAgbVersion: number | null = null

  test.beforeAll(async () => { yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))! })

  test('[E2E] agb_version < aktuelle Version → /profil leitet zu /rechtliches um', async ({ page }) => {
    const s = svc()
    // Aktuelle AGB-Version (höchste sort_order) ermitteln + Originalwert sichern
    const { data: agb } = await s.from('agb_versions').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle()
    const currentOrder = agb?.sort_order ?? 1
    const { data: prof } = await s.from('profiles').select('agb_version').eq('id', yogi1Id).maybeSingle()
    originalAgbVersion = (prof?.agb_version ?? null) as number | null
    try {
      // 1) Frisch einloggen (AGB noch aktuell → Login klappt, keine Umleitung)
      const login = new LoginPage(page)
      await login.goto()
      await login.login(process.env.TEST_YOGI1_EMAIL!, process.env.TEST_YOGI1_PASSWORD!)
      // 2) AGB künstlich "veralten"
      await s.from('profiles').update({ agb_version: currentOrder - 1 }).eq('id', yogi1Id)
      // 3) /profil → Konsequenz: Redirect auf /rechtliches (Re-Akzeptanz erzwungen)
      await page.goto('/profil')
      await page.waitForURL(/\/rechtliches/, { timeout: 15_000 })
      await expect(page).toHaveURL(/\/rechtliches/)
    } finally {
      // Originalzustand robust wiederherstellen — sonst bliebe yogi1 für andere Tests "gesperrt"
      await s.from('profiles').update({ agb_version: originalAgbVersion ?? currentOrder }).eq('id', yogi1Id)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Gap #9: Profil-Benachrichtigungseinstellung umschalten → persistiert in der DB
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Coverage: Profil-Benachrichtigungen speichern', () => {
  // Frischer Login (siehe AGB-Test oben) — vermeidet abgelaufene Session spät im Lauf.
  test.use({ storageState: { cookies: [], origins: [] } })

  let yogi1Id: string
  let original: boolean | null = null

  test.beforeAll(async () => { yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))! })

  test('[E2E] Toggle "Bestätigungen meiner Buchungen" → profiles.notify_booking_confirmations gespeichert', async ({ page }) => {
    const s = svc()
    const { data: before } = await s.from('profiles').select('notify_booking_confirmations').eq('id', yogi1Id).maybeSingle()
    // App-Default-Anzeige: !== false (null/true → checked)
    const shownChecked = before?.notify_booking_confirmations !== false
    original = (before?.notify_booking_confirmations ?? null) as boolean | null
    try {
      const login = new LoginPage(page)
      await login.goto()
      await login.login(process.env.TEST_YOGI1_EMAIL!, process.env.TEST_YOGI1_PASSWORD!)

      await page.goto('/profil')
      await page.waitForLoadState('networkidle')

      const toggle = page.locator('label', { hasText: 'Bestätigungen meiner Buchungen' }).locator('input[type="checkbox"]')
      await expect(toggle).toBeVisible({ timeout: 15_000 })
      await toggle.click()

      // Konsequenz: DB-Wert ist nun das Gegenteil des angezeigten Zustands
      const expected = !shownChecked
      await expect.poll(async () => {
        const { data } = await s.from('profiles').select('notify_booking_confirmations').eq('id', yogi1Id).maybeSingle()
        return data?.notify_booking_confirmations
      }, { timeout: 10_000 }).toBe(expected)
    } finally {
      await s.from('profiles').update({ notify_booking_confirmations: original }).eq('id', yogi1Id)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Gap #5: Admin-Dashboard-Kacheln zählen die Buchungen DIESER Woche (funktional).
//   Ergänzt den Source-Guard aus 56-live-bugfixes (weekSessionIds-Roll-up) um
//   eine echte UI-Wert-Prüfung.
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Coverage: Dashboard-Kacheln Wochen-Buchungen', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let yogi1Id: string
  let yogi2Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
  })
  test.afterAll(async () => { await resetYogi(yogi1Id); await resetYogi(yogi2Id) })

  test('[E2E] 2 Buchungen in einer Stunde DIESER Woche → Kachel "Buchungen" ≥ 2', async ({ page }) => {
    const db = await getAdminClient()
    await resetYogi(yogi1Id); await resetYogi(yogi2Id)

    // Stunde auf HEUTE legen (immer in der aktuellen Dashboard-Woche)
    const today = berlinToday()
    const course = await createTestCourse({ name: `${E2E_PREFIX} Dashboard-Woche`, sessionCount: 1, startDaysFromNow: 7, maxSpots: 5 })
    const sessionId = course.sessionIds[0]
    await db.from('sessions').update({ date: today, time_start: '23:30:00' }).eq('id', sessionId)
    await db.from('courses').update({ date_start: today, date_end: today }).eq('id', course.courseId)

    await db.from('bookings').insert([
      { user_id: yogi1Id, session_id: sessionId, credit_id: null, type: 'single', status: 'active' },
      { user_id: yogi2Id, session_id: sessionId, credit_id: null, type: 'single', status: 'active' },
    ])

    await page.goto('/admin/dashboard')
    await page.waitForLoadState('networkidle')

    // Die 3 Wochen-Kacheln rendern
    const grid = page.locator('.grid-cols-3').first()
    await expect(grid.getByText('Buchungen')).toBeVisible({ timeout: 15_000 })
    await expect(grid.getByText('Abmeldungen')).toBeVisible()
    await expect(grid.getByText('Warteliste')).toBeVisible()

    // Funktional: Kachel "Buchungen" zeigt mind. die 2 frisch gebuchten Stunden dieser Woche
    const buchungenTile = grid.locator('button', { hasText: 'Buchungen' })
    await expect.poll(async () => {
      const txt = (await buchungenTile.locator('.text-2xl').innerText().catch(() => '0')).trim()
      const n = parseInt(txt.replace(/[^\d]/g, ''), 10)
      return Number.isNaN(n) ? -1 : n
    }, { timeout: 12_000 }).toBeGreaterThanOrEqual(2)
  })
})
