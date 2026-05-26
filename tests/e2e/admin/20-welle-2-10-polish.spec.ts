/**
 * Welle 2.10 Polish (Sarah 2026-05-26)
 *
 * Source-Code-Smoke-Tests für die vier Polish-Punkte:
 *  - Punkt 2: "Beendete Stunden & Events"-Sektion auf /admin/kurse
 *  - Punkt 3: Cancel-Modal entfernt Ersatztermin-Option bei Events/Einzelstunden
 *  - Punkt 4: Yogi-zu-Event Credit-Safety (event_free/event_paid → KEIN Credit-Abzug)
 *  - Punkt 6: BottomNav-Label "Kalender" statt "Kurse" für Yogi
 *
 * Keine UI-Klick-Tests — Source-Verifikation reicht für Smoke. Vollständige
 * E2E-Buchungsverhalten sind durch 02-booking.spec.ts + 25-vorhol-nachhol.spec.ts
 * abgedeckt; hier nur Welle-2.10-spezifische Regeln.
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// ── Punkt 2: Beendete Stunden & Events-Sektion ───────────────────────────────
test.describe('[E2E] Punkt 2 — Beendete Stunden & Events Sektion', () => {
  test('admin/kurse trennt geplante (date >= heute) und beendete (date < heute) Container-Sessions', () => {
    const src = read('app/admin/kurse/page.tsx')
    // Filter auf "Geplante Stunden & Events" ist date >= heute
    expect(src).toMatch(/Geplante Stunden & Events/)
    // Eigene Sektion "Beendete Stunden & Events" existiert
    expect(src).toMatch(/Beendete Stunden & Events/)
    // Filter date < heute für ended-Sessions
    expect(src).toMatch(/s\.date < today/)
  })

  test('Sektion "Beendete Stunden & Events" wird nur gerendert wenn >0 Einträge (kein leerer Header)', () => {
    const src = read('app/admin/kurse/page.tsx')
    // Pattern: `if (endedSessions.length === 0) return null`
    expect(src).toMatch(/endedSessions\.length === 0[\s\S]*?return null/)
  })
})

// ── Punkt 3: Cancel-Modal Replacement-Option entfernen ───────────────────────
test.describe('[E2E] Punkt 3 — Cancel-Modal ohne Ersatztermin bei Events', () => {
  test('Ersatztermin-Bereich ist conditional auf session_type === course_session', () => {
    const src = read('app/admin/sessions/[id]/page.tsx')
    // Conditional Render: nur course_session zeigt "Ersatztermin anbieten"-Checkbox
    expect(src).toMatch(/session\?\.session_type === 'course_session' \? \(/)
    // hasReplacement wird beim Submit für nicht-course_session ignoriert
    expect(src).toMatch(/isCourseSession[\s\S]*?hasReplacement/)
  })

  test('Bei event_free/event_paid: Hinweistext statt Ersatztermin-Option', () => {
    const src = read('app/admin/sessions/[id]/page.tsx')
    // event_paid Text
    expect(src).toMatch(/Bezahlung wird – wenn schon geleistet – manuell mit Sarah geklärt/)
    // event_free Text
    expect(src).toMatch(/Kein Credit verbraucht – nichts zurückzubuchen/)
  })
})

// ── Punkt 4: Credit-Safety bei Yogi-zu-Event ─────────────────────────────────
test.describe('[E2E] Punkt 4 — Credit-Safety bei event_free/event_paid', () => {
  test('handleAddYogi: event_free/event_paid → credit_id=null, KEIN selectCreditForBooking', () => {
    const src = read('app/admin/sessions/[id]/page.tsx')
    // Branch für event_free + event_paid existiert
    expect(src).toMatch(/isFreeEvent = sessionType === 'event_free'/)
    expect(src).toMatch(/isPaidEvent = sessionType === 'event_paid'/)
    expect(src).toMatch(/skipCreditLogic = isFreeEvent \|\| isPaidEvent/)
    // Audit-Log Eintrag für Event-Buchung mit credit_used:false
    expect(src).toMatch(/admin_added_yogi_to_event/)
    expect(src).toMatch(/credit_used: false/)
  })

  test('addWaitlistYogi: gleiche Credit-Safety für Warteliste-Promote bei Events', () => {
    const src = read('app/admin/sessions/[id]/page.tsx')
    // event_free/event_paid Pfad in addWaitlistYogi
    expect(src).toMatch(/evType === 'event_free' \|\| evType === 'event_paid'/)
  })

  test('addYogiToSession (dashboard): gleiche Credit-Safety auch im Quick-Buchen-Pfad', () => {
    const src = read('app/admin/dashboard/page.tsx')
    expect(src).toMatch(/evType === 'event_free' \|\| evType === 'event_paid'/)
    expect(src).toMatch(/credit_id: null, type: 'single'/)
  })

  test('Email-Versand bei Event-Buchung enthält Preis-Hinweis für event_paid', () => {
    const src = read('app/admin/sessions/[id]/page.tsx')
    // courseName-Marker mit Preis + Bezahl-Hinweis
    expect(src).toMatch(/bitte bar mitbringen oder vorab überweisen/)
    // Kostenlos-Marker für event_free
    expect(src).toMatch(/\(kostenlos\)/)
  })
})

// ── Punkt 6: BottomNav-Label ─────────────────────────────────────────────────
test.describe('[E2E] Punkt 6 — BottomNav Yogi-Tab "Kalender" statt "Kurse"', () => {
  test('yogiNav Label ist "Kalender", URL bleibt /kurse', () => {
    const src = read('components/layout/BottomNav.tsx')
    // Label umbenannt
    expect(src).toMatch(/label: 'Kalender'/)
    // URL unverändert
    expect(src).toMatch(/href: '\/kurse'/)
    // adminNav bleibt "Kurse" (separate Liste)
    expect(src).toMatch(/href: '\/admin\/kurse',[^}]*label: 'Kurse'/)
  })
})
