/**
 * Range-Einbuchung: zeitlich begrenzte Teilnahme korrekt anzeigen (Sarah 2026-06-01)
 *
 * Bug: Ein Yogi wurde fuer einen begrenzten Zeitraum eingebucht (Range-Einbuchung,
 * z.B. nur 1. + 8. Juni). Auf der Admin-Yogi-Detailseite:
 *  (a) Die Pille sagte "Eingestiegen ab 1. Juni" — der zeitlich begrenzte Charakter
 *      ("Teilnahme nur vom … bis …") war nicht erkennbar.
 *  (b) Stunden NACH seinem Zeitraum zeigten faelschlich "Ausgetragen" — obwohl er
 *      dafuer nie angemeldet war. Ursache: Reste einer frueheren Voll-Einbuchung
 *      (stornierte Buchungen OHNE credit_id), die durch die Range-Einbuchung ersetzt
 *      wurde. Sie sollen "—" zeigen (wie die Stunden VOR dem Einstieg).
 *
 * Fix: reine ANZEIGE-Logik in app/admin/yogis/[id]/page.tsx:
 *  - Teilnahme-Zeitraum aus den ECHTEN (credit-verknuepften / aktiven) Buchungen.
 *  - Pille zeigt bei begrenzter Teilnahme "Teilnahme nur vom … bis …".
 *  - Stunden ausserhalb des Zeitraums zeigen "—" statt "Ausgetragen".
 * Greift nur bei echter Begrenzung (isLimitedRange) — fuer Voll-/Mid-Course-Yogis
 * bleibt die Anzeige unveraendert. Keine Buchungs-/Credit-Logik beruehrt.
 *
 * Hier Source-Checks als Regressions-Schutz (staging-sicher, kein Prod-Eingriff).
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const SRC = 'app/admin/yogis/[id]/page.tsx'

test.describe('Admin-Yogi-Detail: zeitlich begrenzte Teilnahme (Range)', () => {
  test('Teilnahme-Zeitraum kommt aus credit-verknuepften / aktiven Buchungen (Reste ohne credit_id zaehlen NICHT)', () => {
    const src = read(SRC)
    // genuineDates filtert auf credit_id ODER aktive Buchung
    expect(src, 'genuineDates definiert').toMatch(/const genuineDates\s*=/)
    expect(src, 'Filter credit_id || active').toMatch(/\.filter\(\(b: any\) => b\.credit_id \|\| b\.status === 'active'\)/)
    // partStart / partEnd aus den echten Buchungen
    expect(src, 'partStartStr definiert').toMatch(/const partStartStr\s*=/)
    expect(src, 'partEndStr definiert').toMatch(/const partEndStr\s*=/)
  })

  test('isLimitedRange = letzte Teilnahme-Stunde liegt VOR der letzten Kursstunde', () => {
    const src = read(SRC)
    expect(src, 'lastCourseDateStr definiert').toMatch(/const lastCourseDateStr\s*=/)
    expect(src, 'isLimitedRange vergleicht partEnd < lastCourseDate').toMatch(
      /const isLimitedRange = !!\(partEndStr && lastCourseDateStr && partEndStr < lastCourseDateStr\)/
    )
  })

  test('Pille zeigt bei begrenzter Teilnahme "Teilnahme nur vom … bis …", sonst "Eingestiegen ab"', () => {
    const src = read(SRC)
    expect(src, 'Range-Text vorhanden').toMatch(/Teilnahme nur vom/)
    expect(src, 'Mid-Course-Text weiterhin vorhanden').toMatch(/Eingestiegen ab/)
    // Pille wird gezeigt wenn Mid-Course ODER begrenzt
    expect(src, 'showRangePill steuert die Pille').toMatch(/const showRangePill = isMidCourse \|\| isLimitedRange/)
    expect(src, 'Pille an showRangePill gebunden').toMatch(/\{showRangePill && partStartStr && \(/)
  })

  test('Stunden AUSSERHALB des Zeitraums zeigen "—" (sessInRange-Zweig VOR dem Buchungs-Status)', () => {
    const src = read(SRC)
    // sessInRange-Berechnung
    expect(src, 'sessInRange definiert').toMatch(/const sessInRange = !isLimitedRange/)
    expect(src, 'sessInRange prueft Datumsgrenzen').toMatch(
      /\(!partStartStr \|\| s\.date >= partStartStr\) && \(!partEndStr \|\| s\.date <= partEndStr\)/
    )
    // Der "—"-Zweig fuer ausserhalb-Stunden steht VOR dem active/cancelled-Zweig.
    const idxOutOfRange = src.indexOf('} else if (!sessInRange) {')
    const idxActive = src.indexOf("} else if (myBooking?.status === 'active') {")
    expect(idxOutOfRange, 'Out-of-Range-Zweig existiert').toBeGreaterThan(-1)
    expect(idxActive, 'active-Zweig existiert').toBeGreaterThan(-1)
    expect(idxOutOfRange, 'Out-of-Range wird VOR dem Buchungs-Status geprueft').toBeLessThan(idxActive)
  })

  test('In-Range-Stunden behalten ihren echten Status (cancelledActorLabel bleibt erhalten)', () => {
    const src = read(SRC)
    // Der echte Storno-Status (Ausgetragen/Abgemeldet) wird weiterhin verwendet —
    // nur eben NUR fuer Stunden innerhalb des Zeitraums (nach dem sessInRange-Gate).
    expect(src, 'cancelledActorLabel weiterhin genutzt').toMatch(/cancelledActorLabel\(myBooking\)/)
  })
})
