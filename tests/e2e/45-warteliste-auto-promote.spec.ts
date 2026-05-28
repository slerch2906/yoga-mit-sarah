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
