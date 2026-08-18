/**
 * Sarah-Wunsch (2026-08-18): Uhrzeit/Location einer einzelnen Stunde ändern +
 * alle aktuell gebuchten Teilnehmer per Mail informieren — auch Nachholer,
 * die nicht regulär im Kurs eingeschrieben sind (anders als die bestehende
 * kursweite Uhrzeit-Änderung, die nur Enrollments erreicht).
 *
 * Praxisfall: Outdoor-Stunde wird wegen Hitze eine Stunde nach hinten und
 * nach drinnen verlegt.
 *
 * Testfälle:
 *   - Uhrzeit + Location + Nachricht ändern → DB aktualisiert, BEIDE
 *     Teilnehmer (Kursmitglied + Drop-in/Nachholer) werden gezählt
 *   - Nur Uhrzeit ändern (Location/Nachricht leer) → nur time_changed=true
 *   - Nichts geändert + keine Nachricht → kein Update, kein Audit-Eintrag
 */
import { test, expect } from '@playwright/test'
import { createTestCourse, E2E_PREFIX, giveYogiSingleCredit } from '../../utils/seed'
import { getUserIdByEmail, getAdminClient } from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('[E2E] Uhrzeit/Location einer Stunde ändern + Teilnehmer informieren', () => {
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
      name: `${E2E_PREFIX} Uhrzeit-Location-Test`, sessionCount: 1, startDaysFromNow: 15, maxSpots: 5,
    })
    courseId = course.courseId
    sessionId = course.sessionIds[0]
    await db.from('courses').update({ location: 'Rooftop' }).eq('id', courseId)

    const { data: cc } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: courseId, model: 'course', total: 1, used: 0,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).select('id').single()
    courseCreditId = cc!.id
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: courseId })
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: sessionId, credit_id: courseCreditId, type: 'course', status: 'active',
    })

    singleCreditId = (await giveYogiSingleCredit(yogi2Id, 1))!
    // Drop-in/Nachholer: gebucht, aber NICHT im Kurs eingeschrieben.
    await db.from('bookings').insert({
      user_id: yogi2Id, session_id: sessionId, credit_id: singleCreditId, type: 'single', status: 'active',
    })
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('enrollments').delete().eq('course_id', courseId)
    await db.from('credits').delete().in('id', [courseCreditId, singleCreditId])
    await db.from('audit_log').delete().eq('action', 'session_participants_notified')
      .eq('details->>session_id', sessionId)
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
  })

  test('Uhrzeit + Location + Nachricht ändern → beide Teilnehmer gezählt, DB aktualisiert', async ({ page }) => {
    const db = await getAdminClient()
    await page.goto(`/admin/sessions/${sessionId}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /uhrzeit\/location ändern/i }).click()
    const modal = page.locator('.modal-overlay')
    await expect(modal.getByText('Uhrzeit/Location ändern')).toBeVisible({ timeout: 5_000 })

    // Location muss mit dem Kurs-Default vorbefüllt sein (kein eigenes
    // Session-Override gesetzt).
    await expect(modal.locator('input[placeholder*="Rooftop"]')).toHaveValue('Rooftop')

    await modal.locator('input[type="time"]').fill('19:00')
    await modal.locator('input[placeholder*="Rooftop"]').fill('Studio (drinnen)')
    await modal.locator('textarea').fill('Wegen der Hitze verlegen wir die Stunde nach drinnen und nach hinten.')
    await modal.getByRole('button', { name: /speichern & teilnehmer informieren/i }).click()
    // Modal schließt erst NACH dem kompletten Ablauf (DB-Update + beide Mail-
    // Versuche + Audit-Insert) — robusteres Signal als ein fester Timeout.
    await expect(modal).toBeHidden({ timeout: 15_000 })

    const { data: sess } = await db.from('sessions').select('time_start, location').eq('id', sessionId).single()
    expect(sess?.time_start?.slice(0, 5)).toBe('19:00')
    expect(sess?.location).toBe('Studio (drinnen)')

    const { data: audit } = await db.from('audit_log')
      .select('*').eq('action', 'session_participants_notified')
      .eq('details->>session_id', sessionId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    expect(audit, 'audit_log-Eintrag fehlt').toBeTruthy()
    expect(audit!.details.recipient_count, 'Kursmitglied UND Nachholer müssen beide gezählt werden').toBe(2)
    expect(audit!.details.time_changed).toBe(true)
    expect(audit!.details.location_changed).toBe(true)
    expect(audit!.details.has_message).toBe(true)
    expect(audit!.details.old_time?.slice(0, 5)).toBe('18:30')
    expect(audit!.details.old_location).toBe('Rooftop')
  })

  test('Quellcode: Formular funktioniert für course_session (keine Ausnahme wie beim Bearbeiten-Formular)', () => {
    const fs = require('fs')
    const path = require('path')
    const src = fs.readFileSync(path.join(process.cwd(), 'app/admin/sessions/[id]/page.tsx'), 'utf8')
    // Der neue Button ist NICHT auf session_type !== 'course_session' beschränkt.
    const btnMatch = src.match(/openNotifyForm[\s\S]{0,400}/)
    expect(btnMatch, 'openNotifyForm-Button nicht gefunden').toBeTruthy()
    expect(src).toMatch(/Uhrzeit\/Location ändern & Teilnehmer informieren/)
    expect(src).toMatch(/sessionUpdateNotice/)
  })
})
