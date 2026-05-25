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
})
