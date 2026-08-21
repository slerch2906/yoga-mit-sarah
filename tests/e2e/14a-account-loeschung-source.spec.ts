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

  // ── Aktualisiert 2026-08-21 ──────────────────────────────────────────────
  // Die DSGVO-Mails und die Admin-Benachrichtigung liefen frueher clientseitig
  // in app/profil bzw. app/admin/yogis/[id]. Seit dem Umbau vom 2026-06-01
  // laufen sie SERVER-SEITIG in /api/delete-account (Service-Rolle, RLS-immun,
  // einheitlich fuer Selbst- und Admin-Loeschung). Die Tests pruefen deshalb
  // jetzt die Route — die Schutzabsicht ("die Mails duerfen nie verlorengehen")
  // bleibt unveraendert. Gegenrichtung (Client darf es NICHT mehr tun) prueft
  // tests/e2e/61-dsgvo-loeschung-admin-mail.spec.ts.
  test('Admin-Notification "account_deleted_dsgvo" wird erstellt (server-seitig)', async () => {
    const src = read('app/api/delete-account/route.ts')
    expect(src).toMatch(/account_deleted_dsgvo/)
  })

  // Sarah-Befund 2026-05-25: direkter fetch zur Edge Function ohne x-function-secret
  // hat zu 401-Fehler gefuehrt — Admin-Email kam nie an. Loesung: zentraler Email-Helper.
  // Diese Tests verhindern Rueckfall in das direkte-fetch-Pattern.
  test('Loeschung nutzt zentralen Email-Helper (kein direkter fetch send-email)', async () => {
    const route = read('app/api/delete-account/route.ts')
    expect(route).toMatch(/Email\.adminDsgvoDeletion/)
    // Kein direkter fetch auf send-email (waere ohne x-function-secret und wuerde 401)
    expect(route).not.toMatch(/fetch\([^)]*\/functions\/v1\/send-email/)
    for (const p of ['app/profil/page.tsx', 'app/admin/yogis/[id]/page.tsx']) {
      expect(read(p), `${p} darf send-email nicht direkt aufrufen`)
        .not.toMatch(/fetch\([^)]*\/functions\/v1\/send-email/)
    }
  })

  // Yogi-Bestaetigungs-Email VOR dem finalen Auth-Delete (DSGVO Art. 12 — danach
  // ist die Adresse weg). Gilt fuer BEIDE Loeschwege, weil beide dieselbe Route nutzen.
  test('Yogi bekommt Bestaetigungs-Email vor dem Auth-Delete', async () => {
    const src = read('app/api/delete-account/route.ts')
    expect(src).toMatch(/Email\.accountDeletedYogi/)
    const mailIdx = src.indexOf('Email.accountDeletedYogi')
    const deleteIdx = src.indexOf('auth/v1/admin/users')
    expect(mailIdx, 'accountDeletedYogi gefunden').toBeGreaterThan(-1)
    expect(deleteIdx, 'Auth-Delete gefunden').toBeGreaterThan(-1)
    expect(mailIdx < deleteIdx,
      'Bestaetigungsmail MUSS vor dem Auth-Delete raus — danach ist die Adresse geloescht').toBe(true)
  })

  test('lib/email.ts hat neue Helper adminDsgvoDeletion + accountDeletedYogi', async () => {
    const src = read('lib/email.ts')
    expect(src).toMatch(/adminDsgvoDeletion:/)
    expect(src).toMatch(/accountDeletedYogi:/)
    expect(src).toMatch(/admin_dsgvo_deletion/)
    expect(src).toMatch(/account_deleted_yogi/)
  })

  // Hinweis 2026-08-21: Die frueheren zwei Tests "accountDeletedYogi VOR
  // /api/delete-account" (je einer fuer Profil- und Admin-Pfad) sind entfallen.
  // Seit die Mail in der Route selbst verschickt wird, ist die Reihenfolge dort
  // festgelegt und wird oben in einem Test fuer beide Wege geprueft.

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
  // Fix 2026-08-21: Vorher wurde die ERSTE Fundstelle von '/api/delete-account'
  // genommen — das ist inzwischen ein erklaerender Kommentar, nicht der Aufruf.
  // Dadurch schlug die Bearer-Pruefung fehl, obwohl der Token korrekt gesendet
  // wird. Jetzt wird gezielt der fetch-Aufruf gesucht.
  function deleteAccountCallBlock(src: string): string {
    const idx = src.search(/fetch\(\s*['"`]\/api\/delete-account['"`]/)
    expect(idx, 'fetch-Aufruf auf /api/delete-account gefunden').toBeGreaterThan(-1)
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
