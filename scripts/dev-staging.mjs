// ============================================================================
// Startet den Next.js-Dev-Server gegen die STAGING-DB (Test-Umgebung).
// Liest die Staging-Verbindung aus .env.test und erzwingt sie für die App,
// damit der lokale Server NICHT die Prod-Variablen aus .env.local benutzt.
//
//   npm run dev:staging      → App auf http://localhost:3000 gegen Staging
//   (danach in 2. Terminal):  npx playwright test   → E2E gegen Staging
//
// Eingebaute Sicherheitssperre: bricht ab, falls .env.test auf Prod zeigt.
// ============================================================================
import { spawn } from 'node:child_process'
import * as dotenv from 'dotenv'

const env = dotenv.config({ path: '.env.test' }).parsed || {}
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || ''
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || ''

const PROD_REF = 'jcczvyablgdijeiyymhc'
if (!url || !anon) {
  console.error('⛔ .env.test hat keine Supabase-URL/anon-Key. Abbruch.')
  process.exit(1)
}
if (url.includes(PROD_REF)) {
  console.error('⛔ .env.test zeigt auf PRODUKTION — dev:staging verweigert den Start.')
  console.error('   Bitte .env.test auf die Staging-Umgebung zeigen lassen.')
  process.exit(1)
}

process.env.NEXT_PUBLIC_SUPABASE_URL = url
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon

console.log('▶ Dev-Server gegen STAGING:', url)
console.log('  (Prod bleibt unberührt — das ist die Test-DB.)\n')

const child = spawn('npx', ['next', 'dev'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
})
child.on('exit', (code) => process.exit(code ?? 0))
