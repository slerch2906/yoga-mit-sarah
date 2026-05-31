/**
 * Stornofrist Kursrücktritt (Sarah-Welle 2026-05-31):
 *   kostenfrei bis 14 Tage vor Kursbeginn → danach "gebucht ist gebucht"
 *   (volle Kursgebühr). Die frühere 30-€-Zwischenstufe (13–7 Tage) ENTFÄLLT.
 *   Zusätzlich: Dankes-Satz "…Wertschätzung für meine Planung ❤️" bei den
 *   Storno-Fristen (Kurs 14 Tage + Event 7 Tage).
 *
 * Betrifft den Kursrücktritt (komplette Abmeldung VOR Kursbeginn), NICHT die
 * 3h-Frist für einzelne Stunden (siehe 13-spaet-abmeldung.spec.ts).
 *
 * Source-Smoke: scripts/generate-agb.js, app/rechtliches/page.tsx,
 *               tests/fixtures/send-email-snapshot.txt (yogi_enrolled_by_admin).
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const DANKE = 'Danke für Dein Verständnis und deine Wertschätzung für meine Planung'
const countOf = (s: string, needle: string) => s.split(needle).length - 1

test.describe('[E2E] Stornofrist Kursrücktritt — AGB-Generator', () => {
  test('14 Tage kostenfrei', () => {
    expect(read('scripts/generate-agb.js')).toMatch(/kostenfreie Stornierung ist bis 14 Tage vor Kursbeginn/i)
  })

  test('danach: gebucht ist gebucht → volle Kursgebühr', () => {
    expect(read('scripts/generate-agb.js')).toMatch(/gebucht ist gebucht.*Kursgebühr/i)
  })

  test('alte 30-€-Zwischenstufe ist ENTFERNT', () => {
    const src = read('scripts/generate-agb.js')
    expect(src).not.toMatch(/Bearbeitungsgebühr von 30/i)
    expect(src).not.toMatch(/zwischen 13 und 7 Tagen/i)
    expect(src).not.toMatch(/Ab Tag 6 fällt die volle/i)
  })

  test('Dankes-Satz bei Kurs- UND Event-Storno (mind. 2x)', () => {
    expect(countOf(read('scripts/generate-agb.js'), DANKE)).toBeGreaterThanOrEqual(2)
  })

  test('Stand-Hinweis "Juni 2026" + 14 Tage im Generator-Header', () => {
    const src = read('scripts/generate-agb.js')
    expect(src).toMatch(/Stand: Juni 2026/i)
    expect(src).toMatch(/14 Tag/i)
  })
})

test.describe('[E2E] Stornofrist Kursrücktritt — UI (Click-Wrap)', () => {
  test('rechtliches: 14 Tage kostenfrei + gebucht ist gebucht, KEIN 30 €', () => {
    const src = read('app/rechtliches/page.tsx')
    expect(src).toMatch(/14 Tage.*kostenfrei/i)
    expect(src).toMatch(/gebucht ist gebucht/i)
    expect(src).not.toMatch(/Bearbeitungsgebühr/i)
    expect(src).not.toMatch(/13–7 Tage/i)
  })

  test('Ersatzteilnehmer-Option vorhanden', () => {
    expect(read('app/rechtliches/page.tsx')).toMatch(/Ersatzteilnehmer/i)
  })

  test('Dankes-Satz auf rechtliches (Kurs + Event, mind. 2x)', () => {
    expect(countOf(read('app/rechtliches/page.tsx'), DANKE)).toBeGreaterThanOrEqual(2)
  })
})

test.describe('[E2E] Stornofrist Kursrücktritt — Email-Templates', () => {
  // Snapshot wird nach jedem Edge-Function-Deploy neu gezogen (tests/fixtures/README.md).
  test('yogi_enrolled_by_admin-Mail: 14 Tage + gebucht ist gebucht, KEIN 30 €', () => {
    const snap = read('tests/fixtures/send-email-snapshot.txt')
    expect(snap).toMatch(/Rücktritt vom gesamten Kurs/)
    expect(snap).toMatch(/14 Tage vor Kursbeginn/)
    expect(snap).toMatch(/gebucht ist gebucht/)
    expect(snap).toMatch(/Ersatzteilnehmer jederzeit/)
    expect(snap).not.toMatch(/30 €/)
  })

  test('Dankes-Satz in den Storno-Mails', () => {
    expect(read('tests/fixtures/send-email-snapshot.txt')).toContain(DANKE)
  })
})
