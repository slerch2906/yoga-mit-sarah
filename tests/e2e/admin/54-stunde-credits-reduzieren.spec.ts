/**
 * Workflow: Admin – Stunde absagen mit "Kurscredits reduzieren" (Sarah 2026-08-18)
 *
 * Hintergrund: Sagt Sarah eine Kursstunde krankheitsbedingt OHNE Ersatztermin ab,
 * soll es einen dritten Absage-Weg geben, der NICHT den Credit zurückbucht
 * (= keine zusätzliche gratis Stunde für die Yogis), sondern stattdessen die
 * Kurscredit-Gesamtzahl (`credits.total`) der betroffenen Yogis dauerhaft um 1
 * senkt — die Yogis zahlen dadurch eine Stunde weniger.
 *
 * Testfälle:
 *   - Stunde mit "Keine Rückbuchung – Kurscredits reduzieren" absagen →
 *     Session als credit_reduced_on_cancel markiert, total sinkt um 1,
 *     used sinkt im Gleichschritt (kein Nettogewinn an freien Stunden)
 *   - Bei so abgesagten Stunden gibt es keinen "Ersatztermin nachträglich
 *     anlegen"-Button mehr (Sarah-Entscheidung: sonst bliebe total falsch niedrig)
 *   - Admin-Kursübersicht zeigt eigenes Label statt "Abgesagt"
 */
import { test, expect } from '@playwright/test'
import { createTestCourse, E2E_PREFIX } from '../../utils/seed'
import { getUserIdByEmail, getAdminClient, getCourseCredit } from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

async function cleanupCourse(courseId: string) {
  const db = await getAdminClient()
  const { data: sessions } = await db.from('sessions').select('id').eq('course_id', courseId)
  const ids = (sessions || []).map(s => s.id)
  if (ids.length > 0) await db.from('bookings').delete().in('session_id', ids)
  await db.from('credits').delete().eq('course_id', courseId)
  await db.from('enrollments').delete().eq('course_id', courseId)
  await db.from('sessions').delete().eq('course_id', courseId)
  await db.from('courses').delete().eq('id', courseId)
}

test.describe('Stunde absagen: Kurscredits reduzieren statt Rückbuchung', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let courseId: string
  let sessionId: string
  let session2Id: string
  let yogiId: string
  let creditId: string

  test.beforeAll(async () => {
    yogiId = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogiId).eq('model', 'course')

    const course = await createTestCourse({
      name: `${E2E_PREFIX} Credits-Reduzieren-Test`, sessionCount: 2,
    })
    courseId = course.courseId
    sessionId = course.sessionIds[0]
    session2Id = course.sessionIds[1]

    const expires = new Date()
    expires.setDate(expires.getDate() + 90)
    const { data: credit } = await db.from('credits').insert({
      user_id: yogiId, course_id: courseId, model: 'course',
      total: 2, used: 0, expires_at: expires.toISOString(),
    }).select('id').single()
    creditId = credit!.id

    await db.from('enrollments').insert({ user_id: yogiId, course_id: courseId })
    for (const sid of course.sessionIds) {
      await db.from('bookings').insert({
        user_id: yogiId, session_id: sid, credit_id: creditId, type: 'course', status: 'active',
      })
    }
    await db.from('credits').update({ used: 2 }).eq('id', creditId)
  })

  test.afterAll(async () => {
    if (courseId) await cleanupCourse(courseId)
  })

  test('Absage mit "Kurscredits reduzieren" → total sinkt, kein Netto-Gewinn an freien Stunden', async ({ page }) => {
    const creditBefore = await getCourseCredit(yogiId, courseId)
    expect(creditBefore?.total, 'total muss vorher 2 sein').toBe(2)
    expect(creditBefore?.used, 'used muss vorher 2 sein (beide Sessions aktiv gebucht)').toBe(2)
    const remainingBefore = (creditBefore?.total ?? 0) - (creditBefore?.used ?? 0)

    await page.goto(`/admin/sessions/${sessionId}`)
    await page.waitForLoadState('networkidle')

    const yogiEmail = process.env.TEST_YOGI1_EMAIL!
    await expect(page.getByText(yogiEmail).first()).toBeVisible({ timeout: 8_000 })

    await page.getByRole('button', { name: /stunde absagen/i }).click()
    await expect(page.getByText(/keine rückbuchung.*kurscredits reduzieren/i)).toBeVisible({ timeout: 5_000 })

    // Dritte Option auswählen
    await page.getByText(/keine rückbuchung.*kurscredits reduzieren/i).click()

    page.on('dialog', d => d.accept())
    await page.getByRole('button', { name: /^absagen$/i }).click()
    await page.waitForTimeout(2_000)

    // Session als credit_reduced_on_cancel markiert
    const db = await getAdminClient()
    const { data: sess } = await db.from('sessions')
      .select('is_cancelled, credit_reduced_on_cancel').eq('id', sessionId).maybeSingle()
    expect(sess?.is_cancelled, 'Session muss abgesagt sein').toBe(true)
    expect(sess?.credit_reduced_on_cancel, 'Session muss als credit_reduced_on_cancel markiert sein').toBe(true)

    // Buchung storniert
    const { data: booking } = await db.from('bookings')
      .select('status').eq('user_id', yogiId).eq('session_id', sessionId).maybeSingle()
    expect(booking?.status, 'Buchung muss storniert sein').toBe('cancelled')

    // Credit: total UND used sinken im Gleichschritt — kein Netto-Gewinn
    const creditAfter = await getCourseCredit(yogiId, courseId)
    expect(creditAfter?.total, 'total muss um 1 gesunken sein').toBe(1)
    expect(creditAfter?.used, 'used muss automatisch mitgesunken sein (Session ist cancelled)').toBe(1)
    const remainingAfter = (creditAfter?.total ?? 0) - (creditAfter?.used ?? 0)
    expect(remainingAfter, 'verbleibende nutzbare Stunden dürfen sich nicht ändern').toBe(remainingBefore)
  })

  test('Kein nachträglicher Ersatztermin für "Credits reduziert"-Absage möglich', async ({ page }) => {
    await page.goto(`/admin/sessions/${sessionId}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/ausgefallen.*kurscredits reduziert/i).first()).toBeVisible({ timeout: 8_000 })
    await expect(page.getByRole('button', { name: /ersatztermin nachträglich anlegen/i })).toHaveCount(0)
  })

  test('Admin-Kursübersicht zeigt eigenes Label statt "Abgesagt"', async ({ page }) => {
    await page.goto('/admin/kurse')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(`${E2E_PREFIX} Credits-Reduzieren-Test`).first()).toBeVisible({ timeout: 8_000 })
    // Einziger Testkurs auf der Seite (isolierte Testdaten) — "Termine" klappt die Stundenliste auf.
    await page.getByRole('button', { name: /termine/i }).first().click()
    await expect(page.getByText(/ausgefallen \(credits reduziert\)/i).first()).toBeVisible({ timeout: 8_000 })
  })
})
