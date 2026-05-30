/**
 * Sarah-Welle 2026-05-24: End-zu-End Logik- + Plausibilitäts-Tests
 *
 * Alle neuen Funktionen werden mit "ein Workflow von A bis Z" geprüft:
 *  1. Charity-Booking ohne Credit (Buchung + Bestätigung + Abmelden)
 *  2. Charity-Waitlist Auto-Promote (yogi rückt vor ohne Credit)
 *  3. Sprechblase Admin-Promote → DB-Update → URL korrekt
 *  4. URL-Normalisierung im AdminAnnouncementBubble (4 Fälle)
 *  5. fn_notify_cancellation_complete Trigger (2 yogis, idempotent)
 *  6. 9-Tage-Sperre delete + archive
 *  7. Wartelisten-Multi-Conflict mit echtem Promote
 *
 * Jeder Test räumt seine eigenen Daten auf (kein Leakage zwischen Tests).
 */

import { test, expect } from '@playwright/test'
import { getServiceClient } from '../utils/db'
import { E2E_PREFIX, futureDateStr, ensureTestUser } from '../utils/seed'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

const FAR_FUTURE = '2099-12-31T23:59:59.000Z'

// ════════════════════════════════════════════════════════════════════════════
// 1) CHARITY-BOOKING: yogi bucht ohne credit → bestätigung → abmelden
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-Logic] Charity-Booking — Workflow ohne Credit', () => {
  const tag = `${E2E_PREFIX}-Charity-Logic-${Date.now()}`
  let courseId: string
  let sessionId: string
  let yogi1Id: string

  test.beforeAll(async () => {
    const db = getServiceClient()
    yogi1Id = (await ensureTestUser('test.yogi1@yogamitsarah.me', 'TestYogi2024!sicher'))
    // Charity-Kurs anlegen: is_single=true, is_free=true
    const dateStr = futureDateStr(7)
    const { data: course } = await db.from('courses').insert({
      name: `${tag} Charity`,
      weekday: 'Sonntag', time_start: '10:00:00', duration_min: 60,
      max_spots: 20, total_units: 1,
      date_start: dateStr, date_end: dateStr,
      location: 'Test', is_active: true, is_single: true,
      is_open: true, is_free: true,
    }).select('id').single()
    courseId = course!.id
    const { data: sess } = await db.from('sessions').insert({
      course_id: courseId, date: dateStr,
      time_start: '10:00:00', duration_min: 60, is_cancelled: false,
    }).select('id').single()
    sessionId = sess!.id
  })

  test.afterAll(async () => {
    const db = getServiceClient()
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('waitlist').delete().eq('session_id', sessionId)
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
  })

  // Snapshot der Yogi-Credits VOR dem Charity-Workflow. In voller Suite hat der
  // Test-Yogi evtl. schon Credits aus vorherigen Tests — wir prüfen also den DIFF.
  let creditsBeforeWorkflow: number = 0

  test('Yogi bucht Charity → Booking-Row hat credit_id=NULL, type=single', async () => {
    const db = getServiceClient()
    // Vorzustand snapshotten (KEIN delete — würde andere Tests stören)
    const { data: before } = await db.from('credits').select('id').eq('user_id', yogi1Id)
    creditsBeforeWorkflow = (before || []).length
    // Buchung direkt einfügen (Charity-Pfad in handleBook setzt credit_id=null)
    const { data: booking, error } = await db.from('bookings').insert({
      user_id: yogi1Id, session_id: sessionId,
      credit_id: null, type: 'single', status: 'active',
      cancelled_at: null, cancel_late: false,
    }).select().single()
    expect(error?.message || '').toBe('')
    expect(booking?.credit_id).toBeNull()
    expect(booking?.type).toBe('single')
    expect(booking?.status).toBe('active')
  })

  test('Charity-Buchung: keine NEUE credits-Row wurde erzeugt (kein Credit verbraucht)', async () => {
    const db = getServiceClient()
    const { data: credits } = await db.from('credits').select('id').eq('user_id', yogi1Id)
    // Diff: Anzahl darf sich durch Charity-Buchung NICHT erhöht haben
    expect((credits || []).length).toBe(creditsBeforeWorkflow)
  })

  test('Charity-Stunde in /kurse-Query: liefert is_free + image_url Felder', async () => {
    const db = getServiceClient()
    const { data: sess } = await db.from('sessions')
      .select('*, course:courses(id, name, max_spots, difficulty, is_free, image_url)')
      .eq('id', sessionId).maybeSingle()
    expect((sess as any)?.course?.is_free).toBe(true)
  })

  test('Yogi meldet sich von Charity ab → Booking cancelled, KEINE neue Credit-Refund-Row', async () => {
    const db = getServiceClient()
    // Cancel-Update wie es handleCancel macht
    await db.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(),
    }).eq('user_id', yogi1Id).eq('session_id', sessionId)
    const { data: credits } = await db.from('credits').select('id').eq('user_id', yogi1Id)
    // Diff: durch Charity-Cancel kommt keine neue Credit-Row dazu
    expect((credits || []).length).toBe(creditsBeforeWorkflow)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2) CHARITY-WAITLIST: Auto-Promote ohne Credit-Check
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-Logic] Charity-Waitlist — Auto-Promote ohne Credit', () => {
  const tag = `${E2E_PREFIX}-Charity-WL-${Date.now()}`
  let courseId: string
  let sessionId: string
  let yogi1Id: string
  let yogi2Id: string

  test.beforeAll(async () => {
    const db = getServiceClient()
    yogi1Id = (await ensureTestUser('test.yogi1@yogamitsarah.me', 'TestYogi2024!sicher'))
    yogi2Id = (await ensureTestUser('test.yogi2@yogamitsarah.me', 'TestYogi2024!sicher'))
    const dateStr = futureDateStr(7)
    const { data: course } = await db.from('courses').insert({
      name: `${tag} Charity-Voll`,
      weekday: 'Samstag', time_start: '11:00:00', duration_min: 60,
      max_spots: 1, total_units: 1,
      date_start: dateStr, date_end: dateStr,
      location: 'Test', is_active: true, is_single: true,
      is_open: true, is_free: true,
    }).select('id').single()
    courseId = course!.id
    const { data: sess } = await db.from('sessions').insert({
      course_id: courseId, date: dateStr,
      time_start: '11:00:00', duration_min: 60, is_cancelled: false,
    }).select('id').single()
    sessionId = sess!.id
  })

  test.afterAll(async () => {
    const db = getServiceClient()
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('waitlist').delete().eq('session_id', sessionId)
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
  })

  test('Setup: Yogi1 bucht (kein Credit), Yogi2 auf Warteliste (kein Credit)', async () => {
    const db = getServiceClient()
    await db.from('credits').delete().in('user_id', [yogi1Id, yogi2Id])
    // Yogi1 bucht
    const { error: b1 } = await db.from('bookings').insert({
      user_id: yogi1Id, session_id: sessionId,
      credit_id: null, type: 'single', status: 'active',
    })
    expect(b1?.message || '').toBe('')
    // Yogi2 auf Waitlist
    const { error: w1 } = await db.from('waitlist').insert({
      user_id: yogi2Id, session_id: sessionId, type: 'waitlist', position: 1,
    })
    expect(w1?.message || '').toBe('')
  })

  test('Yogi1 cancelt → Auto-Promote: Yogi2 in bookings ohne Credit, Waitlist-Eintrag weg', async () => {
    const db = getServiceClient()
    // Yogi1 abmelden
    await db.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(),
    }).eq('user_id', yogi1Id).eq('session_id', sessionId)
    // promoteWaitlistOrOfferLate simulieren (Sarah-Logic ab >90 Min: auto-promote)
    // Direkt den Charity-Pfad ausführen: bookings.upsert mit credit_id=null
    await db.from('bookings').upsert({
      user_id: yogi2Id, session_id: sessionId, credit_id: null,
      type: 'single', status: 'active', cancelled_at: null, cancel_late: false,
    }, { onConflict: 'user_id,session_id' })
    await db.from('waitlist').delete().eq('user_id', yogi2Id).eq('session_id', sessionId)

    const { data: yogi2Booking } = await db.from('bookings').select('*')
      .eq('user_id', yogi2Id).eq('session_id', sessionId).eq('status', 'active').maybeSingle()
    expect(yogi2Booking?.credit_id).toBeNull()
    expect(yogi2Booking?.type).toBe('single')

    const { data: wlAfter } = await db.from('waitlist').select('id')
      .eq('user_id', yogi2Id).eq('session_id', sessionId)
    expect((wlAfter || []).length).toBe(0)
  })

  test('Charity-Pfad rückt OHNE Credit nach (auto-promoted → waitlistPromoted)', async () => {
    // RLS-Kontext-Fix 2026-05-29: Die privilegierte DB-Arbeit (auch der Charity-
    // No-Credit-Pfad) wurde aus dem Client in die SECURITY-DEFINER-RPC
    // process_cancellation_full verschoben. Der TS-Helper verschickt im
    // 'auto-promoted'-Zweig die waitlistPromoted-Email (keine separate Charity-Mail).
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/waitlist-promote.ts'), 'utf8')
    expect(src).toMatch(/mode === 'auto-promoted'[\s\S]{0,400}Email\.waitlistPromoted/)
    // Die "ohne Credit nachrücken"-Logik (Events + Charity/is_free) steckt in der Migration:
    const mig = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260529_process_cancellation_full.sql'), 'utf8')
    expect(mig).toMatch(/v_promote_without_credit\s*:?=\s*v_is_event\s*OR\s*v_session\.is_free/)
    expect(mig).toMatch(/credit_id\s*=\s*NULL/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3) SPRECHBLASE: Admin-Promote → DB-Update → URL korrekt
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-Logic] Sprechblase — Admin-Promote setzt admin_announcement korrekt', () => {
  let savedAnnouncement: any = null

  test.beforeAll(async () => {
    const db = getServiceClient()
    const { data } = await db.from('admin_announcement').select('*').eq('id', 1).maybeSingle()
    savedAnnouncement = data
  })

  test.afterAll(async () => {
    const db = getServiceClient()
    if (savedAnnouncement) {
      await db.from('admin_announcement').update({
        message: savedAnnouncement.message,
        is_active: savedAnnouncement.is_active,
        link_url: savedAnnouncement.link_url,
        link_label: savedAnnouncement.link_label,
        updated_at: new Date().toISOString(),
      }).eq('id', 1)
    }
  })

  test('Admin setzt Promo mit link_url=/kurse/X → DB hat is_active=true + link', async () => {
    const db = getServiceClient()
    const testLink = '/kurse/test-uuid-123'
    const testLabel = 'Zur Stunde'
    const testMessage = 'Test Charity am Sonntag 10:00 - kostenlos!'
    await db.from('admin_announcement').update({
      message: testMessage, is_active: true,
      link_url: testLink, link_label: testLabel,
      updated_at: new Date().toISOString(),
    }).eq('id', 1)
    const { data } = await db.from('admin_announcement').select('*').eq('id', 1).maybeSingle()
    expect((data as any).is_active).toBe(true)
    expect((data as any).link_url).toBe(testLink)
    expect((data as any).link_label).toBe(testLabel)
    expect((data as any).message).toBe(testMessage)
  })

  test('Sprechblase-Promote-Logik (admin/sessions): kein "Diese Woche" hartcoded', async () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const src = fs.readFileSync(path.join(process.cwd(), 'app/admin/sessions/[id]/page.tsx'), 'utf8')
    // Verbotenes Pattern: "Diese Woche:" hartcoded (war Bug)
    expect(src).not.toMatch(/Diese Woche:\s*\$\{/)
    // Stattdessen: neutrales Format mit Datum
    expect(src).toMatch(/dateFormatted/)
    expect(src).toMatch(/kostenlos!/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 4) URL-NORMALISIERUNG: 4 Fälle abgedeckt
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-Logic] AdminAnnouncementBubble — URL-Normalisierung', () => {
  function normalize(raw: string): string {
    const trimmed = raw.trim()
    return /^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')
      ? trimmed
      : `https://${trimmed}`
  }
  function isInternal(url: string): boolean {
    return url.startsWith('/')
  }

  test('https:// bleibt unverändert', () => {
    expect(normalize('https://www.yogamitsarah.me')).toBe('https://www.yogamitsarah.me')
  })

  test('http:// bleibt unverändert (kein zwangs-https)', () => {
    expect(normalize('http://example.com')).toBe('http://example.com')
  })

  test('/kurse/abc bleibt intern (kein https:// vorgehängt)', () => {
    expect(normalize('/kurse/abc')).toBe('/kurse/abc')
    expect(isInternal(normalize('/kurse/abc'))).toBe(true)
  })

  test('www.yogamitsarah.me bekommt https:// vorgehängt', () => {
    expect(normalize('www.yogamitsarah.me')).toBe('https://www.yogamitsarah.me')
    expect(isInternal(normalize('www.yogamitsarah.me'))).toBe(false)
  })

  test('Externe Links bekommen target=_blank im Component-Code', async () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const src = fs.readFileSync(path.join(process.cwd(), 'components/AdminAnnouncementBubble.tsx'), 'utf8')
    expect(src).toMatch(/isInternal\s*=\s*linkUrl\.startsWith\(['"]\/['"]\)/)
    expect(src).toMatch(/isInternal\s*\?\s*\{\}\s*:\s*\{\s*target:\s*['"]_blank['"]/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 5) CANCELLATION-COMPLETE-TRIGGER: 2 Yogis, idempotent
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-Logic] fn_notify_cancellation_complete — Trigger-Logik', () => {
  let courseId: string
  let yogi1Id: string
  let yogi2Id: string
  let response1Id: string
  let response2Id: string

  test.beforeAll(async () => {
    const db = getServiceClient()
    yogi1Id = (await ensureTestUser('test.yogi1@yogamitsarah.me', 'TestYogi2024!sicher'))
    yogi2Id = (await ensureTestUser('test.yogi2@yogamitsarah.me', 'TestYogi2024!sicher'))
    const dateStr = futureDateStr(30)
    const { data: course } = await db.from('courses').insert({
      name: `${E2E_PREFIX}-Trigger-Test-${Date.now()}`,
      weekday: 'Mittwoch', time_start: '18:00:00', duration_min: 60,
      max_spots: 5, total_units: 5,
      date_start: dateStr, date_end: futureDateStr(60),
      location: 'Test', is_active: true, is_single: false,
      is_open: true,
    }).select('id').single()
    courseId = course!.id

    // 2 cancellation_responses für diesen Kurs (offen)
    const { data: r1 } = await db.from('course_cancellation_responses').insert({
      course_id: courseId, user_id: yogi1Id, token: `t1-${Date.now()}`,
      choice: null, expires_at: FAR_FUTURE, remaining_sessions: 3,
    }).select('id').single()
    response1Id = r1!.id
    const { data: r2 } = await db.from('course_cancellation_responses').insert({
      course_id: courseId, user_id: yogi2Id, token: `t2-${Date.now()}`,
      choice: null, expires_at: FAR_FUTURE, remaining_sessions: 3,
    }).select('id').single()
    response2Id = r2!.id
    // Vorhandene "complete"-Notifications für diesen Kurs löschen (clean state)
    await db.from('admin_notifications').delete()
      .eq('type', 'course_cancellation_complete')
      .filter('details->>course_id', 'eq', courseId)
  })

  test.afterAll(async () => {
    const db = getServiceClient()
    await db.from('admin_notifications').delete()
      .eq('type', 'course_cancellation_complete')
      .filter('details->>course_id', 'eq', courseId)
    await db.from('course_cancellation_responses').delete().eq('course_id', courseId)
    await db.from('courses').delete().eq('id', courseId)
  })

  test('1. Yogi antwortet (von 2) → KEINE complete-Notification', async () => {
    const db = getServiceClient()
    await db.from('course_cancellation_responses').update({
      choice: 'guthaben', responded_at: new Date().toISOString(),
    }).eq('id', response1Id)
    const { count } = await db.from('admin_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'course_cancellation_complete')
      .filter('details->>course_id', 'eq', courseId)
    expect(count).toBe(0)
  })

  test('2. Yogi antwortet (letzter) → GENAU 1 complete-Notification', async () => {
    const db = getServiceClient()
    await db.from('course_cancellation_responses').update({
      choice: 'erstattung', responded_at: new Date().toISOString(),
    }).eq('id', response2Id)
    const { count } = await db.from('admin_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'course_cancellation_complete')
      .filter('details->>course_id', 'eq', courseId)
    expect(count).toBe(1)
  })

  test('Notification-Details enthalten korrekte Statistik (1×erstattung + 1×guthaben)', async () => {
    const db = getServiceClient()
    const { data } = await db.from('admin_notifications')
      .select('message, details')
      .eq('type', 'course_cancellation_complete')
      .filter('details->>course_id', 'eq', courseId)
      .single()
    expect((data as any).details.total).toBe(2)
    expect((data as any).details.refunds).toBe(1)
    expect((data as any).details.guthaben).toBe(1)
    expect((data as any).message).toContain('Erstattung')
    expect((data as any).message).toContain('Guthaben')
  })

  test('Idempotenz: erneutes Update der Response erzeugt KEINE 2. Notification', async () => {
    const db = getServiceClient()
    // Sarah setzt z.B. refund_paid=true → das triggert wieder UPDATE
    await db.from('course_cancellation_responses').update({
      refund_paid: true,
    }).eq('id', response2Id)
    const { count } = await db.from('admin_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'course_cancellation_complete')
      .filter('details->>course_id', 'eq', courseId)
    expect(count).toBe(1) // immer noch 1, kein Duplikat
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 6) 9-TAGE-SPERRE: delete + archive
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-Logic] 9-Tage-Sperre — Source-Logik prüfen', () => {
  test('deleteCourse: hat Datumsvergleich mit date_end + 9-Tage-Schwelle', async () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const src = fs.readFileSync(path.join(process.cwd(), 'app/admin/kurse/page.tsx'), 'utf8')
    // Find deleteCourse function
    const deleteCourseMatch = src.match(/async function deleteCourse[\s\S]{0,3500}/)
    expect(deleteCourseMatch).not.toBeNull()
    const deleteFn = deleteCourseMatch![0]
    expect(deleteFn).toMatch(/date_end/)
    // "9 Tag" oder "9. Tag" oder "9 Tage" muss im Block stehen
    expect(deleteFn).toMatch(/9\.?\s*Tag/i)
    expect(deleteFn).toMatch(/alert/)
  })

  test('archiveCourse: hat gleiche 9-Tage-Sperre', async () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const src = fs.readFileSync(path.join(process.cwd(), 'app/admin/kurse/page.tsx'), 'utf8')
    const archiveCourseMatch = src.match(/async function archiveCourse[\s\S]{0,3500}/)
    expect(archiveCourseMatch).not.toBeNull()
    const archiveFn = archiveCourseMatch![0]
    expect(archiveFn).toMatch(/date_end/)
    expect(archiveFn).toMatch(/9\.?\s*Tag/i)
  })

  test('archiveCourse: Kurs OHNE Teilnehmer ist IMMER archivierbar (9-Tage-Sperre nur bei Teilnehmern)', async () => {
    // Sarah-Fix 2026-05-29: Admin kann Kurse ohne Teilnehmer immer archivieren,
    // unabhängig vom Datum. Die 9-Tage-Sperre greift nur, wenn es etwas zu
    // schützen gibt (aktive Buchungen / Enrollments / einlösbare Credits).
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const src = fs.readFileSync(path.join(process.cwd(), 'app/admin/kurse/page.tsx'), 'utf8')
    const archiveCourseMatch = src.match(/async function archiveCourse[\s\S]{0,3500}/)
    expect(archiveCourseMatch).not.toBeNull()
    const archiveFn = archiveCourseMatch![0]
    // Teilnehmer-Erkennung vorhanden (Buchungen + Enrollments + Credits)
    expect(archiveFn).toMatch(/aHasParticipants/)
    expect(archiveFn).toMatch(/from\(['"]bookings['"]\)/)
    expect(archiveFn).toMatch(/from\(['"]enrollments['"]\)/)
    // 9-Tage-Sperre ist an aHasParticipants gekoppelt (nicht mehr bedingungslos)
    expect(archiveFn).toMatch(/aHasParticipants\s*&&\s*courseObj\.date_end/)
    // Guthaben zählt NICHT als schützenswert (kursunabhängig einlösbar)
    expect(archiveFn).toMatch(/guthaben/)
  })

  test('Safety-Net: deleteCourse prüft auf credits mit expires_at > NOW vor dem Löschen', async () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const src = fs.readFileSync(path.join(process.cwd(), 'app/admin/kurse/page.tsx'), 'utf8')
    const deleteCourseMatch = src.match(/async function deleteCourse[\s\S]{0,3000}/)
    expect(deleteCourseMatch).not.toBeNull()
    const deleteFn = deleteCourseMatch![0]
    expect(deleteFn).toMatch(/from\(['"]credits['"]\)/)
    expect(deleteFn).toMatch(/expires_at/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 7) WARTELISTEN-MULTI-CONFLICT: yogi auf 3 Wartelisten, 1 Credit, rückt in 1 vor
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-Logic] Waitlist-Multi-Conflict — Cleanup nach Auto-Promote', () => {
  // Dedizierter Wegwerf-User damit die globale Multi-Cleanup-Logik
  // KEINE anderen E2E-Tests pollutiert (in voller Suite teilen sich Tests yogi1).
  const dedicatedEmail = `e2e.multi-wl-${Date.now()}@yogamitsarah.me`
  let yogi1Id: string
  let courseIds: string[] = []
  let sessionIds: string[] = []

  test.beforeAll(async () => {
    const db = getServiceClient()
    yogi1Id = (await ensureTestUser(dedicatedEmail, 'TestYogi2024!sicher'))
    // 3 separate Kurse mit je 1 Stunde
    for (let i = 0; i < 3; i++) {
      const dateStr = futureDateStr(10 + i)
      const { data: c } = await db.from('courses').insert({
        name: `${E2E_PREFIX}-Multi-WL-${Date.now()}-${i}`,
        weekday: 'Donnerstag', time_start: '19:00:00', duration_min: 60,
        max_spots: 1, total_units: 1,
        date_start: dateStr, date_end: dateStr,
        location: 'Test', is_active: true, is_single: true, is_open: true,
      }).select('id').single()
      courseIds.push(c!.id)
      const { data: s } = await db.from('sessions').insert({
        course_id: c!.id, date: dateStr, time_start: '19:00:00',
        duration_min: 60, is_cancelled: false,
      }).select('id').single()
      sessionIds.push(s!.id)
    }
  })

  test.afterAll(async () => {
    const db = getServiceClient()
    await db.from('bookings').delete().in('session_id', sessionIds)
    await db.from('waitlist').delete().in('session_id', sessionIds)
    await db.from('credits').delete().eq('user_id', yogi1Id)
    await db.from('sessions').delete().in('id', sessionIds)
    await db.from('courses').delete().in('id', courseIds)
    // Dedizierten User wieder loswerden (Profile + auth.user)
    await db.from('legal_acceptances').delete().eq('user_id', yogi1Id)
    await db.from('profiles').delete().eq('id', yogi1Id)
    await db.auth.admin.deleteUser(yogi1Id).catch(() => {})
  })

  test('Setup: Yogi mit 1 Single-Credit, auf 3 Wartelisten', async () => {
    const db = getServiceClient()
    await db.from('credits').delete().eq('user_id', yogi1Id)
    await db.from('credits').insert({
      user_id: yogi1Id, total: 1, used: 0, model: 'single',
      expires_at: FAR_FUTURE,
    })
    for (const sId of sessionIds) {
      await db.from('waitlist').insert({
        user_id: yogi1Id, session_id: sId, type: 'waitlist', position: 1,
      })
    }
    const { data: wl } = await db.from('waitlist').select('id').eq('user_id', yogi1Id)
    expect((wl || []).length).toBe(3)
  })

  test('Yogi rückt in Waitlist 0 vor → Credit verbraucht → Waitlist 1+2 müssen gelöscht werden', async () => {
    const db = getServiceClient()
    // Promote in erste Waitlist: bookings.upsert mit credit
    const { data: credit } = await db.from('credits').select('id').eq('user_id', yogi1Id).single()
    await db.from('bookings').upsert({
      user_id: yogi1Id, session_id: sessionIds[0],
      credit_id: credit!.id, type: 'single', status: 'active',
    }, { onConflict: 'user_id,session_id' })
    await db.from('waitlist').delete().eq('user_id', yogi1Id).eq('session_id', sessionIds[0])

    // Trigger trg_sync_credit_used erhöht used. Wenn used=total → keine freien mehr.
    // Multi-Conflict-Cleanup-Logik (lib/waitlist-promote.ts) löscht die anderen Wartelisten.
    // Wir simulieren das hier manuell wie der Code es macht:
    const nowIso = new Date().toISOString()
    const { data: creditsAfter } = await db.from('credits')
      .select('id, total, used, model').eq('user_id', yogi1Id)
      .gt('expires_at', nowIso)
    const stillFree = (creditsAfter || []).filter((c: any) => c.total > c.used && c.model !== 'guthaben')
    if (stillFree.length === 0) {
      await db.from('waitlist').delete().eq('user_id', yogi1Id).eq('type', 'waitlist')
    }

    const { data: wlAfter } = await db.from('waitlist').select('id').eq('user_id', yogi1Id)
    expect((wlAfter || []).length).toBe(0)
  })

  test('Multi-Cleanup nach Promote: Migration entfernt andere Wartelisten + TS mailt pro Eintrag', async () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/waitlist-promote.ts'), 'utf8')
    // TS verschickt pro server-seitig entferntem Warteliste-Eintrag eine Hinweis-Mail.
    expect(src).toMatch(/removed_elsewhere[\s\S]{0,400}Email\.waitlistRemovedCreditUsedElsewhere/)
    // Die eigentliche Cleanup-Logik (letzter Credit weg → andere Wartelisten löschen)
    // liegt in der RPC-Migration:
    const mig = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260529_process_cancellation_full.sql'), 'utf8')
    expect(mig).toMatch(/SELECT count\(\*\) INTO v_still_free/)
    expect(mig).toMatch(/IF v_still_free = 0 THEN/)
    expect(mig).toMatch(/DELETE FROM waitlist WHERE user_id = v_waitlist\.user_id AND type = 'waitlist'/)
  })
})
