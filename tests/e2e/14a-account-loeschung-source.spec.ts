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

  // ── Sarah-Welle 2026-05-25 (Workflow #6): Reihenfolge accountDeletedYogi VOR Auth-Delete ──
  test('Profil-Pfad: accountDeletedYogi() wird VOR delete-account-Call ausgefuehrt', async () => {
    const src = read('app/profil/page.tsx')
    // Reihenfolge: Email.accountDeletedYogi(...) ... /api/delete-account
    const re = /Email\.accountDeletedYogi[\s\S]+\/api\/delete-account/
    expect(re.test(src), 'accountDeletedYogi MUSS vor /api/delete-account aufgerufen werden — sonst keine Email mehr nach Auth-Delete').toBe(true)
  })

  test('Admin-Yogi-Loesch-Pfad: accountDeletedYogi() wird VOR delete-account-Call ausgefuehrt', async () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    const re = /Email\.accountDeletedYogi[\s\S]+\/api\/delete-account/
    expect(re.test(src), 'accountDeletedYogi MUSS vor /api/delete-account aufgerufen werden — sonst keine Email mehr nach Auth-Delete').toBe(true)
  })

  test('/api/delete-account ruft auth/v1/admin/users/<id> DELETE auf (server-side Auth-Delete)', async () => {
    const src = read('app/api/delete-account/route.ts')
    expect(src).toMatch(/auth\/v1\/admin\/users/)
    expect(src).toMatch(/method:\s*['"]DELETE['"]/)
    expect(src).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  // ── Sarah-Bug 2026-05-31: Die Route verlangt seit Welle S1/H1 einen Bearer-Token.
  //    Der Admin-Loeschpfad schickte ihn NICHT → 401 → Auth-User + E-Mail blieben
  //    bestehen (Adresse nicht mehr registrierbar), Fehler wurde verschluckt.
  //    BEIDE Pfade MUESSEN den Token senden; der Admin-Pfad MUSS Fehlschlag melden. ──
  function deleteAccountCallBlock(src: string): string {
    const idx = src.indexOf('/api/delete-account')
    expect(idx, '/api/delete-account-Aufruf gefunden').toBeGreaterThan(-1)
    return src.slice(idx, idx + 320)
  }

  test('Profil-Pfad sendet Authorization-Bearer an /api/delete-account', async () => {
    const block = deleteAccountCallBlock(read('app/profil/page.tsx'))
    expect(block, 'Profil-Pfad muss Bearer-Token senden').toMatch(/Authorization[\s\S]*Bearer/)
  })

  test('Admin-Yogi-Pfad sendet Authorization-Bearer an /api/delete-account (Regress 2026-05-31)', async () => {
    const block = deleteAccountCallBlock(read('app/admin/yogis/[id]/page.tsx'))
    expect(block, 'Admin-Pfad muss Bearer-Token senden — sonst 401 und E-Mail bleibt belegt').toMatch(/Authorization[\s\S]*Bearer/)
  })

  test('Admin-Yogi-Pfad meldet fehlgeschlagenen Auth-Delete (kein stilles "erfolgreich")', async () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    expect(src, 'Ergebnis des Auth-Delete wird ausgewertet').toMatch(/authDeleted/)
    expect(src, 'Admin wird bei Fehlschlag gewarnt').toMatch(/!authDeleted/)
  })
})
