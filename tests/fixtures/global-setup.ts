/**
 * Global Setup – läuft einmalig VOR allen Tests.
 *
 * Was passiert hier:
 * 1. Test-Nutzer anlegen (Admin, Yogi1, Yogi2)
 * 2. Browser-Sessions speichern (eingeloggt)
 * 3. Alten E2E-Testdaten bereinigen
 */
import { chromium, FullConfig } from '@playwright/test'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import { ensureTestUser, cleanupAllE2EData } from '../utils/seed'

dotenv.config({ path: '.env.test' })

const AUTH_DIR = path.join(__dirname, '../.auth')

// ════════════════════════════════════════════════════════════════════════════
// PROD-SCHUTZSPERRE (Sarah 2026-05-31, Pre-Go-Live)
// Die E2E-Suite legt Test-Nutzer an UND löscht Daten (cleanupAllE2EData).
// Das darf NIEMALS gegen die Produktiv-Umgebung laufen. Diese Sperre bricht den
// Lauf hart ab, sobald Ziel-App ODER Test-DB auf Prod zeigen — egal was in
// .env.test steht. Nur mit explizitem Notnagel ALLOW_PROD_E2E überstimmbar.
// ════════════════════════════════════════════════════════════════════════════
const PROD_DB_REF = 'jcczvyablgdijeiyymhc'       // Produktiv-Supabase-Projekt
const PROD_APP_DOMAIN = 'kurse.yogamitsarah.me'  // Produktiv-App-Domain

function assertNotProduction(baseURL: string): void {
  const supaUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const hitsProdDb = supaUrl.includes(PROD_DB_REF)
  const hitsProdApp = (baseURL || '').includes(PROD_APP_DOMAIN)
  const override = process.env.ALLOW_PROD_E2E === 'JA-ICH-WEISS-WAS-ICH-TUE'
  if ((hitsProdDb || hitsProdApp) && !override) {
    throw new Error(
      '\n\n⛔ ABBRUCH — E2E-Tests zeigen auf die PRODUKTIV-Umgebung!\n' +
      (hitsProdApp ? `   • Ziel-App: ${PROD_APP_DOMAIN}\n` : '') +
      (hitsProdDb ? `   • Test-DB:  Produktiv-Projekt ${PROD_DB_REF}\n` : '') +
      '   Tests legen Test-Nutzer an und löschen Daten — das ist gegen Prod verboten.\n' +
      '   → Bitte .env.test auf die STAGING-Umgebung zeigen lassen.\n\n'
    )
  }
}

export { assertNotProduction }

async function saveAuthState(
  baseURL: string,
  email: string,
  password: string,
  outFile: string
) {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`${baseURL}/login`)
  await page.waitForLoadState('networkidle')

  await page.getByPlaceholder(/e-mail|email/i).fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /anmelden|einloggen|login/i }).click()

  // Warten bis Weiterleitung erfolgt (prüft PATH, nicht Domain!)
  await page.waitForURL(url => new URL(url).pathname !== '/login', { timeout: 15_000 })
  await page.waitForLoadState('networkidle')

  await context.storageState({ path: outFile })
  await browser.close()
  console.log(`  ✓ Auth-State gespeichert: ${path.basename(outFile)}`)
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  // Harte Prod-Schutzsperre — MUSS als allererstes laufen (vor jeder DB-Operation).
  assertNotProduction(baseURL)

  console.log('\n🚀 E2E Test-Setup startet...')
  console.log(`   Ziel-URL: ${baseURL}`)

  // .auth-Verzeichnis anlegen
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true })

  // Test-Nutzer anlegen — MUSS vor dem Cleanup laufen!
  // cleanupAllE2EData() meldet sich als Test-Admin an. Existiert der Admin nicht
  // (z.B. nach einem DB-Reset, der nur den echten Account behält), bricht der
  // Cleanup sonst mit "Invalid login credentials" ab und das Setup schlägt fehl,
  // BEVOR die Nutzer überhaupt angelegt werden. Reihenfolge 2026-05-29 getauscht
  // (Test-Tag): erst anlegen → dann bereinigen → dann Browser-Sessions speichern.
  console.log('\n👥 Test-Nutzer anlegen...')

  const adminEmail = process.env.TEST_ADMIN_EMAIL!
  const adminPass  = process.env.TEST_ADMIN_PASSWORD!
  const yogi1Email = process.env.TEST_YOGI1_EMAIL!
  const yogi1Pass  = process.env.TEST_YOGI1_PASSWORD!
  const yogi2Email = process.env.TEST_YOGI2_EMAIL!
  const yogi2Pass  = process.env.TEST_YOGI2_PASSWORD!

  await ensureTestUser(adminEmail, adminPass, true)
  console.log(`  ✓ Admin: ${adminEmail}`)

  await ensureTestUser(yogi1Email, yogi1Pass, false)
  console.log(`  ✓ Yogi1: ${yogi1Email}`)

  await ensureTestUser(yogi2Email, yogi2Pass, false)
  console.log(`  ✓ Yogi2: ${yogi2Email}`)

  // Alte Testdaten bereinigen (jetzt kann sich der Admin sicher anmelden)
  console.log('\n🧹 Alte Testdaten bereinigen...')
  await cleanupAllE2EData()

  // Browser-Sessions (eingeloggte Zustände) speichern
  console.log('\n🔐 Browser-Sessions einloggen und speichern...')

  await saveAuthState(baseURL, adminEmail, adminPass, path.join(AUTH_DIR, 'admin.json'))
  await saveAuthState(baseURL, yogi1Email, yogi1Pass, path.join(AUTH_DIR, 'yogi1.json'))
  await saveAuthState(baseURL, yogi2Email, yogi2Pass, path.join(AUTH_DIR, 'yogi2.json'))

  console.log('\n✅ Setup abgeschlossen – Tests starten...\n')
}
