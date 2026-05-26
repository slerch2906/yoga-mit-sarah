// Welle 5 Refactor (Sarah 2026-05-26): zusätzliche semantische Assertions
/**
 * Workflow: Gleichzeitige Buchung des letzten Platzes
 * Testfälle:
 *   - Stunde mit max_spots=1, Yogi1 ist schon gebucht → Yogi2 sieht "Ausgebucht"
 *   - Yogi2 kann sich nicht eintragen, nur auf Warteliste
 *   - Direkter DB-Insert über RLS müsste max_spots NICHT überschreiten
 *     (Hinweis: max_spots wird via Trigger/Logik geprüft – Test deckt UI + DB-Verhalten)
 */
import { test, expect } from '@playwright/test'
import { SessionDetailPage } from '../page-objects/SessionDetailPage'
import { createTestCourse, giveYogiSingleCredit, E2E_PREFIX } from '../utils/seed'
import {
  getUserIdByEmail, getAdminClient, countActiveBookingsForSession,
} from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })
dotenv.config({ path: '.env.local' }) // für NEXT_PUBLIC_* Keys (anon)

let sessionId: string
let courseId: string
let yogi1Id: string
let yogi2Id: string

test.beforeAll(async () => {
  yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!

  const db = await getAdminClient()
  await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')
  await db.from('credits').delete().eq('user_id', yogi2Id).eq('model', 'single')

  // Kurs mit max_spots=1, in 10 Tagen
  const course = await createTestCourse({
    name: `${E2E_PREFIX} Concurrent-Test`,
    maxSpots: 1,
    sessionCount: 1,
    startDaysFromNow: 10,
  })
  courseId = course.courseId
  sessionId = course.sessionIds[0]

  // Beide Yogis bekommen Credits
  await giveYogiSingleCredit(yogi1Id, 2)
  await giveYogiSingleCredit(yogi2Id, 2)

  // Yogi1 schon eingebucht (simuliert dass Yogi1 den letzten Platz "zuerst" bekam)
  const yogi1Credit = await db.from('credits')
    .select('*').eq('user_id', yogi1Id).eq('model', 'single')
    .order('created_at', { ascending: false }).limit(1).single()
  await db.from('bookings').insert({
    user_id: yogi1Id,
    session_id: sessionId,
    credit_id: yogi1Credit.data!.id,
    type: 'single',
    status: 'active',
  })
  await db.from('credits').update({ used: 1 }).eq('id', yogi1Credit.data!.id)
})

test.afterAll(async () => {
  const db = await getAdminClient()
  await db.from('bookings').delete().eq('session_id', sessionId)
  await db.from('waitlist').delete().eq('session_id', sessionId)
  await db.from('sessions').delete().eq('id', sessionId)
  await db.from('courses').delete().eq('id', courseId)
  await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')
  await db.from('credits').delete().eq('user_id', yogi2Id).eq('model', 'single')
})

test.describe('Concurrent Booking: Letzter Platz', () => {
  test.use({ storageState: 'tests/.auth/yogi2.json' })

  test('Yogi2 sieht "Ausgebucht" und keinen Buchungs-Button', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(sessionId)

    // Ausgebucht-Badge
    await sessionPage.expectFullMessage()

    // Kein Buchungs-Button sichtbar
    await sessionPage.expectNoBookButton()
    // Welle 5: konkret das Wort "ausgebucht" oder "voll" muss sichtbar sein
    await expect(
      page.getByText(/ausgebucht|voll besetzt|kein platz|0\s*\/\s*\d+|warteliste/i).first()
    ).toBeVisible()
    // Kursname noch im UI sichtbar (kein Crash-Zustand)
    await expect(page.locator('body')).toContainText(/Concurrent-Test/i)
  })

  test('Yogi2 kann auf Warteliste, aber NICHT direkt buchen', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(sessionId)

    // Warteliste-Button verfügbar
    await expect(
      page.getByRole('button', { name: /warteliste/i }).first()
    ).toBeVisible({ timeout: 8_000 })

    // Aktive Buchungen unverändert (genau 1)
    const count = await countActiveBookingsForSession(sessionId)
    expect(count, 'max_spots=1 darf nicht überschritten werden').toBe(1)
    // Welle 5: explizit kein direkter "Buchen"-Button für Yogi2
    await expect(
      page.getByRole('button', { name: /^für diese stunde eintragen$|^buchen$/i })
    ).toHaveCount(0)
  })

  test('RLS: Direkter DB-Insert für überbuchte Stunde liefert keine Überschreitung', async () => {
    // Direkter Versuch via Yogi2-Token: zweite Buchung anlegen
    const { createClient } = await import('@supabase/supabase-js')
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    await client.auth.signInWithPassword({
      email: process.env.TEST_YOGI2_EMAIL!,
      password: process.env.TEST_YOGI2_PASSWORD!,
    })

    const db = await getAdminClient()
    const yogi2Credit = await db.from('credits')
      .select('*').eq('user_id', yogi2Id).eq('model', 'single')
      .order('created_at', { ascending: false }).limit(1).single()

    // Versuch: Buchung als Yogi2 einfügen
    const { error } = await client.from('bookings').insert({
      user_id: yogi2Id,
      session_id: sessionId,
      credit_id: yogi2Credit.data!.id,
      type: 'single',
      status: 'active',
    })

    // Erwartung: Entweder DB-Trigger blockiert (Fehler), oder es wird eine Buchung mehr,
    // aber die UI/Logik muss den Überlauf verhindern. Wir prüfen Endergebnis:
    const count = await countActiveBookingsForSession(sessionId)

    if (!error) {
      // Wenn kein DB-Schutz greift, muss die UI das vorher abfangen
      // → Dokumentiert: Race Condition ist auf UI-Level beschränkt
      console.warn(`⚠️ Direkter DB-Insert hat ${count} aktive Buchungen erzeugt (max_spots=1) – UI-Schutz ist die einzige Barriere.`)
    }

    // Aktive Buchungen dürfen die max_spots nicht überschreiten
    // Falls dieser Test fehlschlägt: DB-Trigger oder unique-Constraint hinzufügen!
    expect(
      count,
      `KRITISCH: max_spots=1 darf nicht überschritten werden, aktuell: ${count}`,
    ).toBeLessThanOrEqual(1)
  })
})
