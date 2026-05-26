// Welle 5 Refactor (Sarah 2026-05-26): zusätzliche semantische Assertions
/**
 * Workflow: Admin – Anwesenheit-Page (/admin/anwesenheit)
 * Testfälle:
 *   - Liste heutiger Sessions sichtbar (oder leere Liste)
 *   - Direktaufruf mit Session-ID zeigt Yogis + Absagen-Button
 *   - Stunde absagen via UI → Buchungen storniert, Credits zurück
 */
import { test, expect } from '@playwright/test'
import { createTestCourse, giveYogiSingleCredit, futureDateStr, E2E_PREFIX } from '../../utils/seed'
import {
  getUserIdByEmail, getAdminClient, getActiveBooking, getCancelledBooking, getSingleCredit,
} from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('Anwesenheit: Übersicht', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  test('GET /admin/anwesenheit zeigt Header und Heute-Liste oder Empty-State', async ({ page }) => {
    await page.goto('/admin/anwesenheit')
    await page.waitForLoadState('networkidle')

    // Header sichtbar
    await expect(page.getByRole('heading', { name: /anwesenheit/i }).first()).toBeVisible({ timeout: 8_000 })

    // Entweder Liste oder Empty-State – beide Texte können gleichzeitig im DOM sein
    // (Header "Heutige Stunden" + "Heute keine Stunden" als Empty-State). Wir prüfen
    // nur dass IRGENDEINER von beiden sichtbar ist via count().
    const hasContent = await page.getByText(/heutige stunden/i).count()
    const hasEmpty = await page.getByText(/heute keine stunden/i).count()
    expect(hasContent + hasEmpty, 'Page muss mind. eine Anzeige haben').toBeGreaterThan(0)
  })
})

test.describe('Anwesenheit: Session-spezifische Ansicht + Absagen-Flow', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let sessionId: string
  let courseId: string
  let yogi1Id: string
  let creditId: string | undefined

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()

    // Sauberer State
    await db.from('bookings').delete().eq('user_id', yogi1Id)
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')

    // Heutige Session anlegen
    const today = new Date().toISOString().split('T')[0]
    const inTwoHours = new Date(); inTwoHours.setHours(inTwoHours.getHours() + 2)
    const timeStr = inTwoHours.toTimeString().slice(0, 8)

    const { data: course } = await db.from('courses').insert({
      name: `${E2E_PREFIX} Anwesenheit-Test`,
      weekday: new Date().toLocaleDateString('de-DE', { weekday: 'long' }),
      time_start: timeStr,
      duration_min: 60,
      max_spots: 5,
      total_units: 1,
      date_start: today,
      date_end: today,
      is_active: true,
      is_single: true,
      is_open: true,
    }).select('id').single()
    courseId = course!.id

    const { data: sess } = await db.from('sessions').insert({
      course_id: courseId,
      date: today,
      time_start: timeStr,
      duration_min: 60,
      is_cancelled: false,
    }).select('id').single()
    sessionId = sess!.id

    creditId = await giveYogiSingleCredit(yogi1Id, 2)
    await db.from('bookings').insert({
      user_id: yogi1Id,
      session_id: sessionId,
      credit_id: creditId,
      type: 'single',
      status: 'active',
    })
    await db.from('credits').update({ used: 1 }).eq('id', creditId!)
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')
  })

  test('Anwesenheit?session=ID zeigt Yogi-Liste mit angemeldetem Yogi', async ({ page }) => {
    await page.goto(`/admin/anwesenheit?session=${sessionId}`)
    await page.waitForLoadState('networkidle')

    // Kursname sichtbar
    await expect(page.getByText(/anwesenheit-test/i).first()).toBeVisible({ timeout: 8_000 })

    // Angemeldete-Yogis Liste mit yogi1
    const yogiEmail = process.env.TEST_YOGI1_EMAIL!
    await expect(page.getByText(yogiEmail).first()).toBeVisible({ timeout: 5_000 })

    // Absagen-Button sichtbar
    await expect(page.getByRole('button', { name: /diese stunde absagen/i })).toBeVisible()
    // Welle 5: Yogi-Vorname/Nachname muss sichtbar sein (aus profiles)
    const db = await getAdminClient()
    const { data: prof } = await db.from('profiles')
      .select('first_name, last_name').eq('id', yogi1Id).maybeSingle()
    if (prof?.first_name) {
      await expect(page.locator('body')).toContainText(new RegExp(prof.first_name, 'i'))
    }
  })

  test('Stunde absagen via Anwesenheit-Page → Buchung storniert, Credit zurück', async ({ page }) => {
    // Credit-Stand vorher
    const creditBefore = await getSingleCredit(yogi1Id)
    expect(creditBefore?.used).toBe(1)

    await page.goto(`/admin/anwesenheit?session=${sessionId}`)
    await page.waitForLoadState('networkidle')

    // Confirm-Dialog akzeptieren
    page.on('dialog', d => d.accept())

    await page.getByRole('button', { name: /diese stunde absagen/i }).click()

    // Weiterleitung zu /admin/dashboard
    await page.waitForURL(/\/admin\/dashboard/, { timeout: 15_000 })

    // DB-Check: Session abgesagt, Buchung storniert, Credit zurück
    const db = await getAdminClient()
    const { data: sess } = await db.from('sessions').select('is_cancelled, cancel_reason').eq('id', sessionId).maybeSingle()
    expect(sess?.is_cancelled).toBe(true)
    // Welle 5 Note: cancel_reason wird auf der Anwesenheit-Page (Quick-Cancel) nicht
    // gesetzt — nur bei expliziten Kursabbruch-Workflows (cancelCourse) oder Krankheit.
    // Hier reicht is_cancelled=true als Signal.

    const cancelled = await getCancelledBooking(yogi1Id, sessionId)
    expect(cancelled, 'Buchung muss storniert sein').toBeTruthy()
    // Welle 5: cancelled_at + cancel_late=false (Admin-Absage ist nie spät für Yogi)
    expect(cancelled?.cancelled_at).toBeTruthy()
    expect(cancelled?.cancel_late, 'Admin-Absage ist KEINE Spät-Abmeldung').toBe(false)

    const creditAfter = await getSingleCredit(yogi1Id)
    expect(creditAfter?.used, 'Credit muss zurückgegeben sein').toBe(0)
    // Welle 5: Dashboard zeigt nach Redirect Header
    await expect(page.locator('body')).toContainText(/dashboard|admin|kurse/i)
  })
})
