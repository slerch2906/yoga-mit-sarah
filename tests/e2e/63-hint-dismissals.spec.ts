/**
 * Sarah 2026-06-02: Alle wegklickbaren Admin-/Yogi-Hinweise nutzen EINEN
 * zentralen, DB-persistenten Mechanismus (lib/hint-dismissals.ts ->
 * Tabelle user_dismissals). Vorher merkten sich mehrere Banner das Wegklicken
 * nur in localStorage -> kamen nach Logout (localStorage.clear) oder auf anderem
 * Geraet wieder. Diese Source-Checks verhindern den Rueckfall.
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

test.describe('Hinweise: zentrale DB-Persistenz fuer Wegklicken', () => {
  test('zentraler Hook existiert und schreibt in user_dismissals', () => {
    const src = read('lib/hint-dismissals.ts')
    expect(src).toMatch(/export function useHintDismissals/)
    expect(src).toMatch(/from\('user_dismissals'\)/)
    expect(src).toMatch(/\.upsert\(\s*\{\s*user_id/)
  })

  test('Credit-Ablauf-Banner nutzt den Hook (kein localStorage-only mehr)', () => {
    const src = read('components/YogiCreditExpiryBanner.tsx')
    expect(src).toMatch(/useHintDismissals/)
    // alter localStorage-only Mechanismus ist raus
    expect(src).not.toMatch(/yogi-credit-expiry-dismissed/)
  })

  test('Admin-Geburtstags-Banner nutzt den Hook', () => {
    const src = read('components/AdminBirthdayBanner.tsx')
    expect(src).toMatch(/useHintDismissals/)
    expect(src).toMatch(/birthday:\$\{weekMondayStr\(\)\}/)
  })

  test('Neu-Yogi-Hinweis (/kurse) nutzt den Hook', () => {
    const src = read('app/kurse/page.tsx')
    expect(src).toMatch(/useHintDismissals/)
    expect(src).toMatch(/isDismissed\('new_yogi'\)/)
  })
})
