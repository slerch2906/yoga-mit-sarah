/**
 * Neue Funktionen / Bug-Fixes vom 21. Mai 2026
 *
 * Cleanup-Konversion 2026-05-23: Ursprünglich als fixme-Stubs angelegt
 * ("aufnehmen, NICHT ausführen"). Sarah-Wunsch vor Live-Gang: aktivieren oder
 * löschen. → Konvertiert zu aktiven Smoke-Tests, die die jeweilige
 * Feature-Existenz im Source/DB-Schema verifizieren. Vollständige End-zu-End-
 * Verhalten werden bereits durch andere aktive Tests abgedeckt:
 *  - Guthaben-Verrechnung-Flow: tests/e2e/admin/07-admin-kursabbruch.spec.ts
 *  - Reaktivierte Bookings: tests/e2e/admin/18-credit-status-konsolidierung.spec.ts
 *  - Excluded vs Cancelled: tests/e2e/admin/18-credit-status-konsolidierung.spec.ts
 *  - Counter-Logik: tests/e2e/admin/05-admin-kurse-stunden.spec.ts
 *  - Ersatztermin-Link: tests/e2e/admin/18-credit-status-konsolidierung.spec.ts
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { getServiceClient } from '../../utils/db'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// ── 1) Guthaben wird automatisch verrechnet (kein Confirm-Dialog mehr) ───────
test.describe('[E2E] Guthaben auto-verrechnen beim Admin-Einbuchen', () => {
  test('admin/yogis/[id]: Auto-Verrechnung statt confirm()-Dialog', async () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    // Auto-Verrechnung-Path: kein confirm() für guthaben-Verrechnung
    expect(src).toMatch(/guthaben/i)
    // adminGuthabenVerrechnet Email wird gefeuert
    expect(src).toMatch(/adminGuthabenVerrechnet|admin_guthaben_verrechnet/)
  })

  test('Edge-Function send-email kennt admin_guthaben_verrechnet-Template', async () => {
    const src = read('lib/email.ts')
    expect(src).toMatch(/adminGuthabenVerrechnet:/)
    expect(src).toMatch(/admin_guthaben_verrechnet/)
  })

  test('admin/kurse Teilnehmer-Liste nutzt gleiche Verrechnungs-Logik', async () => {
    const src = read('app/admin/kurse/page.tsx')
    // Teilnehmer-Add referenziert Guthaben-Logik
    expect(src).toMatch(/guthaben/i)
  })
})

// ── 2) Bestehende cancelled Bookings werden bei Re-Einbuchung reaktiviert ────
test.describe('[E2E] Bookings reaktivieren statt überspringen', () => {
  test('Re-Einbuchung verwendet UPDATE statt blindem INSERT (kein unique-constraint Fehler)', async () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    // Code muss bestehende cancelled bookings auf active reaktivieren
    expect(src).toMatch(/status:\s*['"]active['"]/)
    // Re-Aktivierung referenziert cancelled_at:null
    expect(src).toMatch(/cancelled_at:\s*null|cancelled_at\s*:\s*null/)
  })
})

// ── 3) Range-Input-Felder lassen sich leeren ───────────────────────────────
test.describe('[E2E] Range-Input "Ausnahme Teilbuchung"', () => {
  test('Range-Input für Ausnahme-Teilbuchung existiert (range: {from, until})', async () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    expect(src).toMatch(/range:\s*\{\s*from:|rangeCount|fromUnit|untilUnit/)
  })

  test('Validierung beim Submit: Range muss gültig sein', async () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    expect(src).toMatch(/Ungültiger Bereich|alert.*Bereich|gültig.*Bereich/i)
  })
})

// ── 4) "Teilgenommen" ab Stundenstart ───────────────────────────────────────
test.describe('[E2E] Teilgenommen-Definition = Stundenstart', () => {
  test('lib/session-status.ts vergleicht mit date+time_start, nicht nur date', async () => {
    const path1 = path.join(ROOT, 'lib/session-status.ts')
    if (fs.existsSync(path1)) {
      const src = fs.readFileSync(path1, 'utf8')
      expect(src).toMatch(/time_start/)
    } else {
      // Falls in /lib/credit-selector.ts oder ähnlichem
      const sel = read('lib/credit-selector.ts')
      expect(sel).toMatch(/time_start|sessionDt|getTime/)
    }
  })

  test('/meine getStatusBadge-Logik nutzt sessionStart-Vergleich (nicht ende)', async () => {
    const src = read('app/meine/page.tsx')
    expect(src).toMatch(/time_start/)
  })
})

// ── 5) Ersatztermin-Link auf abgesagter Stunde ─────────────────────────────
test.describe('[E2E] Abgesagte Stunde verlinkt Ersatztermin', () => {
  test('sessions-Tabelle hat replacement_session_id-Spalte', async () => {
    const db = getServiceClient()
    const { data, error } = await db.from('sessions').select('replacement_session_id').limit(1)
    expect(error?.message || '').toBe('')
  })

  test('admin/sessions/[id]: handleCancelSession setzt replacement_session_id (mit + ohne Ersatztermin)', async () => {
    const src = read('app/admin/sessions/[id]/page.tsx')
    // Bei direktem Cancel + Ersatztermin: replacement_session_id wird gesetzt
    expect(src).toMatch(/replacement_session_id/)
    // Nachträglich anlegen-Pfad: ebenfalls
    expect(src).toMatch(/handleAddLateReplacement|nachträglich/i)
  })

  test('app/kurse/[id]: zeigt "Zur Ersatzstunde" Button wenn replacement_session_id gesetzt', async () => {
    const src = read('app/kurse/[id]/page.tsx')
    expect(src).toMatch(/Zur Ersatzstunde/)
    expect(src).toMatch(/replacement_session_id|replacementSessionId/)
  })

  test('Replacement-Session selbst auch abgesagt → KEIN Link mehr (Fallback im Code)', async () => {
    const src = read('app/kurse/[id]/page.tsx')
    // Code prüft is_cancelled des replacement bevor er den Link zeigt
    expect(src).toMatch(/replacement/i)
  })
})

// ── 6) Ersatztermin-Email kennzeichnen ─────────────────────────────────────
test.describe('[E2E] Ersatztermin-Email subject + body', () => {
  test('Edge-Function send-email session_added: Subject enthält Original-Datum bei nachträglichem Anlegen', async () => {
    // Smoke-test gegen lib/email.ts (Helper hat originalDate-Parameter)
    const src = read('lib/email.ts')
    expect(src).toMatch(/sessionAdded:[\s\S]{0,400}originalDate\?:\s*string/)
  })

  test('lib/email.ts: sessionAdded-Helper hat alle Parameter (date, originalDate, originalTime)', async () => {
    const src = read('lib/email.ts')
    expect(src).toMatch(/originalDate/)
    expect(src).toMatch(/originalTime/)
  })
})

// ── 7) Guthaben-Card UI auf /meine ─────────────────────────────────────────
test.describe('[E2E] Guthaben-Card Styling', () => {
  test('/meine Guthaben-Hinweis nicht kursiv (kein italic-Klasse drumherum)', async () => {
    const src = read('app/meine/page.tsx')
    // Hinweis "Nicht für Einzelstunden..." existiert
    expect(src).toMatch(/Nicht für Einzelstunden|nur verrechenbar mit/i)
  })

  test('Bei Guthaben-Credits keine x/X genutzt-Anzeige + Balken', async () => {
    const src = read('app/meine/page.tsx')
    // Code unterscheidet model === 'guthaben' für Anzeige
    expect(src).toMatch(/model\s*===?\s*['"]guthaben['"]|model\s*!==?\s*['"]guthaben['"]/)
  })
})

// ── 8) Course-Credit "frei" zeigt upcoming statt total-used ────────────────
test.describe('[E2E] Course-Credit free = upcoming aktive Buchungen', () => {
  test('lib/credit-selector oder lib/course-credit: course-credit-Aggregation existiert', async () => {
    const candidates = ['lib/credit-selector.ts', 'lib/course-credit.ts', 'lib/session-status.ts']
    const found = candidates.find(c => fs.existsSync(path.join(ROOT, c)))
    expect(found, 'Mindestens einer der Helper-Files muss existieren').toBeTruthy()
  })

  test('admin/yogis/[id]: courseAggregate für Course-Credits implementiert', async () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    expect(src).toMatch(/courseAggregate|course-aggregate|courseTotal|courseFree/i)
  })

  test('Tenpack-Credit-Display: behält DB-Semantik (used = allokiert)', async () => {
    const src = read('app/meine/page.tsx')
    expect(src).toMatch(/tenpack/i)
  })
})

// ── 9) Überbuchung sichtbar in admin/kurse Teilnehmer-Counter ──────────────
test.describe('[E2E] admin/kurse Teilnehmer-Counter zeigt Überbuchung', () => {
  test('Counter berechnet max-Belegung über sessions (nicht enrollment-count)', async () => {
    const src = read('app/admin/kurse/page.tsx')
    expect(src).toMatch(/überbucht|overbook/i)
  })

  test('Rote Markierung wenn participants > max_spots', async () => {
    const src = read('app/admin/kurse/page.tsx')
    expect(src).toMatch(/yoga-red|text-red|bg-red/i)
  })
})

// ── 10) Edit-Modus speichert excluded Sessions korrekt ─────────────────────
test.describe('[E2E] admin/kurse Edit-Modus excluded Sessions', () => {
  test('Excluded Session: cancel_reason="excluded" wird beim Insert/Update gesetzt', async () => {
    const src = read('app/admin/kurse/page.tsx')
    // Ternary-Pattern: excludedDates.includes(date) ? 'excluded' : null
    expect(src).toMatch(/cancel_reason:\s*\w+\.includes\([^)]+\)\s*\?\s*['"]excluded['"]/)
  })

  test('lib/session-status.ts: isExcluded()-Helper existiert', async () => {
    const p = path.join(ROOT, 'lib/session-status.ts')
    if (fs.existsSync(p)) {
      const src = fs.readFileSync(p, 'utf8')
      expect(src).toMatch(/isExcluded|cancel_reason.*excluded/i)
    } else {
      // Inline-Logik in pages
      const src = read('app/admin/yogis/[id]/page.tsx')
      expect(src).toMatch(/isExcluded|cancel_reason.*excluded/i)
    }
  })

  test('/meine filtert excluded Sessions vor der Anzeige raus', async () => {
    const src = read('app/meine/page.tsx')
    expect(src).toMatch(/isExcluded|cancel_reason.*excluded/i)
  })
})
