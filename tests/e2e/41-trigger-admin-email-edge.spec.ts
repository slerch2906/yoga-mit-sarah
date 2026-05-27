/**
 * Workflow #7 (Sarah-Welle 2026-05-25): trigger-admin-email Edge Function v5.
 *
 * Diese interne Edge Function wird via pg_cron / pg_net aufgerufen und
 * triggert send-email mit hardcoded ANON_KEY + EDGE_FUNCTION_SECRET.
 *
 * v5-Sicherheit:
 *  - Whitelist von Types (ALLOWED_TYPES Set in der Function)
 *  - x-trigger-secret Header-Check (TRIGGER_ADMIN_EMAIL_SECRET oder EDGE_FUNCTION_SECRET)
 *  - Hardcoded ANON_KEY (public, kein Geheimnis)
 *  - verify_jwt:false (intern erreichbar)
 *
 * Live-Tests gegen die deployte Function.
 */
import { test, expect } from '@playwright/test'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

const FN_URL = 'https://jcczvyablgdijeiyymhc.supabase.co/functions/v1/trigger-admin-email'
// Welle S1 (Sarah 2026-05-27): Secret aus .env.test lesen (nach Rotation).
// Falls EDGE_FUNCTION_SECRET nicht gesetzt → tests (c)+(d) werden geskippt
// statt fehlzuschlagen — Local-Dev ohne Secret bleibt nutzbar.
const SECRET = process.env.EDGE_FUNCTION_SECRET || ''

test.describe('[E2E] trigger-admin-email Edge Function — Live', () => {
  test('(a) Ohne x-trigger-secret Header → 401 Unauthorized', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'admin_guthaben_2y_expiry', data: {} }),
    })
    expect(res.status, 'Ohne Secret muss 401 zurueckkommen').toBe(401)
  })

  test('(b) Falscher x-trigger-secret → 401 Unauthorized', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-trigger-secret': 'wrong-secret-' + Date.now(),
      },
      body: JSON.stringify({ type: 'admin_guthaben_2y_expiry', data: {} }),
    })
    expect(res.status, 'Falsches Secret muss 401 zurueckkommen').toBe(401)
  })

  test('(c) Gueltiges Secret + nicht-whitelisteter Type → 403 (Type not allowed)', async () => {
    test.skip(!SECRET, 'EDGE_FUNCTION_SECRET nicht in .env.test gesetzt — Live-Test uebersprungen')
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-trigger-secret': SECRET,
      },
      body: JSON.stringify({ type: 'welcome', data: { email: 'noop@example.com', firstName: 'E2E' } }),
    })
    // Whitelist blockt: erwarten 4xx (403 oder 400). 'welcome' ist KEIN admin-type.
    expect([400, 403], 'Non-whitelisted type muss 4xx liefern').toContain(res.status)
    const body = await res.json().catch(() => ({}))
    expect(JSON.stringify(body)).toMatch(/not allowed|forbidden|whitelist/i)
  })

  test('(d) Gueltiges Secret + whitelisteter Type → 200 (oder 500 wenn send-email scheitert)', async () => {
    test.skip(!SECRET, 'EDGE_FUNCTION_SECRET nicht in .env.test gesetzt — Live-Test uebersprungen')
    // admin_guthaben_2y_expiry ist whitelisted (siehe trigger-admin-email v5
    // ALLOWED_TYPES). Daten sind minimal/dummy — wenn send-email die Mail
    // an Mail@yogamitsarah.me schickt, ist das ok (geht eh nur an Admin).
    // Wir akzeptieren 200 (Mail-Versand ok) oder 500 (Brevo-Quota voll o.ae.).
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-trigger-secret': SECRET,
      },
      body: JSON.stringify({
        type: 'admin_guthaben_2y_expiry',
        data: {
          yogiName: '[E2E] Test-Yogi (NICHT REAL — Test-Mail bitte ignorieren)',
          yogiEmail: 'e2e-test-do-not-deliver@example.invalid',
          unusedCredits: 3,
          originalCourseName: '[E2E] Test-Kurs',
          creditCreatedAt: new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      }),
    })
    // 200 oder 500 — beide bedeuten Whitelist+Secret haben funktioniert.
    // Wichtig: NICHT 401/403 (das waeren Secret/Whitelist-Fehler).
    expect([200, 500], `Got status ${res.status} — erwartet 200 (ok) oder 500 (send-email-Fehler)`).toContain(res.status)
    const body = await res.json().catch(() => ({}))
    // Response-Format-Check
    expect(typeof body.ok, 'Response muss .ok-Property haben').toBe('boolean')
  })

  test('OPTIONS → 200 (CORS-Preflight)', async () => {
    const res = await fetch(FN_URL, { method: 'OPTIONS' })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-headers') || '').toMatch(/x-trigger-secret/i)
  })
})
