/**
 * DEEP AUDIT: Credit-Konsistenz Yogi-Sicht ↔ Admin-Sicht ↔ DB
 *
 * Sarah-Anforderung 2026-05-23:
 * Bei jedem Credit-Vergabe/Rücknahme/Abmeldungs-Szenario muss gelten:
 *   credit.used (DB) == "frei = total - used" Anzeige bei Yogi == bei Admin
 *
 * Bekannte historische Bugs die wir hier als Regression abdecken:
 * - Sl296: Yogi bucht, kein Credit-Abzug
 * - 4/6 vs 4/7: Admin zeigt mehr als Yogi
 * - Drop-In doppelt in /meine
 * - handleBook reaktiviert mit falschem type
 * - Cross-Course-Booking zählt fälschlich in Aggregation
 */
import { test, expect } from '@playwright/test'
import * as dotenv from 'dotenv'
import { getAdminClient, getUserIdByEmail } from '../utils/db'
import { createTestCourse, E2E_PREFIX } from '../utils/seed'

dotenv.config({ path: '.env.test' })

async function resetYogi(userId: string) {
  const db = await getAdminClient()
  await db.from('waitlist').delete().eq('user_id', userId)
  await db.from('bookings').delete().eq('user_id', userId)
  await db.from('credits').delete().eq('user_id', userId)
  await db.from('enrollments').delete().eq('user_id', userId)
}

function dateStr(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().split('T')[0]
}

test.describe('Credit-Konsistenz: DB-Trigger trg_sync_credit_used', () => {
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

  test('[AUDIT] Tenpack: Buchung anlegen → credit.used = 1', async () => {
    const db = await getAdminClient()
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, model: 'tenpack', total: 10, used: 0,
      expires_at: exp.toISOString(),
    }).select('id').single()

    const course = await createTestCourse({ name: `${E2E_PREFIX} CreditTrg-1`, sessionCount: 1, startDaysFromNow: 5 })
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: credit!.id,
      type: 'single', status: 'active',
    })

    const { data: after } = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(after?.used).toBe(1)
  })

  test('[AUDIT] Tenpack: Buchung cancelled → credit.used = 0', async () => {
    const db = await getAdminClient()
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, model: 'tenpack', total: 10, used: 0,
      expires_at: exp.toISOString(),
    }).select('id').single()
    const course = await createTestCourse({ name: `${E2E_PREFIX} CreditTrg-2`, sessionCount: 1, startDaysFromNow: 5 })
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: credit!.id,
      type: 'single', status: 'active',
    })
    // Cancel
    await db.from('bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('user_id', yogi1Id).eq('session_id', course.sessionIds[0])

    const { data: after } = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(after?.used).toBe(0)
  })

  test('[AUDIT] Course-Credit: 2 Bookings → used=2, 1 cancelled → used=1', async () => {
    const db = await getAdminClient()
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const course = await createTestCourse({ name: `${E2E_PREFIX} CreditTrg-Course`, sessionCount: 2, startDaysFromNow: 5 })
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: course.courseId, model: 'course',
      total: 2, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })
    for (const sid of course.sessionIds) {
      await db.from('bookings').insert({
        user_id: yogi1Id, session_id: sid, credit_id: credit!.id,
        type: 'course', status: 'active',
      })
    }
    const { data: after2 } = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(after2?.used).toBe(2)

    await db.from('bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('user_id', yogi1Id).eq('session_id', course.sessionIds[0])

    const { data: after1 } = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(after1?.used).toBe(1)
  })

  test('[AUDIT] Cross-Course Vorhol: Course-Credit-A verwendet für Session-B → A.used hoch', async () => {
    const db = await getAdminClient()
    // Course A, Yogi enrolled
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const courseA = await createTestCourse({ name: `${E2E_PREFIX} CrossUsage-A`, sessionCount: 1, startDaysFromNow: 5 })
    const { data: credA } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: courseA.courseId, model: 'course',
      total: 1, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: courseA.courseId })

    // Course B (Yogi NICHT enrolled)
    const courseB = await createTestCourse({ name: `${E2E_PREFIX} CrossUsage-B`, sessionCount: 1, startDaysFromNow: 3 })

    // Booking in B mit Credit von A
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: courseB.sessionIds[0], credit_id: credA!.id,
      type: 'course', status: 'active',
    })

    // A.used muss 1 sein (Trigger zählt ALLE active bookings mit credit_id=A)
    const { data: after } = await db.from('credits').select('used').eq('id', credA!.id).single()
    expect(after?.used).toBe(1)
  })

  test('[AUDIT] UNIQUE-Constraint: 2x Insert in dieselbe Session → nur 1 Booking', async () => {
    const db = await getAdminClient()
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, model: 'tenpack', total: 10, used: 0,
      expires_at: exp.toISOString(),
    }).select('id').single()
    const course = await createTestCourse({ name: `${E2E_PREFIX} Unique-Test`, sessionCount: 1, startDaysFromNow: 5 })

    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: credit!.id,
      type: 'single', status: 'active',
    })
    // 2. Insert sollte fehlen oder per onConflict upserten
    const { error: err2 } = await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: credit!.id,
      type: 'single', status: 'active',
    })
    // Entweder Error (Unique-Violation) ODER Upsert → höchstens 1 Booking in DB
    const { data: bookings } = await db.from('bookings')
      .select('id').eq('user_id', yogi1Id).eq('session_id', course.sessionIds[0])
    expect(bookings?.length).toBe(1)
    // Plus: credit.used muss 1 sein (nicht 2!)
    const { data: c } = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(c?.used).toBe(1)
  })
})

test.describe('Credit-Konsistenz: Yogi-Sicht ↔ Admin-Sicht ↔ DB', () => {
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

  /** Liest /meine-Aggregation wie es die UI macht: Math.max(0, total - used) */
  async function yogiViewFreeCredits(): Promise<{ totalFree: number, perCredit: any[] }> {
    const db = await getAdminClient()
    const { data: credits } = await db.from('credits').select('*')
      .eq('user_id', yogi1Id)
      .gt('expires_at', new Date().toISOString())
    const visible = (credits || []).filter((c: any) =>
      c.model === 'course' || Math.max(0, c.total - c.used) > 0
    )
    const totalFree = visible.reduce((s, c) => s + Math.max(0, c.total - c.used), 0)
    return { totalFree, perCredit: visible }
  }

  /** Admin /admin/yogis/[id] freeCredits-Berechnung */
  async function adminViewFreeCredits(): Promise<number> {
    const db = await getAdminClient()
    const { data: credits } = await db.from('credits').select('*').eq('user_id', yogi1Id)
    return (credits || []).reduce((sum, c) => {
      if (new Date(c.expires_at) > new Date()) return sum + Math.max(0, c.total - c.used)
      return sum
    }, 0)
  }

  test('[AUDIT] Yogi mit Course-Credit 3/0: beide Sichten zeigen 3 frei', async () => {
    const db = await getAdminClient()
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const course = await createTestCourse({ name: `${E2E_PREFIX} Konsistenz-1`, sessionCount: 3, startDaysFromNow: 5 })
    await db.from('credits').insert({
      user_id: yogi1Id, course_id: course.courseId, model: 'course',
      total: 3, used: 0, expires_at: exp.toISOString(),
    })
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })

    const yogi = await yogiViewFreeCredits()
    const admin = await adminViewFreeCredits()
    expect(yogi.totalFree).toBe(3)
    expect(admin).toBe(3)
  })

  test('[AUDIT] Nach 1 Buchung: beide Sichten zeigen 2 frei', async () => {
    const db = await getAdminClient()
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const course = await createTestCourse({ name: `${E2E_PREFIX} Konsistenz-2`, sessionCount: 3, startDaysFromNow: 5 })
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: course.courseId, model: 'course',
      total: 3, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: credit!.id,
      type: 'course', status: 'active',
    })

    const yogi = await yogiViewFreeCredits()
    const admin = await adminViewFreeCredits()
    expect(yogi.totalFree).toBe(2)
    expect(admin).toBe(2)
  })

  test('[AUDIT] Cross-Course-Bug-Regression: A-Credit für B-Stunde verbraucht — beide Sichten zeigen weniger frei', async () => {
    const db = await getAdminClient()
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const courseA = await createTestCourse({ name: `${E2E_PREFIX} XCnt-A`, sessionCount: 2, startDaysFromNow: 5 })
    const courseB = await createTestCourse({ name: `${E2E_PREFIX} XCnt-B`, sessionCount: 1, startDaysFromNow: 3 })
    const { data: credA } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: courseA.courseId, model: 'course',
      total: 2, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: courseA.courseId })
    // Cross-course: B-Session mit Credit-A
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: courseB.sessionIds[0], credit_id: credA!.id,
      type: 'course', status: 'active',
    })
    const yogi = await yogiViewFreeCredits()
    const admin = await adminViewFreeCredits()
    expect(yogi.totalFree).toBe(1) // 2 total - 1 used = 1
    expect(admin).toBe(1)
    expect(yogi.totalFree).toBe(admin)
  })

  test('[AUDIT] Guthaben-Credit zählt NUR im Admin-Frei-Count, NICHT im Yogi-Frei-Count? — beide identisch', async () => {
    // Diese Annahme war historisch umstritten. Aktuelle Logik: beide zählen Guthaben.
    const db = await getAdminClient()
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 2)
    await db.from('credits').insert({
      user_id: yogi1Id, model: 'guthaben', total: 4, used: 0,
      expires_at: exp.toISOString(),
    })
    const yogi = await yogiViewFreeCredits()
    const admin = await adminViewFreeCredits()
    expect(yogi.totalFree).toBe(admin)
  })

  test('[AUDIT] Voll verbraucht: total=used → 0 frei in beiden Sichten', async () => {
    const db = await getAdminClient()
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const course = await createTestCourse({ name: `${E2E_PREFIX} Voll-Verbraucht`, sessionCount: 2, startDaysFromNow: 5 })
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: course.courseId, model: 'course',
      total: 2, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })
    for (const sid of course.sessionIds) {
      await db.from('bookings').insert({
        user_id: yogi1Id, session_id: sid, credit_id: credit!.id,
        type: 'course', status: 'active',
      })
    }
    const yogi = await yogiViewFreeCredits()
    const admin = await adminViewFreeCredits()
    expect(yogi.totalFree).toBe(0)
    expect(admin).toBe(0)
  })

  test('[AUDIT] Abgelaufener Credit zählt in keiner Sicht', async () => {
    const db = await getAdminClient()
    const past = new Date(); past.setDate(past.getDate() - 5)
    await db.from('credits').insert({
      user_id: yogi1Id, model: 'tenpack', total: 5, used: 0,
      expires_at: past.toISOString(),
    })
    const yogi = await yogiViewFreeCredits()
    const admin = await adminViewFreeCredits()
    expect(yogi.totalFree).toBe(0)
    expect(admin).toBe(0)
  })
})

test.describe('Credit-Vergabe & Rücknahme: vollständige Sequenzen', () => {
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

  test('[AUDIT] FULL CYCLE: Yogi enrolled, bucht, sagt ab, bucht wieder — credit.used kohärent', async () => {
    const db = await getAdminClient()
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const course = await createTestCourse({ name: `${E2E_PREFIX} FullCycle`, sessionCount: 1, startDaysFromNow: 5 })
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: course.courseId, model: 'course',
      total: 1, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })
    const sid = course.sessionIds[0]

    // 1) Buchen
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: sid, credit_id: credit!.id,
      type: 'course', status: 'active',
    })
    let { data: c } = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(c?.used).toBe(1)

    // 2) Cancel
    await db.from('bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('user_id', yogi1Id).eq('session_id', sid)
    ;({ data: c } = await db.from('credits').select('used').eq('id', credit!.id).single())
    expect(c?.used).toBe(0)

    // 3) Re-aktivieren (Update statt neuer Insert, weil UNIQUE-Constraint)
    await db.from('bookings').update({ status: 'active', cancelled_at: null })
      .eq('user_id', yogi1Id).eq('session_id', sid)
    ;({ data: c } = await db.from('credits').select('used').eq('id', credit!.id).single())
    expect(c?.used).toBe(1)
  })

  test('[AUDIT] Yogi mit 0 freien Credits + abgelaufenen Credits → "keine Credits" Zustand', async () => {
    const db = await getAdminClient()
    // Abgelaufen
    const past = new Date(); past.setDate(past.getDate() - 1)
    await db.from('credits').insert({
      user_id: yogi1Id, model: 'tenpack', total: 5, used: 5, expires_at: past.toISOString(),
    })
    // Voll-verbrauchter aktueller Credit
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    await db.from('credits').insert({
      user_id: yogi1Id, model: 'tenpack', total: 3, used: 3, expires_at: exp.toISOString(),
    })

    // Sicht-Helpers wie in /meine
    const { data: credits } = await db.from('credits').select('*')
      .eq('user_id', yogi1Id)
      .gt('expires_at', new Date().toISOString())
    const visible = (credits || []).filter((c: any) =>
      c.model === 'course' || Math.max(0, c.total - c.used) > 0
    )
    expect(visible).toHaveLength(0) // Voll-verbrauchte non-course Credits sind ausgeblendet
  })

  test('[AUDIT] Mid-Course Enrollment: Course-Credit total < course.total_units', async () => {
    const db = await getAdminClient()
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    // 4-Session-Kurs, Yogi steigt erst ab Session 3 ein → Credit-Total = 2 (nicht 4)
    const course = await createTestCourse({ name: `${E2E_PREFIX} MidCourse-Test`, sessionCount: 4, startDaysFromNow: 5 })
    const { data: courseRow } = await db.from('courses').select('total_units').eq('id', course.courseId).single()
    const yogiUnits = 2
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: course.courseId, model: 'course',
      total: yogiUnits, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })
    // Yogi nur in Session 3 + 4 gebucht
    for (const sid of course.sessionIds.slice(2)) {
      await db.from('bookings').insert({
        user_id: yogi1Id, session_id: sid, credit_id: credit!.id,
        type: 'course', status: 'active',
      })
    }

    // Yogi's credit muss total=2 used=2 sein
    const { data: c } = await db.from('credits').select('total, used').eq('id', credit!.id).single()
    expect(c?.total).toBe(2)
    expect(c?.used).toBe(2)
    // Course-Total bleibt 4
    expect(courseRow?.total_units).toBe(4)
  })
})
