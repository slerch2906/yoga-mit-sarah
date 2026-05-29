/**
 * SCHUTZ-TEST (Sarah 2026-05-29): Gebündelte Audit-Fixes Fall 2–5.
 *
 * Dieser Test verankert die 5 mit Sarah abgestimmten Fixes auf Quelltext-Ebene
 * (strukturell, wie die übrigen [E2E-Text]-Specs). Schlägt einer fehl, wurde ein
 * abgestimmter Fix unbeauftragt rückgängig gemacht — dann mit Sarah abstimmen.
 *
 *   Fall 2  cancelCourse schützt Guthaben (model='guthaben') beim Kursabbruch —
 *           gleiches Detach-Then-Delete-Muster wie deleteCourse.
 *   Fall 3  Warteliste-Protokoll: waitlist_joined (Client), waitlist_promoted +
 *           waitlist_auto_removed (RPCs), Protokoll-/Yogi-Historie-Mapping.
 *   Fall 4  DSGVO-Selbstlöschung räumt ALLE Yogi-Ressourcen explizit (nicht nur
 *           Cascade); delete-account-Route meldet Auth-Fehler ehrlich + Admin-Notify.
 *   Fall 5  Absage-Frist (3h/7d/90min) Berlin-verankert + Hinweistext.
 */
import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const SRC_ADMIN_KURSE = () => read('app/admin/kurse/page.tsx')
const SRC_SESSION = () => read('app/kurse/[id]/page.tsx')
const SRC_PROFIL = () => read('app/profil/page.tsx')
const SRC_DELETE_ROUTE = () => read('app/api/delete-account/route.ts')
const SRC_SESSION_TIME = () => read('lib/session-time.ts')
const SRC_PROTOKOLL = () => read('app/admin/protokoll/page.tsx')
const SRC_YOGI_DETAIL = () => read('app/admin/yogis/[id]/page.tsx')
const SRC_MIGRATION = () => read('supabase/migrations/20260529_waitlist_audit_log.sql')

test.describe('[E2E-Text] Fall 2 — cancelCourse Guthaben-Schutz', () => {
  test('cancelCourse entkoppelt Guthaben (course_id=null) und löscht nur model<>guthaben', () => {
    const src = SRC_ADMIN_KURSE()
    // Detach der Guthaben-Credits an course_id + user_id
    expect(src).toMatch(/credits'\)\s*\.update\(\{ course_id: null \}\)\s*\.eq\('user_id', prof\.id\)\.eq\('course_id', cancellingCourse\.id\)\.eq\('model', 'guthaben'\)/)
    // Delete NUR der nicht-Guthaben-Credits
    expect(src).toMatch(/credits'\)\.delete\(\)\s*\.eq\('user_id', prof\.id\)\.eq\('course_id', cancellingCourse\.id\)\.neq\('model', 'guthaben'\)/)
  })
})

test.describe('[E2E-Text] Fall 3 — Warteliste-Protokoll vollständig', () => {
  test('Client schreibt waitlist_joined-Audit beim Warteliste-Beitritt (nur type=waitlist)', () => {
    const src = SRC_SESSION()
    expect(src).toContain("action: 'waitlist_joined'")
    // Im handleWaitlist-Pfad, gekoppelt an type === 'waitlist'
    expect(src).toMatch(/if \(type === 'waitlist'\) \{[\s\S]*action: 'waitlist_joined'/)
  })

  test('Migration schreibt waitlist_promoted in BEIDEN RPCs', () => {
    const mig = SRC_MIGRATION()
    expect(mig).toContain('CREATE OR REPLACE FUNCTION public.process_cancellation_full')
    expect(mig).toContain('CREATE OR REPLACE FUNCTION public.process_cancellation_with_waitlist')
    const promotes = mig.match(/'waitlist_promoted'/g) || []
    expect(promotes.length).toBeGreaterThanOrEqual(2)
  })

  test('Migration schreibt waitlist_auto_removed beim Verbrauch des letzten Credits', () => {
    const mig = SRC_MIGRATION()
    expect(mig).toContain("'waitlist_auto_removed'")
    expect(mig).toContain("'last_credit_used'")
  })

  test('Audit-Inserts in der RPC sind exception-gekapselt (dürfen Promote nie abbrechen)', () => {
    const mig = SRC_MIGRATION()
    expect(mig).toMatch(/EXCEPTION WHEN OTHERS THEN NULL/)
  })

  test('Protokoll + Yogi-Historie kennen alle drei Warteliste-Actions', () => {
    const prot = SRC_PROTOKOLL()
    expect(prot).toContain('waitlist_joined:')
    expect(prot).toContain('waitlist_promoted:')
    expect(prot).toContain('waitlist_auto_removed:')
    const yogi = SRC_YOGI_DETAIL()
    expect(yogi).toContain("case 'waitlist_joined'")
    expect(yogi).toContain("case 'waitlist_promoted'")
    expect(yogi).toContain("case 'waitlist_auto_removed'")
  })
})

test.describe('[E2E-Text] Fall 4 — DSGVO-Selbstlöschung voll abgesichert', () => {
  test('profil löscht bookings/credits/notification_log/waitlist_offers explizit', () => {
    const src = SRC_PROFIL()
    expect(src).toMatch(/from\('bookings'\)\.delete\(\)\.eq\('user_id', user\.id\)/)
    expect(src).toMatch(/from\('credits'\)\.delete\(\)\.eq\('user_id', user\.id\)/)
    expect(src).toMatch(/from\('notification_log'\)\.delete\(\)\.eq\('user_id', user\.id\)/)
    expect(src).toMatch(/from\('waitlist_offers'\)\.delete\(\)\.eq\('user_id', user\.id\)/)
  })

  test('delete-account-Route gibt bei Auth-Fehler NICHT mehr success:true zurück', () => {
    const src = SRC_DELETE_ROUTE()
    // Kein success:true mehr im Fehlerzweig
    expect(src).not.toContain("success: true, warning: 'Auth deletion failed but profile anonymized'")
    // Ehrlicher Fehler + Admin-Notify
    expect(src).toContain("success: false")
    expect(src).toContain("'auth_delete_failed'")
    expect(src).toContain('admin_notifications')
  })
})

test.describe('[E2E-Text] Fall 5 — Absage-Frist Berlin-verankert', () => {
  test('parseSessionDateTimeBerlin existiert und nutzt Europe/Berlin', () => {
    const src = SRC_SESSION_TIME()
    expect(src).toContain('export function parseSessionDateTimeBerlin')
    expect(src).toContain("timeZone: 'Europe/Berlin'")
  })

  test('handleCancel verankert sessionStart + 90-Min-Cutoff in Berlin-Zeit', () => {
    const src = SRC_SESSION()
    expect(src).toContain('parseSessionDateTimeBerlin')
    // Stundenstart Berlin-verankert mit Fallback
    expect(src).toMatch(/const sessionStart = parseSessionDateTimeBerlin\(session\.date, session\.time_start\)/)
  })

  test('Hinweistext "deutsche Zeitzone (Europe/Berlin)" am Absage-Button', () => {
    const src = SRC_SESSION()
    expect(src).toContain('deutsche Zeitzone (Europe/Berlin)')
  })
})
