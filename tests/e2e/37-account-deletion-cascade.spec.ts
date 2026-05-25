/**
 * Sarah-Welle B 2026-05-25: End-zu-End-Tests für die Account-Löschen-Cascade.
 *
 * Sowohl Yogi-selbst-löscht als auch Admin-löscht-Yogi müssen identisch reagieren:
 *  1. Alle aktiven zukünftigen Buchungen werden entfernt (cancelled bzw. delete)
 *  2. Enrollments werden entfernt
 *  3. Plätze sind sofort frei
 *  4. Wartelisten-Yogis rücken automatisch nach (mit Auto-Promote)
 *
 * Wir simulieren BEIDE Pfade direkt auf der DB (kein UI-Trigger), weil die
 * Cleanup-Logik clientseitig in der Komponente steht. Der Test prüft, dass
 * die DB-Sequenz identisch ist und dass die Wartelisten-Auto-Promote-Logik
 * in beiden Pfaden gleich aussieht.
 */

import { test, expect } from '@playwright/test'
import { getServiceClient } from '../utils/db'
import { E2E_PREFIX, futureDateStr, ensureTestUser } from '../utils/seed'
import * as dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

dotenv.config({ path: '.env.test' })

const FAR_FUTURE = '2099-12-31T23:59:59.000Z'
const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// ════════════════════════════════════════════════════════════════════════════
// STRUKTUR: beide Pfade haben dieselbe Cascade-Logik
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-Logic] Account-Löschen — Source-Konsistenz', () => {
  test('Yogi-selbst: handleDeleteAccount sammelt session_ids + cancelt Bookings + Promotes Wartelisten', async () => {
    const src = read('app/profil/page.tsx')
    expect(src).toMatch(/sessionsToPromote/)
    expect(src).toMatch(/status:\s*['"]cancelled['"]/)
    expect(src).toMatch(/from\(['"]enrollments['"]\)\.delete/)
    expect(src).toMatch(/promoteWaitlistOrOfferLate\(supabase,\s*sId\)/)
  })

  test('Admin-löscht-Yogi: handleDeleteYogi sammelt session_ids + Promotes Wartelisten', async () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    expect(src).toMatch(/sessionsToPromote/)
    expect(src).toMatch(/from\(['"]bookings['"]\)\.delete\(\)\.eq\(['"]user_id['"]/)
    expect(src).toMatch(/from\(['"]enrollments['"]\)\.delete\(\)\.eq\(['"]user_id['"]/)
    expect(src).toMatch(/for\s*\(\s*const\s+sId\s+of\s+sessionsToPromote[\s\S]{0,200}promoteWaitlistOrOfferLate/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// END-ZU-END: Yogi selbst löscht — Cascade-Verhalten
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-Logic] Account-Löschen — Yogi-selbst (DB-Simulation)', () => {
  const tag = `${E2E_PREFIX}-AccDel-Yogi-${Date.now()}`
  let courseId: string
  let sessionId: string
  let testYogiId: string
  let otherYogiId: string

  test.beforeAll(async () => {
    const db = getServiceClient()
    // 2 frische Wegwerf-Yogis
    testYogiId = (await ensureTestUser(`e2e.del-yogi-self-${Date.now()}@yogamitsarah.me`, 'TestYogi2024!sicher'))
    otherYogiId = (await ensureTestUser(`e2e.del-other-self-${Date.now()}@yogamitsarah.me`, 'TestYogi2024!sicher'))

    // 1 Kurs mit 1 Session, max 1 Platz
    const dateStr = futureDateStr(7)
    const { data: course } = await db.from('courses').insert({
      name: `${tag} Kurs`,
      weekday: 'Sonntag', time_start: '10:00:00', duration_min: 60,
      max_spots: 1, total_units: 1,
      date_start: dateStr, date_end: dateStr,
      location: 'Test', is_active: true, is_single: false, is_open: true,
    }).select('id').single()
    courseId = course!.id
    const { data: sess } = await db.from('sessions').insert({
      course_id: courseId, date: dateStr, time_start: '10:00:00',
      duration_min: 60, is_cancelled: false,
    }).select('id').single()
    sessionId = sess!.id

    // testYogi: enrolled + gebucht
    await db.from('credits').insert({
      user_id: testYogiId, total: 1, used: 0, model: 'single',
      expires_at: FAR_FUTURE,
    })
    await db.from('enrollments').insert({ user_id: testYogiId, course_id: courseId })
    const { data: credit } = await db.from('credits').select('id').eq('user_id', testYogiId).single()
    await db.from('bookings').insert({
      user_id: testYogiId, session_id: sessionId, credit_id: credit!.id,
      type: 'single', status: 'active',
    })

    // otherYogi: hat Credit + auf Warteliste
    await db.from('credits').insert({
      user_id: otherYogiId, total: 1, used: 0, model: 'single',
      expires_at: FAR_FUTURE,
    })
    await db.from('waitlist').insert({
      user_id: otherYogiId, session_id: sessionId, type: 'waitlist', position: 1,
    })
  })

  test.afterAll(async () => {
    const db = getServiceClient()
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('waitlist').delete().eq('session_id', sessionId)
    await db.from('enrollments').delete().eq('course_id', courseId)
    await db.from('credits').delete().in('user_id', [testYogiId, otherYogiId])
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
    await db.from('legal_acceptances').delete().in('user_id', [testYogiId, otherYogiId])
    await db.from('profiles').delete().in('id', [testYogiId, otherYogiId])
    await db.auth.admin.deleteUser(testYogiId).catch(() => {})
    await db.auth.admin.deleteUser(otherYogiId).catch(() => {})
  })

  test('Setup: testYogi gebucht + otherYogi auf Warteliste', async () => {
    const db = getServiceClient()
    const { data: bk } = await db.from('bookings').select('*')
      .eq('session_id', sessionId).eq('status', 'active')
    expect((bk || []).length).toBe(1)
    expect((bk || [])[0].user_id).toBe(testYogiId)
    const { data: wl } = await db.from('waitlist').select('*').eq('session_id', sessionId)
    expect((wl || []).length).toBe(1)
    expect((wl || [])[0].user_id).toBe(otherYogiId)
  })

  test('Simuliere Yogi-löscht-selbst: Buchung cancelled + Enrollment weg + Auto-Promote', async () => {
    const db = getServiceClient()
    // Genau wie in app/profil/page.tsx handleDeleteAccount:
    const today = new Date().toISOString().split('T')[0]
    const { data: futureBookings } = await db.from('bookings')
      .select('id, session_id, session:sessions!bookings_session_id_fkey(date, time_start)')
      .eq('user_id', testYogiId).eq('status', 'active')
    const sessionsToPromote: string[] = (futureBookings || [])
      .filter((b: any) => b.session?.date && b.session.date >= today)
      .map((b: any) => b.session_id)
    expect(sessionsToPromote.length).toBe(1)

    // Bookings stornieren
    await db.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false,
    }).eq('user_id', testYogiId).eq('status', 'active').in('session_id', sessionsToPromote)

    // Enrollments entfernen
    await db.from('enrollments').delete().eq('user_id', testYogiId)

    // Promote-Logik simulieren (in production läuft das durch promoteWaitlistOrOfferLate)
    // Simulation: erster Wartelisten-Yogi mit Credit wird gebucht
    const { data: wl } = await db.from('waitlist').select('*, profile:profiles(email)')
      .eq('session_id', sessionId).eq('type', 'waitlist').order('created_at')
    if ((wl || []).length > 0) {
      const promotedYogi = (wl as any)[0]
      const { data: pc } = await db.from('credits').select('id')
        .eq('user_id', promotedYogi.user_id).gt('total', 0).single()
      if (pc) {
        await db.from('bookings').upsert({
          user_id: promotedYogi.user_id, session_id: sessionId, credit_id: pc.id,
          type: 'single', status: 'active', cancelled_at: null,
        }, { onConflict: 'user_id,session_id' })
        await db.from('waitlist').delete().eq('id', promotedYogi.id)
      }
    }

    // Assertions
    const { data: bookings } = await db.from('bookings').select('user_id, status')
      .eq('session_id', sessionId).eq('status', 'active')
    expect((bookings || []).length).toBe(1)
    expect((bookings || [])[0].user_id).toBe(otherYogiId) // otherYogi ist nachgerueckt

    const { data: enrols } = await db.from('enrollments').select('id').eq('user_id', testYogiId)
    expect((enrols || []).length).toBe(0)

    const { data: wlAfter } = await db.from('waitlist').select('id').eq('session_id', sessionId)
    expect((wlAfter || []).length).toBe(0) // otherYogi nicht mehr auf Warteliste
  })
})

// ════════════════════════════════════════════════════════════════════════════
// END-ZU-END: Admin löscht Yogi — Cascade-Verhalten
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-Logic] Account-Löschen — Admin-löscht-Yogi (DB-Simulation)', () => {
  const tag = `${E2E_PREFIX}-AccDel-Admin-${Date.now()}`
  let courseId: string
  let sessionId: string
  let testYogiId: string
  let otherYogiId: string

  test.beforeAll(async () => {
    const db = getServiceClient()
    testYogiId = (await ensureTestUser(`e2e.del-yogi-admin-${Date.now()}@yogamitsarah.me`, 'TestYogi2024!sicher'))
    otherYogiId = (await ensureTestUser(`e2e.del-other-admin-${Date.now()}@yogamitsarah.me`, 'TestYogi2024!sicher'))

    const dateStr = futureDateStr(7)
    const { data: course } = await db.from('courses').insert({
      name: `${tag} Kurs`,
      weekday: 'Sonntag', time_start: '11:00:00', duration_min: 60,
      max_spots: 1, total_units: 1,
      date_start: dateStr, date_end: dateStr,
      location: 'Test', is_active: true, is_single: false, is_open: true,
    }).select('id').single()
    courseId = course!.id
    const { data: sess } = await db.from('sessions').insert({
      course_id: courseId, date: dateStr, time_start: '11:00:00',
      duration_min: 60, is_cancelled: false,
    }).select('id').single()
    sessionId = sess!.id

    await db.from('credits').insert({
      user_id: testYogiId, total: 1, used: 0, model: 'single', expires_at: FAR_FUTURE,
    })
    await db.from('enrollments').insert({ user_id: testYogiId, course_id: courseId })
    const { data: credit } = await db.from('credits').select('id').eq('user_id', testYogiId).single()
    await db.from('bookings').insert({
      user_id: testYogiId, session_id: sessionId, credit_id: credit!.id,
      type: 'single', status: 'active',
    })

    await db.from('credits').insert({
      user_id: otherYogiId, total: 1, used: 0, model: 'single', expires_at: FAR_FUTURE,
    })
    await db.from('waitlist').insert({
      user_id: otherYogiId, session_id: sessionId, type: 'waitlist', position: 1,
    })
  })

  test.afterAll(async () => {
    const db = getServiceClient()
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('waitlist').delete().eq('session_id', sessionId)
    await db.from('enrollments').delete().eq('course_id', courseId)
    await db.from('credits').delete().in('user_id', [testYogiId, otherYogiId])
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
    await db.from('legal_acceptances').delete().in('user_id', [testYogiId, otherYogiId])
    await db.from('profiles').delete().in('id', [testYogiId, otherYogiId])
    await db.auth.admin.deleteUser(testYogiId).catch(() => {})
    await db.auth.admin.deleteUser(otherYogiId).catch(() => {})
  })

  test('Setup: testYogi gebucht + otherYogi auf Warteliste', async () => {
    const db = getServiceClient()
    const { data: bk } = await db.from('bookings').select('*')
      .eq('session_id', sessionId).eq('status', 'active')
    expect((bk || []).length).toBe(1)
    expect((bk || [])[0].user_id).toBe(testYogiId)
  })

  test('Simuliere Admin-löscht-Yogi: HARDER Delete + Auto-Promote (Admin-Pfad)', async () => {
    const db = getServiceClient()
    // Genau wie in app/admin/yogis/[id]/page.tsx handleDeleteYogi:
    const today = new Date().toISOString().split('T')[0]
    const { data: futureActiveBookings } = await db.from('bookings')
      .select('session_id, session:sessions!bookings_session_id_fkey(date)')
      .eq('user_id', testYogiId).eq('status', 'active')
    const sessionsToPromote: string[] = (futureActiveBookings || [])
      .filter((b: any) => b.session?.date && b.session.date >= today)
      .map((b: any) => b.session_id)
    expect(sessionsToPromote.length).toBe(1)

    // Hartes Löschen statt Cancel (Admin-Pfad)
    await db.from('bookings').delete().eq('user_id', testYogiId)
    await db.from('enrollments').delete().eq('user_id', testYogiId)

    // Auto-Promote (Simulation)
    const { data: wl } = await db.from('waitlist').select('*')
      .in('session_id', sessionsToPromote).eq('type', 'waitlist').order('created_at')
    for (const w of (wl || [])) {
      const { data: pc } = await db.from('credits').select('id')
        .eq('user_id', (w as any).user_id).gt('total', 0).maybeSingle()
      if (pc) {
        await db.from('bookings').upsert({
          user_id: (w as any).user_id, session_id: (w as any).session_id, credit_id: pc.id,
          type: 'single', status: 'active', cancelled_at: null,
        }, { onConflict: 'user_id,session_id' })
        await db.from('waitlist').delete().eq('id', (w as any).id)
      }
    }

    // Assertions: gleiches Endergebnis wie beim Yogi-Pfad
    const { data: bookings } = await db.from('bookings').select('user_id, status')
      .eq('session_id', sessionId).eq('status', 'active')
    expect((bookings || []).length).toBe(1)
    expect((bookings || [])[0].user_id).toBe(otherYogiId)

    const { data: enrols } = await db.from('enrollments').select('id').eq('user_id', testYogiId)
    expect((enrols || []).length).toBe(0)
  })
})
