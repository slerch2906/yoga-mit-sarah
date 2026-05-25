/**
 * Workflow #2 (Sarah-Welle 2026-05-25): 14-Tage-Stornofrist + 30€ Gebuehr 13-7d.
 *
 * Diese Stornofrist betrifft Kursruecktritt (komplette Abmeldung vor Kursbeginn),
 * NICHT die 3h-Frist fuer einzelne Einzelstunden (siehe 13-spaet-abmeldung.spec.ts).
 *
 * Source-Smoke:
 *  - scripts/generate-agb.js (PDF-Generator) hat 3 Stufen
 *  - app/rechtliches/page.tsx (Click-Wrap) zeigt die Stufen
 *  - send-email-snapshot.txt (yogi_enrolled_by_admin) erwaehnt 30 € + 14 Tage
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

test.describe('[E2E] 14-Tage-Stornofrist (Kursruecktritt) — AGB-Generator', () => {
  test('generate-agb.js: 14 Tage kostenfrei', async () => {
    const src = read('scripts/generate-agb.js')
    expect(src).toMatch(/kostenfreie Stornierung.*14 Tage vor Kursbeginn/i)
  })

  test('generate-agb.js: 13-7 Tage = 30 € Bearbeitungsgebuehr', async () => {
    const src = read('scripts/generate-agb.js')
    expect(src).toMatch(/zwischen 13 und 7 Tagen.*30\s*€|13.*7.*30 €/i)
    expect(src).toMatch(/Bearbeitungsgebühr/i)
  })

  test('generate-agb.js: ab <7 Tage = volle Kursgebuehr', async () => {
    const src = read('scripts/generate-agb.js')
    // "Ab Tag 6" oder "weniger als 7 Tag" — volle Gebuehr
    expect(src).toMatch(/(weniger als 7 Tag|ab 6 Tag|ab Tag 6).*(voll|gesamt)/i)
  })

  test('Stand-Hinweis "Mai 2026" oder neuere Version im Generator', async () => {
    const src = read('scripts/generate-agb.js')
    // Generator-Header dokumentiert die Welle
    expect(src).toMatch(/Stand:|Mai 2026/i)
    expect(src).toMatch(/14 Tag/i)
  })
})

test.describe('[E2E] 14-Tage-Stornofrist — UI-Hinweise (Click-Wrap)', () => {
  test('app/rechtliches/page.tsx zeigt alle 3 Stufen', async () => {
    const src = read('app/rechtliches/page.tsx')
    expect(src).toMatch(/14 Tage.*kostenfrei/i)
    expect(src).toMatch(/13.+7 Tage.*30/i)
    expect(src).toMatch(/Ab 6 Tagen.*voll/i)
  })

  test('Rücktritt-Sektion erwaehnt Ersatzteilnehmer-Option (auch innerhalb der Frist)', async () => {
    const src = read('app/rechtliches/page.tsx')
    expect(src).toMatch(/Ersatzteilnehmer/i)
    expect(src).toMatch(/innerhalb der Stornofrist/i)
  })
})

test.describe('[E2E] 14-Tage-Stornofrist — Email-Templates', () => {
  // Edge-Function-Snapshot ist v61 (tests/fixtures/send-email-snapshot.txt).
  test('yogi_enrolled_by_admin-Mail: "Rücktritt vom gesamten Kurs" mit 14d/30€-Hinweis', async () => {
    const snap = read('tests/fixtures/send-email-snapshot.txt')
    expect(snap).toMatch(/Rücktritt vom gesamten Kurs/)
    expect(snap).toMatch(/14 Tage vor Kursbeginn/)
    expect(snap).toMatch(/30 €/)
    expect(snap).toMatch(/Ersatzteilnehmer jederzeit/)
  })
})
