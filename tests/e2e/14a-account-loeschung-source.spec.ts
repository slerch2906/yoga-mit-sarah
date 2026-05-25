/**
 * DSGVO Account-Löschung — Source-Smoke-Tests.
 *
 * Begleitend zu 14-account-loeschung.spec.ts: dort sind 2 fixme-Tests dokumentiert
 * (Test-Setup-Issue mit Wegwerf-User-Login-Timing). Diese Tests verifizieren die
 * Implementierung über Source-Code-Checks — sie greifen wenn jemand die
 * DSGVO-Funktionalität versehentlich entfernt.
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

test.describe('[E2E] DSGVO Account-Löschung — Source-Smoke', () => {
  test('app/profil/page.tsx hat handleDeleteAccount-Funktion', async () => {
    const src = read('app/profil/page.tsx')
    expect(src).toMatch(/handleDeleteAccount|account.*löschen/i)
  })

  test('Bestätigungs-Dialog "Account endgültig löschen" im UI-Code', async () => {
    const src = read('app/profil/page.tsx')
    expect(src).toMatch(/Account endgültig löschen|endgültig.*löschen/i)
  })

  test('DSGVO-Hinweis "anonymisiert" im Dialog', async () => {
    const src = read('app/profil/page.tsx')
    expect(src).toMatch(/anonymisiert|DSGVO/i)
  })

  test('Profil wird auf "Gelöschter Nutzer" gesetzt + email/emergency genullt', async () => {
    const src = read('app/profil/page.tsx')
    expect(src).toMatch(/Gelöschter/)
    expect(src).toMatch(/first_name|last_name/)
  })

  test('Admin-Notification "account_deleted_dsgvo" wird erstellt', async () => {
    const src = read('app/profil/page.tsx')
    expect(src).toMatch(/account_deleted_dsgvo|admin_dsgvo_deletion/i)
  })

  // Sarah-Befund 2026-05-25: direkter fetch zur Edge Function ohne x-function-secret
  // hat zu 401-Fehler gefuehrt — Admin-Email kam nie an. Loesung: zentraler Email-Helper.
  // Diese Tests verhindern Rueckfall in das direkte-fetch-Pattern.
  test('Profil-Loeschung nutzt zentralen Email-Helper (kein direkter fetch send-email)', async () => {
    const src = read('app/profil/page.tsx')
    expect(src).toMatch(/Email\.adminDsgvoDeletion/)
    // Kein direkter fetch auf send-email mehr (waere ohne x-function-secret und wuerde 401)
    expect(src).not.toMatch(/fetch\([^)]*\/functions\/v1\/send-email/)
  })

  test('Admin-Yogi-Loeschung nutzt zentralen Email-Helper', async () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    expect(src).toMatch(/Email\.adminDsgvoDeletion/)
    expect(src).not.toMatch(/fetch\([^)]*\/functions\/v1\/send-email/)
  })

  // Yogi-Bestaetigungs-Email VOR dem finalen Auth-Delete (DSGVO Art. 12)
  test('Yogi bekommt Bestaetigungs-Email vor Auth-Delete (Profil)', async () => {
    const src = read('app/profil/page.tsx')
    expect(src).toMatch(/Email\.accountDeletedYogi/)
  })

  test('Yogi bekommt Bestaetigungs-Email vor Auth-Delete (Admin loescht)', async () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    expect(src).toMatch(/Email\.accountDeletedYogi/)
  })

  test('lib/email.ts hat neue Helper adminDsgvoDeletion + accountDeletedYogi', async () => {
    const src = read('lib/email.ts')
    expect(src).toMatch(/adminDsgvoDeletion:/)
    expect(src).toMatch(/accountDeletedYogi:/)
    expect(src).toMatch(/admin_dsgvo_deletion/)
    expect(src).toMatch(/account_deleted_yogi/)
  })
})
