/**
 * Workflow #3 (Sarah-Welle 2026-05-25): Krankheits-Austragung mit Attest — echter DB-Flow.
 *
 * Komplementaer zu admin/19-notifications.spec.ts Z. 872-983 (12 Source-Smoke-Tests).
 * Hier: End-zu-End-Flow auf DB-Ebene — simuliert was cancelEnrollmentDueToIllness()
 * in app/admin/yogis/[id]/page.tsx macht (siehe Z. 514-650).
 *
 * Setup: Yogi mit aktivem Kurs (3 Sessions), 1 Vorhol-Buchung.
 * Ablauf: Sessions stornieren + Vorhol stornieren + Guthaben anlegen (10 Mon, source=illness)
 *         + Enrollment.end_date + Enrollment.end_reason='illness'.
 * Assert: alle DB-State korrekt + audit_log enthaelt admin_illness_credit-Eintrag-Format.
 *
 * Stil: 18-kursabbruch-token.spec.ts Z. 510-555 (DB-Setup + Assertions).
 */
import { test, expect } from '@playwright/test'
import { createEnrolledCourse, E2E_PREFIX, futureDateStr } from '../utils/seed'
import { getUserIdByEmail, getAdminClient, getServiceClient } from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('[E2E] Krankheits-Austragung — echter DB-Flow', () => {
  test('Komplett-Flow: Bookings stornieren + Vorhol weg + Guthaben 10 Monate + enrollment.end_*', async () => {
    const yogiId = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()

    // Cleanup vorab
    await db.from('credits').delete().eq('user_id', yogiId).eq('model', 'guthaben').eq('source', 'illness')

    // 1) Kurs mit 3 Sessions + 1 Vorhol-Buchung anlegen
    const course = await createEnrolledCourse(yogiId, {
      name: `${E2E_PREFIX} Krankheit-Flow`, sessionCount: 3,
    })
    const courseId = course.courseId

    // Vorhol-Buchung anlegen: Yogi bucht eine Session aus einem ANDEREN Kurs
    // mit origin_session_id (Vorhol). Wir simulieren via direkter Insert.
    const otherCourseDate = futureDateStr(20)
    const { data: otherCourse } = await db.from('courses').insert({
      name: `${E2E_PREFIX} Krankheit-Vorhol-Quelle`,
      weekday: 'Montag', time_start: '18:00:00', duration_min: 60,
      max_spots: 5, total_units: 1,
      date_start: otherCourseDate, date_end: otherCourseDate,
      is_active: true, is_single: false, is_open: false,
    }).select('id').single()
    const { data: vorholSession } = await db.from('sessions').insert({
      course_id: otherCourse!.id, date: otherCourseDate, time_start: '18:00:00',
      duration_min: 60, is_cancelled: false,
    }).select('id').single()
    // Origin-Session = erste Kurs-Session (technische Referenz, muss existieren)
    const originSessionId = course.sessionIds[0]
    const { data: vorholBk } = await db.from('bookings').insert({
      user_id: yogiId, session_id: vorholSession!.id, type: 'vorhol',
      status: 'active', origin_session_id: originSessionId,
    }).select('id').single()

    try {
      // ── ATTEST-AUSTRAGUNG (simuliert cancelEnrollmentDueToIllness) ─────
      const attestDateStr = futureDateStr(15) // 1 Tag vor 1. Session (16d)
      // Hinweis: createEnrolledCourse legt Sessions ab Tag 14 an (sieht seed.ts).

      // 1) Kurs-Sessions ab Attest-Datum holen
      const { data: futureSessions } = await db.from('sessions')
        .select('id').eq('course_id', courseId).gte('date', attestDateStr)
      const futureSessionIds = (futureSessions || []).map(s => s.id)
      expect(futureSessionIds.length, 'Es muss mindestens 1 zukuenftige Session geben').toBeGreaterThanOrEqual(1)

      // 2) Bookings dieses Yogis in zukuenftigen Sessions stornieren (cancel_late=false)
      const { data: bksToCancel } = await db.from('bookings')
        .select('id').eq('user_id', yogiId).in('session_id', futureSessionIds).eq('status', 'active')
      const cancelledCount = (bksToCancel || []).length
      await db.from('bookings').update({
        status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false,
      }).eq('user_id', yogiId).in('session_id', futureSessionIds).eq('status', 'active')

      // 3) Vorhol-Buchungen (origin_session_id NOT NULL) ab Attest-Datum stornieren — ersatzlos
      const { data: vorholBks } = await db.from('bookings')
        .select('id, session_id, session:sessions!bookings_session_id_fkey(date)')
        .eq('user_id', yogiId).eq('status', 'active').not('origin_session_id', 'is', null)
      const vorholToCancel = (vorholBks || []).filter((b: any) =>
        b.session?.date && b.session.date >= attestDateStr
      )
      for (const b of vorholToCancel) {
        await db.from('bookings').update({
          status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: true,
        }).eq('id', b.id)
      }

      // 4) enrollment.end_date + end_reason='illness'
      await db.from('enrollments')
        .update({ end_date: attestDateStr, end_reason: 'illness' })
        .eq('user_id', yogiId).eq('course_id', courseId)

      // 5) Neuer Credit: source='illness', 10 Monate gueltig
      const expiresAt = new Date(attestDateStr)
      expiresAt.setMonth(expiresAt.getMonth() + 10)
      const hoursCredited = cancelledCount
      if (hoursCredited > 0) {
        await db.from('credits').insert({
          user_id: yogiId, model: 'guthaben',
          total: hoursCredited, used: 0,
          expires_at: expiresAt.toISOString(),
          source: 'illness',
        } as any)
      }

      // 5b) Alten Kurs-Credit dieses Kurses loeschen (Sarah-Fix 2026-05-28).
      //     Mirror des Handlers cancelEnrollmentDueToIllness: Buchungen
      //     entkoppeln, dann den model='course'-Credit dieses Kurses loeschen.
      //     Verhindert Doppel-Credit (alter Kurs-Credit + neues Guthaben).
      const { data: oldCourseCreds } = await db.from('credits')
        .select('id').eq('user_id', yogiId).eq('course_id', courseId)
      const oldCourseCreditIds = (oldCourseCreds || []).map(c => c.id)
      if (oldCourseCreditIds.length > 0) {
        await db.from('bookings').update({ credit_id: null })
          .eq('user_id', yogiId).in('credit_id', oldCourseCreditIds)
        await db.from('enrollments').update({ credit_id: null })
          .eq('user_id', yogiId).in('credit_id', oldCourseCreditIds)
        await db.from('credits').delete().in('id', oldCourseCreditIds)
      }

      // 6) Audit-Log eintrag
      await db.from('audit_log').insert({
        user_id: yogiId,
        action: 'admin_illness_credit',
        details: {
          course_id: courseId,
          attest_date: attestDateStr,
          hours_credited: hoursCredited,
          vorhol_cancelled_count: vorholToCancel.length,
          expires_at: expiresAt.toISOString(),
        },
      } as any)

      // ── ASSERTIONS ──────────────────────────────────────────────────────

      // a) Bookings storniert
      const { data: cancelledBks } = await db.from('bookings')
        .select('id, status, cancel_late').eq('user_id', yogiId)
        .in('session_id', futureSessionIds)
      expect(cancelledBks?.every(b => b.status === 'cancelled'),
        'Alle Yogi-Bookings im Kurs ab Attest-Datum muessen storniert sein').toBe(true)
      expect(cancelledBks?.every(b => b.cancel_late === false),
        'Kurs-Bookings: cancel_late=false (DB-Trigger gibt Credit zurueck)').toBe(true)

      // b) Vorhol-Buchung storniert mit cancel_late=true
      const { data: vorholAfter } = await db.from('bookings')
        .select('status, cancel_late').eq('id', vorholBk!.id).single()
      expect(vorholAfter?.status).toBe('cancelled')
      expect(vorholAfter?.cancel_late, 'Vorhol: cancel_late=true (ersatzlos)').toBe(true)

      // c) Enrollment hat end_date + end_reason
      const { data: enr } = await db.from('enrollments')
        .select('end_date, end_reason').eq('user_id', yogiId).eq('course_id', courseId).single()
      expect(enr?.end_date).toBe(attestDateStr)
      expect(enr?.end_reason).toBe('illness')

      // d) Neuer Credit: source='illness', 10 Monate-Frist
      const { data: illnessCred } = await db.from('credits')
        .select('total, used, expires_at, source, model')
        .eq('user_id', yogiId).eq('source', 'illness').single()
      expect(illnessCred?.source).toBe('illness')
      expect(illnessCred?.model).toBe('guthaben')
      expect(illnessCred?.total).toBe(cancelledCount)
      expect(illnessCred?.used).toBe(0)

      // d2) KEIN alter Kurs-Credit mehr (Sarah-Fix 2026-05-28): der model='course'
      //     Credit dieses Kurses muss geloescht sein — sonst Doppel-Credit
      //     (haengende "0 / X genutzt"-Karte in /meine zusaetzlich zum Guthaben).
      const { data: leftoverCourseCred } = await db.from('credits')
        .select('id').eq('user_id', yogiId).eq('course_id', courseId).eq('model', 'course')
      expect(leftoverCourseCred?.length ?? 0,
        'Alter Kurs-Credit muss nach Krankheits-Austragung geloescht sein').toBe(0)
      // Expiry-Check: ca. 10 Monate ab Attest-Datum (Toleranz 2 Tage)
      const expiryDt = new Date(illnessCred!.expires_at as string)
      const expectedDt = new Date(attestDateStr)
      expectedDt.setMonth(expectedDt.getMonth() + 10)
      const diffDays = Math.abs((expiryDt.getTime() - expectedDt.getTime()) / (1000 * 60 * 60 * 24))
      expect(diffDays, 'Expiry-Datum muss innerhalb von 2 Tagen vom errechneten 10-Monats-Datum liegen').toBeLessThan(2)

      // e) Audit-Log enthaelt admin_illness_credit
      const { data: audits } = await db.from('audit_log')
        .select('action, details').eq('user_id', yogiId).eq('action', 'admin_illness_credit')
        .order('created_at', { ascending: false }).limit(1)
      expect((audits || []).length).toBeGreaterThanOrEqual(1)
      expect(audits![0].action).toBe('admin_illness_credit')
      const d = audits![0].details as any
      expect(d?.attest_date).toBe(attestDateStr)
      expect(d?.hours_credited).toBe(cancelledCount)
    } finally {
      // Cleanup
      await db.from('audit_log').delete().eq('user_id', yogiId).eq('action', 'admin_illness_credit')
      await db.from('credits').delete().eq('user_id', yogiId).eq('model', 'guthaben').eq('source', 'illness')
      await db.from('bookings').delete().eq('user_id', yogiId).in('session_id', [vorholSession!.id])
      await db.from('sessions').delete().eq('id', vorholSession!.id)
      await db.from('courses').delete().eq('id', otherCourse!.id)
      // courseId-Cleanup
      await db.from('enrollments').delete().eq('course_id', courseId)
      await db.from('credits').delete().eq('course_id', courseId)
      const { data: sessions } = await db.from('sessions').select('id').eq('course_id', courseId)
      if (sessions && sessions.length > 0) {
        await db.from('bookings').delete().in('session_id', sessions.map(s => s.id))
      }
      await db.from('sessions').delete().eq('course_id', courseId)
      await db.from('courses').delete().eq('id', courseId)
    }
  })

  test('DB-Schema: credits.source akzeptiert "illness"', async () => {
    const db = getServiceClient()
    const { error } = await db.from('credits').select('source').eq('source', 'illness').limit(1)
    expect(error?.message || '').toBe('')
  })

  test('DB-Schema: enrollments.end_reason akzeptiert "illness"', async () => {
    const db = getServiceClient()
    const { error } = await db.from('enrollments').select('end_reason').eq('end_reason', 'illness').limit(1)
    expect(error?.message || '').toBe('')
  })
})
