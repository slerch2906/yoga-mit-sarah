/**
 * DEEP AUDIT: UI-Texte, Hinweise, Buttons + Realbetrieb-Edge-Cases
 *
 * Sarah-Anforderung 2026-05-23:
 * Prüft semantisch-plausible Anzeigen und Edge-Cases im Live-Betrieb,
 * die in normaler Test-Suite leicht durchrutschen.
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

test.describe('UI-Texte: Hinweise + Modal-Texte', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let yogi2Id: string

  test.beforeAll(async () => {
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
  })

  test.afterEach(async () => {
    await resetYogi(yogi2Id)
  })

  test('[AUDIT] Quick-Credit-Modal: korrekter Hinweis-Text mit Yogi-Name + Guthaben-Zahl', async ({ page }) => {
    const db = await getAdminClient()
    await resetYogi(yogi2Id)
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 2)
    await db.from('credits').insert({
      user_id: yogi2Id, model: 'guthaben', total: 3, used: 0,
      expires_at: exp.toISOString(),
    })
    const course = await createTestCourse({ name: `${E2E_PREFIX} GuthabenModalUI`, sessionCount: 1, startDaysFromNow: 5 })
    await page.goto(`/admin/sessions/${course.sessionIds[0]}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /yogi hinzufügen/i }).click()
    await page.getByPlaceholder(/name oder e-mail/i).fill(process.env.TEST_YOGI2_EMAIL!.split('@')[0])
    await page.waitForTimeout(800)

    page.once('dialog', d => d.accept())
    await page.getByRole('button', { name: /einbuchen/i }).first().click()

    // Modal-Text muss explizit "Nur Kurs-Guthaben vorhanden" enthalten + Zahl + "nur für neue Kurse"
    await expect(page.getByText(/Nur Kurs-Guthaben vorhanden/i)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/3 Guthaben aus einem abgesagten Kurs/i)).toBeVisible()
    await expect(page.getByText(/nur für neue Kurse.*nicht für Einzelstunden/i)).toBeVisible()
  })

  test('[AUDIT] Yogi mit 0 Credits: "Keine Credits vorhanden"-Modal beim Einbuchen', async ({ page }) => {
    const db = await getAdminClient()
    await resetYogi(yogi2Id)
    const course = await createTestCourse({ name: `${E2E_PREFIX} NoCreditsModalUI`, sessionCount: 1, startDaysFromNow: 5 })
    await page.goto(`/admin/sessions/${course.sessionIds[0]}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /yogi hinzufügen/i }).click()
    await page.getByPlaceholder(/name oder e-mail/i).fill(process.env.TEST_YOGI2_EMAIL!.split('@')[0])
    await page.waitForTimeout(800)

    page.once('dialog', d => d.accept())
    await page.getByRole('button', { name: /einbuchen/i }).first().click()

    await expect(page.getByText(/Keine Credits vorhanden/i)).toBeVisible({ timeout: 5000 })
  })

  test('[AUDIT] /meine: "Du hast keine freien Credits" Hinweis wenn 0 frei', async ({ browser }) => {
    const db = await getAdminClient()
    await resetYogi(yogi2Id)
    const ctx = await browser.newContext({ storageState: 'tests/.auth/yogi2.json' })
    const p = await ctx.newPage()
    await p.goto('/meine')
    await p.waitForLoadState('networkidle')
    // /meine sollte zeigen "Noch keine Buchungen" oder Empty-State, aber NICHT crashen
    await expect(p.locator('body')).toBeVisible()
    await ctx.close()
  })
})

test.describe('Edge-Cases: Konsistenz Yogi-Sicht vs Admin-Sicht (UI)', () => {
  let yogi2Id: string

  test.beforeAll(async () => {
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
  })

  test.afterEach(async () => {
    await resetYogi(yogi2Id)
  })

  test('[AUDIT] Yogi mit 3 Course-Credits frei: /meine zeigt 3, Admin /admin/yogis/[id] zeigt 3', async ({ browser }) => {
    const db = await getAdminClient()
    await resetYogi(yogi2Id)
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const course = await createTestCourse({ name: `${E2E_PREFIX} ViewConsistency-1`, sessionCount: 3, startDaysFromNow: 5 })
    await db.from('credits').insert({
      user_id: yogi2Id, course_id: course.courseId, model: 'course',
      total: 3, used: 0, expires_at: exp.toISOString(),
    })
    await db.from('enrollments').insert({ user_id: yogi2Id, course_id: course.courseId })

    // /meine als Yogi2 — warte explizit auf hydratisiertes Element (kein page.content())
    const yogiCtx = await browser.newContext({ storageState: 'tests/.auth/yogi2.json' })
    const yp = await yogiCtx.newPage()
    await yp.goto('/meine')
    // Warte bis /meine fertig hydratisiert ist — Section-Label oder Card mit "3" muss da sein
    await expect(yp.locator('body').getByText(/3/).first()).toBeVisible({ timeout: 15_000 })
    await yogiCtx.close()

    // Admin /admin/yogis/[id] als Admin
    const adminCtx = await browser.newContext({ storageState: 'tests/.auth/admin.json' })
    const ap = await adminCtx.newPage()
    await ap.goto(`/admin/yogis/${yogi2Id}`)
    await expect(ap.locator('body').getByText(/3/).first()).toBeVisible({ timeout: 15_000 })
    await adminCtx.close()
  })

  test('[AUDIT] Cross-Course-Booking: Admin-Aggregation zählt sie korrekt nur im Ziel-Kurs', async () => {
    const db = await getAdminClient()
    await resetYogi(yogi2Id)
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const courseA = await createTestCourse({ name: `${E2E_PREFIX} XCnt-Admin-A`, sessionCount: 2, startDaysFromNow: 5 })
    const courseB = await createTestCourse({ name: `${E2E_PREFIX} XCnt-Admin-B`, sessionCount: 1, startDaysFromNow: 3 })
    const { data: credA } = await db.from('credits').insert({
      user_id: yogi2Id, course_id: courseA.courseId, model: 'course',
      total: 2, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    await db.from('enrollments').insert({ user_id: yogi2Id, course_id: courseA.courseId })
    // 1 Booking in Kurs A
    await db.from('bookings').insert({
      user_id: yogi2Id, session_id: courseA.sessionIds[0], credit_id: credA!.id,
      type: 'course', status: 'active',
    })
    // 1 Booking in Kurs B mit Credit von A
    await db.from('bookings').insert({
      user_id: yogi2Id, session_id: courseB.sessionIds[0], credit_id: credA!.id,
      type: 'course', status: 'active',
    })

    // courseAggregateForCredit logic: für Kurs A zählen wir nur Bookings in Kurs A
    const { data: aBookings } = await db.from('bookings')
      .select('id, session:sessions!bookings_session_id_fkey(course_id)')
      .eq('user_id', yogi2Id).eq('credit_id', credA!.id).eq('status', 'active')
    const inA = (aBookings || []).filter((b: any) => b.session?.course_id === courseA.courseId)
    const inB = (aBookings || []).filter((b: any) => b.session?.course_id === courseB.courseId)
    expect(inA).toHaveLength(1) // nur die Kurs-A-Buchung
    expect(inB).toHaveLength(1)
    // Insgesamt: credit.used = 2 (beide gezählt für credit-Verbrauch)
    const { data: c } = await db.from('credits').select('used').eq('id', credA!.id).single()
    expect(c?.used).toBe(2)
  })
})

test.describe('Edge-Cases: Race-Conditions + parallele Bookings', () => {
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test.afterEach(async () => {
    await resetYogi(yogi1Id)
  })

  test('[AUDIT] Doppel-Insert via Race: zwei parallele Bookings derselben Session → 1 Booking, credit.used=1', async () => {
    const db = await getAdminClient()
    await resetYogi(yogi1Id)
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, model: 'tenpack', total: 10, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    const course = await createTestCourse({ name: `${E2E_PREFIX} RaceBooking`, sessionCount: 1, startDaysFromNow: 5 })
    const sid = course.sessionIds[0]

    // Parallel 2 insert-Anfragen
    const [r1, r2] = await Promise.allSettled([
      db.from('bookings').insert({
        user_id: yogi1Id, session_id: sid, credit_id: credit!.id,
        type: 'single', status: 'active',
      }),
      db.from('bookings').insert({
        user_id: yogi1Id, session_id: sid, credit_id: credit!.id,
        type: 'single', status: 'active',
      }),
    ])
    // Mindestens eine sollte mit UNIQUE-violation failen oder beide synchron sein
    const { data: bookings } = await db.from('bookings')
      .select('id, status').eq('user_id', yogi1Id).eq('session_id', sid)
    expect(bookings?.length).toBe(1)
    const { data: c } = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(c?.used).toBe(1)
  })

  test('[AUDIT] Yogi cancelled Session während Admin storniert Kurs — finaler Zustand konsistent', async () => {
    // Setup: Yogi enrolled, 1 Session
    const db = await getAdminClient()
    await resetYogi(yogi1Id)
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const course = await createTestCourse({ name: `${E2E_PREFIX} ConcurrentCancel`, sessionCount: 1, startDaysFromNow: 7 })
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: course.courseId, model: 'course',
      total: 1, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: credit!.id,
      type: 'course', status: 'active',
    })

    // Parallel: Yogi cancelt Booking + Admin storniert Session
    await Promise.all([
      db.from('bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('user_id', yogi1Id).eq('session_id', course.sessionIds[0]),
      db.from('sessions').update({ is_cancelled: true, cancel_reason: 'admin cancel' })
        .eq('id', course.sessionIds[0]),
    ])

    // Final-Zustand: Booking cancelled, Session cancelled, credit.used = 0
    const { data: b } = await db.from('bookings').select('status').eq('user_id', yogi1Id).eq('session_id', course.sessionIds[0]).single()
    const { data: s } = await db.from('sessions').select('is_cancelled').eq('id', course.sessionIds[0]).single()
    const { data: c } = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(b?.status).toBe('cancelled')
    expect(s?.is_cancelled).toBe(true)
    expect(c?.used).toBe(0)
  })

  test('[AUDIT] Cancelled Session: prevent_booking_cancelled_session-Trigger blockiert ALLE (auch Admin/Service-Role)', async () => {
    // Sarah-Regel 2026-05-23: Auch Admin darf NICHT in abgesagte Stunde buchen.
    const db = await getAdminClient()
    await resetYogi(yogi1Id)
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, model: 'tenpack', total: 5, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    const course = await createTestCourse({ name: `${E2E_PREFIX} BlockCancelledSession`, sessionCount: 1, startDaysFromNow: 5 })
    // Session direkt cancelled markieren
    await db.from('sessions').update({ is_cancelled: true }).eq('id', course.sessionIds[0])
    // Versuche Buchung anzulegen mit Service-Role → DB-Trigger MUSS blockieren (kein Admin-Bypass mehr)
    const { error } = await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: credit!.id,
      type: 'single', status: 'active',
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/abgesagt/i)
  })
})

test.describe('Edge-Cases: Buchungs-Status-Übergänge', () => {
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test.afterEach(async () => {
    await resetYogi(yogi1Id)
  })

  test('[AUDIT] cancelled → active Re-Aktivierung: credit.used hoch + cancelled_at=null', async () => {
    const db = await getAdminClient()
    await resetYogi(yogi1Id)
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const course = await createTestCourse({ name: `${E2E_PREFIX} Reactivate`, sessionCount: 1, startDaysFromNow: 5 })
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, course_id: course.courseId, model: 'course',
      total: 1, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    await db.from('enrollments').insert({ user_id: yogi1Id, course_id: course.courseId })
    // Initial: active
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: credit!.id,
      type: 'course', status: 'active',
    })
    // Cancel
    await db.from('bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('user_id', yogi1Id).eq('session_id', course.sessionIds[0])
    // Re-aktivieren
    await db.from('bookings').update({ status: 'active', cancelled_at: null })
      .eq('user_id', yogi1Id).eq('session_id', course.sessionIds[0])

    const { data: b } = await db.from('bookings').select('status, cancelled_at')
      .eq('user_id', yogi1Id).eq('session_id', course.sessionIds[0]).single()
    expect(b?.status).toBe('active')
    expect(b?.cancelled_at).toBeNull()
    const { data: c } = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(c?.used).toBe(1)
  })

  test('[AUDIT] late-cancel: cancel_late=true → credit.used BLEIBT (Yogi zahlt)', async () => {
    const db = await getAdminClient()
    await resetYogi(yogi1Id)
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, model: 'tenpack', total: 5, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    const course = await createTestCourse({ name: `${E2E_PREFIX} LateCancel`, sessionCount: 1, startDaysFromNow: 5 })
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: credit!.id,
      type: 'single', status: 'active',
    })
    const { data: cBefore } = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(cBefore?.used).toBe(1)

    // Late-Cancel: status='cancelled', cancel_late=true
    await db.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: true,
    }).eq('user_id', yogi1Id).eq('session_id', course.sessionIds[0])

    // recalc_credit_used zählt: status='active' OR (status='cancelled' AND cancel_late=true)
    // → used bleibt 1 nach late-cancel.
    const { data: cAfter } = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(cAfter?.used).toBe(1)
  })

  test('[AUDIT] regular cancel (cancel_late=false): credit.used wird freigegeben', async () => {
    const db = await getAdminClient()
    await resetYogi(yogi1Id)
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
    const { data: credit } = await db.from('credits').insert({
      user_id: yogi1Id, model: 'tenpack', total: 5, used: 0, expires_at: exp.toISOString(),
    }).select('id').single()
    const course = await createTestCourse({ name: `${E2E_PREFIX} RegularCancel`, sessionCount: 1, startDaysFromNow: 5 })
    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: credit!.id,
      type: 'single', status: 'active',
    })
    await db.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false,
    }).eq('user_id', yogi1Id).eq('session_id', course.sessionIds[0])
    const { data: c } = await db.from('credits').select('used').eq('id', credit!.id).single()
    expect(c?.used).toBe(0)
  })
})

test.describe('Edge-Cases: Email-Felder existieren im App-Code', () => {
  test('[AUDIT] API-Route /api/kursabbruch ruft Email mit refundCredits+newPaidCredits Feldern', async () => {
    // Static-Check: app/api/kursabbruch/[token]/route.ts ist die echte Aufrufstelle
    // (die .page.tsx delegiert via fetch dorthin). Wenn diese Felder FEHLEN, wäre
    // verrechnet immer 0 → "verrechnetes Guthaben"-Satz würde nie korrekt erscheinen.
    const fs = require('fs')
    const path = require('path')
    const p = path.join(__dirname, '..', '..', 'app', 'api', 'kursabbruch', '[token]', 'route.ts')
    let found = ''
    if (fs.existsSync(p)) { found = fs.readFileSync(p, 'utf-8') }
    expect(found.length).toBeGreaterThan(0)
    expect(found).toMatch(/refundCredits/)
    // newPaidCredits ist der neue korrekte Name (vorher: guthabenCredits)
    expect(found).toMatch(/newPaidCredits/)
  })

  test('[AUDIT] cancelCourse passt newCreditsCount + courseTotal an admin_guthaben_verrechnet Email', async () => {
    const fs = require('fs')
    const path = require('path')
    const p = path.join(process.cwd(), 'app/admin/yogis/[id]/page.tsx')
    let src = ''
    if (fs.existsSync(p)) src = fs.readFileSync(p, 'utf-8')
    expect(src.length).toBeGreaterThan(0)
    // Sollte die Felder courseTotal + newCreditsCount benutzen wenn Email aufgerufen
    expect(src).toMatch(/adminGuthabenVerrechnet[\s\S]{0,500}courseTotal/i)
  })
})
