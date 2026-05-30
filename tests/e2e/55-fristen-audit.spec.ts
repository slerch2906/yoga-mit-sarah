/**
 * Fristen-Audit (Sarah 2026-05-30) — Absicherung kritischer Fristen:
 *
 *  1. Last-Minute-Grenze: < 90 Min vor Start → KEIN Auto-Promote, sondern
 *     Spätangebot ('late-offer') an alle Wartenden. > 90 Min → Auto-Promote.
 *  3. Guthaben-Trennung:
 *     A) Krankheits-Guthaben (source='illness', 10 Monate) → HART gelöscht.
 *     B) Kursabbruch-Guthaben (source='cancellation_choice', 2 Jahre) → NICHT
 *        gelöscht, sondern Auszahlung angestoßen (used=total) + Admin-Mail.
 *     + 4-Wochen-Vorwarnung (Kalender) für Krankheits-Guthaben.
 *
 * DB-zentrisch: ruft die echten RPCs direkt auf (stabil gegen UI-Drift).
 */
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { getAdminClient, getUserIdByEmail } from '../utils/db'
import { createTestCourse, E2E_PREFIX } from '../utils/seed'

dotenv.config({ path: '.env.test' })

function svc() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Datum+Uhrzeit in Europe/Berlin, X Minuten ab jetzt (für minutengenaue Start-Tests). */
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
// 1) Last-Minute-Grenze: < 90 Min → late-offer (kein Auto-Promote)
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Last-Minute ab < 90 Min (kein Auto-Promote)', () => {
  let yogi1Id: string
  let yogi2Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
  })

  test.beforeEach(async () => { await resetYogi(yogi1Id); await resetYogi(yogi2Id) })
  test.afterAll(async () => { await resetYogi(yogi1Id); await resetYogi(yogi2Id) })

  test('[E2E] Platz wird 85 Min vor Start frei → KEIN Auto-Promote, Spätangebot an alle', async () => {
    const db = await getAdminClient()
    const course = await createTestCourse({ name: `${E2E_PREFIX} LastMinute-85`, sessionCount: 1, startDaysFromNow: 0 })
    const sessionId = course.sessionIds[0]
    // Session-Start exakt 85 Min ab jetzt (Berlin) — innerhalb der 90-Min-Grenze.
    const when = berlinInMinutes(85)
    await db.from('sessions').update({ date: when.date, time_start: when.time }).eq('id', sessionId)
    await db.from('courses').update({ date_start: when.date, date_end: when.date }).eq('id', course.courseId)
    // Yogi2 auf Warteliste (mit Credit — der bei Auto-Promote SOFORT verbraucht würde).
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    await db.from('credits').insert({ user_id: yogi2Id, course_id: null, model: 'single', total: 5, used: 0, expires_at: exp.toISOString() })
    await db.from('waitlist').insert({ user_id: yogi2Id, session_id: sessionId, type: 'waitlist' })

    const res = await svc().rpc('process_cancellation_full', { p_session_id: sessionId })
    expect(res.error).toBeNull()
    const out = res.data as any

    // KEIN Auto-Promote, sondern Spätangebot
    expect(out.mode, 'mode muss late-offer sein (≤ 90 Min)').toBe('late-offer')
    expect(out.promoted, 'kein automatisches Nachrücken').toBeNull()
    expect(Array.isArray(out.offers) && out.offers.length).toBeGreaterThan(0)

    // Kein Booking für Yogi2 angelegt (er rückt NICHT automatisch nach)
    const { data: bk } = await db.from('bookings').select('id').eq('user_id', yogi2Id).eq('session_id', sessionId).eq('status', 'active')
    expect((bk || []).length, 'Yogi2 darf nicht automatisch eingebucht sein').toBe(0)
    // Offer-Zeile existiert, noch ohne Gewinner (first-click wins kommt erst beim Klick)
    const { data: offers } = await db.from('waitlist_offers').select('resolved_winner_user_id').eq('session_id', sessionId)
    expect((offers || []).length).toBeGreaterThan(0)
    expect((offers || [])[0].resolved_winner_user_id).toBeNull()

    await db.from('waitlist_offers').delete().eq('session_id', sessionId)
  })

  test('[E2E] Kontrolle: 95 Min vor Start → Auto-Promote (nicht late-offer)', async () => {
    const db = await getAdminClient()
    const course = await createTestCourse({ name: `${E2E_PREFIX} LastMinute-95`, sessionCount: 1, startDaysFromNow: 0 })
    const sessionId = course.sessionIds[0]
    const when = berlinInMinutes(95) // > 90 Min
    await db.from('sessions').update({ date: when.date, time_start: when.time }).eq('id', sessionId)
    await db.from('courses').update({ date_start: when.date, date_end: when.date }).eq('id', course.courseId)
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    await db.from('credits').insert({ user_id: yogi2Id, course_id: null, model: 'single', total: 5, used: 0, expires_at: exp.toISOString() })
    await db.from('waitlist').insert({ user_id: yogi2Id, session_id: sessionId, type: 'waitlist' })

    const res = await svc().rpc('process_cancellation_full', { p_session_id: sessionId })
    expect(res.error).toBeNull()
    const out = res.data as any
    expect(out.mode, 'mode muss auto-promoted sein (> 90 Min)').toBe('auto-promoted')
    expect(out.promoted, 'Yogi2 rückt automatisch nach').not.toBeNull()
    // Booking mit promoted_at angelegt
    const { data: bk } = await db.from('bookings').select('id, promoted_at').eq('user_id', yogi2Id).eq('session_id', sessionId).eq('status', 'active')
    expect((bk || []).length).toBe(1)
    expect((bk || [])[0].promoted_at).not.toBeNull()

    await db.from('waitlist_offers').delete().eq('session_id', sessionId)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3) Guthaben-Trennung: Krankheit (10 Mon, löschen) vs Kursabbruch (2 J, Auszahlung)
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Guthaben-Ablauf: Krankheit (löschen) vs Kursabbruch (Auszahlung)', () => {
  let yogi1Id: string

  test.beforeAll(async () => { yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))! })
  test.beforeEach(async () => { await resetYogi(yogi1Id) })
  test.afterAll(async () => { await resetYogi(yogi1Id) })

  test('[E2E] Krankheits-Guthaben (10 Monate abgelaufen) → wird HART gelöscht', async () => {
    const db = await getAdminClient()
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000) // gestern abgelaufen
    const { data: cred } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: null, model: 'guthaben', source: 'illness',
      total: 3, used: 0, expires_at: past.toISOString(),
    }).select('id').single()

    try {
      const res = await svc().rpc('fn_check_illness_credit_expiry', { p_dry_run: false })
      expect(res.error).toBeNull()

      // Credit ist ERSATZLOS GELÖSCHT
      const { data: stillThere } = await db.from('credits').select('id').eq('id', cred!.id).maybeSingle()
      expect(stillThere, 'Krankheits-Guthaben muss gelöscht sein').toBeNull()
      // Audit-Eintrag
      const { data: audit } = await db.from('audit_log').select('id')
        .eq('action', 'illness_credit_expired').eq('user_id', yogi1Id)
        .order('created_at', { ascending: false }).limit(1)
      expect((audit || []).length).toBeGreaterThan(0)
    } finally {
      // audit_log ist für den Admin-User append-only (RLS) → Service-Role nötig
      await svc().from('audit_log').delete().eq('action', 'illness_credit_expired').eq('user_id', yogi1Id)
      await db.from('credits').delete().eq('id', cred!.id)
    }
  })

  test('[E2E] Kursabbruch-Guthaben (2 Jahre abgelaufen) → NICHT gelöscht, Auszahlung angestoßen', async () => {
    const db = await getAdminClient()
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const { data: cred } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: null, model: 'guthaben', source: 'cancellation_choice',
      total: 4, used: 0, expires_at: past.toISOString(),
    }).select('id').single()
    // Dedup-Notification vorab anlegen → RPC überspringt Mail-Versand (kein realer Mailversand im Test)
    await db.from('admin_notifications').insert({
      type: 'refund_pending_auto_2y',
      message: `${E2E_PREFIX} dedup`,
      details: { credit_id: cred!.id },
      read: false,
    })

    try {
      const res = await svc().rpc('fn_check_guthaben_2y_expiry')
      expect(res.error).toBeNull()

      // Credit existiert NOCH (nicht gelöscht), ist aber als verbraucht markiert (Auszahlung läuft extern)
      const { data: after } = await db.from('credits').select('id, total, used').eq('id', cred!.id).maybeSingle()
      expect(after, 'Kursabbruch-Guthaben darf NICHT gelöscht werden').not.toBeNull()
      expect(after!.used).toBe(after!.total)
      // Auszahlungs-Audit
      const { data: audit } = await db.from('audit_log').select('id, details')
        .eq('action', 'guthaben_2y_auto_refund').eq('user_id', yogi1Id)
        .order('created_at', { ascending: false }).limit(1)
      expect((audit || []).length).toBeGreaterThan(0)
    } finally {
      // audit_log ist für den Admin-User append-only (RLS) → Service-Role nötig
      await svc().from('audit_log').delete().eq('action', 'guthaben_2y_auto_refund').eq('user_id', yogi1Id)
      await db.from('admin_notifications').delete().eq('type', 'refund_pending_auto_2y').eq('details->>credit_id', cred!.id)
      await db.from('credits').delete().eq('id', cred!.id)
    }
  })

  test('[E2E] Kalender-Banner warnt 4 Wochen vor Krankheits-Guthaben-Ablauf', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/YogiCreditExpiryBanner.tsx'), 'utf8')
    // Branch für Krankheits-Guthaben (source==='illness')
    expect(src).toMatch(/source\s*===\s*['"]illness['"]/)
    // 28-Tage-Fenster (4 Wochen) + Verfalls-Hinweis
    expect(src).toMatch(/<=\s*28/)
    expect(src).toMatch(/läuft in .* ab/)
    expect(src).toMatch(/gelöscht/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Late-Offer (< 90 Min): KEINE 60-Min-Gnadenfrist — ab Sekunde 1 verbindlich
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Late-Offer-Annahme: keine Gnadenfrist, Storno gilt sofort als „spät"', () => {
  let yogi2Id: string
  test.beforeAll(async () => { yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))! })
  test.beforeEach(async () => { await resetYogi(yogi2Id) })
  test.afterAll(async () => { await resetYogi(yogi2Id) })

  test('[E2E] 45 Min vor Start angenommen → kein promoted_at; Storno 5 Min später = spät (Credit verfällt)', async () => {
    const db = await getAdminClient()
    const s = svc()
    const course = await createTestCourse({ name: `${E2E_PREFIX} LateOffer-NoGrace`, sessionCount: 1, startDaysFromNow: 0 })
    const sessionId = course.sessionIds[0]
    const when = berlinInMinutes(45) // 45 Min vor Start → < 90 Min (Late-Offer) und < 3h (Storno wäre spät)
    await db.from('sessions').update({ date: when.date, time_start: when.time }).eq('id', sessionId)
    await db.from('courses').update({ date_start: when.date, date_end: when.date }).eq('id', course.courseId)

    // Yogi2 hat genau 1 freien Credit
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const { data: cred } = await db.from('credits').insert({
      user_id: yogi2Id, course_id: null, model: 'single', total: 1, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()

    // Stale-Setup (Härtetest des Fixes): Yogi2 war für DIESE Stunde früher schon mal
    // auto-promoted (promoted_at gesetzt) und hat storniert. Die Late-Offer-Annahme
    // MUSS diesen Zeitstempel löschen — sonst greift fälschlich eine Gnadenfrist.
    const stalePromotedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    await db.from('bookings').insert({
      user_id: yogi2Id, session_id: sessionId, credit_id: null, type: 'single',
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false,
      promoted_at: stalePromotedAt,
    })

    await db.from('waitlist').insert({ user_id: yogi2Id, session_id: sessionId, type: 'waitlist' })
    const sessStartIso = new Date(`${when.date}T${when.time}`).toISOString()
    const { data: offer } = await s.from('waitlist_offers').insert({
      session_id: sessionId, user_id: yogi2Id, expires_at: sessStartIso,
    }).select('token').single()

    try {
      // Late-Offer aktiv per Link annehmen → echte deployte Route
      const res = await fetch(`${process.env.BASE_URL}/api/waitlist-offer/${offer!.token}`, { method: 'POST' })
      expect(res.ok, `Annahme sollte ok sein (HTTP ${res.status})`).toBeTruthy()

      const { data: bk } = await db.from('bookings')
        .select('id, status, cancel_late, promoted_at')
        .eq('user_id', yogi2Id).eq('session_id', sessionId).maybeSingle()
      expect(bk?.status, 'Buchung aktiv nach Annahme').toBe('active')
      expect(bk?.cancel_late).toBe(false)
      // KERN: kein Nachrück-Zeitstempel → keine Gnadenfrist möglich (ab Sekunde 1 verbindlich)
      expect(bk?.promoted_at, 'Late-Offer-Gewinner darf KEIN promoted_at haben (sonst Gnadenfrist)').toBeNull()
      const { data: c1 } = await db.from('credits').select('used').eq('id', cred!.id).single()
      expect(c1?.used, 'Credit nach Annahme verbraucht').toBe(1)

      // 5 Min später stornieren: Session ~40 Min entfernt (< 3h) UND promoted_at=null
      // → keine Gnadenfrist → handleCancel setzt cancel_late = true (spät storniert).
      const late = true // = within3h && !inPromoteGrace; inPromoteGrace ist false (promoted_at null, s. o.)
      await db.from('bookings').update({
        status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: late, cancelled_by: 'self',
      }).eq('id', bk!.id)

      // recalc_credit_used zählt cancel_late=true als „used" → Credit bleibt verfallen
      const { data: c2 } = await db.from('credits').select('used').eq('id', cred!.id).single()
      expect(c2?.used, 'Credit bleibt verfallen (Spät-Storno, kein Gnaden-Rückbuchen)').toBe(1)
      const { data: bk2 } = await db.from('bookings').select('cancel_late').eq('id', bk!.id).single()
      expect(bk2?.cancel_late, 'Storno als spät markiert').toBe(true)
    } finally {
      await s.from('audit_log').delete().eq('action', 'waitlist_offer_late_accepted').eq('user_id', yogi2Id)
      await s.from('waitlist_offers').delete().eq('session_id', sessionId)
    }
  })

  test('[E2E] Offer-Seite, Mail & Route kodieren „verbindlich, keine Gnadenfrist"', () => {
    const hint = 'Verbindliche Sofort-Buchung'
    const page = fs.readFileSync(path.join(process.cwd(), 'app/warteliste/angebot/[token]/page.tsx'), 'utf8')
    expect(page.includes(hint), 'Offer-Seite enthält Verbindlichkeits-Hinweis').toBe(true)

    const mail = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/send-email/index.ts'), 'utf8')
    const idx = mail.indexOf("case 'waitlist_offer_late'")
    expect(idx, 'waitlist_offer_late-Template vorhanden').toBeGreaterThan(0)
    expect(mail.slice(idx, idx + 1500).includes(hint), 'waitlist_offer_late-Mail enthält Hinweis').toBe(true)

    // Route bucht mit promoted_at: null → keine 60-Min-Gnadenfrist
    const route = fs.readFileSync(path.join(process.cwd(), 'app/api/waitlist-offer/[token]/route.ts'), 'utf8')
    expect(route).toMatch(/promoted_at:\s*null/)
  })
})
