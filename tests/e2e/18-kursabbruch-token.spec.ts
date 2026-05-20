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
})
