/**
 * Global Teardown – läuft einmalig NACH allen Tests.
 * Bereinigt alle Testdaten aus der Datenbank.
 */
import * as dotenv from 'dotenv'
import { cleanupAllE2EData } from '../utils/seed'

dotenv.config({ path: '.env.test' })

export default async function globalTeardown() {
  console.log('\n🧹 E2E Teardown: Testdaten werden bereinigt...')
  await cleanupAllE2EData()
  console.log('✅ Teardown abgeschlossen\n')
}
