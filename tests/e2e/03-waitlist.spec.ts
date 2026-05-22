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
test.describe('Warteliste-Austrag via Email-Link', () => {
  test.fixme('[E2E] Token-Link trägt aus + zeigt Bestätigung mit Kursname/Datum', async () => {
    // 1) Yogi auf waitlist setzen via RPC join_waitlist
    // 2) unsubscribe_token aus DB lesen
    // 3) /warteliste/austragen?token=<token> (unangemeldet) öffnen
    // 4) Erwartet: H2 "Von der Warteliste ausgetragen" + Kursname + Datum sichtbar
    // 5) DB-Check: waitlist-Row gelöscht
  })

  test.fixme('[E2E] Zweiter Klick auf denselben Link → "Bereits ausgetragen"', async () => {
    // Idempotenz: nach erstem Klick zeigt Page "Bereits ausgetragen", kein Crash, kein 500.
  })

  test.fixme('[E2E] Ungültiger / random Token → "Link ungültig"', async () => {
    // /warteliste/austragen?token=<random-uuid> → invalid-State
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
