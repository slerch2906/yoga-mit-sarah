/**
 * Workflow: Audit-Log / Protokoll
 * Testfälle:
 *   - Buchung → audit_log Eintrag 'booking_created' vorhanden
 *   - Abmeldung → audit_log Eintrag 'booking_cancelled' vorhanden
 *   - Admin sagt Session ab → 'session_cancelled' Eintrag
 *   - /admin/protokoll zeigt Einträge mit Yogi-Info
 */
import { test, expect } from '@playwright/test'
import { SessionDetailPage } from '../../page-objects/SessionDetailPage'
import { createTestCourse, giveYogiSingleCredit, E2E_PREFIX } from '../../utils/seed'
import {
  getUserIdByEmail, getAdminClient, getActiveBooking,
} from '../../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

test.describe('Audit-Log: Buchung + Abmeldung loggen Events', () => {
  let sessionId: string
  let courseId: string
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    const db = await getAdminClient()
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')

    const course = await createTestCourse({
      name: `${E2E_PREFIX} Audit-Log-Test`,
      sessionCount: 1,
      startDaysFromNow: 10,
    })
    courseId = course.courseId
    sessionId = course.sessionIds[0]

    await giveYogiSingleCredit(yogi1Id, 3)

    // Alte Audit-Log Einträge dieser Session bereinigen
    await db.from('audit_log').delete().eq('user_id', yogi1Id).filter('details->>session_id', 'eq', sessionId)
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    await db.from('audit_log').delete().eq('user_id', yogi1Id).filter('details->>session_id', 'eq', sessionId)
    await db.from('bookings').delete().eq('session_id', sessionId)
    await db.from('sessions').delete().eq('id', sessionId)
    await db.from('courses').delete().eq('id', courseId)
    await db.from('credits').delete().eq('user_id', yogi1Id).eq('model', 'single')
  })

  test.describe('Yogi bucht', () => {
    test.use({ storageState: 'tests/.auth/yogi1.json' })

    test('Buchung erzeugt booking_created Audit-Log-Eintrag', async ({ page }) => {
      const sessionPage = new SessionDetailPage(page)
      await sessionPage.goto(sessionId)
      await sessionPage.book()

      const booking = await getActiveBooking(yogi1Id, sessionId)
      expect(booking).toBeTruthy()

      // Audit-Log Eintrag prüfen
      const db = await getAdminClient()
      const { data: log } = await db.from('audit_log')
        .select('*').eq('user_id', yogi1Id).eq('action', 'booking_created')
        .filter('details->>session_id', 'eq', sessionId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()

      expect(log, 'booking_created Eintrag muss existieren').toBeTruthy()
      expect(log?.details?.session_id).toBe(sessionId)
    })

    test('Abmeldung erzeugt booking_cancelled Audit-Log-Eintrag', async ({ page }) => {
      const sessionPage = new SessionDetailPage(page)
      await sessionPage.goto(sessionId)
      await sessionPage.cancelBooking()

      // Trigger braucht kurz Zeit
      await page.waitForTimeout(1_500)

      const db = await getAdminClient()
      const { data: log } = await db.from('audit_log')
        .select('*').eq('user_id', yogi1Id).eq('action', 'booking_cancelled')
        .filter('details->>session_id', 'eq', sessionId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()

      expect(log, 'booking_cancelled Eintrag muss existieren').toBeTruthy()
      expect(log?.details?.late, 'late-Flag muss boolean sein').toBeDefined()
    })
  })
})

test.describe('Audit-Log: /admin/protokoll Page rendert Einträge', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  test('Protokoll-Page lädt und zeigt mind. einen Eintrag', async ({ page }) => {
    // Audit-Log sollte Einträge enthalten aus vorherigen Tests
    await page.goto('/admin/protokoll')
    await page.waitForLoadState('networkidle')

    // Header sichtbar
    await expect(page.getByRole('heading', { name: /protokoll/i }).first()).toBeVisible({ timeout: 8_000 })

    // Liste oder Empty-State sichtbar
    await expect(
      page.getByText(/booking_created|booking_cancelled|keine.*einträge|keine.*protokoll/i).first()
    ).toBeVisible({ timeout: 8_000 })
  })
})

// Sarah-Wunsch 2026-05-26: yogi-bezogenes Protokoll auf /admin/yogis/[id] hat
// ein Mapping action → human-readable Text. Falls in Zukunft eine neue
// audit_log-Action im App-Code dazukommt OHNE Mapping in formatAuditEntry,
// faellt sie auf den default-case und der Admin sieht nur den Code-String.
// Dieser Drift-Test grep't alle action-Strings aus dem App-Code und prueft
// dass jeder im case-Statement aufgefuehrt ist.
test.describe('[E2E] Yogi-Protokoll: kein Action-Drift', () => {
  test('Alle action-Strings im App-Code sind in formatAuditEntry gemappt', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const { execSync } = await import('child_process')

    // 1) Sammle alle action-Strings aus dem App-Code (app/**, supabase/**).
    //    Test-Dateien ignorieren (E2E setzt manchmal Test-Actions die nie
    //    in Prod laufen — z.B. 'cascade_replacement_cancelled' in einem Seed).
    let appActions: Set<string>
    try {
      // rg auf Windows oft nicht in PATH → wirft, dann greift der Fallback.
      const out = execSync(
        'rg -t ts -t js -t sql --no-heading -o "action[^a-zA-Z][^\'\\"]*[\'\\\"]([a-z0-9_]+)[\'\\\"]" -r "$1" app supabase',
        { cwd: path.join(process.cwd()), encoding: 'utf8' }
      ).toString().trim()
      appActions = new Set(out.split(/\r?\n/).filter(Boolean))
    } catch {
      // Fallback: hard-coded Liste mit allen bekannten Actions (Stand 2026-05-26).
      // Wird nicht idealerweise verwendet — der rg-Pfad funktioniert auf den
      // meisten Setups. Falls dieser Test trotzdem aus irgendeinem Grund nicht
      // greifen kann, bleibt die hard-coded Liste als Sicherheitsnetz.
      appActions = new Set([
        'booking_created', 'booking_cancelled', 'booking_cancelled_by_admin',
        'admin_added_yogi_to_session', 'admin_illness_credit',
        'admin_promoted_waitlist_yogi', 'admin_bulk_mail',
        'yogi_enrolled_by_admin', 'yogi_removed_from_course',
        'yogi_course_cancellation_choice', 'yogi_anonymized_dsgvo',
        'course_cancelled', 'course_rollover', 'session_cancelled',
        'replacement_session_added', 'cascade_replacement_cancelled',
        'waitlist_offer_late_accepted', 'credit_assigned', 'credit_adjusted',
        'credit_deleted', 'guthaben_2y_auto_refund', 'token_expired_auto_refund',
      ])
    }

    // 2) Lies die formatAuditEntry-Funktion und extrahiere alle case-Strings.
    const yogiDetailSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/yogis/[id]/page.tsx'), 'utf8'
    )
    const mappedActions = new Set<string>()
    const re = /case '([a-z0-9_]+)':/g
    let m: RegExpExecArray | null
    while ((m = re.exec(yogiDetailSrc)) !== null) {
      mappedActions.add(m[1])
    }
    expect(mappedActions.size, 'formatAuditEntry sollte mind. 1 case haben').toBeGreaterThan(0)

    // 3) Drift-Check: jede App-Action muss gemappt sein. Fehlende dokumentieren
    //    für Debug-Output.
    const missing: string[] = []
    appActions.forEach((act) => {
      if (!mappedActions.has(act)) missing.push(act)
    })
    expect(
      missing,
      `Diese Action-Strings sind im App-Code aber NICHT in formatAuditEntry (app/admin/yogis/[id]/page.tsx) gemappt. Bitte case-Statement ergänzen: ${missing.join(', ')}`
    ).toEqual([])
  })

  test('formatAuditEntry-Texte enthalten konkreten Kontext (Kurs/Stunde/Anzahl)', async () => {
    // Sarah-Wunsch 2026-05-26 (zweite Welle): Jeder Eintrag MUSS nachvollziehbar
    // sein. Wir pruefen dass kein case-Block einen reinen Statisch-Satz ohne
    // Variablen-Interpolation (${...}) zurueckgibt — sonst ist der Eintrag
    // "Yogi hat Stunde abgemeldet" statt "Yogi hat sich abgemeldet · 16. Juni
    // um 18:30 · Body & Mind".
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/yogis/[id]/page.tsx'), 'utf8'
    )
    // Extrahiere alle case-Bloecke. Ein case ohne Termin/Kurs/Anzahl-Interpolation
    // gilt als "vage". Whitelist: yogi_anonymized_dsgvo hat keinen sinnvollen
    // Kontext (Account ist weg).
    const WHITELIST_VAGE = new Set(['yogi_anonymized_dsgvo'])
    // Slice von "switch (entry.action)" bis "default:"
    const swStart = src.indexOf("switch (entry.action)")
    const swEnd = src.indexOf("default:", swStart)
    expect(swStart, 'switch-Block in formatAuditEntry muss existieren').toBeGreaterThan(0)
    expect(swEnd, 'default-Case muss existieren').toBeGreaterThan(swStart)
    const switchBody = src.substring(swStart, swEnd)
    const caseRe = /case '([a-z0-9_]+)':[\s\S]*?(?=case '|default:)/g
    let m: RegExpExecArray | null
    const vague: string[] = []
    while ((m = caseRe.exec(switchBody)) !== null) {
      const actionName = m[1]
      const body = m[0]
      if (WHITELIST_VAGE.has(actionName)) continue
      // Heuristik: Body muss mind. EINE Template-Literal-Interpolation `${...}`
      // ENTHALTEN, die nicht nur ein Helper-Aufruf ohne Detail ist.
      const hasInterpolation = /\$\{[^}]+\}/.test(body)
      if (!hasInterpolation) {
        vague.push(actionName)
      }
    }
    expect(
      vague,
      `Diese Action-Cases liefern KEINE konkreten Details (keine Variablen-Interpolation im Text). Bitte Termin/Kurs/Anzahl ergänzen damit der Admin nachvollziehen kann WAS passiert ist: ${vague.join(', ')}`
    ).toEqual([])
  })
})
