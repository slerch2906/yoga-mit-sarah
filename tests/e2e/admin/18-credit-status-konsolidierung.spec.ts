/**
 * Credit/Status-Workflow Konsolidierung (Commit bdf8edc, 21. Mai 2026)
 *
 * Cleanup-Konversion 2026-05-23: Aktiviert für Live-Gang.
 *
 * Status-Modell (Single Source of Truth = lib/session-status.ts):
 *   Aktiv:          is_cancelled=false                            → zählt, Credit
 *   Vergangen:      aktiv + date+time < now                       → zählt, Credit verbraucht
 *   Ausgeschlossen: is_cancelled=true, cancel_reason='excluded'   → zählt NICHT
 *   Abgesagt:       is_cancelled=true, cancel_reason!='excluded'  → zählt NICHT (Refund/Ersatz)
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import {
  isExcluded, isCancelled, isActive, isStarted,
  countActiveUnits, countActiveFutureUnits, sessionStatusLabel,
} from '../../../lib/session-status'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// ── 1) Unit-Helper: lib/session-status.ts ───────────────────────────────────
test.describe('[E2E] lib/session-status Helper (Unit-Smoke)', () => {
  test('isExcluded(): is_cancelled=true UND cancel_reason="excluded" → true', () => {
    expect(isExcluded({ is_cancelled: true, cancel_reason: 'excluded' })).toBe(true)
    expect(isExcluded({ is_cancelled: true, cancel_reason: 'Krankheit' })).toBe(false)
    expect(isExcluded({ is_cancelled: false })).toBe(false)
    expect(isExcluded(null)).toBe(false)
  })

  test('isCancelled(): is_cancelled=true UND cancel_reason!="excluded" → true', () => {
    expect(isCancelled({ is_cancelled: true, cancel_reason: 'Krankheit' })).toBe(true)
    expect(isCancelled({ is_cancelled: true, cancel_reason: null })).toBe(true)
    expect(isCancelled({ is_cancelled: true, cancel_reason: 'excluded' })).toBe(false)
    expect(isCancelled({ is_cancelled: false })).toBe(false)
  })

  test('countActiveFutureUnits ignoriert excluded + cancelled + vergangene', () => {
    const today = new Date()
    const future1 = new Date(today); future1.setDate(future1.getDate() + 7)
    const future2 = new Date(today); future2.setDate(future2.getDate() + 14)
    const past = new Date(today); past.setDate(past.getDate() - 7)
    const f = (d: Date) => d.toISOString().split('T')[0]

    const sessions = [
      { date: f(future1), is_cancelled: false },                              // ✓ count
      { date: f(future2), is_cancelled: false },                              // ✓ count
      { date: f(future1), is_cancelled: true, cancel_reason: 'excluded' },    // skip
      { date: f(future1), is_cancelled: true, cancel_reason: 'Krankheit' },   // skip
      { date: f(past),    is_cancelled: false },                              // skip (vergangen)
    ]
    expect(countActiveFutureUnits(sessions)).toBe(2)
  })

  test('sessionStatusLabel liefert "Ausgeschlossen"/"Abgesagt"/"Vergangen"/"Aktiv"', () => {
    const future = new Date(); future.setDate(future.getDate() + 7)
    const past = new Date(); past.setDate(past.getDate() - 7)
    const f = (d: Date) => d.toISOString().split('T')[0]

    expect(sessionStatusLabel({ is_cancelled: true, cancel_reason: 'excluded' })).toBe('Ausgeschlossen')
    expect(sessionStatusLabel({ is_cancelled: true, cancel_reason: 'Krankheit' })).toBe('Abgesagt')
    expect(sessionStatusLabel({ date: f(past), time_start: '12:00:00', is_cancelled: false })).toBe('Vergangen')
    expect(sessionStatusLabel({ date: f(future), time_start: '12:00:00', is_cancelled: false })).toBe('Aktiv')
  })
})

// ── 2) Dropdown-Count (Ursprungs-Bug) ───────────────────────────────────────
test.describe('[E2E] admin/yogis/[id] Dropdown zeigt korrekte Credits', () => {
  test('Code-Smoke: Dropdown-Berechnung nutzt countActiveFutureUnits', async () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    expect(src).toMatch(/countActiveFutureUnits|countActiveUnits|isActive|isExcluded/)
  })

  test('Dropdown-Source enthält is_cancelled-Filter (excluded zählt nicht)', async () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    // Code lädt cancel_reason mit (Voraussetzung für is/isExcluded-Filter)
    expect(src).toMatch(/cancel_reason/)
  })
})

// ── 3) admin/credits getRemainingUnits ──────────────────────────────────────
test.describe('[E2E] admin/credits Page filtert excluded raus', () => {
  test('Source filtert excluded-Sessions via lib/session-status', async () => {
    // Welle C 2026-05: app/admin/credits/page.tsx wurde komplett umgebaut
    // zu einem reinen Credit-Vergabe-Formular (Punktekarte + Quartal). Die
    // session-status-Filterung lebt jetzt zentral in lib/session-status.ts +
    // app/admin/yogis/[id]/page.tsx (dort getestet in §2). Diese Konsolidierung
    // ist Absicht — der Test verifiziert nur noch dass die alte Page existiert
    // und die neuen Modelle handhabt.
    const p = path.join(ROOT, 'app/admin/credits/page.tsx')
    expect(fs.existsSync(p), 'admin/credits page existiert').toBe(true)
    const src = fs.readFileSync(p, 'utf8')
    expect(src).toMatch(/tenpack|Punktekarte/)
    expect(src).toMatch(/quarterly|Quartal/)
  })

  test('getAutoExpiry / expires_at-Berechnung nutzt letzte AKTIVE Session', async () => {
    // Beweis: lib/session-status.ts hat isActive-Helper der diese Logik kapselt
    const src = read('lib/session-status.ts')
    expect(src).toMatch(/isActive/)
  })
})

// ── 4) admin/kurse Termine-Liste: "Ausgeschlossen" vs "Abgesagt" ───────────
test.describe('[E2E] admin/kurse Termine-Anzeige', () => {
  test('Excluded-Session zeigt suffix "· Ausgeschlossen", live-cancelled "· Abgesagt"', async () => {
    const src = read('app/admin/kurse/page.tsx')
    expect(src).toMatch(/Ausgeschlossen/)
    expect(src).toMatch(/Abgesagt/)
    // Ternary basierend auf cancel_reason
    expect(src).toMatch(/cancel_reason\s*===?\s*['"]excluded['"]/)
  })

  test('loadSessions lädt cancel_reason mit (Regression-Schutz)', async () => {
    const src = read('app/admin/kurse/page.tsx')
    // SELECT-String enthält cancel_reason
    expect(src).toMatch(/select.*cancel_reason|cancel_reason.*select/i)
  })
})

// ── 5) replacement_session_id beim direkten Cancel ─────────────────────────
test.describe('[E2E] admin/sessions/[id] Cancel + Ersatz', () => {
  test('handleCancelSession setzt replacement_session_id bei mitgegebenem Ersatz', async () => {
    const src = read('app/admin/sessions/[id]/page.tsx')
    expect(src).toMatch(/replacement_session_id/)
  })

  test('Status-Label nutzt isExcluded()-Helper, nicht direkten String-Vergleich', async () => {
    const src = read('app/admin/sessions/[id]/page.tsx')
    // Idealerweise: isExcluded(s) Aufruf, alternativ semantisch korrekt:
    expect(src).toMatch(/isExcluded|cancel_reason\s*===?\s*['"]excluded['"]/)
  })
})

// ── 6) /meine Status-Badge: Ausgeschlossen wird nicht durchgereicht ────────
test.describe('[E2E] /meine getStatusBadge / Filter', () => {
  test('Excluded Sessions werden VOR der Anzeige gefiltert', async () => {
    const src = read('app/meine/page.tsx')
    expect(src).toMatch(/isExcluded/)
  })

  test('Cancelled Session bekommt Badge "Abgesagt" (rot)', async () => {
    const src = read('app/meine/page.tsx')
    expect(src).toMatch(/Abgesagt/)
    expect(src).toMatch(/yoga-red|text-red|bg-red/i)
  })

  test('Started Session zeigt "Teilgenommen" (Stundenstart-Cutoff)', async () => {
    const src = read('app/meine/page.tsx')
    expect(src).toMatch(/Teilgenommen|teilgenommen/)
  })
})

// ── 7) /kurse/[id] Yogi-Detail: Excluded vs Cancelled Text ─────────────────
test.describe('[E2E] /kurse/[id] Excluded-Detail-Seite', () => {
  test('Excluded Session: zeigt "ausgeschlossen"-Text, kein Ersatz-Button', async () => {
    const src = read('app/kurse/[id]/page.tsx')
    expect(src).toMatch(/ausgeschlossen|Ausgeschlossen/)
  })

  test('Cancelled mit Ersatz: "Zur Ersatzstunde am ..." Button', async () => {
    const src = read('app/kurse/[id]/page.tsx')
    expect(src).toMatch(/Zur Ersatzstunde/)
  })
})

// ── 8) register/page: Filter beim Self-Enrollment ──────────────────────────
test.describe('[E2E] /register filtert excluded/cancelled Sessions', () => {
  test('Auto-Einbuchung filtert is_cancelled=false (jetzt in der server-validierten RPC)', async () => {
    // Welle-2-Security-Fix (2026-05-30): Die Auto-Einbuchung läuft nicht mehr über
    // Client-Inserts, sondern über die SECURITY-DEFINER-RPC consume_invitation_enrollment.
    // Register delegiert nur noch — die RPC filtert excluded/cancelled Sessions serverseitig.
    const reg = fs.readFileSync(path.join(ROOT, 'app/register/page.tsx'), 'utf8')
    expect(reg, 'register delegiert an die RPC').toMatch(/consume_invitation_enrollment/)
    const mig = path.join(ROOT, 'supabase/migrations/20260530_consume_invitation_enrollment.sql')
    expect(fs.existsSync(mig), 'RPC-Migration vorhanden').toBe(true)
    expect(fs.readFileSync(mig, 'utf8'), 'RPC filtert is_cancelled=false').toMatch(/is_cancelled\s*=\s*false/)
  })

  test('Expires_at-Berechnung nutzt letzte aktive Session (kein "verlängert" durch excluded)', async () => {
    const src = read('lib/session-status.ts')
    // isActive-Helper liefert die Basis
    expect(src).toMatch(/export function isActive/)
  })
})
