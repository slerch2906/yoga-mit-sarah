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
import { getAdminClient, getServiceClient } from '../utils/db'
import { createTestCourse, E2E_PREFIX } from '../utils/seed'

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

  // ── Fix #2 Lockdown-Guards (grün NACH Anwendung der credits/enrollments-Lockdown-Migration) ──
  test('[E2E] Yogi kann sich NICHT selbst Credits gutschreiben', async () => {
    const { client, userId } = await signInYogi1()
    try {
      const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)
      const { error } = await client.from('credits').insert({
        user_id: userId, total: 99, used: 0, model: 'single', expires_at: exp.toISOString(),
      }).select()
      expect(error, 'Self-Insert von Credits muss serverseitig abgelehnt werden').toBeTruthy()
      const { data: planted } = await svc().from('credits').select('id')
        .eq('user_id', userId).eq('total', 99).eq('model', 'single')
      expect((planted || []).length, 'kein selbst-gegrantetes Credit angelegt').toBe(0)
    } finally {
      await svc().from('credits').delete().eq('user_id', userId).eq('total', 99).eq('model', 'single')
      await client.auth.signOut()
    }
  })

  test('[E2E] Yogi kann sich NICHT selbst in einen Kurs einschreiben', async () => {
    const course = await createTestCourse({ name: `${E2E_PREFIX} Self-Enroll-Block`, sessionCount: 1, startDaysFromNow: 7 })
    const { client, userId } = await signInYogi1()
    try {
      const { error } = await client.from('enrollments')
        .insert({ user_id: userId, course_id: course.courseId }).select()
      expect(error, 'Self-Enroll muss serverseitig abgelehnt werden').toBeTruthy()
      const { data: planted } = await svc().from('enrollments').select('id')
        .eq('user_id', userId).eq('course_id', course.courseId)
      expect((planted || []).length, 'keine selbst-angelegte Einschreibung').toBe(0)
    } finally {
      await svc().from('enrollments').delete().eq('user_id', userId).eq('course_id', course.courseId)
      await client.auth.signOut()
    }
  })
})

test.describe('[E2E] Security: Einladungs-Einbuchung läuft über server-validierte RPC', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('[E2E] consume_invitation_enrollment legt Enrollment + Credit(total=N) + N Buchungen an', async () => {
    const db = await getAdminClient()
    const service = getServiceClient()
    const email = `e2e.rpc.${Date.now()}@test.yogamitsarah.me`
    const pass = 'TestRpc!2026'
    const { data: created, error: cErr } = await service.auth.admin.createUser({ email, password: pass, email_confirm: true })
    if (cErr || !created.user) throw new Error('createUser: ' + cErr?.message)
    const uid = created.user.id
    await db.from('profiles').upsert({ id: uid, first_name: 'E2E', last_name: 'Rpc', email, is_admin: false }, { onConflict: 'id' })
    const course = await createTestCourse({ name: `${E2E_PREFIX} RPC-Enroll`, sessionCount: 4, startDaysFromNow: 7 })
    const token = `e2e-rpc-${Date.now()}`
    await db.from('invitations').insert({
      token, email, first_name: 'E2E', last_name: 'Rpc',
      course_id: course.courseId, credits_to_assign: 4, used: false,
      expires_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    })
    const yogi = anonClient()
    try {
      const { error: sErr } = await yogi.auth.signInWithPassword({ email, password: pass })
      expect(sErr).toBeNull()
      const { data: res, error: rpcErr } = await yogi.rpc('consume_invitation_enrollment', { p_token: token })
      expect(rpcErr).toBeNull()
      expect((res as any)?.enrolled, 'RPC meldet enrolled').toBe(true)
      expect((res as any)?.bookings, '4 Buchungen').toBe(4)
      expect((res as any)?.credits_total, 'credit total = 4').toBe(4)
      // DB-Wahrheit
      const { data: enr } = await db.from('enrollments').select('id').eq('user_id', uid).eq('course_id', course.courseId)
      expect((enr || []).length).toBe(1)
      const { data: crd } = await db.from('credits').select('total, model').eq('user_id', uid).eq('course_id', course.courseId).maybeSingle()
      expect(crd?.total).toBe(4); expect(crd?.model).toBe('course')
      const { data: bks } = await db.from('bookings').select('status').eq('user_id', uid).in('session_id', course.sessionIds)
      expect((bks || []).filter((b: any) => b.status === 'active').length).toBe(4)
      // Idempotenz: zweiter Aufruf bucht nicht doppelt
      const { data: res2 } = await yogi.rpc('consume_invitation_enrollment', { p_token: token })
      expect((res2 as any)?.already).toBe(true)
    } finally {
      await yogi.auth.signOut()
      await db.from('bookings').delete().eq('user_id', uid)
      await db.from('credits').delete().eq('user_id', uid)
      await db.from('enrollments').delete().eq('user_id', uid)
      await db.from('invitations').delete().eq('token', token)
      await db.from('profiles').delete().eq('id', uid)
      try { await service.auth.admin.deleteUser(uid) } catch {}
    }
  })
})
