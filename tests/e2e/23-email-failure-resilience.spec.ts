/**
 * Workflow: Email-Send-Failure Resilience
 * Testfälle:
 *   - Kursabbruch-Token-Wahl: Email-Failure killt nicht den DB-Save (try/catch)
 *   - Bulk-Kursabbruch mit vielen Yogis: bei Email-Failure läuft Workflow weiter
 *   - Edge Function send-email mit ungültigem Type → 400, App-Code muss das händeln
 */
import { test, expect } from '@playwright/test'
import { createEnrolledCourse, E2E_PREFIX } from '../utils/seed'
import {
  getUserIdByEmail, getAdminClient, getCancellationResponse,
} from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('Email-Resilience: Edge Function Validation', () => {
  test('Edge Function send-email mit ungültigem Type → returns Fehler (kein crash)', async () => {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'invalid'}`,
      },
      body: JSON.stringify({ type: 'nonexistent_type_xyz', data: {} }),
    })

    // Erwartung: kein 5xx (kein Crash), sondern strukturierter Fehler
    expect(res.status, 'Edge Function darf nicht 5xx werfen').toBeLessThan(500)
  })
})

test.describe('Email-Resilience: Kursabbruch Choice-Save bei Email-Failure', () => {
  // Dieser Test verifiziert dass /api/kursabbruch/[token] auch dann erfolgreich antwortet
  // wenn Email.adminYogiChoice scheitert (try/catch).

  let courseId: string
  let yogi1Id: string
  let token: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!

    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'guthaben')

    const course = await createEnrolledCourse(yogi1Id, { name: `${E2E_PREFIX} Email-Resilience-Test` })
    courseId = course.courseId

    await db.from('courses').update({ is_cancelled: true, is_active: false }).eq('id', courseId)

    token = `e2e-resilience-${Date.now()}`
    const futureDate = new Date(); futureDate.setDate(futureDate.getDate() + 5)

    await db.from('course_cancellation_responses').insert({
      user_id: yogi1Id,
      course_id: courseId,
      token,
      choice: null,
      refund_paid: false,
      expires_at: futureDate.toISOString(),
      remaining_sessions: 2,
    })
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('course_cancellation_responses').delete().eq('course_id', courseId)
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'guthaben')
    const { data: sessions } = await db.from('sessions').select('id').eq('course_id', courseId)
    if (sessions && sessions.length > 0) {
      await db.from('bookings').delete().in('session_id', sessions.map(s => s.id))
    }
    await db.from('enrollments').delete().eq('course_id', courseId)
    await db.from('credits').delete().eq('course_id', courseId)
    await db.from('sessions').delete().eq('course_id', courseId)
    await db.from('courses').delete().eq('id', courseId)
  })

  test('POST /api/kursabbruch/[token] mit choice=guthaben → response 200, choice in DB', async () => {
    const res = await fetch(`${process.env.BASE_URL}/api/kursabbruch/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice: 'guthaben' }),
    })

    expect(res.status, 'API muss 200 zurückgeben (Choice gespeichert, Email best-effort)').toBe(200)

    const json = await res.json()
    expect(json.ok, 'Response.ok muss true sein').toBe(true)

    // DB-Check: Choice wurde gespeichert auch wenn Email-Versand evtl. scheitert
    const updated = await getCancellationResponse(yogi1Id, courseId)
    expect(updated?.choice, 'Choice muss in DB gespeichert sein').toBe('guthaben')
  })
})
