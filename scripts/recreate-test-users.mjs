// Welle 6: Test-User nach DB-Wipe per Auth-Admin-API anlegen (saubere Methode)
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.test' })

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const users = [
  { email: process.env.TEST_ADMIN_EMAIL, password: process.env.TEST_ADMIN_PASSWORD, firstName: 'Test', lastName: 'Admin', isAdmin: true },
  { email: process.env.TEST_YOGI1_EMAIL, password: process.env.TEST_YOGI1_PASSWORD, firstName: 'Test', lastName: 'Yogi1', isAdmin: false },
  { email: process.env.TEST_YOGI2_EMAIL, password: process.env.TEST_YOGI2_PASSWORD, firstName: 'Test', lastName: 'Yogi2', isAdmin: false },
]

// Erst alte (eventuell kaputte) Records cleanen
console.log('Cleanup: lösche eventuell kaputte Test-User…')
for (const u of users) {
  const { data: existing } = await sb.from('profiles').select('id').eq('email', u.email).maybeSingle()
  if (existing?.id) {
    try { await sb.auth.admin.deleteUser(existing.id) } catch {}
    try { await sb.from('profiles').delete().eq('id', existing.id) } catch {}
  }
}

console.log('Anlegen via Auth-Admin-API…')
for (const u of users) {
  const { data, error } = await sb.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
    user_metadata: { first_name: u.firstName, last_name: u.lastName },
  })
  if (error) { console.error(`FAIL ${u.email}:`, error.message); continue }
  const uid = data.user.id
  // Profile setzen / updaten
  await sb.from('profiles').upsert({
    id: uid,
    first_name: u.firstName,
    last_name: u.lastName,
    email: u.email,
    is_admin: u.isAdmin,
    legal_accepted_at: new Date().toISOString(),
    legal_version: '2.0',
  }, { onConflict: 'id' })
  // legal_acceptances
  try {
    await sb.from('legal_acceptances').insert({
      user_id: uid,
      version: '2.0',
      accepted_at: new Date().toISOString(),
    })
  } catch {}
  console.log(`OK ${u.email} (${uid})`)
}

console.log('Fertig.')
