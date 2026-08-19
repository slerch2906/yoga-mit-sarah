/**
 * Sarah-Wunsch (2026-08-18): "Stunde ändern" auch direkt im Admin-Dashboard-
 * Stunden-Modal erreichbar, nicht nur auf der separaten /admin/sessions/[id]-
 * Seite. Button sitzt direkt über "Stunde absagen".
 *
 * Gleiche Logik wie tests/e2e/admin/67-uhrzeit-location-aendern.spec.ts,
 * hier über das Dashboard-Modal statt die eigenständige Stunden-Seite.
 *
 * Zusätzlich (Sarah-Wunsch 2026-08-18): Teilnehmer, die eine aktive Buchung
 * haben, aber NICHT im Kurs eingeschrieben sind (reine Nachholer, nicht in
 * der WhatsApp-Gruppe), erscheinen unter einer eigenen Überschrift "Extern"
 * — exakt gleich formatiert wie "Angemeldet", keine Extra-Hervorhebung.
 */
import { test, expect } from '@playwright/test'
import { createTestCourse, E2E_PREFIX, giveYogiSingleCredit } from '../../utils/seed'
import { getUserIdByEmail, getAdminClient } from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('[E2E] Dashboard: "Stunde ändern" über Stunde absagen', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let yogi1Id: string
  let yogi2Id: string
  let courseId: string
  let sessionId: string
  let creditId: string
  let singleCreditId: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'course')
    await db.from('credits').delete().eq('user_id', yogi2Id).eq('model', 'single')

    // "Diese Woche" im Dashboard: Montag der aktuellen Woche + 1 Tag, damit die
    // Stunde sicher im Standard-Wochenfenster des Dashboards liegt.
    const course = await createTestCourse({
      name: `${E2E_PREFIX} Dashboard-Stunde-Aendern`, sessionCount: 1, startDaysFromNow: 1, maxSpots: 5,
    })
    courseId = course.courseId
    sessionId = course.sessionIds[0]
    await db.from('courses').update({ location: 'Rooftop' }).eq('id', courseId)

    const { data: cc } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: courseId, model: 'course', total: 1, used: 0,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).select('id').single()
    creditId = cc!.id
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: courseId })
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: sessionId, credit_id: creditId, type: 'course', status: 'active',
    })

    // yogi2: Nachholer/Drop-in — aktiv gebucht, aber NICHT im Kurs eingeschrieben.
    singleCreditId = (await giveYogiSingleCredit(yogi2Id, 1))!
    await db.from('bookings').insert({
      user_id: yogi2Id, session_id: sessionId, credit_id: singleCreditId, type: 'single', status: 'active',
    })
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('enrollments').delete().eq('course_id', courseId)
    await db.from('credits').delete().in('id', [creditId, singleCreditId])
    await db.from('audit_log').delete().eq('action', 'session_participants_notified')
      .eq('details->>session_id', sessionId)
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
  })

  test('"Extern" zeigt Nachholer ohne Kurs-Enrollment, gleich formatiert wie "Angemeldet"', async ({ page }) => {
    await page.goto('/admin/dashboard')
    await page.waitForLoadState('networkidle')
    await page.getByText(`${E2E_PREFIX} Dashboard-Stunde-Aendern`).first().click()

    // Sarah-Wunsch 2026-08-19: N/Gesamt in beiden Überschriften (2 Anmeldungen
    // insgesamt: 1 Kursmitglied + 1 externer Nachholer).
    await expect(page.getByText('Angemeldet (1/2)')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Extern (1/2)')).toBeVisible({ timeout: 5_000 })

    // Kursmitglied (yogi1) steht unter "Angemeldet", Nachholer (yogi2) unter "Extern".
    const angemeldetHeading = page.getByText('Angemeldet (1/2)')
    const externHeading = page.getByText('Extern (1/2)')
    const angemeldetBox = await angemeldetHeading.boundingBox()
    const externBox = await externHeading.boundingBox()
    expect(angemeldetBox && externBox && angemeldetBox.y < externBox.y, '"Extern" muss unter "Angemeldet" stehen').toBe(true)

    // Gleiche Formatierung: beide Überschriften nutzen dieselbe CSS-Klasse (section-label).
    const angemeldetClass = await angemeldetHeading.getAttribute('class')
    const externClass = await externHeading.getAttribute('class')
    expect(externClass).toContain('section-label')
    expect(externClass?.replace(/\bmt-3\b/g, '').trim()).toBe(angemeldetClass?.replace(/\bmt-3\b/g, '').trim())

    // yogi2 (Nachholer) erscheint namentlich, yogi1 (Kursmitglied) auch.
    await expect(page.getByText('Test Yogi1')).toBeVisible()
    await expect(page.getByText('Test Yogi2')).toBeVisible()
  })

  test('"Stunde ändern" sitzt über "Stunde absagen" und funktioniert', async ({ page }) => {
    const db = await getAdminClient()
    await page.goto('/admin/dashboard')
    await page.waitForLoadState('networkidle')

    await page.getByText(`${E2E_PREFIX} Dashboard-Stunde-Aendern`).first().click()
    await expect(page.getByText('ANGEMELDET')).toBeVisible({ timeout: 10_000 })

    // Reihenfolge: "Stunde ändern" muss direkt über "Stunde absagen" stehen.
    const aendernBtn = page.getByRole('button', { name: /stunde ändern/i })
    const absagenBtn = page.getByRole('button', { name: /stunde absagen/i })
    await expect(aendernBtn).toBeVisible({ timeout: 10_000 })
    const aendernBox = await aendernBtn.boundingBox()
    const absagenBox = await absagenBtn.boundingBox()
    expect(aendernBox && absagenBox && aendernBox.y < absagenBox.y, '"Stunde ändern" muss oberhalb von "Stunde absagen" stehen').toBe(true)

    await aendernBtn.click()
    await expect(page.getByText('Uhrzeit/Location ändern')).toBeVisible({ timeout: 5_000 })
    const locationInput = page.locator('input[placeholder*="Rooftop"]')
    await expect(locationInput).toHaveValue('Rooftop')

    await page.locator('input[type="time"]').fill('20:15')
    await locationInput.fill('Studio (drinnen)')
    await page.getByRole('button', { name: /speichern & teilnehmer informieren/i }).click()
    await expect(page.getByText('Uhrzeit/Location ändern')).toBeHidden({ timeout: 15_000 })

    const { data: sess } = await db.from('sessions').select('time_start, location').eq('id', sessionId).single()
    expect(sess?.time_start?.slice(0, 5)).toBe('20:15')
    expect(sess?.location).toBe('Studio (drinnen)')

    const { data: audit } = await db.from('audit_log')
      .select('*').eq('action', 'session_participants_notified')
      .eq('details->>session_id', sessionId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    expect(audit, 'audit_log-Eintrag fehlt').toBeTruthy()
    // Sarah-Wunsch 2026-08-18: beforeAll bucht jetzt zusätzlich yogi2 als
    // externen Nachholer (für den "Extern"-Test) — beide zählen als Empfänger.
    expect(audit!.details.recipient_count).toBe(2)
    expect(audit!.details.source).toBe('dashboard')
  })
})
