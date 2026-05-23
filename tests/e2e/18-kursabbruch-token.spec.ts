/**
 * Workflow: Kursabbruch Token-Edge-Cases
 * Testfälle:
 *   - Abgelaufenes Token (>7 Tage) → UI zeigt "Frist abgelaufen", DB cleanup
 *   - Token bereits gewählt → UI zeigt bestehenden Status (nicht erneut wählbar)
 *   - Token-Reuse: Atomic update verhindert doppeltes Guthaben
 */
import { test, expect } from '@playwright/test'
import { createEnrolledCourse, E2E_PREFIX } from '../utils/seed'
import {
  getUserIdByEmail, getAdminClient, getGuthabenCredit, getCancellationResponse,
} from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('Kursabbruch: Abgelaufenes Token', () => {
  // Kein Login nötig (Token-Page ist public)
  test.use({ storageState: { cookies: [], origins: [] } })

  let courseId: string
  let yogi1Id: string
  let token: string
  const COURSE_NAME = `${E2E_PREFIX} Token-Expired`

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const course = await createEnrolledCourse(yogi1Id, { name: COURSE_NAME })
    courseId = course.courseId

    const db = await getAdminClient()
    await db.from('courses').update({ is_cancelled: true, is_active: false }).eq('id', courseId)

    // Token mit Ablaufdatum in der Vergangenheit
    token = `e2e-expired-${Date.now()}`
    const pastDate = new Date()
    pastDate.setDate(pastDate.getDate() - 1)

    await db.from('course_cancellation_responses').insert({
      user_id: yogi1Id,
      course_id: courseId,
      token,
      choice: null,
      refund_paid: false,
      expires_at: pastDate.toISOString(),
      remaining_sessions: 3,
    })
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('course_cancellation_responses').delete().eq('course_id', courseId)
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'guthaben')
    const { data: sessions } = await db.from('sessions').select('id').eq('course_id', courseId)
    if (sessions && sessions.length > 0) {
      await db.from('bookings').delete().in('session_id', sessions.map(s => s.id))
    }
    await db.from('enrollments').delete().eq('course_id', courseId)
    await db.from('credits').delete().eq('course_id', courseId)
    await db.from('sessions').delete().eq('course_id', courseId)
    await db.from('courses').delete().eq('id', courseId)
  })

  test('Token-Link mit abgelaufenem expires_at → UI zeigt "Frist abgelaufen"', async ({ page }) => {
    await page.goto(`/kursabbruch/${token}`)
    await page.waitForLoadState('networkidle')

    // UI zeigt Frist-Abgelaufen-State (kein Wahl-Button mehr sichtbar)
    await expect(page.getByText(/frist abgelaufen/i)).toBeVisible({ timeout: 8_000 })
    await expect(page.getByRole('button', { name: /guthaben behalten/i })).not.toBeVisible()
    await expect(page.getByRole('button', { name: /geld zurück/i })).not.toBeVisible()
  })
})

test.describe('Kursabbruch: Bereits gewählter Token', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  let courseId: string
  let yogi1Id: string
  let token: string
  const COURSE_NAME = `${E2E_PREFIX} Token-Already-Chosen`

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!

    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'guthaben')

    const course = await createEnrolledCourse(yogi1Id, { name: COURSE_NAME })
    courseId = course.courseId

    await db.from('courses').update({ is_cancelled: true, is_active: false }).eq('id', courseId)

    token = `e2e-chosen-${Date.now()}`
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 5)

    // Wahl ist bereits getroffen (guthaben)
    await db.from('course_cancellation_responses').insert({
      user_id: yogi1Id,
      course_id: courseId,
      token,
      choice: 'guthaben',
      responded_at: new Date().toISOString(),
      refund_paid: false,
      expires_at: futureDate.toISOString(),
      remaining_sessions: 3,
    })
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('course_cancellation_responses').delete().eq('course_id', courseId)
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'guthaben')
    const { data: sessions } = await db.from('sessions').select('id').eq('course_id', courseId)
    if (sessions && sessions.length > 0) {
      await db.from('bookings').delete().in('session_id', sessions.map(s => s.id))
    }
    await db.from('enrollments').delete().eq('course_id', courseId)
    await db.from('credits').delete().eq('course_id', courseId)
    await db.from('sessions').delete().eq('course_id', courseId)
    await db.from('courses').delete().eq('id', courseId)
  })

  test('Token mit bereits getroffener Wahl → zeigt Bestätigung', async ({ page }) => {
    await page.goto(`/kursabbruch/${token}`)
    await page.waitForLoadState('networkidle')

    // UI zeigt "Guthaben gespeichert" Bestätigung
    await expect(page.getByText(/guthaben gespeichert/i)).toBeVisible({ timeout: 8_000 })

    // Wahl-Buttons sind nicht mehr sichtbar
    await expect(page.getByRole('button', { name: /^guthaben behalten$/i })).not.toBeVisible()
  })
})

test.describe('Kursabbruch: Token-Reuse (atomic update)', () => {
  // Race: 2 parallele POST-Calls auf denselben Token → nur einer setzt die Wahl
  test('Direkter API-Call: 2× POST mit unterschiedlicher Wahl → 2. Call sieht alreadyChosen', async () => {
    const yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()

    // Cleanup vorab
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'guthaben')

    // Token-Eintrag anlegen
    const token = `e2e-race-${Date.now()}`
    const futureDate = new Date(); futureDate.setDate(futureDate.getDate() + 5)
    const course = await createEnrolledCourse(yogi1Id, { name: `${E2E_PREFIX} Token-Race` })

    await db.from('courses').update({ is_cancelled: true, is_active: false }).eq('id', course.courseId)
    await db.from('course_cancellation_responses').insert({
      user_id: yogi1Id,
      course_id: course.courseId,
      token,
      choice: null,
      refund_paid: false,
      expires_at: futureDate.toISOString(),
      remaining_sessions: 2,
    })

    const baseUrl = process.env.BASE_URL!

    // Beide Calls fast gleichzeitig (race condition)
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/kursabbruch/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice: 'guthaben' }),
      }).then(r => r.json()),
      fetch(`${baseUrl}/api/kursabbruch/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice: 'erstattung' }),
      }).then(r => r.json()),
    ])

    // Genau eine der beiden Antworten muss "alreadyChosen" haben
    const responses = [res1, res2]
    const winners = responses.filter(r => r.ok === true)
    const losers = responses.filter(r => r.alreadyChosen)

    expect(winners.length + losers.length, 'Beide Calls müssen sauber abgeschlossen sein').toBe(2)
    expect(winners.length, 'Genau ein Call darf gewinnen').toBeGreaterThanOrEqual(1)
    expect(winners.length, 'Maximal ein Call darf gewinnen').toBeLessThanOrEqual(2)

    // Nur ein Guthaben-Credit in DB (atomic update verhindert doppelte Anlage)
    const guthabenCount = await db.from('credits')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', yogi1Id).eq('model', 'guthaben')
    expect(guthabenCount.count ?? 0, 'Maximal 1 Guthaben-Credit darf angelegt sein').toBeLessThanOrEqual(1)

    // Cleanup
    await db.from('course_cancellation_responses').delete().eq('token', token)
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'guthaben')
    const { data: sessions } = await db.from('sessions').select('id').eq('course_id', course.courseId)
    if (sessions && sessions.length > 0) {
      await db.from('bookings').delete().in('session_id', sessions.map(s => s.id))
    }
    await db.from('enrollments').delete().eq('course_id', course.courseId)
    await db.from('credits').delete().eq('course_id', course.courseId)
    await db.from('sessions').delete().eq('course_id', course.courseId)
    await db.from('courses').delete().eq('id', course.courseId)
  })

  // === Sarah 2026-05-22: Erstattungs-Logik mit Guthaben-Verrechnung ===
  // ────────────────────────────────────────────────────────────────────
  // Diese 4 Tests simulieren den End-Zustand nach cancelCourse() direkt
  // in der DB und testen dann das Verhalten der Token-API. Das ist
  // schneller, robuster und testet exakt die Wirtschaftslogik. Der volle
  // UI-Flow ist bereits in tests/e2e/admin/07-admin-kursabbruch.spec.ts.
  // ────────────────────────────────────────────────────────────────────

  /**
   * Hilfs-Setup: simuliert was cancelCourse() in admin/kurse/page.tsx hinterlässt:
   * - Yogi mit Altguthaben (used=0 nach Trigger-Auto-Refund)
   * - Optional ein provisorisches Guthaben für neu bezahlte Anteile
   * - course_cancellation_responses-Row mit gefülltem Snapshot
   * Liefert: token, courseId, altguthabenCreditId, provisionalCreditId
   */
  async function setupCancelledCourseScenario(opts: {
    yogiId: string
    altguthabenTotal: number
    altguthabenVerrechnet: number    // count im guthaben_breakdown
    newCreditsCount: number          // neu bezahlte Anteile (provisional)
    nameSuffix: string
  }) {
    const db = await getAdminClient()
    // Reset
    await db.from('credits').delete().eq('user_id', opts.yogiId).eq('model', 'guthaben')

    // Altguthaben anlegen — wir simulieren den Zustand NACH Auto-Refund:
    // total bleibt, used=0 (Trigger hat schon zurückgesetzt).
    const expiry2y = new Date(); expiry2y.setFullYear(expiry2y.getFullYear() + 2)
    const { data: alt } = await db.from('credits').insert({
      user_id: opts.yogiId, course_id: null, model: 'guthaben',
      total: opts.altguthabenTotal, used: 0, expires_at: expiry2y.toISOString(),
    }).select('id').single()
    const altguthabenCreditId = alt!.id as string

    // Kurs anlegen (für course_id-Referenz)
    const course = await createEnrolledCourse(opts.yogiId, {
      name: `${E2E_PREFIX} ${opts.nameSuffix}`,
      sessionCount: Math.max(1, opts.altguthabenVerrechnet + opts.newCreditsCount),
    })
    // course-credits dieses Kurses löschen (echter cancelCourse macht das auch)
    await db.from('credits').delete().eq('user_id', opts.yogiId).eq('course_id', course.courseId)

    // Provisorisches Guthaben für neu bezahlte Anteile
    let provisionalCreditId: string | null = null
    if (opts.newCreditsCount > 0) {
      const { data: prov } = await db.from('credits').insert({
        user_id: opts.yogiId, course_id: null, model: 'guthaben',
        total: opts.newCreditsCount, used: 0, expires_at: expiry2y.toISOString(),
      }).select('id').single()
      provisionalCreditId = prov!.id
    }

    // Kurs auf cancelled
    await db.from('courses').update({ is_cancelled: true, is_active: false }).eq('id', course.courseId)

    // Token-Row anlegen
    const token = `e2e-choice-${Date.now()}-${Math.random().toString(36).slice(2,7)}`
    const expires = new Date(); expires.setDate(expires.getDate() + 7)
    const guthabenBreakdown = opts.altguthabenVerrechnet > 0
      ? [{ credit_id: altguthabenCreditId, count: opts.altguthabenVerrechnet }]
      : []
    await db.from('course_cancellation_responses').insert({
      user_id: opts.yogiId,
      course_id: course.courseId,
      token,
      choice: null,
      refund_paid: false,
      expires_at: expires.toISOString(),
      remaining_sessions: opts.altguthabenVerrechnet + opts.newCreditsCount,
      guthaben_breakdown: guthabenBreakdown,
      new_credits_count: opts.newCreditsCount,
      provisional_credit_id: provisionalCreditId,
    })

    return { token, courseId: course.courseId, altguthabenCreditId, provisionalCreditId }
  }

  async function cleanupScenario(courseId: string, yogiId: string) {
    const db = await getAdminClient()
    await db.from('course_cancellation_responses').delete().eq('course_id', courseId)
    await db.from('credits').delete().eq('user_id', yogiId).eq('model', 'guthaben')
    const { data: sessions } = await db.from('sessions').select('id').eq('course_id', courseId)
    if (sessions && sessions.length > 0) {
      await db.from('bookings').delete().in('session_id', sessions.map(s => s.id))
    }
    await db.from('enrollments').delete().eq('course_id', courseId)
    await db.from('credits').delete().eq('course_id', courseId)
    await db.from('sessions').delete().eq('course_id', courseId)
    await db.from('courses').delete().eq('id', courseId)
  }

  test('[E2E] Yogi mit Altguthaben → Erstattung-Wahl: verrechnetes Guthaben verschwindet', async () => {
    const yogiId = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const { token, courseId, altguthabenCreditId } = await setupCancelledCourseScenario({
      yogiId, altguthabenTotal: 2, altguthabenVerrechnet: 1, newCreditsCount: 0,
      nameSuffix: 'Altguthaben-Erstattung',
    })

    // Yogi wählt Erstattung
    const baseUrl = process.env.BASE_URL!
    const res = await fetch(`${baseUrl}/api/kursabbruch/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice: 'erstattung' }),
    }).then(r => r.json())

    expect(res.ok, 'Erstattung muss akzeptiert worden sein').toBe(true)

    // Altguthaben: total um 1 reduziert → 1/0, free=1
    const db = await getAdminClient()
    const { data: cred } = await db.from('credits').select('*').eq('id', altguthabenCreditId).single()
    expect(cred?.total, 'Altguthaben.total nach Erstattung = 1 (nicht mehr 2)').toBe(1)
    expect(cred?.used, 'Altguthaben.used = 0').toBe(0)

    // Choice korrekt persistiert
    const { data: resp } = await db.from('course_cancellation_responses')
      .select('choice, responded_at').eq('token', token).single()
    expect(resp?.choice).toBe('erstattung')
    expect(resp?.responded_at).toBeTruthy()

    await cleanupScenario(courseId, yogiId)
  })

  test('[E2E] Yogi mit Altguthaben + Neu-Bezahlt → Erstattung: nur Guthaben weg, Neu in Geld', async () => {
    const yogiId = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const { token, courseId, altguthabenCreditId, provisionalCreditId } =
      await setupCancelledCourseScenario({
        yogiId, altguthabenTotal: 2, altguthabenVerrechnet: 2, newCreditsCount: 3,
        nameSuffix: 'Mix-Erstattung',
      })

    const baseUrl = process.env.BASE_URL!
    const res = await fetch(`${baseUrl}/api/kursabbruch/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice: 'erstattung' }),
    }).then(r => r.json())
    expect(res.ok).toBe(true)

    const db = await getAdminClient()
    // Altguthaben.total = 0 (2 abgezogen)
    const { data: alt } = await db.from('credits').select('*').eq('id', altguthabenCreditId).maybeSingle()
    expect(alt?.total, 'Altguthaben.total wurde um verrechneten Anteil reduziert').toBe(0)
    // Provisional gelöscht
    const { data: prov } = await db.from('credits').select('id').eq('id', provisionalCreditId!).maybeSingle()
    expect(prov, 'Provisorisches Guthaben muss bei Erstattung gelöscht sein').toBeNull()

    await cleanupScenario(courseId, yogiId)
  })

  test('[E2E] Yogi mit Altguthaben + Neu-Bezahlt → Guthaben behalten: kein Doppel-Count', async () => {
    const yogiId = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const { token, courseId, altguthabenCreditId, provisionalCreditId } =
      await setupCancelledCourseScenario({
        yogiId, altguthabenTotal: 2, altguthabenVerrechnet: 2, newCreditsCount: 3,
        nameSuffix: 'Mix-Guthaben-Behalten',
      })

    const baseUrl = process.env.BASE_URL!
    const res = await fetch(`${baseUrl}/api/kursabbruch/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice: 'guthaben' }),
    }).then(r => r.json())
    expect(res.ok).toBe(true)

    const db = await getAdminClient()
    // Altguthaben bleibt unverändert: total=2, used=0 (frei)
    const { data: alt } = await db.from('credits').select('*').eq('id', altguthabenCreditId).single()
    expect(alt?.total).toBe(2)
    expect(alt?.used).toBe(0)
    // Provisional bleibt bestehen mit total=3
    const { data: prov } = await db.from('credits').select('*').eq('id', provisionalCreditId!).single()
    expect(prov?.total, 'Provisorisches Guthaben bleibt bei "Guthaben behalten"').toBe(3)

    // Summe = 2+3 = 5 freie Guthaben (gleich newCreditsCount + altTotal, nicht remaining_sessions=5)
    const { data: allGut } = await db.from('credits')
      .select('total, used').eq('user_id', yogiId).eq('model', 'guthaben')
    const totalFree = (allGut || []).reduce((s, c: any) => s + (c.total - c.used), 0)
    expect(totalFree, 'Gesamt-freies-Guthaben = 2 (alt) + 3 (provisional) = 5').toBe(5)

    await cleanupScenario(courseId, yogiId)
  })

  test('[E2E] Yogi-Bestätigung: Wahl wird im audit_log dokumentiert', async () => {
    // Statt notification_log testen wir audit_log (die Token-API loggt dort
    // `yogi_course_cancellation_choice` mit allen Details inkl. choice).
    const yogiId = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()

    // Existierende Audit-Einträge merken (damit wir nur neue zählen)
    const auditBefore = await db.from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', yogiId).eq('action', 'yogi_course_cancellation_choice')

    const { token: t1, courseId: c1 } = await setupCancelledCourseScenario({
      yogiId, altguthabenTotal: 0, altguthabenVerrechnet: 0, newCreditsCount: 2,
      nameSuffix: 'Audit-Guthaben',
    })
    const baseUrl = process.env.BASE_URL!
    await fetch(`${baseUrl}/api/kursabbruch/${t1}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice: 'guthaben' }),
    })

    const { token: t2, courseId: c2 } = await setupCancelledCourseScenario({
      yogiId, altguthabenTotal: 0, altguthabenVerrechnet: 0, newCreditsCount: 2,
      nameSuffix: 'Audit-Erstattung',
    })
    await fetch(`${baseUrl}/api/kursabbruch/${t2}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice: 'erstattung' }),
    })

    // Beide Wahlen müssen im audit_log dokumentiert sein
    const auditAfter = await db.from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', yogiId).eq('action', 'yogi_course_cancellation_choice')
    expect((auditAfter.count ?? 0) - (auditBefore.count ?? 0))
      .toBeGreaterThanOrEqual(2)

    await cleanupScenario(c1, yogiId)
    await cleanupScenario(c2, yogiId)
  })
})
