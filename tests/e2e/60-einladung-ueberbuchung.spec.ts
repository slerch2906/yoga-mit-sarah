/**
 * Einladung in vollen Kurs -> Yogi wird trotzdem eingebucht (Admin darf ueberbuchen)
 *
 * Regression fuer Sarah-Bug 2026-06-01: Eingeladener Yogi landete nach der Registrierung
 * NICHT im vollen Kurs.
 *
 * WICHTIG — der ECHTE Pfad (register/page.tsx):
 *   1. signUp + profiles.upsert  -> Trigger handle_invitation_enrollment feuert, aber die
 *      Einladung ist noch used=false -> no-op (der Trigger ist hier wirkungslos!).
 *   2. consume_invitation_by_token -> used=true.
 *   3. consume_invitation_enrollment (RPC, laeuft als der Yogi) -> die ECHTE Einbuchung.
 *
 * Frueher blockierte der max_spots-Trigger Schritt 3 (Yogi != Admin, Kurs voll) und der
 * App-Code verschluckte den Fehler. Fix: consume_invitation_enrollment setzt
 * app.bypass_max_spots='on'. Dieser Test fuehrt GENAU diesen RPC-Pfad aus (Yogi meldet
 * sich an und ruft die RPC selbst auf) — nicht den Trigger.
 */
import { test, expect } from '@playwright/test'
import { getServiceClient } from '../utils/db'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

const STAMP = Date.now()
const INV_EMAIL = `e2e.overbook.${STAMP}@test.yogamitsarah.me`
const TOKEN = `e2e-overbook-${STAMP}`
const PW = 'TestPass!Overbook2026'

let courseId = ''
let sessionId = ''
let newUserId: string | null = null

test.describe('Einladung in vollen Kurs darf ueberbuchen (echter RPC-Pfad)', () => {
  test.beforeAll(async () => {
    const db = await getServiceClient()
    const today = new Date().toISOString().split('T')[0]
    const end = new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0]
    // Kurs mit max_spots=1
    const { data: course } = await db.from('courses').insert({
      name: `[E2E] Ueberbuch-Kurs ${STAMP}`, weekday: 'Montag', time_start: '10:00',
      duration_min: 75, max_spots: 1, total_units: 1, date_start: today, date_end: end,
      is_active: true, is_system_container: false,
    }).select('id').single()
    courseId = course!.id
    const d = new Date(); d.setDate(d.getDate() + 7)
    const { data: sess } = await db.from('sessions').insert({
      course_id: courseId, date: d.toISOString().split('T')[0], time_start: '10:00',
      duration_min: 75, is_cancelled: false, is_open: true,
    }).select('id').single()
    sessionId = sess!.id
    // Stunde voll machen: 1 aktive Buchung == max_spots
    const { data: filler } = await db.from('profiles').select('id').not('email', 'is', null).limit(1).maybeSingle()
    await db.from('bookings').insert({ user_id: filler!.id, session_id: sessionId, type: 'single', status: 'active' })
    // Einladung — used=false (wie zum Zeitpunkt des Profil-Inserts im echten Flow)
    await db.from('invitations').insert({
      email: INV_EMAIL, first_name: 'E2E', last_name: 'Overbook', token: TOKEN,
      course_id: courseId, credits_to_assign: 1, used: false,
      expires_at: new Date(Date.now() + 14 * 864e5).toISOString(),
    })
  })

  test.afterAll(async () => {
    const db = await getServiceClient()
    if (newUserId) {
      await db.from('bookings').delete().eq('user_id', newUserId)
      await db.from('credits').delete().eq('user_id', newUserId)
      await db.from('enrollments').delete().eq('user_id', newUserId)
      await db.from('profiles').delete().eq('id', newUserId)
      try { await db.auth.admin.deleteUser(newUserId) } catch { /* egal */ }
    }
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('invitations').delete().eq('token', TOKEN)
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
    await db.from('admin_notifications').delete().like('message', `%${INV_EMAIL}%`)
  })

  test('consume_invitation_enrollment (als Yogi) bucht trotz vollem Kurs ein (ueberbucht)', async () => {
    const db = await getServiceClient()

    // 1. Auth-User + Profil anlegen (Profil-Insert feuert den Trigger; used=false -> no-op).
    const { data: created, error: ue } = await db.auth.admin.createUser({
      email: INV_EMAIL, password: PW, email_confirm: true,
      user_metadata: { invitation_token: TOKEN, first_name: 'E2E', last_name: 'Overbook' },
    })
    expect(ue, 'createUser darf nicht fehlschlagen').toBeFalsy()
    newUserId = created!.user!.id
    await db.from('profiles').upsert({ id: newUserId, first_name: 'E2E', last_name: 'Overbook', email: INV_EMAIL })

    // Trigger hat NICHT eingebucht (used war false) — Gegenprobe:
    const { data: trigEnr } = await db.from('enrollments').select('id').eq('user_id', newUserId)
    expect((trigEnr || []).length, 'Trigger darf hier noch nicht eingebucht haben').toBe(0)

    // 2. ECHTER Pfad: Yogi meldet sich an und ruft die RPC selbst auf.
    const userClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
    const { error: signErr } = await userClient.auth.signInWithPassword({ email: INV_EMAIL, password: PW })
    expect(signErr, 'Login muss klappen').toBeFalsy()
    const { data: rpcRes, error: rpcErr } = await userClient.rpc('consume_invitation_enrollment', { p_token: TOKEN })
    expect(rpcErr, 'consume_invitation_enrollment darf trotz vollem Kurs NICHT fehlschlagen').toBeFalsy()
    expect((rpcRes as any)?.enrolled, 'RPC muss enrolled=true liefern').toBe(true)

    // 3. DB-Wahrheit: eingeschrieben + Buchung + Stunde ueberbucht.
    const { data: enr } = await db.from('enrollments').select('id').eq('user_id', newUserId).eq('course_id', courseId).maybeSingle()
    expect(enr, 'Yogi muss trotz vollem Kurs eingeschrieben sein').toBeTruthy()
    const { data: bk } = await db.from('bookings').select('id, status').eq('user_id', newUserId).eq('session_id', sessionId).maybeSingle()
    expect(bk, 'Yogi muss eine Buchung haben').toBeTruthy()
    expect(bk?.status).toBe('active')
    const { count } = await db.from('bookings').select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId).eq('status', 'active')
    expect(count ?? 0, 'Stunde muss ueberbucht sein (2 > max_spots 1)').toBeGreaterThanOrEqual(2)
  })
})
