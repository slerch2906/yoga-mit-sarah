/**
 * Sarah-Bug (2026-08-21): Auf der Warteliste standen zwei Yogis auf derselben
 * Nummer (beide "#2"), Platz 1 existierte gar nicht mehr.
 *
 * Ursache: waitlist.position wurde beim Anstellen EINMAL fest gesetzt
 * (COUNT(*)+1) und danach nie wieder nachgezogen. Sechs verschiedene Stellen
 * entfernen Eintraege aus der Warteliste (Nachruecken, Selbst-Austragen,
 * Absage-Verarbeitung, Cleanup-Jobs, Konto-Loeschung) — keine davon nummeriert
 * neu durch. Dadurch entstehen Luecken, und der naechste Beitritt bekommt eine
 * bereits vergebene Nummer.
 *
 * Fix (Sarah-Entscheidung Variante A): Position wird nicht mehr gespeichert
 * ausgewertet, sondern immer live aus der Anstell-Reihenfolge berechnet —
 * per DB-Funktion my_waitlist_positions() bzw. im Admin aus der nach
 * created_at sortierten Liste.
 *
 * Testfaelle:
 *   - Reproduktion des exakten Szenarios: 2 stellen sich an, der Erste rueckt
 *     nach, ein Dritter stellt sich an → Positionen muessen 1 und 2 sein,
 *     KEINE Dopplung (vor dem Fix: 2 und 2).
 *   - Die gespeicherte Spalte darf veraltet sein, ohne die Anzeige zu stoeren.
 *   - Yogi-Ansicht /warteliste zeigt die live berechnete Position.
 */
import { test, expect } from '@playwright/test'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { getServiceClient, getUserIdByEmail } from '../utils/db'
import { createTestCourse, E2E_PREFIX } from '../utils/seed'

dotenv.config({ path: '.env.test' })

const URL = process.env.SUPABASE_URL!
const ANON = process.env.SUPABASE_ANON_KEY!

function svc() { return getServiceClient() }

/** Authentifizierter Client — noetig, weil join_waitlist/my_waitlist_positions auth.uid() nutzen. */
async function makeAuthedClient(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Sign-in fehlgeschlagen (${email}): ${error.message}`)
  return c
}

test.describe('[E2E] Wartelisten-Position wird live berechnet', () => {
  // Browser-Session: yogi2 — er ist der, der von Platz 2 auf 1 nachruecken muss.
  // Der erste Test nutzt eigene, per Passwort angemeldete Clients und ist davon
  // unberuehrt.
  test.use({ storageState: 'tests/.auth/yogi2.json' })

  let courseId: string
  let sessionId: string
  let yogi1Id: string
  let yogi2Id: string
  let adminId: string

  test.beforeAll(async () => {
    const db = svc()
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
    adminId = (await getUserIdByEmail(process.env.TEST_ADMIN_EMAIL!))!

    const course = await createTestCourse({
      name: `${E2E_PREFIX} Warteliste-Position-Live`, sessionCount: 1, startDaysFromNow: 30, maxSpots: 1,
    })
    courseId = course.courseId
    sessionId = course.sessionIds[0]

    // Saubere Ausgangslage
    await db.from('waitlist').delete().eq('session_id', sessionId)
  })

  test.afterAll(async () => {
    const db = svc()
    await db.from('waitlist').delete().eq('session_id', sessionId)
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('audit_log').delete().eq('action', 'waitlist_joined')
      .eq('details->>session_id', sessionId)
    await db.from('sessions').delete().eq('course_id', courseId)
    await db.from('courses').delete().eq('id', courseId)
  })

  test('Nach Nachruecken bleiben die Nummern lueckenlos und eindeutig', async () => {
    const db = svc()

    // 1) Yogi1 und Yogi2 stellen sich an (echte RPC, wie in der App)
    const c1 = await makeAuthedClient(process.env.TEST_YOGI1_EMAIL!, process.env.TEST_YOGI1_PASSWORD!)
    const c2 = await makeAuthedClient(process.env.TEST_YOGI2_EMAIL!, process.env.TEST_YOGI2_PASSWORD!)
    const { data: r1 } = await c1.rpc('join_waitlist', { p_session_id: sessionId, p_type: 'waitlist' })
    const { data: r2 } = await c2.rpc('join_waitlist', { p_session_id: sessionId, p_type: 'waitlist' })
    expect(r1?.position, 'Erster Beitritt bekommt Platz 1').toBe(1)
    expect(r2?.position, 'Zweiter Beitritt bekommt Platz 2').toBe(2)

    // 2) Yogi1 rueckt nach → sein Wartelisten-Eintrag verschwindet
    await db.from('waitlist').delete().eq('session_id', sessionId).eq('user_id', yogi1Id)

    // 3) Ein Dritter stellt sich an. VOR dem Fix bekam er die bereits vergebene
    //    Nummer 2 (COUNT(*)+1 bei einer Luecke) → zwei Yogis auf Platz 2.
    const c3 = await makeAuthedClient(process.env.TEST_ADMIN_EMAIL!, process.env.TEST_ADMIN_PASSWORD!)
    await c3.rpc('join_waitlist', { p_session_id: sessionId, p_type: 'waitlist' })

    // 4) KERN: live berechnete Positionen muessen 1 und 2 sein, ohne Dopplung.
    const { data: pos2 } = await c2.rpc('my_waitlist_positions')
    const { data: pos3 } = await c3.rpc('my_waitlist_positions')
    const p2 = (pos2 || []).find((p: any) => p.session_id === sessionId)
    const p3 = (pos3 || []).find((p: any) => p.session_id === sessionId)

    expect(p2?.live_position, 'Yogi2 muss von 2 auf 1 nachruecken').toBe(1)
    expect(p3?.live_position, 'Der Dritte muss Platz 2 bekommen').toBe(2)
    expect(p2?.live_position, 'Positionen duerfen sich nicht doppeln').not.toBe(p3?.live_position)

    // 5) Gegenprobe: die GESPEICHERTE Spalte ist bewusst veraltet — genau
    //    deshalb darf sie fuer die Anzeige nicht mehr verwendet werden.
    const { data: stored } = await db.from('waitlist')
      .select('user_id, position').eq('session_id', sessionId).eq('type', 'waitlist')
    const storedPositions = (stored || []).map((s: any) => s.position)
    expect(storedPositions.length, 'Zwei Eintraege auf der Warteliste').toBe(2)
    // Dokumentiert den urspruenglichen Fehler: gespeichert stehen beide auf 2.
    expect(new Set(storedPositions).size,
      'Gespeicherte Spalte enthaelt die Dopplung — Anzeige darf sie nicht nutzen').toBe(1)
  })

  test('Yogi sieht auf /warteliste die live berechnete Position', async ({ page }) => {
    // yogi2 stand gespeichert auf Platz 2; nachdem der Erste nachgerueckt ist,
    // muss ihm die App Platz 1 anzeigen.
    await page.goto('/warteliste')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Position 1')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Position 2')).toHaveCount(0)
  })
})

/**
 * Admin-Sicht: genau der Zustand, den Sarah gemeldet hat — zwei Eintraege mit
 * gespeicherter Nummer 2, Platz 1 verwaist. Die Anzeige muss trotzdem sauber
 * #1 und #2 zeigen, weil sie live aus der Anstell-Reihenfolge kommt.
 */
test.describe('[E2E] Admin-Dashboard zeigt saubere Wartelisten-Nummern', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  const COURSE_NAME = `${E2E_PREFIX} WL-Nummern-Admin`
  let courseId: string
  let sessionId: string

  test.beforeAll(async () => {
    const db = svc()
    const yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
    const adminId = (await getUserIdByEmail(process.env.TEST_ADMIN_EMAIL!))!

    // Stunde in DIESER Woche, damit sie im Dashboard-Wochenfenster auftaucht.
    const d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

    const { data: course } = await db.from('courses').insert({
      name: COURSE_NAME, weekday: 'Montag', time_start: '18:30', duration_min: 75,
      max_spots: 1, total_units: 1, date_start: dateStr, date_end: dateStr,
      is_active: true, is_single: false,
    }).select('id').single()
    courseId = course!.id

    const { data: sess } = await db.from('sessions').insert({
      course_id: courseId, date: dateStr, time_start: '18:30', duration_min: 75, is_cancelled: false,
    }).select('id').single()
    sessionId = sess!.id

    // Bewusst KAPUTTE gespeicherte Nummern (beide 2) — wie im gemeldeten Fehlerfall.
    const now = Date.now()
    await db.from('waitlist').insert([
      { user_id: yogi2Id, session_id: sessionId, type: 'waitlist', position: 2,
        created_at: new Date(now - 10 * 60_000).toISOString() },
      { user_id: adminId, session_id: sessionId, type: 'waitlist', position: 2,
        created_at: new Date(now - 5 * 60_000).toISOString() },
    ])
  })

  test.afterAll(async () => {
    const db = svc()
    await db.from('waitlist').delete().eq('session_id', sessionId)
    await db.from('sessions').delete().eq('course_id', courseId)
    await db.from('courses').delete().eq('id', courseId)
  })

  test('Zwei Eintraege mit gespeicherter Nummer 2 werden als #1 und #2 angezeigt', async ({ page }) => {
    await page.goto('/admin/dashboard')
    await page.waitForLoadState('networkidle')
    await page.getByText(COURSE_NAME).first().click()

    await expect(page.getByText('Auf der Warteliste (2)')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('#1', { exact: true })).toBeVisible()
    await expect(page.getByText('#2', { exact: true })).toBeVisible()
    // Der urspruengliche Fehler: zweimal dieselbe Nummer.
    await expect(page.getByText('#2', { exact: true })).toHaveCount(1)
  })
})
