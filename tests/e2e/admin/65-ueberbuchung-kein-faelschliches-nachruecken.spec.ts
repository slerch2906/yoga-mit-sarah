/**
 * Bugfix (Sarah 2026-08-18): Überbuchung + fälschliches Nachrücken.
 *
 * Reproduktion des gemeldeten Bugs: Admin überbucht eine volle Stunde mit
 * einem Dummy (2 aktive Buchungen bei max_spots=1), ein echter Yogi steht
 * auf der Warteliste. Admin trägt den Dummy wieder aus ("Austragen"-Button
 * auf der Stunden-Seite) — die Stunde ist danach exakt wieder voll (1/1),
 * netto also KEIN Platz frei geworden. Vorher rückte der wartende Yogi
 * trotzdem fälschlich nach (process_cancellation_full prüfte die reale
 * Platzzahl nicht, bevor sie nachrückte).
 *
 * Fix: process_cancellation_full() und process_cancellation_with_waitlist()
 * prüfen jetzt selbst zuerst, ob wirklich weniger aktive Buchungen als
 * Plätze vorhanden sind, bevor überhaupt versucht wird nachzurücken.
 *
 * Testfälle:
 *   1. Dummy austragen bei weiterhin voller Stunde → Warteliste bleibt
 *      unverändert, niemand rückt nach (der eigentliche Bugfix).
 *   2. Danach den echten Platzinhaber austragen → jetzt wird wirklich ein
 *      Platz frei, der wartende Yogi MUSS ganz normal nachrücken
 *      (Regressionsschutz für den Happy-Path).
 */
import { test, expect } from '@playwright/test'
import { createTestCourse, E2E_PREFIX, giveYogiSingleCredit } from '../../utils/seed'
import {
  getUserIdByEmail, getAdminClient, getServiceClient,
  getActiveBooking, getCancelledBooking, getWaitlistEntry, countActiveBookingsForSession,
} from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('[E2E] Überbuchung: Dummy austragen darf nicht fälschlich nachrücken lassen', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let yogi1Id: string // steht auf der Warteliste
  let yogi2Id: string // haelt den einzigen "echten" Platz
  let dummyId: string
  let courseId: string
  let sessionId: string
  const dummyEmail = `e2e.dummy.overbook.${Date.now()}@test.yogamitsarah.me`

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
    const db = await getAdminClient()

    // Sauberer Ausgangszustand.
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')
    await db.from('credits').delete().eq('user_id', yogi2Id).eq('model', 'single')
    await db.from('waitlist').delete().eq('user_id', yogi1Id)

    // Dummy-Profil (analog admin/16-admin-dummy-yogi.spec.ts).
    const service = getServiceClient()
    const { data: auth, error: authErr } = await service.auth.admin.createUser({
      email: dummyEmail, password: `DummyPass_${Date.now()}!`, email_confirm: true,
    })
    if (authErr || !auth.user) throw new Error(`Dummy Auth-User: ${authErr?.message}`)
    dummyId = auth.user.id
    await db.from('profiles').upsert({
      id: dummyId, first_name: 'E2E', last_name: 'DummyOverbook', email: null,
      is_dummy: true, legal_accepted_at: new Date().toISOString(),
    }, { onConflict: 'id' })

    // Stunde mit genau 1 Platz, > 90 Min in der Zukunft (Auto-Promote-Pfad).
    const course = await createTestCourse({
      name: `${E2E_PREFIX} Ueberbuchung-Nachrueck-Test`, maxSpots: 1, sessionCount: 1, startDaysFromNow: 15,
    })
    courseId = course.courseId
    sessionId = course.sessionIds[0]

    // yogi2 haelt den einzigen echten Platz.
    const creditId2 = await giveYogiSingleCredit(yogi2Id, 1)
    await db.from('bookings').insert({
      user_id: yogi2Id, session_id: sessionId, credit_id: creditId2, type: 'single', status: 'active',
    })

    // yogi1 braucht einen gueltigen Credit, um im Nachrueck-Fall (2. Testfall)
    // ueberhaupt promotet werden zu koennen — process_cancellation_full sucht
    // beim Nachruecken selbst einen passenden Credit fuer den Wartelisten-Yogi.
    await giveYogiSingleCredit(yogi1Id, 1)

    // Dummy zusaetzlich einbuchen -> 2 aktive Buchungen bei max_spots=1
    // (Admin-Kontext umgeht enforce_session_max_spots, genau wie beim echten
    // Ueberbuchen durch Sarah).
    await db.from('bookings').insert({
      user_id: dummyId, session_id: sessionId, credit_id: null, type: 'single', status: 'active',
    })

    // yogi1 traegt sich in die Warteliste ein.
    await db.from('waitlist').insert({ user_id: yogi1Id, session_id: sessionId, type: 'waitlist', position: 1 })

    const activeCount = await countActiveBookingsForSession(sessionId)
    if (activeCount !== 2) throw new Error(`Testaufbau fehlerhaft: erwartet 2 aktive Buchungen, war ${activeCount}`)
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('waitlist').delete().eq('session_id', sessionId)
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')
    await db.from('credits').delete().eq('user_id', yogi2Id).eq('model', 'single')
    await db.from('credits').delete().eq('user_id', dummyId)
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
    await db.from('profiles').delete().eq('id', dummyId)
    try { await getServiceClient().auth.admin.deleteUser(dummyId) } catch {}
  })

  test('Dummy austragen bei weiterhin voller Stunde → kein Nachrücken', async ({ page }) => {
    await page.goto(`/admin/sessions/${sessionId}`)
    await page.waitForLoadState('networkidle')

    // Die Zeile mit dem Dummy-Namen finden und darin "Austragen" klicken.
    // (Bewusst über die Zeilen-Klassen statt div+hasText+last() gescopt: der
    // Name steckt in einem verschachtelten inneren <div>, das selbst NICHT
    // den Austragen-Button enthält — .last() träfe sonst dieses innere div.)
    const dummyRow = page.locator('div.px-4.py-3.flex.items-center.justify-between.gap-2', { hasText: 'E2E DummyOverbook' })
    await dummyRow.getByRole('button', { name: /austragen/i }).click()

    // React-Modal "Yogi austragen?" — Bestätigen. (Scoped auf .modal-overlay,
    // sonst mehrdeutig mit den "Austragen"-Buttons der verbleibenden Zeilen.)
    const modal = page.locator('.modal-overlay')
    await expect(modal.getByText('Yogi austragen?')).toBeVisible({ timeout: 5_000 })
    await modal.getByRole('button', { name: /^austragen$/i }).click()

    // RPC + Mailversand laufen client-seitig async.
    await page.waitForTimeout(2_500)

    const dummyBooking = await getCancelledBooking(dummyId, sessionId)
    expect(dummyBooking, 'Dummy-Buchung muss storniert sein').toBeTruthy()

    // Stunde ist danach wieder EXAKT voll (1/1) -> kein echter Platz frei.
    const activeCount = await countActiveBookingsForSession(sessionId)
    expect(activeCount, 'Stunde muss weiterhin genau 1 aktive Buchung haben (yogi2)').toBe(1)

    const yogi2Booking = await getActiveBooking(yogi2Id, sessionId)
    expect(yogi2Booking, 'yogi2 muss weiterhin aktiv gebucht sein').toBeTruthy()

    // Der eigentliche Bugfix: yogi1 darf NICHT nachgerückt sein.
    const yogi1Booking = await getActiveBooking(yogi1Id, sessionId)
    expect(yogi1Booking, 'yogi1 darf NICHT fälschlich nachgerückt sein').toBeNull()

    const waitlistEntry = await getWaitlistEntry(yogi1Id, sessionId)
    expect(waitlistEntry, 'yogi1 muss weiterhin auf der Warteliste stehen').toBeTruthy()
  })

  test('Danach echten Platzinhaber austragen → Warteliste rückt normal nach', async ({ page }) => {
    await page.goto(`/admin/sessions/${sessionId}`)
    await page.waitForLoadState('networkidle')

    const yogi2Row = page.locator('div.px-4.py-3.flex.items-center.justify-between.gap-2', { hasText: 'Test Yogi2' })
    await yogi2Row.getByRole('button', { name: /austragen/i }).click()

    const modal = page.locator('.modal-overlay')
    await expect(modal.getByText('Yogi austragen?')).toBeVisible({ timeout: 5_000 })
    await modal.getByRole('button', { name: /^austragen$/i }).click()
    await page.waitForTimeout(2_500)

    const yogi2Booking = await getCancelledBooking(yogi2Id, sessionId)
    expect(yogi2Booking, 'yogi2-Buchung muss storniert sein').toBeTruthy()

    // Jetzt ist wirklich ein Platz frei -> yogi1 muss ganz normal nachrücken.
    const yogi1Booking = await getActiveBooking(yogi1Id, sessionId)
    expect(yogi1Booking, 'yogi1 muss jetzt nachgerückt sein (echter freier Platz)').toBeTruthy()

    const waitlistEntry = await getWaitlistEntry(yogi1Id, sessionId)
    expect(waitlistEntry, 'Wartelisten-Eintrag muss nach Nachrücken entfernt sein').toBeNull()
  })
})
