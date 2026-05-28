/**
 * Live-E2E: Warteliste-Auto-Nachrücken über ALLE Session-Typen (Sarah 2026-05-28)
 *
 * Deckt die zwei verschiedenen Promote-Mechaniken ab:
 *  - TS-Helper promoteWaitlistOrOfferLate (Admin-Austrag-Pfad, Yogi ≤90min)
 *  - DB-RPC process_cancellation_with_waitlist (Yogi-Self-Cancel >90min)
 *
 * Und die zwei Zeitfenster:
 *  - >90min: AUTO-NACHRÜCKEN (erster Warteliste-Yogi wird gebucht)
 *  - ≤90min: KEIN Auto-Nachrücken → Spät-Angebot (waitlist_offers) an alle
 *
 * Session-Typen mit ihren Credit-Regeln:
 *  - Kursstunde / Einzelstunde: Nachrücken verbraucht einen Credit (Yogi braucht einen)
 *  - Event kostenlos / Event bezahlt: Nachrücken OHNE Credit (Bezahlung extern)
 *
 * Setup je Szenario: yogi1 bucht (füllt den 1 Platz), yogi2 auf Warteliste,
 * yogi1 wird ausgetragen → yogi2 muss nachrücken (bzw. ≤90min: Angebot bekommen).
 */
import { test, expect } from '@playwright/test'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { promoteWaitlistOrOfferLate } from '../../lib/waitlist-promote'
import { getServiceClient, getUserIdByEmail, getActiveBooking, getWaitlistEntry } from '../utils/db'
import { createTestCourse, giveYogiSingleCredit, E2E_PREFIX } from '../utils/seed'

dotenv.config({ path: '.env.test' })

const URL = process.env.SUPABASE_URL!
const ANON = process.env.SUPABASE_ANON_KEY!

type Scenario = { type: string; label: string; needsCredit: boolean }
const SCENARIOS: Scenario[] = [
  { type: 'course_session', label: 'Kursstunde',       needsCredit: true },
  { type: 'single',         label: 'Einzelstunde',     needsCredit: true },
  { type: 'event_free',     label: 'Event kostenlos',  needsCredit: false },
  { type: 'event_paid',     label: 'Event bezahlt',    needsCredit: false },
]

let yogi1Id: string  // bucht zuerst, wird ausgetragen
let yogi2Id: string  // steht auf Warteliste, soll nachrücken

function svc() { return getServiceClient() }

/** Authentifizierter Client (für RPC mit auth.uid()). */
async function makeAuthedClient(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Sign-in fehlgeschlagen (${email}): ${error.message}`)
  return c
}

async function resetYogi(userId: string) {
  const db = svc()
  await db.from('waitlist_offers').delete().eq('user_id', userId)
  await db.from('waitlist').delete().eq('user_id', userId)
  await db.from('bookings').delete().eq('user_id', userId)
  await db.from('credits').delete().eq('user_id', userId)
}

/** Datum/Zeit-Strings für "in N Minuten" (lokale Zeit, wie die App parst). */
function inMinutes(min: number): { date: string; time: string } {
  const d = new Date(Date.now() + min * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:00`,
  }
}

/**
 * Legt Szenario an: Kurs + 1 typisierte Session (max_spots=1), yogi1 gebucht,
 * yogi2 auf Warteliste (+ Credit falls nötig). Gibt sessionId zurück.
 */
async function setupScenario(sc: Scenario, minutesFromNow: number): Promise<string> {
  const db = svc()
  await resetYogi(yogi1Id)
  await resetYogi(yogi2Id)

  const course = await createTestCourse({
    name: `${E2E_PREFIX} WL-${sc.type}`, sessionCount: 1, startDaysFromNow: 30, maxSpots: 1,
  })
  const { date, time } = inMinutes(minutesFromNow)
  const { data: sess, error: sessErr } = await db.from('sessions').insert({
    course_id: course.courseId, date, time_start: time, duration_min: 75,
    is_cancelled: false, session_type: sc.type,
    name: `${E2E_PREFIX} ${sc.label}`, max_spots: 1,
    // event_paid braucht einen Preis (Constraint/Plausibilität).
    price_eur: sc.type === 'event_paid' ? 30 : null,
  }).select('id').single()
  if (sessErr || !sess) throw new Error(`Session-Insert fehlgeschlagen (${sc.type}): ${sessErr?.message}`)
  const sessionId = sess.id as string

  // yogi1 bucht → Platz voll
  await db.from('bookings').insert({
    user_id: yogi1Id, session_id: sessionId, credit_id: null, type: 'single', status: 'active',
  })
  // yogi2 auf Warteliste
  await db.from('waitlist').insert({
    user_id: yogi2Id, session_id: sessionId, type: 'waitlist', position: 1,
  })
  if (sc.needsCredit) await giveYogiSingleCredit(yogi2Id, 3)

  return sessionId
}

/**
 * Platz freigeben für den TS-Helper-Pfad: Buchung LÖSCHEN (umgeht den
 * BEFORE-UPDATE 7-Tage-Block bei bezahlten Events; der Helper braucht keine
 * zurückbleibende Buchung von yogi1).
 */
async function deleteYogi1Booking(sessionId: string) {
  await svc().from('bookings').delete().eq('user_id', yogi1Id).eq('session_id', sessionId)
}

// ── Source-Checks: ALLE Admin-Event-Austrag-Pfade rufen Promote auf ────────
// Regressionsschutz: bei Events gibt es einen separaten isEvent-Zweig in jedem
// Austrag-Handler — jeder muss promoteWaitlistOrOfferLate aufrufen, sonst rückt
// die Warteliste nicht nach (genau der Bug den Sarah mehrfach gemeldet hat).
test.describe('[E2E] Alle Admin-Austrag-Pfade rufen Promote auf', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')

  function eventBranchCallsPromote(file: string): boolean {
    const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    const idx = src.indexOf('if (isEvent) {')
    if (idx === -1) return false
    // Block bis zum 'return' nach dem isEvent-Zweig grob abgreifen
    const block = src.slice(idx, idx + 2500)
    return /promoteWaitlistOrOfferLate\(supabase,\s*sessionId\)/.test(block)
  }

  test('Dashboard: isEvent-Zweig promotet', () => {
    expect(eventBranchCallsPromote('app/admin/dashboard/page.tsx')).toBe(true)
  })
  test('Stundenseite (sessions/[id]): isEvent-Zweig promotet', () => {
    expect(eventBranchCallsPromote('app/admin/sessions/[id]/page.tsx')).toBe(true)
  })
  test('Kurse-Seite Teilnehmer-Modal: Austrag promotet', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/admin/kurse/page.tsx'), 'utf8')
    // Der Teilnehmer-Austrag-Handler ruft promote mit session.id auf
    expect(src).toMatch(/promoteWaitlistOrOfferLate\(supabase,\s*session\.id\)/)
  })

  // Sarah-Regel 2026-05-28: ERST Warteliste nachrücken, DANN (nur wenn Platz
  // noch frei) Benachrichtigungen. Die notify-Aufrufe dürfen NICHT vor dem
  // Promote-Versuch stehen.
  test('Benachrichtigungen erst NACH erfolglosem Promote (TS-Helper)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/waitlist-promote.ts'), 'utf8')
    const idxPromotedReturn = src.indexOf("if (promoted) return { mode: 'auto-promoted'")
    const idxFirstNotify = src.indexOf('notifyAllSubscribers(supabase, sessionId')
    expect(idxPromotedReturn, 'Promote-Return muss existieren').toBeGreaterThan(-1)
    expect(idxFirstNotify, 'notifyAllSubscribers muss existieren').toBeGreaterThan(-1)
    // Der erste notify-Aufruf steht im Source NACH dem Auto-Promote-Return,
    // d.h. er wird nur erreicht wenn niemand nachgerückt ist.
    expect(idxFirstNotify, 'notify darf nicht VOR dem Promote stehen').toBeGreaterThan(idxPromotedReturn)
  })
})

test.describe.configure({ mode: 'serial' })

test.describe('[E2E] Warteliste Auto-Nachrücken — alle Typen', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
  })
  test.afterAll(async () => {
    await resetYogi(yogi1Id)
    await resetYogi(yogi2Id)
  })

  for (const sc of SCENARIOS) {
    // ── >90min via TS-Helper (Admin-Austrag-Pfad) ─────────────────────────
    test(`${sc.label}: >90min Auto-Nachrücken (TS-Helper / Admin-Austrag)`, async () => {
      const sessionId = await setupScenario(sc, 3 * 24 * 60) // +3 Tage
      await deleteYogi1Booking(sessionId) // Platz frei (DELETE umgeht 7d-Block)

      const res = await promoteWaitlistOrOfferLate(svc(), sessionId)
      expect(res.mode, JSON.stringify(res)).toBe('auto-promoted')

      const booking = await getActiveBooking(yogi2Id, sessionId)
      expect(booking, 'yogi2 muss eine aktive Buchung haben').not.toBeNull()
      const wl = await getWaitlistEntry(yogi2Id, sessionId)
      expect(wl, 'yogi2 darf nicht mehr auf der Warteliste stehen').toBeNull()
      // Credit-Typen: Buchung mit credit_id; Events: ohne credit_id
      if (sc.needsCredit) expect(booking!.credit_id, 'Credit-Typ → credit_id gesetzt').not.toBeNull()
      else expect(booking!.credit_id, 'Event → kein Credit verbraucht').toBeNull()
    })

    // ── >90min via DB-RPC (Yogi-Self-Cancel-Pfad) ─────────────────────────
    test(`${sc.label}: >90min Auto-Nachrücken (RPC / Yogi sagt selbst ab)`, async () => {
      // event_paid braucht >7 Tage Vorlauf, sonst ist der Yogi-Self-Cancel
      // durch die 7-Tage-Stornofrist (per Design) blockiert.
      const minutes = sc.type === 'event_paid' ? 10 * 24 * 60 : 3 * 24 * 60
      const sessionId = await setupScenario(sc, minutes)

      // Realistischer Pfad: yogi1 storniert SELBST (behält cancelled-Buchung →
      // bleibt RPC-berechtigt) und ruft dann die RPC auf.
      const yogi1Client = await makeAuthedClient(process.env.TEST_YOGI1_EMAIL!, process.env.TEST_YOGI1_PASSWORD!)
      const { error: cancelErr } = await yogi1Client.from('bookings')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('user_id', yogi1Id).eq('session_id', sessionId)
      expect(cancelErr, `Self-Cancel-Fehler: ${cancelErr?.message}`).toBeNull()

      const { data, error } = await yogi1Client.rpc('process_cancellation_with_waitlist', { p_session_id: sessionId })
      expect(error, `RPC-Fehler: ${error?.message}`).toBeNull()
      expect((data as any)?.promoted, 'RPC muss jemanden nachrücken (promoted != null)').not.toBeNull()

      const booking = await getActiveBooking(yogi2Id, sessionId)
      expect(booking, 'yogi2 muss eine aktive Buchung haben').not.toBeNull()
      const wl = await getWaitlistEntry(yogi2Id, sessionId)
      expect(wl, 'yogi2 darf nicht mehr auf der Warteliste stehen').toBeNull()
      if (sc.needsCredit) expect(booking!.credit_id, 'Credit-Typ → credit_id gesetzt').not.toBeNull()
      else expect(booking!.credit_id, 'Event → kein Credit verbraucht').toBeNull()
    })

    // ── ≤90min via TS-Helper: KEIN Auto-Nachrücken, sondern Spät-Angebot ──
    test(`${sc.label}: ≤90min → Spät-Angebot statt Auto-Nachrücken`, async () => {
      const sessionId = await setupScenario(sc, 45) // in 45 Min
      await deleteYogi1Booking(sessionId)

      const res = await promoteWaitlistOrOfferLate(svc(), sessionId)
      expect(res.mode, JSON.stringify(res)).toBe('late-offer-sent')

      // yogi2 darf NICHT automatisch gebucht sein
      const booking = await getActiveBooking(yogi2Id, sessionId)
      expect(booking, 'yogi2 darf ≤90min NICHT auto-nachrücken').toBeNull()
      // … aber ein Angebot (waitlist_offers) muss existieren
      const { data: offer } = await svc().from('waitlist_offers')
        .select('id').eq('session_id', sessionId).eq('user_id', yogi2Id).maybeSingle()
      expect(offer, 'yogi2 muss ein Spät-Angebot bekommen').not.toBeNull()
      // yogi2 bleibt auf der Warteliste (Angebot offen)
      const wl = await getWaitlistEntry(yogi2Id, sessionId)
      expect(wl, 'yogi2 bleibt auf Warteliste bis er das Angebot annimmt').not.toBeNull()
    })
  }
})

// ── Sarah-Regel 2026-05-28: 60-Min-Gnadenfrist nach automatischem Nachrücken ──
// Wer AUTOMATISCH von der Warteliste nachrückt, darf sich 60 Min lang kostenlos
// wieder abmelden (Credit zurück), auch wenn die normale 3h-Frist schon läuft.
// Voraussetzung: beim Auto-Nachrücken wird bookings.promoted_at gesetzt, und
// handleCancel wertet dieses Fenster aus (late=false in der Gnadenfrist).
test.describe('[E2E] Nachrück-Gnadenfrist (promoted_at) — Live', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
  })
  test.afterAll(async () => {
    await resetYogi(yogi1Id)
    await resetYogi(yogi2Id)
  })

  const SINGLE: Scenario = { type: 'single', label: 'Einzelstunde', needsCredit: true }
  const COURSE: Scenario = { type: 'course_session', label: 'Kursstunde', needsCredit: true }

  test('TS-Helper-Pfad setzt promoted_at beim Auto-Nachrücken (Einzelstunde)', async () => {
    const sessionId = await setupScenario(SINGLE, 3 * 24 * 60)
    await deleteYogi1Booking(sessionId)

    const res = await promoteWaitlistOrOfferLate(svc(), sessionId)
    expect(res.mode, JSON.stringify(res)).toBe('auto-promoted')

    const { data: bk } = await svc().from('bookings')
      .select('promoted_at, status').eq('user_id', yogi2Id).eq('session_id', sessionId)
      .eq('status', 'active').maybeSingle()
    expect(bk, 'aktive Buchung von yogi2 muss existieren').not.toBeNull()
    expect(bk!.promoted_at, 'promoted_at muss beim Nachrücken gesetzt sein').not.toBeNull()
    // Frisch gesetzt (innerhalb der letzten 5 Min)
    const ageMs = Date.now() - new Date(bk!.promoted_at).getTime()
    expect(ageMs, 'promoted_at ist aktuell').toBeLessThan(5 * 60 * 1000)
  })

  test('RPC-Pfad setzt promoted_at beim Auto-Nachrücken (Kursstunde, Yogi sagt selbst ab)', async () => {
    const sessionId = await setupScenario(COURSE, 3 * 24 * 60)

    const yogi1Client = await makeAuthedClient(process.env.TEST_YOGI1_EMAIL!, process.env.TEST_YOGI1_PASSWORD!)
    await yogi1Client.from('bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('user_id', yogi1Id).eq('session_id', sessionId)
    const { data, error } = await yogi1Client.rpc('process_cancellation_with_waitlist', { p_session_id: sessionId })
    expect(error, `RPC-Fehler: ${error?.message}`).toBeNull()
    expect((data as any)?.promoted, 'RPC muss jemanden nachrücken').not.toBeNull()

    const { data: bk } = await svc().from('bookings')
      .select('promoted_at, status').eq('user_id', yogi2Id).eq('session_id', sessionId)
      .eq('status', 'active').maybeSingle()
    expect(bk, 'aktive Buchung von yogi2 muss existieren').not.toBeNull()
    expect(bk!.promoted_at, 'RPC muss promoted_at setzen').not.toBeNull()
    const ageMs = Date.now() - new Date(bk!.promoted_at).getTime()
    expect(ageMs, 'promoted_at ist aktuell').toBeLessThan(5 * 60 * 1000)
  })

  test('Reguläre Selbst-Buchung setzt promoted_at NICHT (keine Gnadenfrist)', async () => {
    // Drop-in-Buchung ohne Warteliste-Nachrücken darf kein promoted_at tragen.
    const db = svc()
    await resetYogi(yogi2Id)
    const course = await createTestCourse({
      name: `${E2E_PREFIX} WL-grace-direct`, sessionCount: 1, startDaysFromNow: 30, maxSpots: 2,
    })
    const { date, time } = inMinutes(3 * 24 * 60)
    const { data: sess } = await db.from('sessions').insert({
      course_id: course.courseId, date, time_start: time, duration_min: 75,
      is_cancelled: false, session_type: 'single', name: `${E2E_PREFIX} Direktbuchung`, max_spots: 2,
    }).select('id').single()
    await giveYogiSingleCredit(yogi2Id, 1)
    await db.from('bookings').insert({
      user_id: yogi2Id, session_id: sess!.id, credit_id: null, type: 'single', status: 'active',
    })
    const { data: bk } = await db.from('bookings')
      .select('promoted_at').eq('user_id', yogi2Id).eq('session_id', sess!.id).maybeSingle()
    expect(bk!.promoted_at, 'Direktbuchung darf KEIN promoted_at haben').toBeNull()
  })
})

// ── RLS-Regression: Spät-Angebot muss mit AUTHENTIFIZIERTEM Client klappen ──
// Bug (Sarah 2026-05-28): waitlist_offers hatte RLS aktiv, aber 0 Policies →
// jeder Browser-Zugriff (Admin-Austrag + Yogi-Self-Cancel ≤90min) wurde still
// blockiert, Spät-Angebote wurden nie erstellt → Warteliste rückte nicht nach.
// WICHTIG: Dieser Test nutzt einen AUTHENTIFIZIERTEN Client (nicht den Service-
// Client), denn nur so greift RLS — die übrigen Tests nutzen svc() und hätten
// die Lücke nie gesehen.
test.describe('[E2E] waitlist_offers RLS — Spät-Angebot via authentifiziertem Client', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
  })
  test.afterAll(async () => {
    await resetYogi(yogi1Id)
    await resetYogi(yogi2Id)
  })

  test('Admin kann ≤90min ein Spät-Angebot anlegen (RLS erlaubt INSERT)', async () => {
    const sc: Scenario = { type: 'single', label: 'Einzelstunde', needsCredit: true }
    const sessionId = await setupScenario(sc, 45) // 45 Min → ≤90min-Pfad
    await deleteYogi1Booking(sessionId)

    // Promote als ADMIN-Client (RLS aktiv!) — nicht als Service-Client.
    const adminClient = await makeAuthedClient(process.env.TEST_ADMIN_EMAIL!, process.env.TEST_ADMIN_PASSWORD!)
    const res = await promoteWaitlistOrOfferLate(adminClient, sessionId)
    expect(res.mode, JSON.stringify(res)).toBe('late-offer-sent')

    // Der Offer-Eintrag MUSS trotz RLS angelegt worden sein.
    const { data: offer } = await svc().from('waitlist_offers')
      .select('id, token').eq('session_id', sessionId).eq('user_id', yogi2Id).maybeSingle()
    expect(offer, 'Spät-Angebot muss trotz RLS erstellt werden (Admin-Policy)').not.toBeNull()
    expect(offer!.token, 'Offer braucht einen Token für den Magic-Link').toBeTruthy()
  })
})

// ── Spät-Angebot Claim (Magic-Link /api/waitlist-offer/[token]) ────────────
// Sarah-Fix 2026-05-28: (1) Claim-Fenster zeigt echten Titel (Event/Einzelstunde),
// nicht den SYS-Container. (2) Events rücken OHNE Credit nach (Bezahlung extern).
test.describe('[E2E] Spät-Angebot Claim — Titel + Events ohne Credit', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
  })
  test.afterAll(async () => {
    await resetYogi(yogi1Id)
    await resetYogi(yogi2Id)
  })

  // Hilfsfunktion: Szenario aufsetzen, Spät-Angebot erzeugen, Token holen.
  async function setupOffer(sc: Scenario): Promise<string> {
    const sessionId = await setupScenario(sc, 45) // ≤90min → Spät-Angebot
    await deleteYogi1Booking(sessionId)
    const res = await promoteWaitlistOrOfferLate(svc(), sessionId)
    expect(res.mode, JSON.stringify(res)).toBe('late-offer-sent')
    const { data: offer } = await svc().from('waitlist_offers')
      .select('token').eq('session_id', sessionId).eq('user_id', yogi2Id).maybeSingle()
    expect(offer?.token, 'Offer-Token muss existieren').toBeTruthy()
    return offer!.token
  }

  test('Event kostenlos: Claim bucht OHNE Credit + Titel = Event-Name', async ({ request }) => {
    const token = await setupOffer({ type: 'event_free', label: 'Event kostenlos', needsCredit: false })
    const resp = await request.post(`/api/waitlist-offer/${token}`)
    expect(resp.ok(), `Claim-Status: ${resp.status()}`).toBeTruthy()
    const json = await resp.json()
    expect(json.courseName, 'Titel = Event-Name, nicht SYS-Container').toContain('Event kostenlos')
    expect(json.courseName).not.toContain('SYS')
    // Buchung OHNE Credit
    const { data: bk } = await svc().from('bookings')
      .select('credit_id, status').eq('user_id', yogi2Id).eq('session_id',
        (await svc().from('sessions').select('id').eq('name', `${E2E_PREFIX} Event kostenlos`).order('created_at', { ascending: false }).limit(1).single()).data!.id)
      .eq('status', 'active').maybeSingle()
    expect(bk, 'aktive Buchung muss existieren').not.toBeNull()
    expect(bk!.credit_id, 'Event → kein Credit verbraucht').toBeNull()
  })

  test('Event bezahlt: Claim bucht OHNE Credit', async ({ request }) => {
    const token = await setupOffer({ type: 'event_paid', label: 'Event bezahlt', needsCredit: false })
    const resp = await request.post(`/api/waitlist-offer/${token}`)
    expect(resp.ok(), `Claim-Status: ${resp.status()}`).toBeTruthy()
    const json = await resp.json()
    expect(json.courseName).toContain('Event bezahlt')
    expect(json.courseName).not.toContain('SYS')
  })

  test('Einzelstunde: Claim-Titel = Stundenname (nicht SYS-Container)', async ({ request }) => {
    const token = await setupOffer({ type: 'single', label: 'Einzelstunde', needsCredit: true })
    const resp = await request.post(`/api/waitlist-offer/${token}`)
    expect(resp.ok(), `Claim-Status: ${resp.status()}`).toBeTruthy()
    const json = await resp.json()
    expect(json.courseName, 'Titel = Stundenname, nicht SYS-Container').toContain('Einzelstunde')
    expect(json.courseName).not.toContain('SYS')
  })
})

// ── yogi_notifications: Grant+RLS — Admin legt an, Yogi liest (Event-Absage) ─
// Bug (Sarah 2026-05-28): yogi_notifications hatte RLS aktiv, aber KEINE GRANTs
// an authenticated → Admin konnte keine Benachrichtigung INSERTen und der Yogi
// konnte sie nicht SELECTen ("Kein Hinweis wird angezeigt" bei Event-Absage).
// Dieser Test nutzt echte authentifizierte Clients (nicht svc()), damit
// Grant+RLS wie in Produktion greifen.
test.describe('[E2E] yogi_notifications: Admin legt an → Yogi liest', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('Admin kann Benachrichtigung anlegen, Yogi kann sie lesen', async () => {
    const yogiId = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    // Aufräumen vorab
    await svc().from('yogi_notifications').delete().eq('user_id', yogiId).eq('type', 'event_cancelled')

    // Admin (authenticated, RLS aktiv) legt eine Benachrichtigung für den Yogi an
    const adminClient = await makeAuthedClient(process.env.TEST_ADMIN_EMAIL!, process.env.TEST_ADMIN_PASSWORD!)
    const { error: insErr } = await adminClient.from('yogi_notifications').insert({
      user_id: yogiId, type: 'event_cancelled',
      payload: { title: `${E2E_PREFIX} Test-Event`, reason: 'Testabsage' },
    })
    expect(insErr, `Admin muss yogi_notifications anlegen können: ${insErr?.message}`).toBeNull()

    // Yogi (authenticated) liest seine eigene Benachrichtigung
    const yogiClient = await makeAuthedClient(process.env.TEST_YOGI1_EMAIL!, process.env.TEST_YOGI1_PASSWORD!)
    const { data: notes, error: selErr } = await yogiClient.from('yogi_notifications')
      .select('id, type, payload').eq('type', 'event_cancelled')
    expect(selErr, `Yogi muss eigene Benachrichtigung lesen können: ${selErr?.message}`).toBeNull()
    expect((notes || []).length, 'Yogi sieht seine Event-Absage-Benachrichtigung').toBeGreaterThanOrEqual(1)

    // Aufräumen
    await svc().from('yogi_notifications').delete().eq('user_id', yogiId).eq('type', 'event_cancelled')
  })
})

// ── Source-Checks: Gnadenfrist-Logik in App + Mail ─────────────────────────
test.describe('[E2E] Gnadenfrist — Source-Coverage', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8')

  test('handleCancel: late wird durch 60-Min-Gnadenfrist (promoted_at) entschärft', () => {
    const src = read('app/kurse/[id]/page.tsx')
    // promoted_at + 60-Min-Fenster fließen in die late-Entscheidung ein
    expect(src).toMatch(/promoted_at/)
    expect(src).toMatch(/inPromoteGrace/)
    expect(src).toMatch(/60 \* 60 \* 1000/)
    // late darf bei aktiver Gnadenfrist NICHT true sein
    expect(src).toMatch(/serverNow > deadline3h && !inPromoteGrace/)
  })

  test('handleBook: reguläre (Re-)Buchung setzt promoted_at zurück', () => {
    const src = read('app/kurse/[id]/page.tsx')
    expect(src).toMatch(/promoted_at:\s*null/)
  })

  test('UI: Grace-Button "Versehentlich von Warteliste nachgerückt" für 60 Min', () => {
    const src = read('app/kurse/[id]/page.tsx')
    expect(src).toMatch(/Versehentlich von Warteliste nachgerückt/)
  })

  test('waitlist-promote.ts: beide Auto-Promote-Helfer setzen promoted_at', () => {
    const src = read('lib/waitlist-promote.ts')
    const matches = src.match(/promoted_at:\s*new Date\(\)\.toISOString\(\)/g) || []
    expect(matches.length, 'promoted_at in tryAutoPromoteOne + tryAutoPromoteOneFree').toBeGreaterThanOrEqual(2)
  })

  test('Edge Function: waitlist_promoted-Mail hat "Wieder absagen"-Button', () => {
    const src = read('supabase/functions/send-email/index.ts')
    expect(src).toMatch(/Versehentlich nachgerückt\? Wieder absagen/)
    // Button nur bei Kurs/Einzelstunde (nicht bei Events)
    expect(src).toMatch(/!isPaidEvent && !isFreeEvent && data\.sessionId/)
  })

  test('Claim-Route: echter Titel + Events ohne Credit', () => {
    const src = read('app/api/waitlist-offer/[token]/route.ts')
    // session.name + session_type werden geladen (für Titel + Credit-Entscheidung)
    expect(src).toMatch(/session:sessions\([^)]*name[^)]*session_type/)
    // Titel nutzt session.name bei Events/Einzelstunden (_isStandalone)
    expect(src).toMatch(/_isStandalone.*_sess\.name|_sess\.name.*_isStandalone/s)
    expect(src).toMatch(/courseName: _title/)
    // Events/Charity rücken OHNE Credit nach
    expect(src).toMatch(/_promoteWithoutCredit/)
    expect(src).toMatch(/if \(!_promoteWithoutCredit\)/)
  })
})
