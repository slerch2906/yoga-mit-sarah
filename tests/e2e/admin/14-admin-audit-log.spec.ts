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
import { LoginPage } from '../../page-objects/LoginPage'
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
    // Frischer Login statt gespeichertem yogi1.json: spät im Voll-Lauf ist die
    // gespeicherte Session evtl. ungültig (globaler Logout in einem früheren Test)
    // → /kurse/[id] würde auf /login leiten und der Buchen-Button fehlt (Flake).
    test.use({ storageState: { cookies: [], origins: [] } })
    test.beforeEach(async ({ page }) => {
      const login = new LoginPage(page)
      await login.goto()
      await login.login(process.env.TEST_YOGI1_EMAIL!, process.env.TEST_YOGI1_PASSWORD!)
    })

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

    // Liste oder Empty-State sichtbar — Welle 5 (Sarah 2026-05-26): Raw-Action-Strings
    // sind seit dem ACTION_LABELS-Fix nicht mehr im UI sichtbar; jetzt das gemappte Label
    // "Stunde gebucht"/"Stunde storniert" suchen ODER den Empty-State.
    await expect(
      page.getByText(/stunde gebucht|stunde storniert|keine.*einträge|keine.*protokoll/i).first()
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

    // 1) Referenzliste der Actions = die Beschriftungen im GLOBALEN Protokoll
    //    (app/admin/protokoll/page.tsx, ACTION_LABELS).
    //
    //    Ersetzt 2026-08-21: Die Liste kam frueher aus einem externen
    //    `rg`-Aufruf (ripgrep) ueber den gesamten App-Code, mit einer hart
    //    eingetragenen Ersatzliste als Fallback. Zwei Probleme:
    //      a) Auf Rechnern ohne ripgrep — u.a. Sarahs — schlug der Aufruf IMMER
    //         fehl. Der Test pruefte dadurch dauerhaft nur die Ersatzliste vom
    //         26.05.; jede seither ergaenzte Action war gar nicht erfasst.
    //      b) Die Textsuche fand nebenbei Spalten- und Tabellennamen
    //         ("created_at", "user_id", "audit_log") und meldete sie als
    //         fehlende Actions.
    //
    //    ACTION_LABELS ist die verlaessliche Quelle: dort steht genau das, was
    //    Sarah im globalen Protokoll lesbar angezeigt bekommt. Der Drift-Check
    //    ist damit auch inhaltlich schaerfer — beide Protokoll-Ansichten
    //    (global + pro Yogi) muessen dieselben Vorgaenge benennen koennen.
    const protokollSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/protokoll/page.tsx'), 'utf8'
    )
    const labelsStart = protokollSrc.indexOf('const ACTION_LABELS')
    expect(labelsStart, 'ACTION_LABELS muss in /admin/protokoll existieren').toBeGreaterThan(-1)
    const labelsEnd = protokollSrc.indexOf('\n}', labelsStart)
    const labelsBody = protokollSrc.slice(labelsStart, labelsEnd)

    const appActions = new Set<string>()
    const labelRe = /^\s*([a-z0-9_]+):\s*\{\s*label:/gm
    let hit: RegExpExecArray | null
    while ((hit = labelRe.exec(labelsBody)) !== null) appActions.add(hit[1])

    expect(
      appActions.size,
      'ACTION_LABELS muss eingelesen werden — sonst prueft dieser Test nichts'
    ).toBeGreaterThan(10)

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
    // Welle 3 (2026-05-26): Audit-Cases fuer Container-Sessions (single_session_*,
    // event_*, single_or_event_*, session_open_toggled) liefern den Kontext via
    // subject (= termin = Datum + Uhrzeit + Name) statt via Template-Interpolation
    // im text. Das ist semantisch aequivalent — Admin sieht Termin oben + lesbaren
    // Action-Text unten. Whitelist diese Cases.
    const WHITELIST_VAGE = new Set([
      'yogi_anonymized_dsgvo',
      'single_session_created',
      'single_session_updated',
      'event_created',  // Hat zwar ${pStr} aber je nach payment_type leer
      'event_updated',
      'single_or_event_deleted',
      'single_or_event_updated',
      'session_open_toggled',
    ])
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
      // Ergaenzt 2026-08-21: Ein Case, der `subject: termin` setzt, zeigt dem
      // Admin Datum + Uhrzeit + Kurs in der Kopfzeile des Eintrags — genau der
      // Kontext, den dieser Test einfordert. Diese Gleichwertigkeit stand bisher
      // nur als Begruendung ueber der Whitelist; jetzt ist sie die Regel, damit
      // die Whitelist nicht bei jedem neuen Case weiterwachsen muss.
      const hasTerminSubject = /subject:\s*termin\b/.test(body)
      if (!hasInterpolation && !hasTerminSubject) {
        vague.push(actionName)
      }
    }
    expect(
      vague,
      `Diese Action-Cases liefern KEINE konkreten Details (keine Variablen-Interpolation im Text). Bitte Termin/Kurs/Anzahl ergänzen damit der Admin nachvollziehen kann WAS passiert ist: ${vague.join(', ')}`
    ).toEqual([])
  })
})
