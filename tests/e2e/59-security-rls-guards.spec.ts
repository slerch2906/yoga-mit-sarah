/**
 * Security-Regression (Sarah 2026-05-30, Pre-Go-Live-Audit).
 *
 * Diese Tests gehen NICHT über die UI, sondern direkt über die öffentliche
 * Supabase-API mit einem echten Yogi-Token — also exakt so, wie ein technisch
 * versierter Angreifer es täte. Sie verifizieren, dass die serverseitigen
 * Schutzschichten (RLS-Policies, Spalten-Grants, Trigger) greifen, unabhängig
 * vom clientseitigen Admin-Guard in app/admin/layout.tsx.
 */
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

function svc() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
function anonClient() {
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(process.env.SUPABASE_URL!, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
async function signInYogi1() {
  const c = anonClient()
  const { data, error } = await c.auth.signInWithPassword({
    email: process.env.TEST_YOGI1_EMAIL!, password: process.env.TEST_YOGI1_PASSWORD!,
  })
  if (error || !data.user) throw new Error('Yogi1-Login fehlgeschlagen: ' + error?.message)
  return { client: c, userId: data.user.id }
}

test.describe('[E2E] Security: serverseitige Rechte-Guards', () => {
  // Kein storageState — wir authentifizieren uns selbst per Token.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('[E2E] Yogi kann sich NICHT selbst is_admin=true setzen (Privilege-Escalation)', async () => {
    const { client, userId } = await signInYogi1()
    try {
      // Angriff: eigene Profilzeile auf is_admin=true setzen
      const { error: updErr } = await client.from('profiles')
        .update({ is_admin: true }).eq('id', userId).select()
      // Erwartung: wird abgelehnt (Spalten-Grant entzogen UND Schutz-Trigger).
      expect(updErr, 'is_admin-Update muss serverseitig abgelehnt werden').toBeTruthy()

      // Harte Sicherung: is_admin ist serverseitig weiterhin NICHT true.
      const { data: prof } = await svc().from('profiles').select('is_admin').eq('id', userId).maybeSingle()
      expect(prof?.is_admin === true, 'Yogi darf nach dem Angriff KEIN Admin sein').toBe(false)
    } finally {
      // Sicherheitshalber zurücksetzen (sollte nie nötig sein) + ausloggen.
      await svc().from('profiles').update({ is_admin: false }).eq('id', userId).eq('is_admin', true)
      await client.auth.signOut()
    }
  })
})
