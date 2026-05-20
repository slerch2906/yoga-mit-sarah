#!/usr/bin/env ts-node
/**
 * Einmaliges Setup der Test-Nutzer.
 * Ausführen mit: npm run test:setup
 *
 * Was passiert:
 * 1. Test-Admin anlegen
 * 2. Test-Yogi1 anlegen
 * 3. Test-Yogi2 anlegen
 */
import * as dotenv from 'dotenv'
import { ensureTestUser } from '../tests/utils/seed'

dotenv.config({ path: '.env.test' })

async function main() {
  const required = [
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'TEST_ADMIN_EMAIL', 'TEST_ADMIN_PASSWORD',
    'TEST_YOGI1_EMAIL', 'TEST_YOGI1_PASSWORD',
    'TEST_YOGI2_EMAIL', 'TEST_YOGI2_PASSWORD',
  ]

  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error('❌ Fehlende Umgebungsvariablen in .env.test:')
    missing.forEach(k => console.error(`   ${k}`))
    console.error('\nBitte .env.test.example kopieren und ausfüllen.')
    process.exit(1)
  }

  console.log('🚀 Test-Nutzer Setup startet...\n')

  try {
    const adminId = await ensureTestUser(
      process.env.TEST_ADMIN_EMAIL!,
      process.env.TEST_ADMIN_PASSWORD!,
      true
    )
    console.log(`✅ Admin:  ${process.env.TEST_ADMIN_EMAIL} (${adminId})`)

    const yogi1Id = await ensureTestUser(
      process.env.TEST_YOGI1_EMAIL!,
      process.env.TEST_YOGI1_PASSWORD!,
      false
    )
    console.log(`✅ Yogi1:  ${process.env.TEST_YOGI1_EMAIL} (${yogi1Id})`)

    const yogi2Id = await ensureTestUser(
      process.env.TEST_YOGI2_EMAIL!,
      process.env.TEST_YOGI2_PASSWORD!,
      false
    )
    console.log(`✅ Yogi2:  ${process.env.TEST_YOGI2_EMAIL} (${yogi2Id})`)

    console.log('\n✅ Setup erfolgreich! Du kannst jetzt mit npm run test:e2e testen.\n')
  } catch (err: any) {
    console.error('\n❌ Setup fehlgeschlagen:', err.message)
    process.exit(1)
  }
}

main()
