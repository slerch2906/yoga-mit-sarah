/**
 * Einladung in vollen Kurs -> Yogi wird trotzdem eingebucht (Admin darf ueberbuchen)
 *
 * Regression fuer Sarah-Bug 2026-06-01: Eingeladener Yogi (Thomas) landete nach der
 * Registrierung NICHT im vollen Kurs, weil der max_spots-Trigger den registrierenden
 * Yogi (nicht den Admin) sah und blockierte -> Enrollment/Credit/Bookings rollten zurueck.
 *
 * Fix: handle_invitation_enrollment setzt app.bypass_max_spots='on' (transaktionslokal);
 * enforce_session_max_spots respektiert das. Einladung darf damit immer ueberbuchen.
 *
 * Test-Mechanik (entspricht dem echten Flow): Auth-User mit invitation_token in den
 * Metadaten anlegen, dann das Profil einfuegen (das macht im echten Flow die App) ->
 * der AFTER-INSERT-Trigger on_profile_created_enroll feuert und bucht ein.
 */
import { test, expect } from '@playwright/test'
import { getServiceClient, getAdminClient } from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

const STAMP = Date.now()
const INV_EMAIL = `e2e.overbook.${STAMP}@test.yogamitsarah.me`
const TOKEN = `e2e-overbook-${STAMP}`

let courseId = ''
let sessionId = ''
let newUserId: string | null = null

test.describe('Einladung in vollen Kurs darf ueberbuchen', () => {
  test.beforeAll(async () => {
    const db = await getAdminClient()
    const today = new Date().toISOString().split('T')[0]
    const end = new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0]
    // Kurs mit max_spots=1
    const { data: course } = await db.from('courses').insert({
      name: `[E2E] Ueberbuch-Kurs ${STAMP}`, weekday: 'Montag', time_start: '10:00',
      duration_min: 75, max_spots: 1, total_units: 1, date_start: today, date_end: end,
      is_active: true, is_system_container: false,
    }).select('id').single()
    courseId = course!.id
    // eine zukuenftige Stunde
    const d = new Date(); d.setDate(d.getDate() + 7)
    const { data: sess } = await db.from('sessions').insert({
      course_id: courseId, date: d.toISOString().split('T')[0], time_start: '10:00',
      duration_min: 75, is_cancelled: false, is_open: true,
    }).select('id').single()
    sessionId = sess!.id
    // Stunde voll machen: 1 aktive Buchung -> Belegung == max_spots
    const { data: filler } = await db.from('profiles').select('id').not('email', 'is', null).limit(1).maybeSingle()
    await db.from('bookings').insert({ user_id: filler!.id, session_id: sessionId, type: 'single', status: 'active' })
    // akzeptierte Einladung fuer den Kurs
    await db.from('invitations').insert({
      email: INV_EMAIL, first_name: 'E2E', last_name: 'Overbook', token: TOKEN,
      course_id: courseId, used: true, accepted_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 14 * 864e5).toISOString(),
    })
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    const service = getServiceClient()
    if (newUserId) {
      await db.from('bookings').delete().eq('user_id', newUserId)
      await db.from('credits').delete().eq('user_id', newUserId)
      await db.from('enrollments').delete().eq('user_id', newUserId)
      await db.from('profiles').delete().eq('id', newUserId)
      try { await service.auth.admin.deleteUser(newUserId) } catch { /* egal */ }
    }
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('invitations').delete().eq('token', TOKEN)
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
    await db.from('admin_notifications').delete().like('message', `%${INV_EMAIL}%`)
  })

  test('Registrierung ueber Einladung in vollen Kurs -> Enrollment + aktive Buchung (ueberbucht)', async () => {
    const db = await getAdminClient()
    const service = getServiceClient()

    // 1. Auth-User mit invitation_token (wie nach signUp)
    const { data: created, error: ue } = await service.auth.admin.createUser({
      email: INV_EMAIL, password: 'TestPass!2026', email_confirm: true,
      user_metadata: { invitation_token: TOKEN, first_name: 'E2E', last_name: 'Overbook' },
    })
    expect(ue, 'createUser darf nicht fehlschlagen').toBeFalsy()
    newUserId = created!.user!.id

    // 2. Profil anlegen (im echten Flow macht das die App) -> feuert den Enrollment-Trigger.
    //    OHNE den Fix wuerde der Trigger am vollen Kurs scheitern und dieser Insert
    //    mit Fehler zurueckrollen.
    const { error: pe } = await db.from('profiles').insert({
      id: newUserId, first_name: 'E2E', last_name: 'Overbook', email: INV_EMAIL,
    })
    expect(pe, 'Profil-Insert (und damit die Einbuchung) darf NICHT fehlschlagen').toBeFalsy()

    // 3. Der Yogi muss trotz vollem Kurs eingebucht sein.
    let enrollment: any = null, booking: any = null
    for (let i = 0; i < 8; i++) {
      const { data: e } = await db.from('enrollments').select('id')
        .eq('user_id', newUserId).eq('course_id', courseId).maybeSingle()
      const { data: b } = await db.from('bookings').select('id, status')
        .eq('user_id', newUserId).eq('session_id', sessionId).maybeSingle()
      enrollment = e; booking = b
      if (enrollment && booking) break
      await new Promise(r => setTimeout(r, 400))
    }
    expect(enrollment, 'Yogi muss trotz vollem Kurs eingeschrieben sein').toBeTruthy()
    expect(booking, 'Yogi muss trotz vollem Kurs eine Buchung haben').toBeTruthy()
    expect(booking?.status).toBe('active')

    // 4. Gegenprobe: die Stunde ist jetzt ueberbucht (2 aktive > max_spots 1).
    const { count } = await db.from('bookings').select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId).eq('status', 'active')
    expect(count ?? 0, 'Stunde muss ueberbucht sein (Einladung bucht ueber max_spots)').toBeGreaterThanOrEqual(2)
  })
})
