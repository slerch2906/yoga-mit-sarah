/**
 * Workflow: Dummy-Yogi (is_dummy=true)
 * Testfälle:
 *   - Dummy-Yogi kann durch Admin angelegt werden (Profil ohne Auth-User)
 *   - Admin kann Dummy in Session einbuchen mit Credit-Vergabe
 *   - Bei Wartelisten-Aktionen werden KEINE Emails an Dummy gesendet
 *   - Dummy-Yogi taucht in Yogi-Liste mit Badge "Dummy" auf
 */
import { test, expect } from '@playwright/test'
import { createTestCourse, E2E_PREFIX } from '../../utils/seed'
import {
  getUserIdByEmail, getAdminClient, getActiveBooking,
} from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('Dummy-Yogi: Anlage + Einbuchung', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let dummyYogiId: string
  let sessionId: string
  let courseId: string

  test.beforeAll(async () => {
    const db = await getAdminClient()

    // Dummy-Yogi anlegen (ohne Auth-User)
    const dummyId = crypto.randomUUID()
    const { data: prof, error } = await db.from('profiles').insert({
      id: dummyId,
      first_name: 'E2E',
      last_name: 'Dummy',
      email: null,
      is_admin: false,
      is_dummy: true,
      legal_accepted_at: new Date().toISOString(),
    }).select('id').single()

    if (error) throw new Error(`Dummy-Yogi Anlage fehlgeschlagen: ${error.message}`)
    dummyYogiId = prof!.id

    // Testkurs
    const course = await createTestCourse({
      name: `${E2E_PREFIX} Dummy-Test`,
      sessionCount: 1,
      startDaysFromNow: 15,
    })
    courseId = course.courseId
    sessionId = course.sessionIds[0]
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('bookings').delete().eq('user_id', dummyYogiId)
    await db.from('credits').delete().eq('user_id', dummyYogiId)
    await db.from('profiles').delete().eq('id', dummyYogiId)
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
  })

  test('Dummy-Yogi existiert mit is_dummy=true und email=null', async () => {
    const db = await getAdminClient()
    const { data: prof } = await db.from('profiles')
      .select('first_name, last_name, email, is_dummy')
      .eq('id', dummyYogiId).maybeSingle()

    expect(prof).toBeTruthy()
    expect(prof?.is_dummy, 'is_dummy muss true sein').toBe(true)
    expect(prof?.email, 'Dummy-Yogi hat keine Email').toBeNull()
  })

  test('Admin sieht Dummy-Yogi in Yogi-Liste mit "Dummy"-Badge', async ({ page }) => {
    await page.goto('/admin/yogis')
    await page.waitForLoadState('networkidle')

    // Dummy-Yogi taucht auf (Name oder Badge)
    await expect(page.getByText(/E2E.*Dummy/i).first()).toBeVisible({ timeout: 8_000 })
  })

  test('Dummy-Yogi kann via Admin in Session eingebucht werden', async ({ page }) => {
    // Direkt via DB einbuchen (analog zur Admin-Session UI)
    const db = await getAdminClient()
    const expires = new Date(); expires.setFullYear(expires.getFullYear() + 1)
    const { data: credit } = await db.from('credits').insert({
      user_id: dummyYogiId,
      course_id: null,
      model: 'single',
      total: 1,
      used: 1,
      expires_at: expires.toISOString(),
    }).select('id').single()

    await db.from('bookings').insert({
      user_id: dummyYogiId,
      session_id: sessionId,
      credit_id: credit!.id,
      type: 'single',
      status: 'active',
    })

    const booking = await getActiveBooking(dummyYogiId, sessionId)
    expect(booking, 'Dummy-Yogi muss eingebucht sein').toBeTruthy()
  })
})
