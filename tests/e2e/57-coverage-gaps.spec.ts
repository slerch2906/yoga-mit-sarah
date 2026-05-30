/**
 * Coverage-Gaps (Sarah 2026-05-30): Standard-User-Stories, die bisher NICHT
 * end-to-end abgesichert waren (Audit nach dem Einladung+Kurs-Bug).
 * Echte Klick→Konsequenz-Tests auf DB/RPC/Route-Ebene (deterministisch).
 */
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { getAdminClient, getUserIdByEmail } from '../utils/db'
import { createTestCourse, E2E_PREFIX } from '../utils/seed'
import { selectCreditForBooking } from '../../lib/credit-selector'

dotenv.config({ path: '.env.test' })
function svc() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
function berlinInMinutes(minutes: number): { date: string; time: string } {
  const d = new Date(Date.now() + minutes * 60 * 1000)
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t: string) => p.find(x => x.type === t)!.value
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}:${g('second')}` }
}
async function resetYogi(userId: string) {
  const db = await getAdminClient()
  await db.from('waitlist').delete().eq('user_id', userId)
  await db.from('bookings').delete().eq('user_id', userId)
  await db.from('credits').delete().eq('user_id', userId)
  await db.from('enrollments').delete().eq('user_id', userId)
}

// ════════════════════════════════════════════════════════════════════════════
// Gap #10: Guthaben ist NICHT für Einzelstunden nutzbar (Blockade + no_credit)
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Coverage: Guthaben nicht für Einzelstunden', () => {
  let yogi1Id: string
  test.beforeAll(async () => { yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))! })
  test.beforeEach(async () => { await resetYogi(yogi1Id) })
  test.afterAll(async () => { await resetYogi(yogi1Id) })

  test('[E2E] Yogi mit NUR Guthaben kann keine Einzelstunde buchen → no_credit', async () => {
    const db = await getAdminClient()
    // Einzelstunde (single) in der Zukunft
    const course = await createTestCourse({ name: `${E2E_PREFIX} Guthaben-Single`, sessionCount: 1, startDaysFromNow: 5 })
    const sessionId = course.sessionIds[0]
    await db.from('sessions').update({ session_type: 'single' }).eq('id', sessionId)
    const when = berlinInMinutes(5 * 24 * 60)

    // Yogi hat AUSSCHLIESSLICH ein Guthaben (model='guthaben')
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    await db.from('credits').insert({
      user_id: yogi1Id, course_id: null, model: 'guthaben', source: 'cancellation_choice',
      total: 5, used: 0, expires_at: exp.toISOString(),
    })

    const pick = await selectCreditForBooking(svc(), yogi1Id, sessionId, when.date, when.time)
    expect(pick.ok, 'Guthaben darf NICHT für eine Einzelstunde greifen').toBe(false)
    if (!pick.ok) expect(pick.reason).toBe('no_credit')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Gap #8: Late-Offer-Annahme OHNE freien Credit → 402, Rollback, Platz frei
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Coverage: Late-Offer ohne Credit → Rollback', () => {
  let yogi2Id: string
  test.beforeAll(async () => { yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))! })
  test.beforeEach(async () => { await resetYogi(yogi2Id) })
  test.afterAll(async () => { await resetYogi(yogi2Id) })

  test('[E2E] Annahme ohne Credit → 402 no_credit, Offer zurückgerollt, kein Booking', async () => {
    const db = await getAdminClient()
    const s = svc()
    const course = await createTestCourse({ name: `${E2E_PREFIX} LateOffer-NoCredit`, sessionCount: 1, startDaysFromNow: 0 })
    const sessionId = course.sessionIds[0]
    const when = berlinInMinutes(45)
    await db.from('sessions').update({ date: when.date, time_start: when.time }).eq('id', sessionId)
    await db.from('courses').update({ date_start: when.date, date_end: when.date }).eq('id', course.courseId)

    // Yogi2 auf Warteliste, aber OHNE freien Credit
    await db.from('waitlist').insert({ user_id: yogi2Id, session_id: sessionId, type: 'waitlist' })
    const sessStartIso = new Date(`${when.date}T${when.time}`).toISOString()
    const { data: offer } = await s.from('waitlist_offers').insert({
      session_id: sessionId, user_id: yogi2Id, expires_at: sessStartIso,
    }).select('token').single()

    try {
      const res = await fetch(`${process.env.BASE_URL}/api/waitlist-offer/${offer!.token}`, { method: 'POST' })
      expect(res.status, 'ohne Credit → HTTP 402').toBe(402)
      const json = await res.json().catch(() => ({}))
      expect(json?.error).toBe('no_credit')

      // Kein aktives Booking angelegt
      const { data: bk } = await db.from('bookings').select('id')
        .eq('user_id', yogi2Id).eq('session_id', sessionId).eq('status', 'active')
      expect((bk || []).length, 'kein Booking ohne Credit').toBe(0)
      // Offer zurückgerollt (resolved_winner_user_id wieder null → nächster Yogi könnte klicken)
      const { data: offers } = await db.from('waitlist_offers').select('resolved_winner_user_id').eq('session_id', sessionId)
      expect((offers || []).every((o: any) => o.resolved_winner_user_id === null), 'Offer zurückgerollt').toBe(true)
      // Audit: waitlist_offer_rollback mit reason no_credit
      const { data: audit } = await s.from('audit_log').select('id, details')
        .eq('action', 'waitlist_offer_rollback').eq('user_id', yogi2Id)
        .order('created_at', { ascending: false }).limit(1)
      expect((audit || []).length, 'Rollback im Audit protokolliert').toBeGreaterThan(0)
    } finally {
      await s.from('audit_log').delete().eq('action', 'waitlist_offer_rollback').eq('user_id', yogi2Id)
      await s.from('waitlist_offers').delete().eq('session_id', sessionId)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Gap #6: Bulk-Mail — Schutz-Guards (KEIN Live-Versand getestet)
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Coverage: Bulk-Mail Guards (kein Live-Versand)', () => {
  test('[E2E] POST ohne Subject → 400; ohne Token → 401 (Versand-Pfad nie erreicht)', async () => {
    const base = process.env.BASE_URL!
    // Leeres Subject → 400 (vor jeglichem Versand/Auth)
    const r400 = await fetch(`${base}/api/admin/bulk-mail`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: '', body: '' }),
    })
    expect(r400.status, 'leeres Subject → 400').toBe(400)
    // Subject+Body aber kein Auth-Token → 401 (Versand-Pfad nicht erreicht)
    const r401 = await fetch(`${base}/api/admin/bulk-mail`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'E2E', body: 'E2E' }),
    })
    expect(r401.status, 'ohne Token → 401').toBe(401)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Gap #7: Platz wird frei (Storno) > 90 Min → Warteliste-Yogi rückt automatisch nach
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Coverage: Freier Platz → Warteliste-Nachrücken', () => {
  let yogi1Id: string
  let yogi2Id: string
  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
  })
  test.beforeEach(async () => { await resetYogi(yogi1Id); await resetYogi(yogi2Id) })
  test.afterAll(async () => { await resetYogi(yogi1Id); await resetYogi(yogi2Id) })

  test('[E2E] Yogi1 storniert (Platz frei, >90 Min) → Yogi2 von Warteliste eingebucht', async () => {
    const db = await getAdminClient()
    const s = svc()
    const course = await createTestCourse({ name: `${E2E_PREFIX} Promote-Chain`, sessionCount: 1, startDaysFromNow: 0 })
    const sessionId = course.sessionIds[0]
    const when = berlinInMinutes(120) // > 90 Min → Auto-Promote-Pfad
    await db.from('sessions').update({ date: when.date, time_start: when.time, max_spots: 1 }).eq('id', sessionId)
    await db.from('courses').update({ date_start: when.date, date_end: when.date, max_spots: 1 }).eq('id', course.courseId)

    // Yogi1 belegt den einzigen Platz, dann storniert er (Booking cancelled)
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: sessionId, credit_id: null, type: 'single',
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false, cancelled_by: 'self',
    })
    // Yogi2 wartet + hat einen freien Credit zum Nachrücken
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    await db.from('credits').insert({ user_id: yogi2Id, course_id: null, model: 'single', total: 3, used: 0, expires_at: exp.toISOString() })
    await db.from('waitlist').insert({ user_id: yogi2Id, session_id: sessionId, type: 'waitlist', position: 1 })

    const res = await s.rpc('process_cancellation_full', { p_session_id: sessionId })
    expect(res.error).toBeNull()
    expect((res.data as any)?.mode).toBe('auto-promoted')

    // Yogi2 ist jetzt aktiv eingebucht + von der Warteliste entfernt
    const { data: bk } = await db.from('bookings').select('id, status, promoted_at')
      .eq('user_id', yogi2Id).eq('session_id', sessionId).eq('status', 'active').maybeSingle()
    expect(bk, 'Yogi2 wurde nachgerückt').toBeTruthy()
    expect(bk?.promoted_at, 'promoted_at gesetzt (Auto-Promote)').toBeTruthy()
    const { data: wl } = await db.from('waitlist').select('id').eq('user_id', yogi2Id).eq('session_id', sessionId)
    expect((wl || []).length, 'Warteliste-Eintrag entfernt').toBe(0)
    // Audit waitlist_promoted für Yogi2
    const { data: audit } = await s.from('audit_log').select('id')
      .eq('action', 'waitlist_promoted').eq('user_id', yogi2Id).order('created_at', { ascending: false }).limit(1)
    expect((audit || []).length, 'waitlist_promoted protokolliert').toBeGreaterThan(0)
    await s.from('audit_log').delete().eq('action', 'waitlist_promoted').eq('user_id', yogi2Id)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Gap #4: Bezahltes Event (event_paid) — Buchung ohne Credit + 7-Tage-Storno-Sperre
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Coverage: Event (event_paid) — kein Credit + 7-Tage-Storno', () => {
  let yogi1Id: string
  test.beforeAll(async () => { yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))! })
  test.beforeEach(async () => { await resetYogi(yogi1Id) })
  test.afterAll(async () => { await resetYogi(yogi1Id) })

  test('[E2E] Buchung ohne Credit + <7d Selbst-Abmeldung blockiert, Gnadenfrist/>7d erlaubt', async () => {
    const db = await getAdminClient()
    // svc() = rohe Service-Role → auth.uid() ist NULL → Trigger behandelt als Nicht-Admin
    // (getAdminClient ist als Admin-User eingeloggt und würde die 7d-Sperre umgehen).
    const s = svc()

    // ── event_paid in 3 Tagen (INNERHALB der 7-Tage-Frist) ────────────────────
    const c1 = await createTestCourse({ name: `${E2E_PREFIX} EventPaid-Near`, sessionCount: 1, startDaysFromNow: 3 })
    const sNear = c1.sessionIds[0]
    const w3 = berlinInMinutes(3 * 24 * 60)
    // event_paid erfordert price_eur (CHECK sessions_price_only_for_paid_events).
    const upd1 = await db.from('sessions').update({ date: w3.date, time_start: w3.time, session_type: 'event_paid', price_eur: 30 }).eq('id', sNear)
    expect(upd1.error, 'Session als event_paid markierbar').toBeNull()

    // Event-Buchung OHNE Credit (Events verbrauchen keinen Credit) → muss durchgehen
    const ins = await db.from('bookings').insert({
      user_id: yogi1Id, session_id: sNear, credit_id: null, type: 'single', status: 'active',
    })
    expect(ins.error, 'Event-Buchung ohne Credit ist möglich').toBeNull()

    // Selbst-Abmeldung (active→cancelled) als Nicht-Admin → 7-Tage-Sperre greift
    const blocked = await s.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false, cancelled_by: 'self',
    }).eq('user_id', yogi1Id).eq('session_id', sNear)
    expect(blocked.error, 'event_paid <7d: Selbst-Abmeldung blockiert').toBeTruthy()
    expect(`${blocked.error?.message || ''} ${blocked.error?.details || ''}`).toMatch(/7-Tage|Stornofrist/i)
    const { data: still } = await db.from('bookings').select('status').eq('user_id', yogi1Id).eq('session_id', sNear).maybeSingle()
    expect(still?.status, 'Buchung bleibt aktiv').toBe('active')

    // 60-Min-Nachrück-Gnadenfrist (promoted_at gerade gesetzt) → Abmeldung trotz <7d erlaubt
    await db.from('bookings').update({ promoted_at: new Date().toISOString() }).eq('user_id', yogi1Id).eq('session_id', sNear)
    const grace = await s.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false, cancelled_by: 'self',
    }).eq('user_id', yogi1Id).eq('session_id', sNear)
    expect(grace.error, '60-Min-Gnadenfrist erlaubt Abmeldung trotz <7d').toBeNull()

    // ── event_paid in 10 Tagen (AUSSERHALB der 7-Tage-Frist) → Abmeldung erlaubt ─
    const c2 = await createTestCourse({ name: `${E2E_PREFIX} EventPaid-Far`, sessionCount: 1, startDaysFromNow: 10 })
    const sFar = c2.sessionIds[0]
    const w10 = berlinInMinutes(10 * 24 * 60)
    await db.from('sessions').update({ date: w10.date, time_start: w10.time, session_type: 'event_paid', price_eur: 30 }).eq('id', sFar)
    await db.from('bookings').insert({ user_id: yogi1Id, session_id: sFar, credit_id: null, type: 'single', status: 'active' })
    const far = await s.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false, cancelled_by: 'self',
    }).eq('user_id', yogi1Id).eq('session_id', sFar)
    expect(far.error, 'event_paid >7d: Selbst-Abmeldung erlaubt').toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Gap #3: Account-Löschung — API-Route-Guards (Auth-Boundary, KEIN echter Delete)
//   Die DSGVO-Anonymisierung + Warteliste-Cascade ist über 14-account-loeschung
//   (Source-Smoke) bzw. Gap #7 (process_cancellation_full) abgedeckt. Hier sichern
//   wir die SICHERHEITS-Grenze des Lösch-Endpoints ab (Welle S1/H1): niemand darf
//   mit fremder userId einen Delete auslösen.
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Coverage: delete-account Route-Guards', () => {
  test('[E2E] 400 ohne userId · 401 ohne Token · 403 für fremde userId', async () => {
    const base = process.env.BASE_URL!
    // 400: kein userId
    const r400 = await fetch(`${base}/api/delete-account`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    })
    expect(r400.status, 'ohne userId → 400').toBe(400)

    // 401: userId vorhanden, aber kein Auth-Token
    const r401 = await fetch(`${base}/api/delete-account`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: '00000000-0000-0000-0000-000000000001' }),
    })
    expect(r401.status, 'ohne Token → 401').toBe(401)

    // 403: gültiger Yogi-Token, aber FREMDE (nicht-existente) userId → Guard greift VOR dem Delete
    const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const yogiClient = createClient(process.env.SUPABASE_URL!, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: signIn, error: signErr } = await yogiClient.auth.signInWithPassword({
      email: process.env.TEST_YOGI1_EMAIL!, password: process.env.TEST_YOGI1_PASSWORD!,
    })
    expect(signErr).toBeNull()
    const token = signIn.session!.access_token
    const r403 = await fetch(`${base}/api/delete-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      // Nicht-existente Fremd-userId: selbst bei Logik-Bug würde kein echter Nutzer gelöscht.
      body: JSON.stringify({ userId: '00000000-0000-0000-0000-000000000002' }),
    })
    expect(r403.status, 'Yogi darf fremde userId nicht löschen → 403').toBe(403)
    await yogiClient.auth.signOut()
  })
})
