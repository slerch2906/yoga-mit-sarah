/**
 * Dummy-Account löschen — einfache Hart-Löschung (Sarah 2026-06-01)
 *
 * Dummies sind reine Platzhalter (kein echter Personenbezug). Sie sollen OHNE die
 * DSGVO-Anonymisierung + Mail-Versand + "Auth konnte nicht entfernt werden"-Warnung
 * löschbar sein: Daten weg + Profil hart löschen (Trigger entfernt den Auth-Login).
 * Echte Yogis laufen weiterhin über den vollen DSGVO-Pfad.
 *
 * Auf Staging end-to-end verifiziert (Admin löscht Dummy → Profil + Auth-Login weg,
 * Platz frei). Hier Source-Checks als Regressions-Schutz.
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

test.describe('Dummy-Account: einfache Hart-Löschung', () => {
  test('handleDeleteYogi hat einen Dummy-Zweig der das Profil hart löscht (kein DSGVO-Ballast)', () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    // Eigener Zweig für Dummies …
    expect(src, 'Dummy-Zweig vorhanden').toMatch(/if \(yogi\?\.is_dummy\)/)
    // … der das Profil HART löscht (Trigger entfernt den Auth-Login) …
    expect(src, 'Profil wird hart gelöscht').toMatch(/from\('profiles'\)\.delete\(\)\.eq\('id', id\)/)
    // … und gibt danach zurück (fällt NICHT in den DSGVO-Pfad).
    const dummyBlock = src.slice(src.indexOf('if (yogi?.is_dummy)'), src.indexOf('if (yogi?.is_dummy)') + 1200)
    expect(dummyBlock, 'Dummy-Zweig endet mit return').toMatch(/router\.push\('\/admin\/yogis'\)\s*\n\s*return/)
    // Im Dummy-Zweig KEIN Aufruf der DSGVO-Route / keine Anonymisierung.
    expect(dummyBlock, 'kein delete-account-Aufruf im Dummy-Zweig').not.toMatch(/\/api\/delete-account/)
    expect(dummyBlock, 'keine Anonymisierung im Dummy-Zweig').not.toMatch(/Gelöschter/)
  })

  test('Button-Label ist bei Dummies "Dummy löschen"', () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    expect(src).toMatch(/yogi\?\.is_dummy \? 'Dummy löschen'/)
  })
})
