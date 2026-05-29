/**
 * Live-E2E (Sarah 2026-05-29): Auf Wunsch von Sarah — zwei Dinge die Spec 45
 * NICHT abdeckt:
 *
 *  TEIL A — 3h-Frist × 60-Min-Gnadenfrist beim Nachrück-Yogi:
 *    Ein Yogi rückt automatisch von der Warteliste nach (promoted_at gesetzt) und
 *    meldet sich danach selbst wieder ab. Geprüft wird der Credit-Verfall je nach
 *    Zeitpunkt der Abmeldung — für Kursstunde, Einzelstunde und bezahltes Event:
 *      (1) AUSSERHALB der 3h-Frist            → kostenlos, Credit zurück
 *      (2) INNERHALB 3h, aber in Gnadenfrist  → kostenlos, Credit zurück (1h-Fenster)
 *      (3) INNERHALB 3h, Gnadenfrist abgelaufen → Credit VERFÄLLT (cancel_late=true)
 *    handleCancel (app/kurse/[id]/page.tsx) rechnet `late` clientseitig; die
 *    Formel wird hier 1:1 nachgebildet, die Buchung entsprechend aktualisiert und
 *    der Credit-Verbrauch über den DB-Trigger recalc_credit_used verifiziert.
 *
 *  TEIL B — Spätangebot mit 2 Yogis auf der Warteliste (≤90min):
 *    60 Min vor Stundenbeginn wird ein Platz frei. Statt Auto-Nachrücken bekommen
 *    BEIDE Wartelisten-Yogis ein Spätangebot (waitlist_offers). Wer zuerst auf den
 *    Magic-Link klickt, gewinnt den Platz; der zweite bekommt "too_late" (409).
 *
 * Credit-Regel (DB-Trigger recalc_credit_used, live verifiziert):
 *   Ein Credit gilt als "used", wenn die Session nicht abgesagt ist UND
 *   (status='active' ODER (status='cancelled' AND cancel_late=true)).
 *   → cancel_late=false (rechtzeitig/Gnadenfrist) ⇒ Credit zurück (used--)
 *   → cancel_late=true  (zu spät)                 ⇒ Credit verfällt (used bleibt)
 *
 * Stil & Helfer gespiegelt von 45-warteliste-auto-promote.spec.ts.
 */
import { test, expect } from '@playwright/test'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { promoteWaitlistOrOfferLate } from '../../lib/waitlist-promote'
import {
  getServiceClient, getUserIdByEmail, getActiveBooking, getCancelledBooking,
  getWaitlistEntry, getSession,
} from '../utils/db'
import { createTestCourse, giveYogiSingleCredit, E2E_PREFIX } from '../utils/seed'

dotenv.config({ path: '.env.test' })

const URL = process.env.SUPABASE_URL!
const ANON = process.env.SUPABASE_ANON_KEY!

const THREE_H_MS = 3 * 60 * 60 * 1000
const GRACE_MS = 60 * 60 * 1000 // 60-Min-Gnadenfrist nach automatischem Nachrücken

let yogi1Id: string // bucht / steht auf Warteliste #1
let yogi2Id: string // steht auf Warteliste / rückt nach

function svc() { return getServiceClient() }

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

type Scenario = { type: string; label: string; needsCredit: boolean }

/** Kurs + 1 typisierte Session (max_spots=1), yogi1 gebucht, yogi2 auf Warteliste. */
async function setupScenario(sc: Scenario, minutesFromNow: number): Promise<string> {
  const db = svc()
  await resetYogi(yogi1Id)
  await resetYogi(yogi2Id)

  const course = await createTestCourse({
    name: `${E2E_PREFIX} WL3h-${sc.type}`, sessionCount: 1, startDaysFromNow: 30, maxSpots: 1,
  })
  const { date, time } = inMinutes(minutesFromNow)
  const { data: sess, error: sessErr } = await db.from('sessions').insert({
    course_id: course.courseId, date, time_start: time, duration_min: 75,
    is_cancelled: false, session_type: sc.type,
    name: `${E2E_PREFIX} ${sc.label}`, max_spots: 1,
    price_eur: sc.type === 'event_paid' ? 30 : null,
  }).select('id').single()
  if (sessErr || !sess) throw new Error(`Session-Insert fehlgeschlagen (${sc.type}): ${sessErr?.message}`)
  const sessionId = sess.id as string

  await db.from('bookings').insert({
    user_id: yogi1Id, session_id: sessionId, credit_id: null, type: 'single', status: 'active',
  })
  await db.from('waitlist').insert({
    user_id: yogi2Id, session_id: sessionId, type: 'waitlist', position: 1,
  })
  if (sc.needsCredit) await giveYogiSingleCredit(yogi2Id, 3)

  return sessionId
}

/** Platz freigeben (DELETE umgeht den 7-Tage-Block bei bezahlten Events). */
async function deleteYogi1Booking(sessionId: string) {
  await svc().from('bookings').delete().eq('user_id', yogi1Id).eq('session_id', sessionId)
}

/**
 * Bildet die `late`-Berechnung aus handleCancel (app/kurse/[id]/page.tsx) nach:
 *   deadline3h     = sessionStart - 3h
 *   inPromoteGrace = promoted_at != null && now < promoted_at + 60min
 *   late           = !isEvent && now > deadline3h && !inPromoteGrace
 */
function computeLate(sessionStartMs: number, promotedAtMs: number | null, isEvent: boolean, nowMs: number): boolean {
  const deadline3h = sessionStartMs - THREE_H_MS
  const inPromoteGrace = promotedAtMs != null && nowMs < promotedAtMs + GRACE_MS
  return !isEvent && nowMs > deadline3h && !inPromoteGrace
}

/** Yogi meldet sich selbst ab — schreibt genau das, was handleCancel schreibt. */
async function cancelBooking(userId: string, sessionId: string, late: boolean) {
  const { error } = await svc().from('bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: late })
    .eq('user_id', userId).eq('session_id', sessionId).eq('status', 'active')
  expect(error, `Abmelde-Update-Fehler: ${error?.message}`).toBeNull()
}

function sessionStartMs(sess: any): number {
  // Lokale Zeit, exakt wie die App parst: `${date}T${time}`
  return new Date(`${sess.date}T${sess.time_start}`).getTime()
}

test.describe.configure({ mode: 'serial' })

// ════════════════════════════════════════════════════════════════════════════
// TEIL A — 3h-Frist × 60-Min-Gnadenfrist beim Nachrück-Yogi (Credit-Verfall)
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Nachrücken → Selbst-Abmeldung: 3h-Frist & 60-Min-Gnadenfrist', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
  })
  test.afterAll(async () => {
    await resetYogi(yogi1Id)
    await resetYogi(yogi2Id)
  })

  // Credit-Typen (Kursstunde + Einzelstunde) durchlaufen die volle 3-Fälle-Matrix.
  const CREDIT_SCENARIOS: Scenario[] = [
    { type: 'course_session', label: 'Kursstunde',   needsCredit: true },
    { type: 'single',         label: 'Einzelstunde', needsCredit: true },
  ]

  for (const sc of CREDIT_SCENARIOS) {
    // ── (1) AUSSERHALB der 3h-Frist → kostenlos, Credit zurück ───────────────
    test(`${sc.label}: nachgerückt, Abmeldung AUSSERHALB 3h → Credit zurück`, async () => {
      const sessionId = await setupScenario(sc, 3 * 24 * 60) // +3 Tage
      await deleteYogi1Booking(sessionId)

      const res = await promoteWaitlistOrOfferLate(svc(), sessionId)
      expect(res.mode, JSON.stringify(res)).toBe('auto-promoted')

      const booking = await getActiveBooking(yogi2Id, sessionId)
      expect(booking, 'yogi2 muss nachgerückt sein').not.toBeNull()
      expect(booking!.credit_id, 'Credit-Typ → credit_id gesetzt').not.toBeNull()

      // Credit gilt jetzt als verbraucht (used=1)
      const { data: cBefore } = await svc().from('credits')
        .select('total, used').eq('id', booking!.credit_id).single()
      expect(cBefore!.used, 'Credit nach Nachrücken verbraucht').toBe(1)

      // Abmeldung weit vor der Stunde → late=false
      const sess = await getSession(sessionId)
      const promotedAtMs = booking!.promoted_at ? new Date(booking!.promoted_at).getTime() : null
      const late = computeLate(sessionStartMs(sess), promotedAtMs, false, Date.now())
      expect(late, 'Abmeldung außerhalb 3h ist nicht zu spät').toBe(false)

      await cancelBooking(yogi2Id, sessionId, late)

      const cancelled = await getCancelledBooking(yogi2Id, sessionId)
      expect(cancelled!.cancel_late, 'cancel_late muss false sein').toBe(false)
      const { data: cAfter } = await svc().from('credits')
        .select('used').eq('id', booking!.credit_id).single()
      expect(cAfter!.used, 'Credit muss zurückgebucht sein (used=0)').toBe(0)
    })

    // ── (2) INNERHALB 3h, aber in 60-Min-Gnadenfrist → kostenlos, Credit zurück
    test(`${sc.label}: nachgerückt, Abmeldung INNERHALB 3h aber in Gnadenfrist → Credit zurück`, async () => {
      // Stunde in 120 Min: >90min ⇒ Auto-Nachrücken, aber <3h ⇒ 3h-Frist läuft.
      const sessionId = await setupScenario(sc, 120)
      await deleteYogi1Booking(sessionId)

      const res = await promoteWaitlistOrOfferLate(svc(), sessionId)
      expect(res.mode, JSON.stringify(res)).toBe('auto-promoted')

      const booking = await getActiveBooking(yogi2Id, sessionId)
      expect(booking, 'yogi2 muss nachgerückt sein').not.toBeNull()
      // promoted_at frisch (jetzt) → Gnadenfrist aktiv
      const promotedAtMs = booking!.promoted_at ? new Date(booking!.promoted_at).getTime() : null
      expect(promotedAtMs, 'promoted_at muss gesetzt sein').not.toBeNull()

      const sess = await getSession(sessionId)
      const now = Date.now()
      // Sanity: wir sind tatsächlich INNERHALB der 3h-Frist …
      expect(now > sessionStartMs(sess) - THREE_H_MS, 'Setup: innerhalb 3h-Frist').toBe(true)
      // … aber die Gnadenfrist entschärft late
      const late = computeLate(sessionStartMs(sess), promotedAtMs, false, now)
      expect(late, 'Gnadenfrist macht die Abmeldung kostenlos').toBe(false)

      await cancelBooking(yogi2Id, sessionId, late)

      const cancelled = await getCancelledBooking(yogi2Id, sessionId)
      expect(cancelled!.cancel_late, 'cancel_late=false in der Gnadenfrist').toBe(false)
      const { data: cAfter } = await svc().from('credits')
        .select('used').eq('id', booking!.credit_id).single()
      expect(cAfter!.used, 'Credit zurück trotz <3h (Gnadenfrist)').toBe(0)
    })

    // ── (3) INNERHALB 3h, Gnadenfrist abgelaufen → Credit VERFÄLLT ───────────
    test(`${sc.label}: nachgerückt, Abmeldung INNERHALB 3h NACH Gnadenfrist → Credit verfällt`, async () => {
      const sessionId = await setupScenario(sc, 120)
      await deleteYogi1Booking(sessionId)

      const res = await promoteWaitlistOrOfferLate(svc(), sessionId)
      expect(res.mode, JSON.stringify(res)).toBe('auto-promoted')

      const booking = await getActiveBooking(yogi2Id, sessionId)
      expect(booking, 'yogi2 muss nachgerückt sein').not.toBeNull()

      // promoted_at auf 70 Min in die Vergangenheit setzen → Gnadenfrist abgelaufen
      const past = new Date(Date.now() - 70 * 60 * 1000).toISOString()
      await svc().from('bookings').update({ promoted_at: past }).eq('id', booking!.id)

      const sess = await getSession(sessionId)
      const now = Date.now()
      const late = computeLate(sessionStartMs(sess), new Date(past).getTime(), false, now)
      expect(late, 'innerhalb 3h und Gnadenfrist abgelaufen → zu spät').toBe(true)

      await cancelBooking(yogi2Id, sessionId, late)

      const cancelled = await getCancelledBooking(yogi2Id, sessionId)
      expect(cancelled!.cancel_late, 'cancel_late=true nach Gnadenfrist').toBe(true)
      const { data: cAfter } = await svc().from('credits')
        .select('used').eq('id', booking!.credit_id).single()
      expect(cAfter!.used, 'Credit verfällt (used bleibt 1)').toBe(1)
    })
  }

  // ── Bezahltes Event: Nachrücken OHNE Credit + Selbstabmeldung immer kostenlos
  // Events sind von der 3h-Frist ausgenommen (isEvent ⇒ late=false). Zusätzlich
  // gilt für bezahlte Events ein harter 7-Tage-Selbstabmelde-Block (per Design),
  // daher prüfen wir hier ein Event >7 Tage in der Zukunft.
  test('Bezahltes Event: nachgerückt OHNE Credit, Selbstabmeldung kostenlos (isEvent)', async () => {
    const sc: Scenario = { type: 'event_paid', label: 'Event bezahlt', needsCredit: false }
    const sessionId = await setupScenario(sc, 10 * 24 * 60) // +10 Tage (außerhalb 7d-Block)
    await deleteYogi1Booking(sessionId)

    const res = await promoteWaitlistOrOfferLate(svc(), sessionId)
    expect(res.mode, JSON.stringify(res)).toBe('auto-promoted')

    const booking = await getActiveBooking(yogi2Id, sessionId)
    expect(booking, 'yogi2 muss nachgerückt sein').not.toBeNull()
    expect(booking!.credit_id, 'Event → kein Credit verbraucht').toBeNull()

    // Bei Events ist die Abmeldung immer kostenlos (3h-Frist gilt nicht)
    const sess = await getSession(sessionId)
    const promotedAtMs = booking!.promoted_at ? new Date(booking!.promoted_at).getTime() : null
    const late = computeLate(sessionStartMs(sess), promotedAtMs, true, Date.now())
    expect(late, 'Event-Abmeldung ist nie "zu spät" (isEvent)').toBe(false)

    await cancelBooking(yogi2Id, sessionId, late)
    const cancelled = await getCancelledBooking(yogi2Id, sessionId)
    expect(cancelled!.cancel_late, 'Event: cancel_late=false').toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TEIL B — Spätangebot mit 2 Wartelisten-Yogis (≤90min): erster Klick gewinnt
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Spätangebot: 2 Yogis auf Warteliste, Platz 60 Min vorher frei', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
  })
  test.afterAll(async () => {
    await resetYogi(yogi1Id)
    await resetYogi(yogi2Id)
  })

  /** Session (max_spots=1) mit freiem Platz + beide Yogis auf der Warteliste. */
  async function setupTwoWaiters(minutesFromNow: number): Promise<string> {
    const db = svc()
    await resetYogi(yogi1Id)
    await resetYogi(yogi2Id)

    const course = await createTestCourse({
      name: `${E2E_PREFIX} WL2-spaet`, sessionCount: 1, startDaysFromNow: 30, maxSpots: 1,
    })
    const { date, time } = inMinutes(minutesFromNow)
    const { data: sess, error } = await db.from('sessions').insert({
      course_id: course.courseId, date, time_start: time, duration_min: 75,
      is_cancelled: false, session_type: 'single',
      name: `${E2E_PREFIX} Spaetangebot-2`, max_spots: 1,
    }).select('id').single()
    if (error || !sess) throw new Error(`Session-Insert fehlgeschlagen: ${error?.message}`)
    const sessionId = sess.id as string

    // Platz ist frei (keine aktive Buchung). Beide Yogis auf der Warteliste.
    await db.from('waitlist').insert([
      { user_id: yogi1Id, session_id: sessionId, type: 'waitlist', position: 1 },
      { user_id: yogi2Id, session_id: sessionId, type: 'waitlist', position: 2 },
    ])
    // Beide brauchen einen Credit (Einzelstunde) um den Platz beanspruchen zu können.
    await giveYogiSingleCredit(yogi1Id, 1)
    await giveYogiSingleCredit(yogi2Id, 1)

    return sessionId
  }

  test('Beide bekommen ein Spätangebot; erster Klick gewinnt, zweiter bekommt too_late', async ({ request }) => {
    const sessionId = await setupTwoWaiters(60) // 60 Min vorher → ≤90min-Pfad

    // Kein Auto-Nachrücken, sondern Spätangebot an ALLE Wartelisten-Yogis
    const res = await promoteWaitlistOrOfferLate(svc(), sessionId)
    expect(res.mode, JSON.stringify(res)).toBe('late-offer-sent')

    // Beide Yogis haben ein Angebot (mit Token)
    const { data: offer1 } = await svc().from('waitlist_offers')
      .select('token').eq('session_id', sessionId).eq('user_id', yogi1Id).maybeSingle()
    const { data: offer2 } = await svc().from('waitlist_offers')
      .select('token').eq('session_id', sessionId).eq('user_id', yogi2Id).maybeSingle()
    expect(offer1?.token, 'yogi1 muss ein Spätangebot bekommen').toBeTruthy()
    expect(offer2?.token, 'yogi2 muss ein Spätangebot bekommen').toBeTruthy()

    // Niemand ist (noch) automatisch gebucht
    expect(await getActiveBooking(yogi1Id, sessionId), 'yogi1 noch nicht gebucht').toBeNull()
    expect(await getActiveBooking(yogi2Id, sessionId), 'yogi2 noch nicht gebucht').toBeNull()

    // yogi1 klickt zuerst → gewinnt
    const resp1 = await request.post(`/api/waitlist-offer/${offer1!.token}`)
    expect(resp1.ok(), `yogi1-Claim sollte erfolgreich sein (Status ${resp1.status()})`).toBeTruthy()

    const win = await getActiveBooking(yogi1Id, sessionId)
    expect(win, 'yogi1 muss jetzt gebucht sein').not.toBeNull()
    const wl1 = await getWaitlistEntry(yogi1Id, sessionId)
    expect(wl1, 'yogi1 ist von der Warteliste entfernt').toBeNull()

    // yogi2 klickt danach → Platz ist weg → too_late (409)
    const resp2 = await request.post(`/api/waitlist-offer/${offer2!.token}`)
    expect(resp2.ok(), `yogi2-Claim muss abgelehnt werden (Status ${resp2.status()})`).toBeFalsy()
    expect(resp2.status(), 'zweiter Klick → 409 too_late').toBe(409)
    const json2 = await resp2.json()
    expect(JSON.stringify(json2), 'Antwort signalisiert "too_late"').toContain('too_late')

    // yogi2 hat keine Buchung bekommen
    expect(await getActiveBooking(yogi2Id, sessionId), 'yogi2 darf NICHT gebucht sein').toBeNull()
  })
})
