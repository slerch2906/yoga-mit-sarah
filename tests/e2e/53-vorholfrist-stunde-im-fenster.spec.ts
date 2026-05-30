/**
 * Phase 2 (Sarah 2026-05-30): Dedizierter Nachweis der Kern-Regel zur Vorhol-/
 * Nachholfrist.
 *
 *   Eine Stunde (auch beim Vorholen/Nachholen) ist NUR dann buchbar, wenn die
 *   STUNDE SELBST innerhalb des erlaubten Zeitfensters liegt (z.B. bis 8 Tage
 *   nach Kursende). Der reine BUCHUNGS-Zeitpunkt ist NICHT entscheidend.
 *
 * Technischer Anker in lib/credit-selector.ts:
 *   - `.gt('expires_at', sessionIso)` → der Credit muss bis zum SESSION-Zeitpunkt
 *     gueltig sein (nicht nur "jetzt").
 *   - Origin-Fenster `[origin - 10d, courseEnd + 8d]` in tryCourseCredit().
 *
 * Wir rufen selectCreditForBooking direkt auf (DB-zentrisch) — das ist stabil
 * gegen Production-UI-Drift und prueft das eigentliche Buchungs-Modell.
 */
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { selectCreditForBooking } from '../../lib/credit-selector'
import { getAdminClient, getUserIdByEmail } from '../utils/db'
import { createTestCourse, E2E_PREFIX } from '../utils/seed'

dotenv.config({ path: '.env.test' })

// ── Helpers (lokal, damit der zentrale Test-Helper-Layer schlank bleibt) ──────

/** Yogi komplett leeren */
async function resetYogi(userId: string) {
  const db = await getAdminClient()
  await db.from('waitlist').delete().eq('user_id', userId)
  await db.from('bookings').delete().eq('user_id', userId)
  await db.from('credits').delete().eq('user_id', userId)
  await db.from('enrollments').delete().eq('user_id', userId)
}

/** Service-Client (umgeht RLS) fuer den direkten Aufruf von selectCreditForBooking */
function makeServiceClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Datum x Tage von heute als YYYY-MM-DD */
function dateStr(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().split('T')[0]
}

/**
 * Yogi in einen (beendeten) Kurs einschreiben, einen Course-Credit mit
 * definiertem Ablauf anlegen, die Origin-Stunde buchen UND wieder absagen.
 * Ergebnis: 1 freier Course-Credit-Anspruch (origin = die abgesagte Stunde).
 */
async function enrollFreeCourseCredit(
  userId: string, courseId: string, originSessionId: string, expiresAt: Date,
): Promise<string> {
  const db = await getAdminClient()
  const { data: credit } = await db.from('credits').insert({
    user_id: userId, course_id: courseId, model: 'course',
    total: 1, used: 0, expires_at: expiresAt.toISOString(),
  }).select('id').single()
  await db.from('enrollments').insert({ user_id: userId, course_id: courseId })
  await db.from('bookings').insert({
    user_id: userId, session_id: originSessionId, credit_id: credit?.id,
    type: 'course', status: 'active',
  })
  // Origin-Stunde absagen → Credit-Anspruch wird frei (origin-faehig)
  await db.from('bookings').update({
    status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false,
  }).eq('user_id', userId).eq('session_id', originSessionId)
  return credit?.id as string
}

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Vorholfrist: die STUNDE muss im Fenster liegen (nicht der Buchungszeitpunkt)', () => {
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test.beforeEach(async () => {
    await resetYogi(yogi1Id)
  })

  test.afterAll(async () => {
    await resetYogi(yogi1Id)
  })

  test('[E2E] Buchung HEUTE fuer eine Stunde in 2 Wochen (ausserhalb 8d-nach-Kursende) → blockiert', async () => {
    // Setup: Der Kurs ist bereits beendet (date_end = gestern). Der freie
    // Course-Credit ist deshalb noch genau ~7 Tage gueltig (= 8 Tage nach
    // Kursende). Der Yogi KOENNTE heute problemlos buchen — der Credit ist
    // aktuell gueltig ("wir sind auf Tag 7 des Fensters"). ABER: die Ziel-Stunde
    // liegt in 2 Wochen, also NACH Ablauf des 8-Tage-Fensters.
    // Erwartung: das System blockiert, weil die STUNDE ausserhalb liegt —
    // der Buchungszeitpunkt (heute, noch im Fenster) ist NICHT entscheidend.
    const db = await getAdminClient()
    const past = await createTestCourse({ name: `${E2E_PREFIX} Vorholfrist-Origin`, sessionCount: 1, startDaysFromNow: -1 })
    await db.from('courses').update({ date_end: dateStr(-1) }).eq('id', past.courseId)
    const origin = past.sessionIds[0]
    const expires = new Date(); expires.setDate(expires.getDate() + 7) // = courseEnd + 8d
    await enrollFreeCourseCredit(yogi1Id, past.courseId, origin, expires)

    const target = await createTestCourse({ name: `${E2E_PREFIX} Vorholfrist-Ziel-2W`, sessionCount: 1, startDaysFromNow: 14 })
    const targetSessionId = target.sessionIds[0]

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogi1Id, targetSessionId, dateStr(14), '18:30:00')

    expect(pick.ok).toBe(false)
    if (!pick.ok) {
      expect(pick.reason).toBe('window_blocked')
      // Genau die Sarah-Meldung: Stunde liegt ausserhalb "8 Tage nach Kursende"
      expect(pick.message).toMatch(/8 Tage nach Kursende/i)
    }
  })

  test('[E2E] Kontrolle: gleicher Credit, gleicher Buchungstag — Stunde in 5 Tagen (im Fenster) → erlaubt', async () => {
    // Exakt dasselbe Setup, nur die Ziel-Stunde liegt INNERHALB des Fensters
    // (in 5 Tagen, vor Credit-Ablauf in 7 Tagen). Damit ist bewiesen: nicht der
    // Buchungszeitpunkt (in beiden Faellen "heute") entscheidet, sondern das
    // Datum der zu buchenden STUNDE.
    const db = await getAdminClient()
    const past = await createTestCourse({ name: `${E2E_PREFIX} Vorholfrist-Origin-OK`, sessionCount: 1, startDaysFromNow: -1 })
    await db.from('courses').update({ date_end: dateStr(-1) }).eq('id', past.courseId)
    const origin = past.sessionIds[0]
    const expires = new Date(); expires.setDate(expires.getDate() + 7)
    const creditId = await enrollFreeCourseCredit(yogi1Id, past.courseId, origin, expires)

    const target = await createTestCourse({ name: `${E2E_PREFIX} Vorholfrist-Ziel-5T`, sessionCount: 1, startDaysFromNow: 5 })
    const targetSessionId = target.sessionIds[0]

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogi1Id, targetSessionId, dateStr(5), '18:30:00')

    expect(pick.ok).toBe(true)
    if (pick.ok) {
      expect(pick.usedModel).toBe('course')
      expect(pick.originSessionId).toBe(origin)
      expect(pick.creditId).toBe(creditId)
    }
  })

  test('[E2E] Auch modell-uebergreifend: Credit heute gueltig, Stunde nach Ablauf → blockiert', async () => {
    // Verallgemeinerung ueber Course-Credits hinaus: ein Tenpack-Credit laeuft
    // in 7 Tagen ab. Eine Buchung HEUTE waere gedeckt — aber die Ziel-Stunde
    // liegt in 14 Tagen, also nach Credit-Ablauf. Da der Gueltigkeits-Check
    // an den SESSION-Zeitpunkt gebunden ist (.gt('expires_at', sessionIso)),
    // wird die Buchung blockiert.
    const db = await getAdminClient()
    const exp = new Date(); exp.setDate(exp.getDate() + 7)
    await db.from('credits').insert({
      user_id: yogi1Id, course_id: null, model: 'tenpack',
      total: 5, used: 0, expires_at: exp.toISOString(),
    })

    const target = await createTestCourse({ name: `${E2E_PREFIX} Vorholfrist-Tenpack-2W`, sessionCount: 1, startDaysFromNow: 14 })
    const targetSessionId = target.sessionIds[0]

    const supa = makeServiceClient()
    const pick = await selectCreditForBooking(supa, yogi1Id, targetSessionId, dateStr(14), '18:30:00')

    expect(pick.ok).toBe(false)
    if (!pick.ok) {
      expect(pick.reason).toBe('no_credit')
      expect(pick.message).toMatch(/läuft am.*ab.*nicht mehr gültig/i)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Harte Grenzen (Sarah-Entscheidung 2026-05-30): VORHOLEN = max. 10 Tage VOR der
// abgesagten Stunde (origin-bezogen, NICHT buchungstag-bezogen); NACHHOLEN = max.
// 8 Tage NACH Kursende des Ursprungskurses.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Vorhol-/Nachhol-Grenzen (origin-bezogen): 10 Tage vor / 8 Tage nach', () => {
  let yogi1Id: string
  test.beforeAll(async () => { yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))! })
  test.beforeEach(async () => { await resetYogi(yogi1Id) })
  test.afterAll(async () => { await resetYogi(yogi1Id) })

  test('[E2E] VORHOLEN: Stunde genau 10 Tage vor Origin → erlaubt, >10 Tage vorher → blockiert', async () => {
    const db = await getAdminClient()
    // Abgesagte Stunde (Origin) in 12 Tagen → Vorhol-Fenster ab Origin - 10 Tage (= in 2 Tagen).
    const origin = await createTestCourse({ name: `${E2E_PREFIX} Vorhol-Grenze`, sessionCount: 1, startDaysFromNow: 12 })
    await db.from('courses').update({ date_end: dateStr(12) }).eq('id', origin.courseId)
    const exp = new Date(); exp.setDate(exp.getDate() + 200)
    await enrollFreeCourseCredit(yogi1Id, origin.courseId, origin.sessionIds[0], exp)
    const supa = makeServiceClient()

    // Genau an der Grenze (Origin − 10 Tage = +2 Tage) → erlaubt
    const atEdge = await createTestCourse({ name: `${E2E_PREFIX} Vorhol-Edge`, sessionCount: 1, startDaysFromNow: 2 })
    const pickEdge = await selectCreditForBooking(supa, yogi1Id, atEdge.sessionIds[0], dateStr(2), '18:30:00')
    expect(pickEdge.ok, 'Stunde genau 10 Tage vor Origin → erlaubt').toBe(true)

    // Zu früh (Origin − 11 Tage = +1 Tag) → blockiert
    const tooEarly = await createTestCourse({ name: `${E2E_PREFIX} Vorhol-Zufrueh`, sessionCount: 1, startDaysFromNow: 1 })
    const pickEarly = await selectCreditForBooking(supa, yogi1Id, tooEarly.sessionIds[0], dateStr(1), '18:30:00')
    expect(pickEarly.ok, 'Stunde >10 Tage vor Origin → blockiert').toBe(false)
  })

  test('[E2E] NACHHOLEN: Stunde bis 8 Tage nach Kursende → erlaubt, >8 Tage → blockiert', async () => {
    const db = await getAdminClient()
    // Kurs endete gestern (date_end = −1) → Nachhol-Fenster bis Kursende + 8 Tage (= +7).
    const past = await createTestCourse({ name: `${E2E_PREFIX} Nachhol-Grenze`, sessionCount: 1, startDaysFromNow: -1 })
    await db.from('courses').update({ date_end: dateStr(-1) }).eq('id', past.courseId)
    const exp = new Date(); exp.setDate(exp.getDate() + 8) // Credit gültig bis Kursende+8
    await enrollFreeCourseCredit(yogi1Id, past.courseId, past.sessionIds[0], exp)
    const supa = makeServiceClient()

    // 5 Tage nach Kursende → innerhalb 8 Tage → erlaubt
    const inWin = await createTestCourse({ name: `${E2E_PREFIX} Nachhol-In`, sessionCount: 1, startDaysFromNow: 5 })
    const pickIn = await selectCreditForBooking(supa, yogi1Id, inWin.sessionIds[0], dateStr(5), '18:30:00')
    expect(pickIn.ok, 'Stunde 5 Tage nach Kursende → erlaubt').toBe(true)

    // 9 Tage nach Kursende → außerhalb 8 Tage → blockiert
    const outWin = await createTestCourse({ name: `${E2E_PREFIX} Nachhol-Out`, sessionCount: 1, startDaysFromNow: 9 })
    const pickOut = await selectCreditForBooking(supa, yogi1Id, outWin.sessionIds[0], dateStr(9), '18:30:00')
    expect(pickOut.ok, 'Stunde >8 Tage nach Kursende → blockiert').toBe(false)
  })
})
