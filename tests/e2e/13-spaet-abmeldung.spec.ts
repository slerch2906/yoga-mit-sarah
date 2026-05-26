// Welle 5 Refactor (Sarah 2026-05-26): zusätzliche semantische Assertions
/**
 * Workflow: Spät-Abmeldung (cancel_late=true)
 * Testfälle:
 *   - Abmeldung innerhalb 3h vor Stundenbeginn → Credit NICHT zurück, cancel_late=true
 *   - UI zeigt Stornofrist-Warnung
 */
import { test, expect } from '@playwright/test'
import { SessionDetailPage } from '../page-objects/SessionDetailPage'
import { giveYogiSingleCredit, E2E_PREFIX } from '../utils/seed'
import {
  getUserIdByEmail, getAdminClient, getCancelledBooking, getSingleCredit,
} from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('Spät-Abmeldung: Innerhalb 3h vor Stundenbeginn', () => {
  test.use({ storageState: 'tests/.auth/yogi1.json' })

  let sessionId: string
  let courseId: string
  let yogi1Id: string
  let creditId: string | undefined

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()

    // Alte Credits aufräumen
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')

    // Session in 1h (innerhalb der 3h-Stornofrist fuer Einzel-Sessions; nicht zu
    // verwechseln mit 14-Tage-Kursruecktritt-Stornofrist aus den AGB —
    // siehe tests/e2e/39-stornofrist-14tage.spec.ts).
    // Datum aus lokalen Komponenten der sessionTime ableiten (sonst Tag-Wechsel-Bug)
    const sessionTime = new Date(Date.now() + 60 * 60 * 1000) // +1h
    const dateStr = `${sessionTime.getFullYear()}-${String(sessionTime.getMonth()+1).padStart(2,'0')}-${String(sessionTime.getDate()).padStart(2,'0')}`
    const timeStr = sessionTime.toTimeString().slice(0, 8)

    const { data: course } = await db.from('courses').insert({
      name: `${E2E_PREFIX} Spaet-Abmeldung-Test`,
      weekday: sessionTime.toLocaleDateString('de-DE', { weekday: 'long' }),
      time_start: timeStr,
      duration_min: 60,
      max_spots: 5,
      total_units: 1,
      date_start: dateStr,
      date_end: dateStr,
      is_active: true,
      is_single: true, // Einzelstunde
      is_open: true,
    }).select('id').single()
    courseId = course!.id

    const { data: sess } = await db.from('sessions').insert({
      course_id: courseId,
      date: dateStr,
      time_start: timeStr,
      duration_min: 60,
      is_cancelled: false,
    }).select('id').single()
    sessionId = sess!.id

    // Credit anlegen und Yogi einbuchen
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

  test('Stunde in 1h: Abmelden → cancel_late=true, Credit NICHT zurück', async ({ page }) => {
    // Credit vor Abmeldung
    const creditBefore = await getSingleCredit(yogi1Id)
    expect(creditBefore?.used, 'Credit muss vor Abmeldung verbraucht sein').toBe(1)

    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(sessionId)

    // Sarah-Wunsch 2026-05-23: Neuer 3h-Frist-Confirm via window.confirm.
    // In Playwright muss der native dialog akzeptiert werden bevor er
    // den Code-Flow blockt.
    page.on('dialog', d => d.accept())

    // Abmelden klicken (Button heißt "Von dieser Stunde abmelden")
    await page.getByRole('button', { name: /von dieser stunde abmelden/i }).click()

    // Bestätigung-Button "Ja, abmelden" erscheint
    const confirmBtn = page.getByRole('button', { name: /ja, abmelden/i })
    await confirmBtn.waitFor({ timeout: 5_000 })
    await confirmBtn.click()

    // Warten bis Aktion verarbeitet ist (router.back() in der Logik)
    await page.waitForTimeout(2_500)

    // DB-Check: Buchung storniert mit cancel_late=true
    const booking = await getCancelledBooking(yogi1Id, sessionId)
    expect(booking, 'Buchung muss storniert sein').toBeTruthy()
    expect(booking?.cancel_late, 'Spät-Abmeldung muss cancel_late=true setzen').toBe(true)
    // Welle 5: cancelled_at gesetzt, status cancelled
    expect(booking?.cancelled_at, 'cancelled_at muss gesetzt sein').toBeTruthy()
    expect(booking?.status).toBe('cancelled')

    // Credit darf NICHT zurückgegeben sein
    const creditAfter = await getSingleCredit(yogi1Id)
    expect(creditAfter?.used, 'Credit muss verbraucht bleiben (kein Refund bei Spät-Abmeldung)').toBe(1)
    // Welle 5: Audit-Log-Prüfung – Spät-Abmeldung sollte geloggt sein
    const db = await getAdminClient()
    const { data: audits } = await db.from('audit_log')
      .select('action, user_id, target_id')
      .eq('user_id', yogi1Id)
      .order('created_at', { ascending: false })
      .limit(20)
    // Erwarte mind. einen audit-Eintrag der zur Abmeldung/Cancel passt
    const cancelAudit = (audits || []).find((a: any) =>
      /cancel|abmeld|booking.*delete|booking.*cancel|late/i.test(a.action || '')
    )
    if (!cancelAudit) {
      console.warn(`⚠️ Kein audit-log-Eintrag zur Spät-Abmeldung gefunden (Welle 6 Backlog: Audit-Erweiterung)`)
    }
  })
})

test.describe('Spät-Abmeldung: UI zeigt Stornofrist-Warnung', () => {
  test.use({ storageState: 'tests/.auth/yogi1.json' })

  let sessionId: string
  let courseId: string
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()

    // Sauberer Ausgangszustand
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')

    const sessionTime = new Date(Date.now() + 90 * 60 * 1000) // +90min
    const dateStr = `${sessionTime.getFullYear()}-${String(sessionTime.getMonth()+1).padStart(2,'0')}-${String(sessionTime.getDate()).padStart(2,'0')}`
    const timeStr = sessionTime.toTimeString().slice(0, 8)

    const { data: course } = await db.from('courses').insert({
      name: `${E2E_PREFIX} Stornofrist-Warnung`,
      weekday: sessionTime.toLocaleDateString('de-DE', { weekday: 'long' }),
      time_start: timeStr,
      duration_min: 60,
      max_spots: 5,
      total_units: 1,
      date_start: dateStr,
      date_end: dateStr,
      is_active: true,
      is_single: true,
      is_open: true,
    }).select('id').single()
    courseId = course!.id

    const { data: sess } = await db.from('sessions').insert({
      course_id: courseId, date: dateStr, time_start: timeStr,
      duration_min: 60, is_cancelled: false,
    }).select('id').single()
    sessionId = sess!.id

    const creditId = await giveYogiSingleCredit(yogi1Id, 2)
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: sessionId, credit_id: creditId,
      type: 'single', status: 'active',
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

  test('Stunde innerhalb 3h: Hinweis "kein Credit zurück" sichtbar', async ({ page }) => {
    await page.goto(`/kurse/${sessionId}`)
    await page.waitForLoadState('networkidle')

    // Irgendein Hinweis auf Stornofrist / kein Credit / zu spät
    await expect(
      page.getByText(/stornofrist|kein.*credit|zu spät|unter.*3 stunden|innerhalb.*3/i).first()
    ).toBeVisible({ timeout: 8_000 })
    // Welle 5: konkret die "3 Stunden" Frist-Zahl muss im Warntext erscheinen
    await expect(page.locator('body')).toContainText(/3.*stunde/i)
    // Welle 5: Abmelde-Button trotzdem grundsätzlich verfügbar (UI erlaubt Spät-Abmeldung mit Warnung)
    const abmeldButton = page.getByRole('button', { name: /abmelden|austragen/i })
    await expect(abmeldButton.first()).toBeVisible({ timeout: 5_000 })
  })
})
