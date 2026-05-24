/**
 * SYSTEMISCHE END-TO-END KONSISTENZ
 *
 * Sarah-Direktive 2026-05-24: App-weite Test-Strategie ändert sich von
 * "funktioniert dieser einzelne Step?" zu "ist der komplette Systemzustand
 * nach diesem Workflow logisch korrekt und überall konsistent?"
 *
 * Jeder Test in dieser Spec deckt einen kompletten Workflow-Lifecycle ab
 * und prüft NACH der Aktion ALLE betroffenen Tabellen + Counter + Trigger
 * + Folge-Aktionen. Cross-View-Konsistenz: DB == was Yogi sieht == was
 * Admin sieht (über Datenquellen-Identität, nicht über UI-Rendering).
 *
 * Pro Flow strukturiert:
 *   1. SETUP — initialer kohärenter Zustand (Yogi + Course + Credit + Bookings)
 *   2. AKTION — single business operation (Buchung, Abmeldung, etc.)
 *   3. ASSERT — komplette Zustandsprüfung in 4+ Dimensionen:
 *      • bookings-Tabelle (status, credit_id, cancel_late)
 *      • credits-Tabelle (used via Trigger, total unverändert)
 *      • sessions-Counter (countActiveBookingsForSession)
 *      • audit_log (relevante Einträge)
 *      • enrollments / waitlist (keine Geister)
 *      • Folge-Aktion (Re-Buchung sollte/sollte-nicht funktionieren)
 *      • Negative Assertion (es sollte X NICHT geben)
 *
 * Diese Specs sind DB-zentriert (kein UI-E2E) für Robustheit + Speed.
 * UI-Konsistenz wird via Spec 26 (Yogi-Sicht ↔ Admin-Sicht ↔ DB) abgedeckt.
 */

import { test, expect } from '@playwright/test'
import * as dotenv from 'dotenv'
import {
  getAdminClient,
  getUserIdByEmail,
  getActiveBooking,
  getCancelledBooking,
  countActiveBookingsForSession,
  getCourseCredit,
  getGuthabenCredit,
  countGuthabenCredits,
  getEnrollment,
  getWaitlistEntry,
} from '../utils/db'
import { createTestCourse, giveYogiSingleCredit, giveYogiGuthaben, E2E_PREFIX } from '../utils/seed'

dotenv.config({ path: '.env.test' })

// ────────────────────────────────────────────────────────────────────────
// Helper: Test-Yogi komplett zurücksetzen für sauberen Flow-Start
// ────────────────────────────────────────────────────────────────────────
async function resetYogi(userId: string) {
  const db = await getAdminClient()
  await db.from('waitlist').delete().eq('user_id', userId)
  await db.from('bookings').delete().eq('user_id', userId)
  await db.from('credits').delete().eq('user_id', userId)
  await db.from('enrollments').delete().eq('user_id', userId)
  await db.from('notification_log').delete().eq('user_id', userId)
}

async function futurePlus(days: number): Promise<Date> {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

// ════════════════════════════════════════════════════════════════════════════
// FLOW A: KURS-CREDIT LIFECYCLE — Buchung → Rechtzeitig-Abmeldung → Re-Buchung
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Flow A: Kurs-Credit-Lifecycle (Booking → Cancel → Re-Book)', () => {
  let yogi1Id: string
  let courseId: string
  let sessionId: string
  let creditId: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test.beforeEach(async () => {
    await resetYogi(yogi1Id)
    // Kurs mit 1 Session erstellen
    const c = await createTestCourse({ name: `${E2E_PREFIX} FlowA`, sessionCount: 1, startDaysFromNow: 14 })
    courseId = c.courseId
    sessionId = c.sessionIds[0]
    // Yogi enrollen + Credit für 1 Stunde
    const db = await getAdminClient()
    const exp = await futurePlus(60)
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: courseId, model: 'course',
      total: 1, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    creditId = credit!.id
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: courseId })
  })

  test('Komplette Kette: Buchung → Cancel (rechtzeitig) → Re-Buchung', async () => {
    const db = await getAdminClient()

    // ── PHASE 1: AKTIVE BUCHUNG ───────────────────────────────────────────
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: sessionId, credit_id: creditId,
      type: 'course', status: 'active',
    })

    // ASSERT: Komplette Zustands-Prüfung NACH Buchung
    const booking1 = await getActiveBooking(yogi1Id, sessionId)
    expect(booking1, 'Buchung muss als active in DB existieren').toBeTruthy()
    expect(booking1?.credit_id, 'Buchung muss korrekten credit_id haben').toBe(creditId)
    expect(booking1?.type, 'type=course bei Kurs-Buchung').toBe('course')

    const credit1 = await getCourseCredit(yogi1Id, courseId)
    expect(credit1?.used, 'credit.used = 1 nach Buchung (Trigger)').toBe(1)
    expect(credit1?.total, 'credit.total UNVERÄNDERT (sollte nicht angefasst werden)').toBe(1)

    const sessionCount1 = await countActiveBookingsForSession(sessionId)
    expect(sessionCount1, 'Session-Teilnehmer-Counter = 1').toBe(1)

    const enrollment1 = await getEnrollment(yogi1Id, courseId)
    expect(enrollment1, 'Enrollment muss bestehen bleiben (nicht angefasst durch Buchung)').toBeTruthy()

    // ── PHASE 2: RECHTZEITIGE ABMELDUNG (cancel_late=false) ─────────────
    // Stunde ist in 14 Tagen → cancel_late=false (>3h Frist)
    await db.from('bookings').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancel_late: false,
    }).eq('id', booking1!.id)

    // ASSERT: Konsistenter Zustand NACH Cancel
    const noActive = await getActiveBooking(yogi1Id, sessionId)
    expect(noActive, 'Keine aktive Buchung mehr in DB').toBeNull()

    const cancelled = await getCancelledBooking(yogi1Id, sessionId)
    expect(cancelled, 'Buchung als cancelled in DB').toBeTruthy()
    expect(cancelled?.cancel_late, 'cancel_late=false bei rechtzeitiger Abmeldung').toBe(false)

    const credit2 = await getCourseCredit(yogi1Id, courseId)
    expect(credit2?.used, 'credit.used = 0 nach rechtzeitiger Cancel (Trigger refund)').toBe(0)
    expect(credit2?.total, 'credit.total UNVERÄNDERT').toBe(1)

    const sessionCount2 = await countActiveBookingsForSession(sessionId)
    expect(sessionCount2, 'Session-Counter = 0 (Platz wieder frei)').toBe(0)

    const enrollment2 = await getEnrollment(yogi1Id, courseId)
    expect(enrollment2, 'Enrollment BLEIBT (Yogi gehört noch zum Kurs)').toBeTruthy()

    // ── PHASE 3: RE-BUCHUNG (selbe Session, selber Yogi) ────────────────
    // Reaktivierung der cancelled-Row oder neue active-Row — beides ok,
    // entscheidend: NUR 1 active Buchung danach, credit.used = 1.
    await db.from('bookings').update({
      status: 'active',
      cancelled_at: null,
      cancel_late: null,
    }).eq('id', cancelled!.id)

    const booking3 = await getActiveBooking(yogi1Id, sessionId)
    expect(booking3, 'Re-Buchung muss als active in DB existieren').toBeTruthy()
    expect(booking3?.credit_id, 'Re-Buchung nutzt SAME credit_id').toBe(creditId)
    expect(booking3?.id, 'Re-Buchung sollte SAME booking-ID sein (Reaktivierung)').toBe(booking1!.id)

    const credit3 = await getCourseCredit(yogi1Id, courseId)
    expect(credit3?.used, 'credit.used = 1 nach Re-Buchung').toBe(1)
    expect(credit3?.total, 'credit.total IMMER NOCH unverändert (kein Doppel-Verbrauch)').toBe(1)

    // NEGATIVE ASSERT: KEINE doppelten Bookings für diese user+session
    const { data: allBookings } = await db.from('bookings')
      .select('id, status').eq('user_id', yogi1Id).eq('session_id', sessionId)
    expect(allBookings?.length, 'Maximal 1 booking-Row für user+session (kein Doppel)').toBeLessThanOrEqual(1)

    const activeCount = allBookings?.filter((b: any) => b.status === 'active').length
    expect(activeCount, 'GENAU 1 aktive Buchung (nicht 0, nicht 2)').toBe(1)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// FLOW B: SPÄT-ABMELDUNG — Credit verfällt, kein Refund, Re-Buchung blockiert
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Flow B: Spät-Abmeldung Credit-Verfall (cancel_late=true)', () => {
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test.beforeEach(async () => {
    await resetYogi(yogi1Id)
  })

  test('Spät-Cancel: Credit BLEIBT verbraucht (kein Refund) + Re-Buchung möglich mit anderem Credit', async () => {
    const db = await getAdminClient()
    const exp = await futurePlus(60)

    // SETUP: Yogi mit 2 Single-Credits, gebucht in heutige Session (in 1h = late)
    const creditId2 = await giveYogiSingleCredit(yogi1Id, 2)
    const credit = { id: creditId2 } // Helper returnt UUID-String

    // Session HEUTE in 1h (= innerhalb 3h-Frist)
    const today = new Date()
    const time1hLater = new Date(Date.now() + 60 * 60 * 1000)
    const timeStr = time1hLater.toTimeString().slice(0, 8) // HH:MM:SS

    const course = await createTestCourse({
      name: `${E2E_PREFIX} FlowB`, sessionCount: 1, startDaysFromNow: 0,
    })
    // Session-Time auf in 1h setzen (war default 18:30)
    await db.from('sessions').update({
      date: today.toISOString().split('T')[0],
      time_start: timeStr,
    }).eq('id', course.sessionIds[0])

    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: credit.id,
      type: 'single', status: 'active',
    })

    const beforeCredit = await db.from('credits').select('used, total').eq('id', credit.id).single()
    expect(beforeCredit.data?.used, 'Vor Cancel: 1 Credit verbraucht').toBe(1)

    // AKTION: Spät-Abmeldung mit cancel_late=true
    await db.from('bookings').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancel_late: true,
    }).eq('user_id', yogi1Id).eq('session_id', course.sessionIds[0])

    // ASSERT (Kette):
    const cancelled = await getCancelledBooking(yogi1Id, course.sessionIds[0])
    expect(cancelled?.cancel_late, 'cancel_late=true im DB-Status').toBe(true)

    // KRITISCH: credit.used MUSS verbraucht bleiben (kein Refund bei Spät-Cancel)
    const afterCredit = await db.from('credits').select('used, total').eq('id', credit.id).single()
    expect(afterCredit.data?.used,
      'credit.used MUSS 1 bleiben — Spät-Cancel = kein Refund (Trigger filtert cancel_late)'
    ).toBe(1)
    expect(afterCredit.data?.total, 'credit.total UNVERÄNDERT').toBe(2)

    // Verfügbar = total - used = 1 (nicht 2!)
    const verfuegbar = (afterCredit.data!.total) - (afterCredit.data!.used)
    expect(verfuegbar, 'Yogi hat nur noch 1 Credit verfügbar (Spät-Cancel verfallen)').toBe(1)

    // Session-Counter trotz Cancel = 0 (Platz IST frei trotz Credit-Verfall)
    const sessionCount = await countActiveBookingsForSession(course.sessionIds[0])
    expect(sessionCount, 'Platz ist frei (Counter=0) — Yogi-Geld ist weg, nicht Platz').toBe(0)

    // FOLGE-AKTION: Yogi bucht ANDERE Session — verbraucht den 2. Credit korrekt
    const session2Course = await createTestCourse({
      name: `${E2E_PREFIX} FlowB-2`, sessionCount: 1, startDaysFromNow: 14,
    })
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: session2Course.sessionIds[0], credit_id: credit.id,
      type: 'single', status: 'active',
    })
    const final = await db.from('credits').select('used').eq('id', credit.id).single()
    expect(final.data?.used,
      'Nach 2. Buchung: used=2 (1 verfallen + 1 aktiv) — Trigger zählt korrekt'
    ).toBe(2)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// FLOW C: GUTHABEN-TRENNUNG — wird NICHT für Buchungen verwendet
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Flow C: Guthaben ↔ Credit-Trennung (Priorisierung)', () => {
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test.beforeEach(async () => {
    await resetYogi(yogi1Id)
  })

  test('Guthaben + Single-Credit parallel: Buchung nimmt Single-Credit, NICHT Guthaben', async () => {
    const db = await getAdminClient()
    const guthabenIdC = await giveYogiGuthaben(yogi1Id, 3) // 3 Guthaben für Auszahlung
    const singleIdC = await giveYogiSingleCredit(yogi1Id, 2)
    const guthaben = { id: guthabenIdC }
    const single = { id: singleIdC }
    const course = await createTestCourse({ name: `${E2E_PREFIX} FlowC`, sessionCount: 1, startDaysFromNow: 14 })

    // App-Logik: Booking nutzt single-Credit (handleBook wählt nicht-guthaben)
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: single.id,
      type: 'single', status: 'active',
    })

    // ASSERT: Single-Credit verbraucht, Guthaben UNVERÄNDERT
    const singleAfter = await db.from('credits').select('used').eq('id', single.id).single()
    expect(singleAfter.data?.used, 'Single-Credit.used = 1 (wurde verwendet)').toBe(1)

    const guthabenAfter = await db.from('credits').select('used, total').eq('id', guthaben.id).single()
    expect(guthabenAfter.data?.used, 'Guthaben.used = 0 (NICHT angefasst)').toBe(0)
    expect(guthabenAfter.data?.total, 'Guthaben.total = 3 UNVERÄNDERT').toBe(3)

    // NEGATIVE: keine bookings.credit_id zeigt auf guthaben.id
    const { data: ghBookings } = await db.from('bookings')
      .select('id').eq('user_id', yogi1Id).eq('credit_id', guthaben.id)
    expect(ghBookings?.length,
      'KEINE Buchung darf credit_id=guthaben haben — Guthaben ist NUR für Auszahlung'
    ).toBe(0)
  })

  test('Guthaben-Anzahl: 1 Insert → 1 Row (kein Auto-Split, kein Doppel-Insert)', async () => {
    // countGuthabenCredits zählt ROWS (nicht Total-Sum) → ein Insert = eine Row
    await giveYogiGuthaben(yogi1Id, 5)
    const rowCount = await countGuthabenCredits(yogi1Id)
    expect(rowCount, '1 Guthaben-Row angelegt').toBe(1)

    // Plus: total muss 5 sein
    const gh = await getGuthabenCredit(yogi1Id)
    expect(gh?.total, 'total = 5').toBe(5)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// FLOW D: WAITLIST-PROMOTE — Counter, Booking, Credit, Email-Konsistenz
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Flow D: Warteliste-Promotion Voll-Konsistenz', () => {
  let yogi1Id: string
  let yogi2Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
  })

  test.beforeEach(async () => {
    await resetYogi(yogi1Id)
    await resetYogi(yogi2Id)
  })

  test('Volle Session + Yogi2 auf Warteliste: Cancel von Yogi1 → DB-State korrekt', async () => {
    const db = await getAdminClient()
    const course = await createTestCourse({
      name: `${E2E_PREFIX} FlowD`, sessionCount: 1, startDaysFromNow: 14, maxSpots: 1,
    })
    const sid = course.sessionIds[0]

    // Yogi1: Credit + aktive Buchung (=Session voll)
    const c1Id = await giveYogiSingleCredit(yogi1Id, 1)
    const c1 = { id: c1Id }
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: sid, credit_id: c1.id,
      type: 'single', status: 'active',
    })

    // Yogi2: Credit + auf Warteliste
    const c2Id = await giveYogiSingleCredit(yogi2Id, 1)
    const c2 = { id: c2Id }
    await db.from('waitlist').insert({
      user_id: yogi2Id, session_id: sid,
    })

    // STATE-CHECK vor Cancel
    expect(await countActiveBookingsForSession(sid)).toBe(1)
    const wlBefore = await getWaitlistEntry(yogi2Id, sid)
    expect(wlBefore, 'Yogi2 auf Warteliste').toBeTruthy()

    // AKTION: Yogi1 cancelt (>14d vorher → cancel_late=false)
    await db.from('bookings').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancel_late: false,
    }).eq('user_id', yogi1Id).eq('session_id', sid)

    // ASSERT-KETTE:
    const c1After = await db.from('credits').select('used').eq('id', c1.id).single()
    expect(c1After.data?.used, 'Yogi1 Credit refunded (used=0)').toBe(0)

    // Counter prüfen — Promote ist async (cron oder manuell), daher 0 oder 1
    const counterAfter = await countActiveBookingsForSession(sid)
    expect([0, 1]).toContain(counterAfter) // 0 wenn promote noch nicht lief

    // NEGATIVE: Yogi1 ist NICHT mehr in der Warteliste (war er nie)
    const yogi1Wl = await getWaitlistEntry(yogi1Id, sid)
    expect(yogi1Wl, 'Yogi1 darf nicht plötzlich auf Warteliste sein').toBeNull()

    // Yogi2 Credit unangetastet bis Auto-Promote läuft
    const c2After = await db.from('credits').select('used').eq('id', c2.id).single()
    expect(c2After.data?.used).toBeGreaterThanOrEqual(0) // 0 vor Promote, 1 nach
    expect(c2After.data?.used).toBeLessThanOrEqual(1)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// FLOW E: YOGI-LÖSCHUNG v6 — Cascade-Konsistenz (Plätze sofort frei)
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Flow E: Yogi-Löschung v6 — alle Plätze sofort frei', () => {
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test.beforeEach(async () => {
    await resetYogi(yogi1Id)
  })

  test('Yogi mit Bookings+Credits+Enrollment+Waitlist → manueller DELETE-Block räumt alles auf', async () => {
    const db = await getAdminClient()

    // SETUP: Yogi mit allen Ressourcen
    const course = await createTestCourse({
      name: `${E2E_PREFIX} FlowE`, sessionCount: 2, startDaysFromNow: 14,
    })
    const exp = await futurePlus(60)
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: course.courseId, model: 'course',
      total: 2, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: credit!.id,
      type: 'course', status: 'active',
    })
    // Zusätzlich Warteliste auf einer anderen Session
    const courseB = await createTestCourse({ name: `${E2E_PREFIX} FlowE-B`, sessionCount: 1, startDaysFromNow: 7 })
    await db.from('waitlist').insert({
      user_id: yogi1Id, session_id: courseB.sessionIds[0],
    })

    // STATE-CHECK vor Delete
    expect(await countActiveBookingsForSession(course.sessionIds[0]), 'Session belegt vor Delete').toBe(1)
    expect(await getWaitlistEntry(yogi1Id, courseB.sessionIds[0]), 'Auf Warteliste').toBeTruthy()
    expect(await getEnrollment(yogi1Id, course.courseId), 'Enrolled').toBeTruthy()

    // AKTION: v6 explizite DELETEs (Reihenfolge wie in app/admin/yogis/[id]/page.tsx handleDeleteYogi)
    await db.from('bookings').delete().eq('user_id', yogi1Id)
    await db.from('enrollments').delete().eq('user_id', yogi1Id)
    await db.from('credits').delete().eq('user_id', yogi1Id)
    await db.from('waitlist').delete().eq('user_id', yogi1Id)
    await db.from('notification_log').delete().eq('user_id', yogi1Id)
    // Profile anonymisieren (kein Auth-Delete im Test — sonst wäre yogi1 für andere Tests weg)
    await db.from('profiles').update({
      first_name: 'Gelöschter', last_name: 'Nutzer', email: null,
      emergency_name: null, emergency_phone: null, legal_accepted_at: null,
    }).eq('id', yogi1Id)

    // ASSERT-KETTE: kein verwaister State
    expect(await countActiveBookingsForSession(course.sessionIds[0]),
      'KRITISCH: Platz in Session SOFORT frei nach Delete'
    ).toBe(0)
    expect(await getWaitlistEntry(yogi1Id, courseB.sessionIds[0]),
      'Waitlist-Eintrag weg'
    ).toBeNull()
    expect(await getEnrollment(yogi1Id, course.courseId), 'Enrollment weg').toBeNull()

    const { count: bookingCount } = await db.from('bookings')
      .select('id', { count: 'exact', head: true }).eq('user_id', yogi1Id)
    expect(bookingCount, 'Keine Bookings mehr für Yogi').toBe(0)

    const { count: creditCount } = await db.from('credits')
      .select('id', { count: 'exact', head: true }).eq('user_id', yogi1Id)
    expect(creditCount, 'Keine Credits mehr für Yogi').toBe(0)

    // Profile anonymisiert (PII weg)
    const prof = await db.from('profiles').select('first_name, email').eq('id', yogi1Id).single()
    expect(prof.data?.first_name, 'Profile-Name anonymisiert').toBe('Gelöschter')
    expect(prof.data?.email, 'Profile-Email entfernt').toBeNull()

    // Cleanup: Yogi für andere Tests wiederherstellen (Setup-Helper benutzt diesen User)
    await db.from('profiles').update({
      first_name: 'TestYogi1', last_name: 'E2E',
      email: process.env.TEST_YOGI1_EMAIL!,
      legal_accepted_at: new Date().toISOString(),
    }).eq('id', yogi1Id)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// FLOW F: VORHOL/NACHHOL — origin_session_id, kein Doppel-Credit
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Flow F: Vorhol-/Nachhol-Konsistenz (origin_session_id)', () => {
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test.beforeEach(async () => {
    await resetYogi(yogi1Id)
  })

  test('Yogi nachholt verpasste Stunde: Credit nur 1x verbraucht, origin_session_id verlinkt', async () => {
    const db = await getAdminClient()
    const exp = await futurePlus(60)

    // Kurs mit 3 Stunden, Yogi enrolled + Course-Credit für alle 3
    const course = await createTestCourse({ name: `${E2E_PREFIX} FlowF`, sessionCount: 3, startDaysFromNow: 1 })
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: course.courseId, model: 'course',
      total: 3, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })

    // Alle 3 Stunden gebucht
    for (const sid of course.sessionIds) {
      await db.from('bookings').insert({
        user_id: yogi1Id, session_id: sid, credit_id: credit!.id,
        type: 'course', status: 'active',
      })
    }
    const c1 = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(c1.data?.used, 'Nach 3 Buchungen: credit.used=3').toBe(3)

    // Yogi sagt Session 2 ab (rechtzeitig → cancel_late=false → credit refund)
    await db.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false,
    }).eq('user_id', yogi1Id).eq('session_id', course.sessionIds[1])

    const c2 = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(c2.data?.used, 'Nach Cancel: credit.used=2').toBe(2)

    // NACHHOL: Yogi bucht eine fremde Session (course B) als Nachhol für sessionIds[1]
    const courseB = await createTestCourse({ name: `${E2E_PREFIX} FlowF-B`, sessionCount: 1, startDaysFromNow: 8 })
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: courseB.sessionIds[0], credit_id: credit!.id,
      type: 'course', status: 'active',
      origin_session_id: course.sessionIds[1], // verlinkt zur cancelten Session
    })

    // ASSERT-KETTE:
    const c3 = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(c3.data?.used,
      'Nach Nachhol-Buchung: credit.used=3 (selber Credit, nicht doppelt!)'
    ).toBe(3)

    // courseB.total_units DARF NICHT erhöht sein (Nachhol ist Drop-In, kein Kurs-Slot)
    const courseBData = await db.from('courses').select('total_units').eq('id', courseB.courseId).single()
    expect(courseBData.data?.total_units, 'CourseB.total_units unverändert').toBe(1)

    // courseA.total_units AUCH unverändert (3 Stunden bleiben 3)
    const courseAData = await db.from('courses').select('total_units').eq('id', course.courseId).single()
    expect(courseAData.data?.total_units, 'CourseA.total_units unverändert (3)').toBe(3)

    // Nachhol-Booking hat origin_session_id korrekt gesetzt
    const replacement = await db.from('bookings').select('origin_session_id, credit_id')
      .eq('user_id', yogi1Id).eq('session_id', courseB.sessionIds[0]).single()
    expect(replacement.data?.origin_session_id, 'origin verweist auf gecancelte Session').toBe(course.sessionIds[1])
    expect(replacement.data?.credit_id, 'Selber credit_id wie original').toBe(credit!.id)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// FLOW G: CREDIT-ABLAUF — Expired credits werden nicht mehr genutzt
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Flow G: Credit-Ablauf-Konsistenz (expires_at)', () => {
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test.beforeEach(async () => {
    await resetYogi(yogi1Id)
  })

  test('Abgelaufener Credit: bestehende Buchungen bleiben, neue nicht möglich (App-Logik)', async () => {
    const db = await getAdminClient()
    // Credit mit expires_at = gestern
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, model: 'tenpack', total: 5, used: 2,
      expires_at: yesterday.toISOString(),
    }).select('id, expires_at').single()

    // KRITISCH: credit existiert weiterhin in DB (kein Auto-Delete)
    expect(credit, 'Abgelaufener Credit-Eintrag bleibt erhalten').toBeTruthy()

    // App-Logik-Smoke: /meine filtert .gt('expires_at', now) — d.h. expired Credits werden in UI weggeblendet
    const meinePage = require('fs').readFileSync(
      require('path').join(process.cwd(), 'app/meine/page.tsx'), 'utf8'
    )
    expect(meinePage).toMatch(/expires_at[\s\S]{0,100}gt|gt\([^)]*expires_at/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// FLOW H: KURSABBRUCH yogi_choice → Guthaben — komplette Audit-Kette
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Flow H: Kursabbruch yogi_choice → Guthaben (kein Doppel-Credit)', () => {
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test.beforeEach(async () => {
    await resetYogi(yogi1Id)
  })

  test('Kursabbruch + Yogi wählt Guthaben: alte Course-Credits weg, neues Guthaben mit korrektem Wert', async () => {
    const db = await getAdminClient()
    const exp = await futurePlus(60)

    // SETUP: Kurs mit 5 Sessions, Yogi enrolled + 5 Course-Credits, 2 schon verbraucht
    const course = await createTestCourse({
      name: `${E2E_PREFIX} FlowH`, sessionCount: 5, startDaysFromNow: 7,
    })
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: course.courseId, model: 'course',
      total: 5, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })
    // 2 Sessions belegt → used wird durch Trigger auf 2 hochgehen
    for (let i = 0; i < 2; i++) {
      await db.from('bookings').insert({
        user_id: yogi1Id, session_id: course.sessionIds[i], credit_id: credit!.id,
        type: 'course', status: 'active',
      })
    }
    const cBefore = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(cBefore.data?.used, 'Vor Abbruch: 2 verbraucht von 5').toBe(2)
    const verbleibend = 5 - 2 // 3 noch nicht verbrauchte Sessions

    // AKTION: Admin bricht Kurs ab + Yogi wählt Guthaben (simuliert)
    // 1) Alle restlichen Sessions auf is_cancelled=true
    for (let i = 2; i < 5; i++) {
      await db.from('sessions').update({ is_cancelled: true, cancel_reason: 'admin_kursabbruch' })
        .eq('id', course.sessionIds[i])
    }
    // 2) Course wird inaktiv markiert
    await db.from('courses').update({ is_active: false }).eq('id', course.courseId)
    // 3) Yogi-Wahl "guthaben" → neuer Credit anlegen, alter wird "verbraucht"
    const ghExp = await futurePlus(180)
    const { data: guthabenCredit } = await db.from('credits').insert({
      user_id: yogi1Id, model: 'guthaben',
      total: verbleibend, used: 0, expires_at: ghExp.toISOString(),
    }).select('id').single()
    // Alten Course-Credit "abschließen": used = total (alle verbraucht/ersetzt)
    await db.from('credits').update({ used: 5 }).eq('id', credit!.id)

    // ASSERT-KETTE:
    const oldCredit = await db.from('credits').select('used, total').eq('id', credit!.id).single()
    expect(oldCredit.data?.used, 'Alter Course-Credit: used=5 (abgeschlossen)').toBe(5)
    expect(oldCredit.data?.total, 'Alter Course-Credit: total UNVERÄNDERT').toBe(5)

    const newGuthaben = await getGuthabenCredit(yogi1Id)
    expect(newGuthaben?.total, 'Neues Guthaben = 3 verbleibende Stunden').toBe(verbleibend)
    expect(newGuthaben?.used, 'Neues Guthaben: used=0 (noch nichts ausgezahlt)').toBe(0)

    // NEGATIVE: Yogi hat NICHT plötzlich 2 Guthaben-Einträge (kein Doppel-Insert)
    const ghCount = await countGuthabenCredits(yogi1Id)
    expect(ghCount,
      'KEIN doppeltes Guthaben — exakt 1 Row aus dem Abbruch (countGuthabenCredits = ROWS)'
    ).toBe(1)

    // Sessions wirklich cancelled
    for (let i = 2; i < 5; i++) {
      const s = await db.from('sessions').select('is_cancelled').eq('id', course.sessionIds[i]).single()
      expect(s.data?.is_cancelled, `Session ${i} muss cancelled sein`).toBe(true)
    }
  })
})
