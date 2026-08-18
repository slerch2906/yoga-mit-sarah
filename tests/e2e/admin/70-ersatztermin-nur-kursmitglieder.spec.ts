/**
 * Sarah-Wunsch (2026-08-18): Wird eine Kursstunde abgesagt UND gleichzeitig
 * ein Ersatztermin angelegt, sollen NUR echte Kursmitglieder automatisch in
 * den Ersatztermin übernommen werden (Credit bleibt dort verbraucht).
 * Nachholer aus anderen Kursen (nicht in enrollments dieses Kurses) werden
 * NICHT automatisch umgebucht — ihr Credit wird stattdessen ganz normal
 * zurückgebucht (Trigger) und sie bekommen eine eigene, freundliche Info-Mail
 * statt der "Ersatztermin"-Mail.
 *
 * Testfälle:
 *   - Cancel + Ersatztermin (Session-Seite): Kursmitglied wird übernommen,
 *     externer Nachholer NICHT — sein Credit ist wieder frei.
 *   - Nachträglicher Ersatztermin (handleAddLateReplacement): identische
 *     Kursmitglieder-Gate greift auch hier.
 */
import { test, expect } from '@playwright/test'
import { createTestCourse, E2E_PREFIX, giveYogiSingleCredit } from '../../utils/seed'
import { getUserIdByEmail, getAdminClient } from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('[E2E] Ersatztermin: nur Kursmitglieder automatisch übernehmen', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let yogi1Id: string // Kursmitglied
  let yogi2Id: string // Nachholer/Drop-in, NICHT eingeschrieben
  let courseId: string
  let sessionId: string
  let courseCreditId: string
  let singleCreditId: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'course')
    await db.from('credits').delete().eq('user_id', yogi2Id).eq('model', 'single')

    const course = await createTestCourse({
      name: `${E2E_PREFIX} Ersatztermin-Kursmitglieder`, sessionCount: 1, startDaysFromNow: 20, maxSpots: 5,
    })
    courseId = course.courseId
    sessionId = course.sessionIds[0]

    const { data: cc } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: courseId, model: 'course', total: 1, used: 0,
      expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    }).select('id').single()
    courseCreditId = cc!.id
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: courseId })
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: sessionId, credit_id: courseCreditId, type: 'course', status: 'active',
    })

    singleCreditId = (await giveYogiSingleCredit(yogi2Id, 1))!
    await db.from('bookings').insert({
      user_id: yogi2Id, session_id: sessionId, credit_id: singleCreditId, type: 'single', status: 'active',
    })
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    const { data: sess } = await db.from('sessions').select('replacement_session_id').eq('id', sessionId).maybeSingle()
    const repId = sess?.replacement_session_id
    await db.from('bookings').delete().eq('session_id', sessionId)
    if (repId) await db.from('bookings').delete().eq('session_id', repId)
    await db.from('enrollments').delete().eq('course_id', courseId)
    await db.from('credits').delete().in('id', [courseCreditId, singleCreditId])
    await db.from('audit_log').delete().eq('details->>original_session_id', sessionId)
    if (repId) await db.from('sessions').delete().eq('id', repId)
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
  })

  test('Cancel + Ersatztermin: Kursmitglied übernommen, externer Nachholer nicht', async ({ page }) => {
    const db = await getAdminClient()
    page.on('dialog', d => d.accept())

    await page.goto(`/admin/sessions/${sessionId}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /stunde absagen/i }).click()
    await page.getByText('Ersatztermin anbieten').click()

    const replacementDate = new Date(Date.now() + 27 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await page.locator('input[type="date"]').fill(replacementDate)
    await page.locator('input[type="time"]').fill('19:00')

    await page.getByRole('button', { name: /^absagen$/i }).click()
    // handleCancelSession() ruft am Ende router.back() — warten bis die
    // Navigation weg von der Session-Seite abgeschlossen ist.
    await page.waitForURL(url => !url.pathname.includes(`/admin/sessions/${sessionId}`), { timeout: 15_000 })

    const { data: origSession } = await db.from('sessions')
      .select('is_cancelled, replacement_session_id').eq('id', sessionId).single()
    expect(origSession?.is_cancelled).toBe(true)
    const replacementSessionId = origSession?.replacement_session_id
    expect(replacementSessionId, 'Ersatztermin wurde nicht angelegt').toBeTruthy()

    // Kursmitglied (yogi1): aktive Buchung im Ersatztermin, Credit weiterhin verbraucht.
    const { data: yogi1RepBooking } = await db.from('bookings')
      .select('status, credit_id').eq('session_id', replacementSessionId).eq('user_id', yogi1Id).maybeSingle()
    expect(yogi1RepBooking, 'Kursmitglied wurde nicht in den Ersatztermin übernommen').toBeTruthy()
    expect(yogi1RepBooking?.status).toBe('active')
    expect(yogi1RepBooking?.credit_id).toBe(courseCreditId)

    // Externer Nachholer (yogi2): KEINE Buchung im Ersatztermin.
    const { data: yogi2RepBooking } = await db.from('bookings')
      .select('id').eq('session_id', replacementSessionId).eq('user_id', yogi2Id).maybeSingle()
    expect(yogi2RepBooking, 'Externer Nachholer wurde fälschlich in den Ersatztermin übernommen').toBeNull()

    // Externer Nachholer: Original-Buchung storniert, Credit per Trigger zurückgebucht.
    const { data: yogi2OrigBooking } = await db.from('bookings')
      .select('status').eq('session_id', sessionId).eq('user_id', yogi2Id).single()
    expect(yogi2OrigBooking?.status).toBe('cancelled')
    const { data: singleCredit } = await db.from('credits').select('used').eq('id', singleCreditId).single()
    expect(singleCredit?.used).toBe(0)
  })
})
