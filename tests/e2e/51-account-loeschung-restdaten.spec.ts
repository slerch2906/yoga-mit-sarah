/**
 * FINDING E1 (Deep-QA Phase 1, Sarah 2026-05-29): Die DSGVO-Löschung räumt NICHT
 * alle Yogi-Rest-Daten. Konkret fehlt das Löschen von `course_cancellation_responses`
 * (FK: course_cancellation_responses.user_id → profiles.id = NO ACTION).
 *
 * Hat ein Yogi je einen Kursabbruch-Wahl-Token bekommen (eine Zeile in
 * course_cancellation_responses), blockiert diese Zeile beim Auth-Delete die
 * Cascade-Löschung der profiles-Zeile (profiles.id → auth.users.id = CASCADE).
 * Folge: /api/delete-account liefert 502, der Browser ignoriert das und leitet
 * zu /login → der Auth-User BLEIBT bestehen, obwohl die Bestätigungs-Mail dem
 * Yogi "Account gelöscht" zusichert. Nur eine admin_notifications-Notiz
 * ('auth_delete_failed') verrät den Fehlschlag.
 *
 * Betroffene Pfade (beide räumen course_cancellation_responses NICHT):
 *   - Selbstlöschung:      app/profil/page.tsx        (handleDeleteAccount)
 *   - Admin-Yogi-Löschung: app/admin/yogis/[id]/page.tsx (handleDeleteYogi)
 *
 * Hinweis: deleteCourse() räumt course_cancellation_responses bereits — aber NUR
 * per course_id (admin/kurse/page.tsx:1294), nicht per user_id. Die User-Löschung
 * deckt den Token also nicht ab.
 *
 * Stil: [E2E-Text] Struktur-Guards (kein Browser, lesen den Quelltext).
 *   - "Regressions-Schutz": die bereits geräumten Tabellen dürfen NICHT verschwinden.
 *   - Finding E1 (GEFIXT 2026-05-29): der course_cancellation_responses-Cleanup ist
 *     in BEIDEN Lösch-Pfaden ergänzt (app/profil + app/admin/yogis/[id]). Die zwei
 *     Struktur-Guards sind daher jetzt AKTIV (kein test.fixme mehr).
 *   - Der End-to-End-DB-Test ist seit dem Test-Tag (2026-05-29) ebenfalls AKTIV: er
 *     beweist die FK-Mechanik direkt an der echten DB — eine c_c_r-Zeile blockiert
 *     den Auth-Delete, das Räumen der Zeile entsperrt ihn. Wegwerf-Yogi mit
 *     email_confirm:true ⇒ KEINE Mail; finally-Block räumt alles wieder ab.
 */
import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { getServiceClient } from '../utils/db'
import { E2E_EMAIL_PREFIX } from '../utils/seed'

dotenv.config({ path: '.env.test' })

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const SRC_PROFIL = () => read('app/profil/page.tsx')
const SRC_YOGI_DETAIL = () => read('app/admin/yogis/[id]/page.tsx')

test.describe('[E2E-Text] Finding E1 — Account-Löschung räumt Rest-Daten', () => {
  test('Selbstlöschung räumt bookings/credits/notification_log/waitlist_offers (Regressions-Schutz)', () => {
    const src = SRC_PROFIL()
    expect(src).toMatch(/from\('bookings'\)\.delete\(\)\.eq\('user_id', user\.id\)/)
    expect(src).toMatch(/from\('credits'\)\.delete\(\)\.eq\('user_id', user\.id\)/)
    expect(src).toMatch(/from\('notification_log'\)\.delete\(\)\.eq\('user_id', user\.id\)/)
    expect(src).toMatch(/from\('waitlist_offers'\)\.delete\(\)\.eq\('user_id', user\.id\)/)
  })

  test('Admin-Yogi-Löschung räumt bookings/enrollments/credits/waitlist/notification_log (Regressions-Schutz)', () => {
    const src = SRC_YOGI_DETAIL()
    expect(src).toMatch(/from\('bookings'\)\.delete\(\)\.eq\('user_id', id\)/)
    expect(src).toMatch(/from\('enrollments'\)\.delete\(\)\.eq\('user_id', id\)/)
    expect(src).toMatch(/from\('credits'\)\.delete\(\)\.eq\('user_id', id\)/)
    expect(src).toMatch(/from\('waitlist'\)\.delete\(\)\.eq\('user_id', id\)/)
    expect(src).toMatch(/from\('notification_log'\)\.delete\(\)\.eq\('user_id', id\)/)
  })

  // ── Finding E1 (GEFIXT 2026-05-29) — jetzt aktive Regressions-Guards ─────────
  test('E1: Selbstlöschung räumt course_cancellation_responses (user_id)', () => {
    const src = SRC_PROFIL()
    expect(src).toMatch(/from\('course_cancellation_responses'\)\.delete\(\)\.eq\('user_id', user\.id\)/)
  })

  test('E1: Admin-Yogi-Löschung räumt course_cancellation_responses (user_id)', () => {
    const src = SRC_YOGI_DETAIL()
    expect(src).toMatch(/from\('course_cancellation_responses'\)\.delete\(\)\.eq\('user_id', id\)/)
  })

  test('E1 (E2E-DB): course_cancellation_responses-Zeile blockiert Auth-Delete — Cleanup entsperrt ihn', async () => {
    const svc = getServiceClient()
    const email = `${E2E_EMAIL_PREFIX}del.${Date.now()}@yogamitsarah.me`
    let uid = ''
    try {
      // ── Setup: Wegwerf-Yogi (email_confirm:true ⇒ KEINE Mail) ─────────────────
      const created = await svc.auth.admin.createUser({ email, email_confirm: true })
      expect(created.error, 'createUser ohne Fehler').toBeFalsy()
      uid = created.data.user!.id
      expect(uid, 'Wegwerf-Yogi hat eine id').toBeTruthy()

      // handle_new_user()-Trigger legt das profiles-Row automatisch an. Die
      // c_c_r→profiles-FK braucht es, also kurz verifizieren.
      const { data: prof } = await svc.from('profiles').select('id').eq('id', uid).maybeSingle()
      expect(prof?.id, 'profiles-Zeile via Trigger angelegt').toBe(uid)

      // 1 course_cancellation_responses-Zeile (token + expires_at sind Pflicht).
      const { error: ccrErr } = await svc.from('course_cancellation_responses').insert({
        user_id: uid,
        course_id: null,
        token: `e2e-del-${Date.now()}`,
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      })
      expect(ccrErr, 'c_c_r-Zeile angelegt').toBeFalsy()

      // ── Negativ-Kontrolle: Auth-Delete MUSS scheitern, solange die Zeile da ist ──
      // profiles→auth.users = CASCADE, aber c_c_r→profiles = NO ACTION blockiert die
      // Cascade → genau die Mechanik aus Finding E1.
      const blocked = await svc.auth.admin.deleteUser(uid)
      expect(blocked.error, 'Auth-Delete ist durch die c_c_r-FK blockiert').toBeTruthy()
      const stillThere = await svc.auth.admin.getUserById(uid)
      expect(stillThere.data?.user?.id, 'Yogi existiert nach blockiertem Delete noch').toBe(uid)

      // ── Fix-Pfad: c_c_r per user_id räumen ⇒ Auth-Delete läuft durch ───────────
      const { error: delCcrErr } = await svc
        .from('course_cancellation_responses').delete().eq('user_id', uid)
      expect(delCcrErr, 'c_c_r per user_id geräumt').toBeFalsy()

      const ok = await svc.auth.admin.deleteUser(uid)
      expect(ok.error, 'Auth-Delete nach Cleanup ohne Fehler').toBeFalsy()
      const gone = await svc.auth.admin.getUserById(uid)
      expect(gone.data?.user, 'Yogi ist nach Cleanup wirklich gelöscht').toBeFalsy()
      uid = '' // sauber gelöscht → finally muss nichts mehr tun
    } finally {
      // Sicherheitsnetz: c_c_r + Auth-User best-effort entfernen, falls oben etwas warf.
      if (uid) {
        await svc.from('course_cancellation_responses').delete().eq('user_id', uid)
        await svc.auth.admin.deleteUser(uid).catch(() => {})
      }
    }
  })
})
