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

  console.log('\n🚀 E2E Test-Setup startet...')
  console.log(`   Ziel-URL: ${baseURL}`)

  // .auth-Verzeichnis anlegen
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true })

  // Alte Testdaten bereinigen
  console.log('\n🧹 Alte Testdaten bereinigen...')
  await cleanupAllE2EData()

  // Test-Nutzer anlegen
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

  // Browser-Sessions (eingeloggte Zustände) speichern
  console.log('\n🔐 Browser-Sessions einloggen und speichern...')

  await saveAuthState(baseURL, adminEmail, adminPass, path.join(AUTH_DIR, 'admin.json'))
  await saveAuthState(baseURL, yogi1Email, yogi1Pass, path.join(AUTH_DIR, 'yogi1.json'))
  await saveAuthState(baseURL, yogi2Email, yogi2Pass, path.join(AUTH_DIR, 'yogi2.json'))

  console.log('\n✅ Setup abgeschlossen – Tests starten...\n')
}
