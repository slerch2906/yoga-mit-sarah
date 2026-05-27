/**
 * Welle 4.8 (Sarah 2026-05-26) — Audit-Coverage vollständig
 *
 * Sarah braucht das audit_log als rechtliche Argumentation. Jede Admin-/Yogi-
 * Aktion MUSS:
 *   1) einen Eintrag in der `audit_log`-Tabelle erzeugen
 *   2) im zentralen Protokoll `/admin/protokoll` lesbar (nicht als Roh-String)
 *      erscheinen → ACTION_LABELS in app/admin/protokoll/page.tsx
 *   3) wenn user_id gesetzt: im Yogi-Protokoll `/admin/yogis/[id]` als
 *      formatierter Eintrag erscheinen → formatAuditEntry-switch
 *
 * Diese Spec deckt systematisch ALLE bekannten Action-Strings ab und prüft die
 * Drift-Konsistenz zwischen App-Code, DB und beiden Protokoll-Renderern.
 *
 * Konventionen:
 *  - Source-Checks: fs.readFileSync, charakteristische Code-Strings
 *  - Live-Tests: getAdminClient() für DB, E2E_PREFIX für alle Testdaten
 *  - afterAll-Cleanup, wo Daten erzeugt werden
 *  - Fragwürdige/komplexe Live-Workflows: test.skip() mit Kommentar
 *
 * Diese Spec verändert KEINE bestehenden Files.
 */
import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { getAdminClient, getUserIdByEmail } from '../../utils/db'
import {
  E2E_PREFIX,
  futureDateStr,
  createTestCourse,
  giveYogiSingleCredit,
  giveYogiGuthaben,
} from '../../utils/seed'

dotenv.config({ path: '.env.test' })

const ROOT = process.cwd()
const PROTOKOLL_SRC = fs.readFileSync(
  path.join(ROOT, 'app/admin/protokoll/page.tsx'),
  'utf8',
)
const YOGI_SRC = fs.readFileSync(
  path.join(ROOT, 'app/admin/yogis/[id]/page.tsx'),
  'utf8',
)

// ── Vollständige Liste aller bekannten Audit-Actions (Stand 2026-05-26) ──────
// Quelle: ACTION_LABELS-Map in app/admin/protokoll/page.tsx
// Diese Liste ist der "Soll-Zustand" — jede Action muss in mind. einem der
// nachgelagerten Renderer auftauchen.
const ALL_ACTIONS: string[] = [
  // Buchung / Abmeldung
  'booking_created',
  'booking_cancelled',
  'booking_cancelled_by_admin',
  // Credits
  'credit_assigned',
  'credit_adjusted',
  'credit_deleted',
  // Sessions / Ersatz
  'session_cancelled',
  'replacement_session_added',
  'cascade_replacement_cancelled',
  // Yogi-Lifecycle
  'yogi_enrolled_by_admin',
  'yogi_removed_from_course',
  'yogi_deleted',
  'yogi_anonymized_dsgvo',
  // Legal
  'legal_accepted',
  // Warteliste
  'waitlist_joined',
  'waitlist_promoted',
  'waitlist_offer_late_accepted',
  // Welle 2 — Events / Einzelstunden / Container-Sessions
  'single_session_created',
  'single_session_updated',
  'event_created',
  'event_updated',
  'single_or_event_deleted',
  'single_or_event_updated',
  'external_participants_changed',
  'admin_added_yogi_to_event',
  'admin_added_yogi_to_session',
  'admin_promoted_waitlist_yogi',
  'session_open_toggled',
  // Welle 4.7 — Kurs-Mutationen
  'course_created',
  'course_updated',
  'course_archived',
  'course_deleted',
  'course_open_toggled',
  // Kursabbruch
  'course_cancelled',
  'course_rollover',
  'yogi_course_cancellation_choice',
  // Auto-Refunds
  'token_expired_auto_refund',
  'guthaben_2y_auto_refund',
  // Sonstige Admin-Aktionen
  'admin_illness_credit',
  'admin_bulk_mail',
  'admin_dsgvo_deletion',
]

// ── Actions ohne user_id-Bezug (System-Actions) ──────────────────────────────
// Diese erscheinen NICHT zwingend im Yogi-Protokoll-Switch, da sie keinen
// einzelnen Yogi-Kontext haben. ACTION_LABELS-Mapping bleibt trotzdem Pflicht.
const SYSTEM_ONLY_ACTIONS = new Set<string>([
  'course_rollover',     // System schiebt Kurs in Folgekurs — kein Yogi-Bezug
  'admin_bulk_mail',     // Admin verschickt an viele — wird ohne user_id geloggt
  // Welle S2/S3 (Sarah 2026-05-27): 8d-Cleanup-Cron loescht abgelaufene Kurs-
  // Credits + erstellt Audit-Eintrag ohne user_id (System-Bereinigung).
  'course_credits_auto_expired',
])

// ── Bekannte Drift-Lücken (Stand 2026-05-26) ────────────────────────────────
// Diese Actions sind aktuell in der App "halb" gemappt — sie werden im
// Protokoll-Mapping geführt, weil ein DB-Trigger oder Auth-Hook sie zukünftig
// schreiben wird (oder ein anderer Code-Pfad), aber im Yogi-Switch noch nicht
// gemappt. test.fixme() statt test.skip(), damit der CI grün bleibt UND Sarah
// die offene Liste regelmäßig sieht (fixme zeigt "expected failure" im Report).
// Welle 5 Fix (Sarah 2026-05-26): Drift behoben — alle 5 Cases sind jetzt im
// Yogi-Switch in app/admin/yogis/[id]/page.tsx ergänzt. Set bleibt leer als
// expliziter Marker: "keine bekannten Yogi-Switch-Lücken mehr".
const KNOWN_YOGI_SWITCH_GAPS = new Set<string>([])

// Welle 5 Fix (Sarah 2026-05-26): booking_cancelled_by_admin ist jetzt in
// ACTION_LABELS in app/admin/protokoll/page.tsx ergänzt. Set bleibt leer als
// expliziter Marker: "keine bekannten Protokoll-Mapping-Lücken mehr".
const KNOWN_PROTOKOLL_MAPPING_GAPS = new Set<string>([])

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Prüft dass eine action im ACTION_LABELS-Mapping vorhanden ist (Source). */
function expectActionMapped(actionName: string) {
  // Match-Pattern: "  actionName:" als Map-Key (mit Leerzeichen davor in JS-Objekt)
  const re = new RegExp(`\\b${actionName}\\s*:\\s*\\{\\s*label:`)
  expect(
    re.test(PROTOKOLL_SRC),
    `ACTION_LABELS in /admin/protokoll fehlt Mapping für '${actionName}'`,
  ).toBe(true)
}

/** Prüft dass die action im formatAuditEntry-switch einen case hat. */
function expectYogiProtocolCase(actionName: string) {
  expect(
    YOGI_SRC.includes(`case '${actionName}'`),
    `Yogi-Protokoll-Switch in /admin/yogis/[id] fehlt case für '${actionName}'`,
  ).toBe(true)
}

/** Findet (best effort) einen audit_log-Eintrag mit der gegebenen action. */
async function findAuditEntry(
  db: any,
  action: string,
  filter?: Record<string, any>,
) {
  const { data } = await db
    .from('audit_log')
    .select('*')
    .eq('action', action)
    .order('created_at', { ascending: false })
    .limit(20)
  if (!data || data.length === 0) return null
  if (!filter) return data[0]
  return (
    data.find((e: any) =>
      Object.entries(filter).every(
        ([k, v]) => e.details?.[k] === v || e[k] === v,
      ),
    ) ?? null
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PART A — Pro Action ein Source-Check (Mapping + Yogi-Switch falls relevant)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('[E2E] Audit-Coverage: jede Action ist gemappt', () => {
  for (const action of ALL_ACTIONS) {
    if (KNOWN_PROTOKOLL_MAPPING_GAPS.has(action)) {
      // bekannte Lücke — fixme statt skip, damit Sarah die offene Liste sieht
      test.fixme(
        `Action '${action}' ist in ACTION_LABELS (Protokoll-Page) [bekannte Lücke]`,
        () => {
          expectActionMapped(action)
        },
      )
      continue
    }
    test(`Action '${action}' ist in ACTION_LABELS (Protokoll-Page)`, () => {
      expectActionMapped(action)
    })
  }
})

test.describe('[E2E] Audit-Coverage: Yogi-Protokoll-Cases', () => {
  for (const action of ALL_ACTIONS) {
    if (SYSTEM_ONLY_ACTIONS.has(action)) {
      // System-Actions ohne Yogi-Kontext → skip (siehe SYSTEM_ONLY_ACTIONS)
      test.skip(`Action '${action}' ist System-only, kein Yogi-Switch-Case nötig`, () => {})
      continue
    }
    if (KNOWN_YOGI_SWITCH_GAPS.has(action)) {
      // bekannte Lücke — fixme statt skip
      test.fixme(
        `Action '${action}' hat case im formatAuditEntry-switch [bekannte Lücke]`,
        () => {
          expectYogiProtocolCase(action)
        },
      )
      continue
    }
    test(`Action '${action}' hat case im formatAuditEntry-switch`, () => {
      expectYogiProtocolCase(action)
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// PART B — Cross-Reference: DB-Actions ↔ ACTION_LABELS
// ═══════════════════════════════════════════════════════════════════════════

test.describe('[E2E] Cross-Reference: DB-Actions in ACTION_LABELS', () => {
  test('Alle in audit_log auftauchenden Actions sind im Protokoll-Mapping', async () => {
    const db = await getAdminClient()
    // Hol distinct actions aus DB (Limit großzügig — wir wollen Vollständigkeit)
    const { data, error } = await db
      .from('audit_log')
      .select('action')
      .order('created_at', { ascending: false })
      .limit(5000)
    expect(error, `audit_log-Query fehlgeschlagen: ${error?.message}`).toBeNull()

    const dbActions = new Set<string>(
      (data || []).map((r: any) => r.action).filter(Boolean),
    )
    expect(
      dbActions.size,
      'audit_log sollte mind. eine Action enthalten — sonst läuft die App nie?',
    ).toBeGreaterThan(0)

    // Welche DB-Actions fehlen im Mapping? (Known-Gaps ausgenommen)
    const missing: string[] = []
    dbActions.forEach((act) => {
      if (KNOWN_PROTOKOLL_MAPPING_GAPS.has(act)) return
      const re = new RegExp(`\\b${act}\\s*:\\s*\\{\\s*label:`)
      if (!re.test(PROTOKOLL_SRC)) missing.push(act)
    })
    expect(
      missing,
      `Diese Actions sind in der DB vorhanden, aber NICHT in ACTION_LABELS gemappt (Admin sieht im Protokoll nur den Roh-String): ${missing.join(', ')}`,
    ).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PART C — Yogi-Protokoll-Drift: ACTION_LABELS-Keys vs. switch-cases
// ═══════════════════════════════════════════════════════════════════════════

test.describe('[E2E] Yogi-Protokoll-Drift', () => {
  test('Alle user-relevanten ACTION_LABELS-Keys haben switch-case im Yogi-Protokoll', () => {
    // Extrahiere ACTION_LABELS-Keys aus Protokoll-Source.
    const mapRe = /\b([a-z0-9_]+)\s*:\s*\{\s*label:/g
    const labelKeys = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = mapRe.exec(PROTOKOLL_SRC)) !== null) labelKeys.add(m[1])
    expect(labelKeys.size, 'ACTION_LABELS muss min. 10 Einträge haben').toBeGreaterThanOrEqual(10)

    // Extrahiere case-Strings aus Yogi-Switch.
    const caseRe = /case '([a-z0-9_]+)':/g
    const caseKeys = new Set<string>()
    while ((m = caseRe.exec(YOGI_SRC)) !== null) caseKeys.add(m[1])
    expect(caseKeys.size, 'Yogi-formatAuditEntry muss min. 10 cases haben').toBeGreaterThanOrEqual(10)

    // Drift: was ist gemappt, aber nicht im Switch & nicht System-only?
    const missing: string[] = []
    labelKeys.forEach((k) => {
      if (SYSTEM_ONLY_ACTIONS.has(k)) return
      if (KNOWN_YOGI_SWITCH_GAPS.has(k)) return  // bekannte Lücke, separat in PART A getrackt
      if (!caseKeys.has(k)) missing.push(k)
    })
    expect(
      missing,
      `Diese ACTION_LABELS-Keys sind im Protokoll gemappt aber haben KEINEN case in formatAuditEntry (Yogi-Protokoll). Admin sieht im Yogi-Detail nur "<action> — keine lesbare Beschreibung verfügbar": ${missing.join(', ')}`,
    ).toEqual([])
  })

  test('Yogi-Switch hat keine "Waisen"-Cases die nicht in ACTION_LABELS sind', () => {
    const mapRe = /\b([a-z0-9_]+)\s*:\s*\{\s*label:/g
    const labelKeys = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = mapRe.exec(PROTOKOLL_SRC)) !== null) labelKeys.add(m[1])

    const caseRe = /case '([a-z0-9_]+)':/g
    const caseKeys = new Set<string>()
    while ((m = caseRe.exec(YOGI_SRC)) !== null) caseKeys.add(m[1])

    const orphans: string[] = []
    caseKeys.forEach((k) => {
      if (!labelKeys.has(k)) orphans.push(k)
    })
    expect(
      orphans,
      `Diese Switch-Cases im Yogi-Protokoll existieren OHNE Eintrag in ACTION_LABELS (zentrales Protokoll). Bitte in ACTION_LABELS ergänzen: ${orphans.join(', ')}`,
    ).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PART D — Coverage: App-Code-Inserts ↔ ACTION_LABELS
// ═══════════════════════════════════════════════════════════════════════════

test.describe('[E2E] App-Code-Inserts: alle action-Strings sind gemappt', () => {
  test('Jeder im App-Code geschriebene audit_log.insert hat ACTION_LABELS-Eintrag', () => {
    // Sammle alle action-Strings aus app/**/*.ts(x). Nicht via execSync/rg
    // (Windows-PATH-Probleme), sondern durch rekursives fs-Walk + Regex.
    const APP_DIR = path.join(ROOT, 'app')
    const actionRe = /action\s*:\s*['"]([a-z0-9_]+)['"]/g

    function walk(dir: string): string[] {
      const out: string[] = []
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(full))
        else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full)
      }
      return out
    }

    const files = walk(APP_DIR)
    const appActions = new Set<string>()
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      let m: RegExpExecArray | null
      while ((m = actionRe.exec(src)) !== null) {
        const a = m[1]
        // Filter: heuristisch nur "echte" Action-Strings (alle kleine Buchstaben +
        // underscore, min. 5 Zeichen — verhindert Treffer wie type: 'single').
        if (a.length >= 5 && a.includes('_')) appActions.add(a)
      }
    }
    expect(
      appActions.size,
      'Mind. 5 Action-Inserts müssen im App-Code stehen — sonst grep-Pattern kaputt',
    ).toBeGreaterThanOrEqual(5)

    // Welche fehlen im Mapping?
    const missing: string[] = []
    appActions.forEach((act) => {
      if (KNOWN_PROTOKOLL_MAPPING_GAPS.has(act)) return  // bekannte Lücke
      const re = new RegExp(`\\b${act}\\s*:\\s*\\{\\s*label:`)
      if (!re.test(PROTOKOLL_SRC)) missing.push(act)
    })
    expect(
      missing,
      `Diese Actions werden im App-Code in audit_log geschrieben, aber sind NICHT in ACTION_LABELS gemappt (/admin/protokoll zeigt Roh-String): ${missing.join(', ')}`,
    ).toEqual([])
  })

  test('Jeder im App-Code geschriebene Yogi-relevante audit_log.insert hat formatAuditEntry-case', () => {
    const APP_DIR = path.join(ROOT, 'app')
    const actionRe = /action\s*:\s*['"]([a-z0-9_]+)['"]/g

    function walk(dir: string): string[] {
      const out: string[] = []
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(full))
        else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full)
      }
      return out
    }
    const files = walk(APP_DIR)
    const appActions = new Set<string>()
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      let m: RegExpExecArray | null
      while ((m = actionRe.exec(src)) !== null) {
        const a = m[1]
        if (a.length >= 5 && a.includes('_')) appActions.add(a)
      }
    }

    const missing: string[] = []
    appActions.forEach((act) => {
      if (SYSTEM_ONLY_ACTIONS.has(act)) return
      if (KNOWN_YOGI_SWITCH_GAPS.has(act)) return  // bekannte Lücke
      if (!YOGI_SRC.includes(`case '${act}'`)) missing.push(act)
    })
    expect(
      missing,
      `Diese Actions werden im App-Code geschrieben, sind aber NICHT im Yogi-Protokoll-Switch (formatAuditEntry). Yogi-Detail-Page rendert Default-Fallback: ${missing.join(', ')}`,
    ).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PART E — Live-Workflows (sparsam, nur wo trivial machbar)
// ═══════════════════════════════════════════════════════════════════════════
//
// Wir verifizieren NUR die Actions, die wir mit minimaler Test-Logik via direkter
// DB-Manipulation auslösen können. Komplexe Workflows (course_rollover,
// guthaben_2y_auto_refund, etc.) bleiben Source-Check-only und sind in PART A
// abgedeckt.

test.describe('[E2E] Live-Workflows: einfache Audit-Inserts', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  let yogi1Id: string
  let courseId: string
  let sessionIds: string[]
  const createdCreditIds: string[] = []
  const createdLogIds: string[] = []

  test.beforeAll(async () => {
    const id = await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!)
    if (!id) throw new Error('TEST_YOGI1_EMAIL nicht in DB gefunden')
    yogi1Id = id

    const course = await createTestCourse({
      name: `${E2E_PREFIX} Audit-Cov`,
      sessionCount: 2,
      startDaysFromNow: 21,
      maxSpots: 5,
    })
    courseId = course.courseId
    sessionIds = course.sessionIds
  })

  test.afterAll(async () => {
    const db = await getAdminClient()
    if (createdLogIds.length > 0) {
      await db.from('audit_log').delete().in('id', createdLogIds)
    }
    if (createdCreditIds.length > 0) {
      await db.from('credits').delete().in('id', createdCreditIds)
    }
    if (sessionIds?.length) {
      await db.from('bookings').delete().in('session_id', sessionIds)
      await db.from('sessions').delete().in('id', sessionIds)
    }
    if (courseId) {
      await db.from('courses').delete().eq('id', courseId)
    }
    // Generic E2E-Reste am Yogi
    await db.from('audit_log').delete()
      .eq('user_id', yogi1Id)
      .filter('details->>e2e_marker', 'eq', E2E_PREFIX)
  })

  test('audit_log akzeptiert booking_created Eintrag (Smoke)', async () => {
    const db = await getAdminClient()
    const { data, error } = await db.from('audit_log').insert({
      user_id: yogi1Id,
      action: 'booking_created',
      details: {
        session_id: sessionIds[0],
        e2e_marker: E2E_PREFIX,
        source: 'audit-coverage-spec',
      },
    }).select('id').single()
    expect(error, `audit_log-Insert booking_created: ${error?.message}`).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) createdLogIds.push(data.id)

    const found = await findAuditEntry(db, 'booking_created', {
      session_id: sessionIds[0],
    })
    expect(found, 'booking_created muss auffindbar sein').toBeTruthy()
  })

  test('audit_log akzeptiert credit_assigned Eintrag (Smoke)', async () => {
    const db = await getAdminClient()
    const { data, error } = await db.from('audit_log').insert({
      user_id: yogi1Id,
      action: 'credit_assigned',
      details: {
        model: 'single',
        amount: 3,
        e2e_marker: E2E_PREFIX,
      },
    }).select('id').single()
    expect(error, `audit_log-Insert credit_assigned: ${error?.message}`).toBeNull()
    if (data?.id) createdLogIds.push(data.id)
  })

  test('audit_log akzeptiert session_cancelled Eintrag (Smoke)', async () => {
    const db = await getAdminClient()
    const { data, error } = await db.from('audit_log').insert({
      user_id: yogi1Id,
      action: 'session_cancelled',
      details: {
        session_id: sessionIds[1],
        course_name: `${E2E_PREFIX} Audit-Cov`,
        session_date: futureDateStr(28),
        e2e_marker: E2E_PREFIX,
      },
    }).select('id').single()
    expect(error, `audit_log-Insert session_cancelled: ${error?.message}`).toBeNull()
    if (data?.id) createdLogIds.push(data.id)
  })

  // ── /admin/protokoll rendert lesbar ────────────────────────────────────
  test('/admin/protokoll lädt und rendert Audit-Einträge ohne Roh-Strings', async ({ page }) => {
    await page.goto('/admin/protokoll')
    await page.waitForLoadState('networkidle')
    await expect(
      page.getByRole('heading', { name: /protokoll/i }).first(),
    ).toBeVisible({ timeout: 10_000 })

    // Mind. einer der gemappten Labels muss sichtbar sein. Wir testen mehrere
    // Labels, weil je nach DB-State unterschiedliche Actions oben stehen.
    const anyLabel = page.getByText(
      /Stunde gebucht|Stunde storniert|Credits vergeben|Kurs angelegt|Yogi anonymisiert|Stunde abgesagt|Stunde\/Event freigegeben|Externe Teilnehmer|keine Einträge gefunden/i,
    ).first()
    await expect(anyLabel).toBeVisible({ timeout: 10_000 })
  })

  test('/admin/protokoll zeigt KEINEN nackten action-Roh-String der gemappten Actions', async ({ page }) => {
    await page.goto('/admin/protokoll')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_500)

    const bodyText = (await page.locator('body').innerText()).slice(0, 100_000)
    // Wenn 'booking_created' im UI als nackter String steht (statt 'Stunde gebucht'),
    // ist ACTION_LABELS-Mapping kaputt oder nicht geladen.
    const offending: string[] = []
    for (const act of ALL_ACTIONS) {
      if (KNOWN_PROTOKOLL_MAPPING_GAPS.has(act)) continue  // bekannte Lücke
      // RegExp-Word-Boundary auf snake_case schwierig — wir nehmen ":" oder
      // Leerzeichen-Umgebung als Negativ-Test. Hier reicht ein simples
      // includes — wenn die Action als Text auftaucht, ist Mapping defekt.
      if (bodyText.includes(act)) offending.push(act)
    }
    expect(
      offending,
      `Diese Action-Strings erscheinen ROH im UI (= ACTION_LABELS greift nicht): ${offending.join(', ')}`,
    ).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PART F — Komplexe Workflows (skip mit Begründung)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('[E2E] Komplexe Audit-Workflows (Source-Coverage in PART A)', () => {
  test.skip('guthaben_2y_auto_refund — benötigt Time-Travel auf 2J', () => {
    // Action wird nur durch Cron-Job nach 2 Jahren ausgelöst. Ohne Date-Mocking
    // in Prod-DB nicht reproduzierbar. Source-Mapping ist in PART A geprüft.
  })

  test.skip('token_expired_auto_refund — benötigt Token + 7-Tage-Wartezeit', () => {
    // Edge-Function läuft nach 7 Tagen Token-Inaktivität. Test-Setup erfordert
    // Cron-Trigger-Simulation, die im E2E-Pfad nicht stabil ist.
  })

  test.skip('course_rollover — komplexer Multi-Step-Workflow', () => {
    // Erfordert vollständigen Kurs mit Teilnehmern + Folgekurs-Generation.
    // Bereits in 18-credit-status-konsolidierung.spec.ts indirekt abgedeckt.
  })

  test.skip('admin_bulk_mail — Live-Test verschickt echte Mails', () => {
    // bulk-mail-Endpoint verschickt echte Mails über Resend. Im E2E nur als
    // Source-Check getestet (PART A) — Live wäre Mail-Spam-Risiko.
  })

  test.skip('admin_dsgvo_deletion — destruktiv, im Live-Backend gefährlich', () => {
    // Würde echten Yogi-Account löschen. Nicht in E2E gegen Prod-DB.
  })

  test.skip('yogi_anonymized_dsgvo — destruktiv (siehe oben)', () => {
    // DSGVO-Anonymisierung ist endgültig — wir testen das nur über
    // 14-account-loeschung.spec.ts mit gestaffelten Spezial-Yogis.
  })
})
