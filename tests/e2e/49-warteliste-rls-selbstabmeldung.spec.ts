/**
 * REGRESSIONS-E2E (Sarah 2026-05-29): RLS-Kontext-Fix beim Yogi-SELBST-Abmelden.
 *
 * HINTERGRUND / BUG:
 *   promoteWaitlistOrOfferLate (lib/waitlist-promote.ts) lief früher CLIENT-SEITIG
 *   und las/schrieb waitlist, profiles, credits, bookings, waitlist_offers direkt.
 *   Meldet sich ein NORMALER Yogi selbst ab, greift RLS: er sieht nur die EIGENEN
 *   waitlist-/profil-Zeilen → die Warteliste der ANDEREN ist unsichtbar → es wurde
 *   KEIN Spätangebot/Nachrücken ausgelöst. (Sarah-Repro: Absage 9:56, Start 11:20,
 *   mail@ bekam nichts.)
 *
 *   Die bestehenden Specs 45/47 nutzen den SERVICE-Client (RLS-frei) und konnten
 *   den Bug deshalb NIE reproduzieren. Dieser Test meldet bewusst als EINGELOGGTER
 *   Yogi (yogi1) ab, während ein ANDERER Yogi (yogi2) auf der Warteliste steht.
 *
 * FIX:
 *   Die privilegierte DB-Arbeit läuft jetzt server-seitig in der SECURITY-DEFINER-
 *   RPC process_cancellation_full (umgeht RLS). Der Helper verschickt nur noch Mails
 *   aus den zurückgegebenen Daten.
 *
 * Stil & Helfer gespiegelt von 47-warteliste-3h-frist-und-spaetangebot.spec.ts.
 */
import { test, expect } from '@playwright/test'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import { promoteWaitlistOrOfferLate } from '../../lib/waitlist-promote'
import { getServiceClient, getUserIdByEmail, getActiveBooking } from '../utils/db'
import { createTestCourse, giveYogiSingleCredit, E2E_PREFIX } from '../utils/seed'

dotenv.config({ path: '.env.test' })

const URL = process.env.SUPABASE_URL!
const ANON = process.env.SUPABASE_ANON_KEY!

let yogi1Id: string // CANCELLER — meldet sich selbst ab (eingeloggt)
let yogi2Id: string // ANDERER Yogi — steht auf der Warteliste (unter RLS unsichtbar)
let yogi1Client: SupabaseClient // echter User-JWT von yogi1 (KEIN Service-Client!)

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

/** Einzelstunde (max_spots=1): yogi1 gebucht, yogi2 auf Warteliste (+Credit). */
async function setup(minutesFromNow: number): Promise<string> {
  const db = svc()
  await resetYogi(yogi1Id)
  await resetYogi(yogi2Id)

  const course = await createTestCourse({
    name: `${E2E_PREFIX} RLS-Selbstabmeldung`, sessionCount: 1, startDaysFromNow: 30, maxSpots: 1,
  })
  const { date, time } = inMinutes(minutesFromNow)
  const { data: sess, error } = await db.from('sessions').insert({
    course_id: course.courseId, date, time_start: time, duration_min: 75,
    is_cancelled: false, session_type: 'single', name: `${E2E_PREFIX} RLS-Stunde`, max_spots: 1,
  }).select('id').single()
  if (error || !sess) throw new Error(`Session-Insert fehlgeschlagen: ${error?.message}`)
  const sessionId = sess.id as string

  // yogi1 hat den Platz, yogi2 wartet (mit Credit fürs >90-Nachrücken).
  await db.from('bookings').insert({
    user_id: yogi1Id, session_id: sessionId, credit_id: null, type: 'single', status: 'active',
  })
  await db.from('waitlist').insert({
    user_id: yogi2Id, session_id: sessionId, type: 'waitlist', position: 1,
  })
  await giveYogiSingleCredit(yogi2Id, 3)

  return sessionId
}

/** yogi1 meldet sich selbst ab — exakt unter SEINEM Auth-Kontext (RLS aktiv). */
async function yogi1CancelsOwnBooking(sessionId: string) {
  const { error } = await yogi1Client.from('bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false })
    .eq('user_id', yogi1Id).eq('session_id', sessionId).eq('status', 'active')
  expect(error, `Selbst-Abmeldung fehlgeschlagen: ${error?.message}`).toBeNull()
}

test.describe.configure({ mode: 'serial' })

test.describe('[E2E] RLS-Fix: Yogi-Selbstabmeldung löst Spätangebot/Nachrücken aus', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
    yogi1Client = await makeAuthedClient(process.env.TEST_YOGI1_EMAIL!, process.env.TEST_YOGI1_PASSWORD!)
  })
  test.afterAll(async () => {
    await resetYogi(yogi1Id)
    await resetYogi(yogi2Id)
  })

  // ── ≤90 Min: der eigentliche Sarah-Bug — Spätangebot an den ANDEREN Yogi ──────
  test('≤90 Min: yogi1 meldet sich (eingeloggt) ab → yogi2 bekommt ein Spätangebot', async () => {
    const sessionId = await setup(60) // 60 Min vorher → ≤90min-Pfad
    await yogi1CancelsOwnBooking(sessionId)

    // Promote läuft unter yogi1s ECHTEM Auth-Kontext (RLS aktiv).
    const res = await promoteWaitlistOrOfferLate(yogi1Client, sessionId)
    expect(res.mode, JSON.stringify(res)).toBe('late-offer-sent')

    // Der ANDERE Yogi (yogi2) muss ein Angebot haben — DAS ging vor dem Fix verloren.
    const { data: offer } = await svc().from('waitlist_offers')
      .select('token').eq('session_id', sessionId).eq('user_id', yogi2Id).maybeSingle()
    expect(offer?.token, 'yogi2 muss trotz RLS ein Spätangebot bekommen').toBeTruthy()
  })

  // ── >90 Min: Auto-Nachrücken des ANDEREN Yogis trotz RLS ──────────────────────
  test('>90 Min: yogi1 meldet sich (eingeloggt) ab → yogi2 rückt automatisch nach', async () => {
    const sessionId = await setup(3 * 24 * 60) // +3 Tage → >90min-Pfad
    await yogi1CancelsOwnBooking(sessionId)

    const res = await promoteWaitlistOrOfferLate(yogi1Client, sessionId)
    expect(res.mode, JSON.stringify(res)).toBe('auto-promoted')

    const booking = await getActiveBooking(yogi2Id, sessionId)
    expect(booking, 'yogi2 muss trotz RLS nachgerückt sein').not.toBeNull()
    expect(booking!.credit_id, 'Einzelstunde → Credit verbraucht').not.toBeNull()
  })

  // ── Struktureller Schutz: der RLS-blinde Client-Pfad darf NICHT zurückkehren ──
  test('Struktur: Helper delegiert an SECURITY-DEFINER-RPC statt client-seitiger Reads', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/waitlist-promote.ts'), 'utf8')
    // Delegiert an die RPCs
    expect(src).toContain("process_cancellation_full")
    expect(src).toContain("delete_notify_subscribers")
    // Der alte RLS-blinde Client-Pfad ist ENTFERNT (keine direkten Tabellen-Reads/Writes mehr)
    expect(src).not.toContain(".from('waitlist')")
    expect(src).not.toContain(".from('credits')")
    expect(src).not.toContain(".from('waitlist_offers')")
    expect(src).not.toContain(".from('bookings')")

    // Die Migration mit beiden Funktionen liegt vor
    const mig = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260529_process_cancellation_full.sql'), 'utf8')
    expect(mig).toContain('CREATE OR REPLACE FUNCTION public.process_cancellation_full')
    expect(mig).toContain('CREATE OR REPLACE FUNCTION public.delete_notify_subscribers')
    expect(mig).toContain('SECURITY DEFINER')
    // anon darf NICHT ausführen (sonst Auth-Check-Bypass über NULL-Caller)
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.process_cancellation_full.*FROM PUBLIC, anon/)
  })
})
