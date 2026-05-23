/**
 * Workflow: Warteliste & Nachrücken
 * Testfälle: Auf Warteliste setzen, Warteliste nachrücken, Benachrichtigung
 */
import { test, expect } from '@playwright/test'
import { SessionDetailPage } from '../page-objects/SessionDetailPage'
import { createFullCourse, giveYogiSingleCredit } from '../utils/seed'
import { getActiveBooking, getWaitlistEntry, getUserIdByEmail, getAdminClient } from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

let fullSessionId: string
let notifySessionId: string
let prioritySessionId: string
let yogi1Id: string
let yogi2Id: string
let adminId: string

test.beforeAll(async () => {
  yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
  adminId = (await getUserIdByEmail(process.env.TEST_ADMIN_EMAIL!))!

  // Ausgebuchten Kurs erstellen (Yogi1 belegt den einzigen Platz)
  const course = await createFullCourse(yogi1Id, yogi2Id)
  fullSessionId = course.sessionIds[0]

  // Separater Kurs für Benachrichtigungs-Test
  const course2 = await createFullCourse(yogi1Id, yogi2Id)
  notifySessionId = course2.sessionIds[0]

  // Kurs für Prioritäts-Test: Yogi2 auf Warteliste, Admin auf Notify-Liste (via DB)
  const course3 = await createFullCourse(yogi1Id, yogi2Id)
  prioritySessionId = course3.sessionIds[0]

  // Yogi2 bekommt Credits für Warteliste
  await giveYogiSingleCredit(yogi2Id, 5)

  // Warteliste- und Notify-Einträge für Prioritäts-Test direkt anlegen
  const db = await getAdminClient()
  await db.from('waitlist').insert({ user_id: yogi2Id, session_id: prioritySessionId, type: 'waitlist' })
  await db.from('waitlist').insert({ user_id: adminId, session_id: prioritySessionId, type: 'notify' })
})

// --- Yogi2 auf Warteliste ---
test.describe('Warteliste (Yogi2)', () => {
  test.use({ storageState: 'tests/.auth/yogi2.json' })

  test('Ausgebuchte Stunde → "Ausgebucht" Badge sichtbar', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(fullSessionId)
    await sessionPage.expectFullMessage()
    await sessionPage.expectNoBookButton()
  })

  test('Auf Warteliste eintragen → Eintrag in DB vorhanden', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(fullSessionId)
    await sessionPage.joinWaitlist()

    const entry = await getWaitlistEntry(yogi2Id, fullSessionId)
    expect(entry, 'Warteliste fehlgeschlagen: Kein Eintrag in der Datenbank').toBeTruthy()
    expect(entry?.type).toBe('waitlist')
  })
})

// --- Yogi1 meldet sich ab → Yogi2 rückt nach ---
test.describe('Warteliste Nachrücken (Yogi1)', () => {
  test.use({ storageState: 'tests/.auth/yogi1.json' })

  test('Yogi1 meldet sich ab → Yogi2 rückt nach → hat aktive Buchung', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(fullSessionId)
    await sessionPage.cancelBooking()

    // Kurz warten bis Trigger nachrückt
    await page.waitForTimeout(3_000)

    const booking = await getActiveBooking(yogi2Id, fullSessionId)
    expect(
      booking,
      'Workflow Warteliste fehlgeschlagen: Yogi2 ist nach Abmeldung von Yogi1 nicht nachgerückt.'
    ).toBeTruthy()
  })
})

// --- Benachrichtigungs-Typ ---
test.describe('Warteliste Benachrichtigung (Yogi2)', () => {
  test.use({ storageState: 'tests/.auth/yogi2.json' })

  test('Benachrichtigung eintragen → Typ notify in Datenbank', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(notifySessionId)
    await sessionPage.joinNotifyList()

    const entry = await getWaitlistEntry(yogi2Id, notifySessionId)
    expect(entry?.type, 'Benachrichtigungs-Eintrag hat falschen Typ').toBe('notify')
  })
})

// --- Wartelisten-Austrag via Email-Token (Sarah 2026-05-22) ---
test.describe('[E2E] Warteliste-Austrag via Email-Link', () => {
  // Page ist public — kein Login. Wir nutzen einen eigenen Yogi-Kontext (yogi2)
  // nur zum Anlegen des waitlist-Eintrags via RPC, dann öffnen wir die Page ohne Session.
  test.use({ storageState: { cookies: [], origins: [] } })

  let austragSessionId: string
  let austragCourseName: string
  let austragDate: string
  let austragTimeStart: string
  let validToken: string

  test.beforeAll(async () => {
    // Eigene ausgebuchte Session für diesen Block — nicht den priority-Setup recyceln
    const setup = await createFullCourse(yogi1Id, yogi2Id)
    austragSessionId = setup.sessionIds[0]

    const db = await getAdminClient()
    const { data: sess } = await db.from('sessions')
      .select('id, date, time_start, course:courses(name)')
      .eq('id', austragSessionId).single()
    austragCourseName = (sess as any)?.course?.name || ''
    austragDate = (sess as any)?.date || ''
    austragTimeStart = (sess as any)?.time_start || ''

    // waitlist-Eintrag direkt via Service-Role anlegen.
    // unsubscribe_token wird vom DB-Default `gen_random_uuid()` befüllt.
    // (Andere Tests dieses Files können bereits einen yogi2-waitlist auf
    //  dieser Session angelegt haben — ON CONFLICT-sicher löschen wir vorher.)
    await db.from('waitlist').delete()
      .eq('user_id', yogi2Id).eq('session_id', austragSessionId)
    const { data: ins, error: insErr } = await db.from('waitlist').insert({
      user_id: yogi2Id, session_id: austragSessionId, type: 'waitlist',
    }).select('unsubscribe_token').single()
    if (insErr || !ins?.unsubscribe_token) {
      throw new Error(`waitlist-Insert für Token-Austrag fehlgeschlagen: ${insErr?.message}`)
    }
    validToken = ins.unsubscribe_token
  })

  test('Token-Link trägt aus + zeigt Bestätigung mit Kursname/Datum', async ({ page }) => {
    await page.goto(`/warteliste/austragen?token=${encodeURIComponent(validToken)}`)
    await page.waitForLoadState('networkidle')

    // Erfolgs-State
    await expect(page.getByRole('heading', { name: /von der warteliste ausgetragen/i }))
      .toBeVisible({ timeout: 10_000 })

    // Kursname sichtbar
    await expect(page.getByText(austragCourseName)).toBeVisible()

    // Datum-Anzeige enthält Jahr (formatGermanDate gibt z.B. "Donnerstag, 5. Juni 2026 um 18:30 Uhr")
    const year = new Date(austragDate).getFullYear()
    await expect(page.getByText(new RegExp(`${year}`))).toBeVisible()
    // Uhrzeit-Anzeige (z.B. "18:30 Uhr")
    const hhmm = austragTimeStart.slice(0, 5)
    await expect(page.getByText(new RegExp(`${hhmm}`))).toBeVisible()

    // DB-Check: waitlist-Eintrag gelöscht
    const entry = await getWaitlistEntry(yogi2Id, austragSessionId)
    expect(entry, 'waitlist-Eintrag muss nach Token-Austrag gelöscht sein').toBeNull()
  })

  test('Zweiter Klick auf denselben Link → "Bereits ausgetragen" (Idempotenz)', async ({ page }) => {
    // 1. Klick: trägt aus (success)
    await page.goto(`/warteliste/austragen?token=${encodeURIComponent(validToken)}`)
    await page.waitForLoadState('networkidle')
    // 2. Klick: zeigt already-removed-State
    await page.goto(`/warteliste/austragen?token=${encodeURIComponent(validToken)}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: /bereits ausgetragen/i }))
      .toBeVisible({ timeout: 10_000 })
    // Kein Error/Crash — Link-zur-App-Button sichtbar
    await expect(page.getByRole('link', { name: /zur app/i })).toBeVisible()
  })

  test('Ungültiger / random Token → "Link ungültig"', async ({ page }) => {
    const randomToken = `e2e-invalid-${Date.now()}-${Math.random().toString(36).slice(2)}`
    await page.goto(`/warteliste/austragen?token=${encodeURIComponent(randomToken)}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: /link ungültig/i }))
      .toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('link', { name: /zur app/i })).toBeVisible()
  })
})

// --- Warteliste hat Vorrang vor Benachrichtigung ---
test.describe('Warteliste Priorität (Yogi1)', () => {
  test.use({ storageState: 'tests/.auth/yogi1.json' })

  test('Yogi1 sagt ab → Yogi2 rückt nach (Warteliste), Admin-Notify bleibt bestehen', async ({ page }) => {
    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(prioritySessionId)
    await sessionPage.cancelBooking()

    // Warten bis Trigger nachrückt
    await page.waitForTimeout(3_000)

    // Yogi2 muss aktive Buchung haben (wurde von Warteliste nachrückend)
    const booking = await getActiveBooking(yogi2Id, prioritySessionId)
    expect(
      booking,
      'Workflow Warteliste-Priorität fehlgeschlagen: Yogi2 ist nicht von der Warteliste nachgerückt.'
    ).toBeTruthy()

    // Da Yogi2 nachrückte, wurde kein Platz frei → Admin-Notify-Eintrag darf NICHT gelöscht worden sein
    const notifyEntry = await getWaitlistEntry(adminId, prioritySessionId)
    expect(
      notifyEntry,
      'Workflow Warteliste-Priorität fehlgeschlagen: Notify-Eintrag wurde fälschlicherweise gelöscht, obwohl Warteliste Vorrang hatte.'
    ).toBeTruthy()
    expect(notifyEntry?.type).toBe('notify')
  })
})
