/**
 * Bugfix (Sarah 2026-08-18): Verwaister Wartelisten-Eintrag blockierte fälschlich
 * neue Buchungen.
 *
 * Reproduktion des gemeldeten Bugs: Ein Yogi stand auf der Warteliste einer
 * Stunde, ist aber nicht nachgerückt (Stunde hat einfach stattgefunden ohne
 * freien Platz). Der Wartelisten-Eintrag blieb bestehen. Als der Yogi sich
 * danach für eine andere Stunde buchen wollte, zählte checkWaitlistConflicts()
 * (app/kurse/[id]/page.tsx) diesen längst vergangenen Eintrag mit und zeigte
 * fälschlich den "Wartelisten-Konflikt"-Hinweis, obwohl der Yogi genug Credits
 * hatte.
 *
 * Testfälle:
 *   - Buchung trotz vergangenem Wartelisten-Eintrag läuft ohne Konflikt-Popup durch
 *   - fn_cleanup_stale_waitlist_entries() räumt genau solche Einträge auf
 *     (Dry-Run zählt nur, scharf löscht + schreibt audit_log)
 */
import { test, expect } from '@playwright/test'
import { SessionDetailPage } from '../page-objects/SessionDetailPage'
import { createTestCourse, giveYogiSingleCredit, E2E_PREFIX } from '../utils/seed'
import { getUserIdByEmail, getAdminClient, getWaitlistEntry } from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('[E2E] Warteliste: verwaister Eintrag verursacht keinen Buchungs-Konflikt mehr', () => {
  test.use({ storageState: 'tests/.auth/yogi1.json' })

  let yogi1Id: string
  let staleCourseId: string
  let staleSessionId: string
  let bookableCourseId: string
  let bookableSessionId: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()
    // Sauberer Ausgangszustand: keine übrigen Single-Credits/Wartelisten von yogi1.
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')
    await db.from('waitlist').delete().eq('user_id', yogi1Id)

    // 1) Vergangene Stunde + Wartelisten-Eintrag (simuliert exakt den gemeldeten Bug:
    //    Yogi stand auf der Liste, ist nie nachgerückt, Eintrag blieb liegen).
    const staleCourse = await createTestCourse({
      name: `${E2E_PREFIX} Waitlist-Stale-Test`, sessionCount: 1, startDaysFromNow: -3,
    })
    staleCourseId = staleCourse.courseId
    staleSessionId = staleCourse.sessionIds[0]
    await db.from('waitlist').insert({
      user_id: yogi1Id, session_id: staleSessionId, type: 'waitlist', position: 1,
    })

    // 2) Buchbare Stunde in der Zukunft + genau 1 Credit — reicht für GENAU
    //    diese eine Buchung. Zaehlt der verwaiste Eintrag faelschlich mit,
    //    schlaegt checkWaitlistConflicts Alarm ("nicht genug Credits fuer alle").
    const bookableCourse = await createTestCourse({
      name: `${E2E_PREFIX} Waitlist-Stale-Bookable`, sessionCount: 1, startDaysFromNow: 7,
    })
    bookableCourseId = bookableCourse.courseId
    bookableSessionId = bookableCourse.sessionIds[0]
    await giveYogiSingleCredit(yogi1Id, 1)
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')
    await db.from('waitlist').delete().eq('user_id', yogi1Id)
    for (const sid of [staleSessionId, bookableSessionId]) {
      await db.from('bookings').delete().eq('session_id', sid)
    }
    await db.from('sessions').delete().in('course_id', [staleCourseId, bookableCourseId])
    await db.from('courses').delete().in('id', [staleCourseId, bookableCourseId])
  })

  test('Buchung läuft ohne "Wartelisten-Konflikt"-Popup direkt durch', async ({ page }) => {
    // Vorbedingung: der verwaiste Eintrag existiert wirklich (Bug-Ausgangslage).
    const staleEntry = await getWaitlistEntry(yogi1Id, staleSessionId)
    expect(staleEntry, 'Testaufbau fehlerhaft: verwaister Eintrag fehlt').toBeTruthy()

    const sessionPage = new SessionDetailPage(page)
    await sessionPage.goto(bookableSessionId)
    // book() klickt "Für diese Stunde eintragen" und erwartet direkt die
    // "Du bist dabei"-Bestätigung. Erscheint stattdessen das Konflikt-Modal
    // ("Wartelisten-Konflikt"), bleibt der Button/die Bestätigung aus und
    // dieser Schritt läuft in ein Timeout — genau das reproduziert den Bug.
    await sessionPage.book()
    await sessionPage.expectBookedStatus()
    // Kein weiterer Check nötig: book() + expectBookedStatus() schlagen fehl/
    // timeouten, falls stattdessen das Konflikt-Modal erschienen wäre — genau
    // das ist der eigentliche Regressionstest. (Bewusst KEIN Check mehr, ob der
    // verwaiste Eintrag danach noch existiert — der alle 15 Min laufende Cron
    // kann ihn zwischen Setup und hier bereits regulär aufgeräumt haben.)
  })
})

test.describe('[E2E] fn_cleanup_stale_waitlist_entries: Cron-Bereinigung', () => {
  let yogi1Id: string
  let courseId: string
  let sessionId: string
  let waitlistId: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()
    const course = await createTestCourse({
      name: `${E2E_PREFIX} Waitlist-Cron-Test`, sessionCount: 1, startDaysFromNow: -2,
    })
    courseId = course.courseId
    sessionId = course.sessionIds[0]
    const { data: ins } = await db.from('waitlist').insert({
      user_id: yogi1Id, session_id: sessionId, type: 'waitlist', position: 1,
    }).select('id').single()
    waitlistId = ins!.id
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('waitlist').delete().eq('id', waitlistId)
    await db.from('sessions').delete().eq('course_id', courseId)
    await db.from('courses').delete().eq('id', courseId)
  })

  test('Dry-Run zählt den Eintrag, löscht aber nichts', async () => {
    const db = await getAdminClient()
    const { data: dryRun } = await db.rpc('fn_cleanup_stale_waitlist_entries', { p_dry_run: true })
    const entries = (dryRun as any)?.entries || []
    expect(entries.some((e: any) => e.waitlist_id === waitlistId), 'Trockenlauf muss den Testeintrag als Kandidat listen').toBe(true)

    const stillThere = await getWaitlistEntry(yogi1Id, sessionId)
    expect(stillThere, 'Trockenlauf darf nichts löschen').toBeTruthy()
  })

  test('Scharfer Lauf löscht den Eintrag + schreibt audit_log', async () => {
    const db = await getAdminClient()
    await db.rpc('fn_cleanup_stale_waitlist_entries', { p_dry_run: false })

    const gone = await getWaitlistEntry(yogi1Id, sessionId)
    expect(gone, 'Verwaister Eintrag muss nach scharfem Lauf gelöscht sein').toBeNull()

    const { data: audit } = await db.from('audit_log')
      .select('*').eq('action', 'waitlist_stale_entry_removed')
      .eq('details->>waitlist_id', waitlistId).maybeSingle()
    expect(audit, 'audit_log-Eintrag für die Löschung fehlt').toBeTruthy()
  })
})
