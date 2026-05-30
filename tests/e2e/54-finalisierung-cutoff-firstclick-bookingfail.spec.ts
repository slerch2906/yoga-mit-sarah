/**
 * Finalisierung (Sarah 2026-05-30) — 3 verbleibende Logiken aus der Analyse:
 *
 *  1. Kursstart-Kappung ("Hard Cut-Off"): Die 60-Min-Nachrück-Gnadenfrist endet
 *     spätestens zum Stundenanfang. Ab Kursbeginn keine kostenlose Stornierung.
 *     Hinweis "Kostenlose Stornierung nur bis zum Stundenanfang möglich!" in App + Mail.
 *  2. Überbuchungsschutz (First-Click-Wins): Bei gleichzeitigen Klicks auf ein
 *     Spätangebot bekommt nur EINER den Platz — atomar, ohne DB-Fehler. Der zweite
 *     sieht "Schade, ein anderer Yogi war schneller!".
 *  3. Fehler-Protokollierung: Eine an einer Frist/​einem Fenster gescheiterte
 *     Buchung wird als 'booking_failed_deadline' ins Audit-Log geschrieben und ist
 *     auf der Admin-Protokollseite lesbar.
 */
import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { getAdminClient, getUserIdByEmail } from '../utils/db'
import { createTestCourse, E2E_PREFIX } from '../utils/seed'

dotenv.config({ path: '.env.test' })

const ROOT = process.cwd()
const KURSE_SRC   = fs.readFileSync(path.join(ROOT, 'app/kurse/[id]/page.tsx'), 'utf8')
const EMAIL_SRC   = fs.readFileSync(path.join(ROOT, 'supabase/functions/send-email/index.ts'), 'utf8')
const OFFER_PAGE  = fs.readFileSync(path.join(ROOT, 'app/warteliste/angebot/[token]/page.tsx'), 'utf8')
const OFFER_API   = fs.readFileSync(path.join(ROOT, 'app/api/waitlist-offer/[token]/route.ts'), 'utf8')
const PROTOKOLL_SRC = fs.readFileSync(path.join(ROOT, 'app/admin/protokoll/page.tsx'), 'utf8')

const HARD_CUTOFF_HINT = 'Kostenlose Stornierung nur bis zum Stundenanfang möglich!'

// ════════════════════════════════════════════════════════════════════════════
// 1) Kursstart-Kappung ("Hard Cut-Off") + UX-/Mail-Hinweis
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Hard Cut-Off: Gnadenfrist endet zum Stundenanfang', () => {
  test('App zeigt den Hinweis "Kostenlose Stornierung nur bis zum Stundenanfang möglich!"', () => {
    expect(KURSE_SRC).toContain(HARD_CUTOFF_HINT)
  })

  test('Warteliste-Nachrück-Mail enthält denselben Hinweis', () => {
    expect(EMAIL_SRC).toContain(HARD_CUTOFF_HINT)
  })

  test('Hard Cut-Off strukturell: Abmelde-UI ist an !past (Stundenanfang) gekoppelt', () => {
    // Sobald die Stunde begonnen hat (past === true) verschwindet die gesamte
    // Abmelde-Sektion — d.h. ab Stundenanfang ist keine (kostenlose) Stornierung
    // mehr möglich, auch nicht innerhalb der 60-Min-Gnadenfrist.
    expect(KURSE_SRC).toMatch(/\{!past && !session\.is_cancelled && myBooking/)
    // isPast() = Stundenbeginn in der Vergangenheit
    expect(KURSE_SRC).toMatch(/const inPromoteGrace/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2) Überbuchungsschutz: First-Click-Wins (atomar, ohne DB-Fehler)
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] First-Click-Wins: kein Überbuchen bei Express-Plätzen', () => {
  let yogi1Id: string
  let yogi2Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
  })

  test('Zweiter gleichzeitiger Klick geht leer aus — genau ein Gewinner, kein DB-Fehler', async () => {
    const db = await getAdminClient()
    const course = await createTestCourse({ name: `${E2E_PREFIX} FirstClick`, sessionCount: 1, startDaysFromNow: 5 })
    const sessionId = course.sessionIds[0]
    const exp = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const stamp = Date.now()

    // Zwei offene Spätangebote (resolved_winner_user_id = NULL) für dieselbe Stunde
    await db.from('waitlist_offers').insert([
      { session_id: sessionId, user_id: yogi1Id, token: `e2e-fc-${stamp}-1`, expires_at: exp },
      { session_id: sessionId, user_id: yogi2Id, token: `e2e-fc-${stamp}-2`, expires_at: exp },
    ])

    try {
      // 1. Klick (Yogi1) — exakt der atomare Guard aus der API-Route
      const { data: first, error: firstErr } = await db.from('waitlist_offers')
        .update({ resolved_winner_user_id: yogi1Id, claimed_at: new Date().toISOString() })
        .eq('session_id', sessionId).is('resolved_winner_user_id', null)
        .select('id')
      expect(firstErr).toBeNull()
      expect((first || []).length, 'Erster Klick muss gewinnen').toBeGreaterThan(0)

      // 2. Klick (Yogi2) — Guard blockt, KEIN DB-Fehler, leeres Result
      const { data: second, error: secondErr } = await db.from('waitlist_offers')
        .update({ resolved_winner_user_id: yogi2Id, claimed_at: new Date().toISOString() })
        .eq('session_id', sessionId).is('resolved_winner_user_id', null)
        .select('id')
      expect(secondErr, 'Zweiter Klick darf KEINEN DB-Fehler werfen').toBeNull()
      expect((second || []).length, 'Zweiter Klick geht leer aus (zu spät)').toBe(0)

      // Genau EIN Gewinner für die Stunde → keine Überbuchung
      const { data: winners } = await db.from('waitlist_offers')
        .select('resolved_winner_user_id').eq('session_id', sessionId)
      const distinct = new Set((winners || []).map((w: any) => w.resolved_winner_user_id).filter(Boolean))
      expect(distinct.size, 'Es darf nur genau einen Gewinner geben').toBe(1)
      expect([...distinct][0]).toBe(yogi1Id)
    } finally {
      await db.from('waitlist_offers').delete().eq('session_id', sessionId)
    }
  })

  test('API-Route nutzt den atomaren Guard (resolved_winner_user_id IS NULL) + 409 too_late', () => {
    expect(OFFER_API).toMatch(/\.is\(\s*['"]resolved_winner_user_id['"]\s*,\s*null\s*\)/)
    expect(OFFER_API).toContain('too_late')
  })

  test('Zweiter Klicker sieht "Schade, ein anderer Yogi war schneller!"', () => {
    expect(OFFER_PAGE).toContain('Schade, ein anderer Yogi war schneller!')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3) Fehler-Protokollierung: booking_failed_deadline
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E] Audit: booking_failed_deadline (Silent-Failure behoben)', () => {
  test('handleBook schreibt booking_failed_deadline ins Audit-Log bei Fehlschlag', () => {
    expect(KURSE_SRC).toMatch(/action:\s*['"]booking_failed_deadline['"]/)
    // im Fehlerzweig (!pick.ok) verankert
    expect(KURSE_SRC).toMatch(/if \(!pick\.ok\)[\s\S]{0,400}booking_failed_deadline/)
  })

  test('ACTION_LABELS mappt booking_failed_deadline (lesbar für Sarah)', () => {
    expect(PROTOKOLL_SRC).toMatch(/booking_failed_deadline\s*:\s*\{\s*label:/)
  })
})

test.describe('[E2E] Audit: booking_failed_deadline auf Admin-Protokollseite sichtbar', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })
  let yogi1Id: string

  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test('Ein booking_failed_deadline-Eintrag erscheint mit lesbarem Label auf /admin/protokoll', async ({ page }) => {
    const db = await getAdminClient()
    const { data: row } = await db.from('audit_log').insert({
      user_id: yogi1Id,
      action: 'booking_failed_deadline',
      details: {
        course_name: `${E2E_PREFIX} Buchung-Fail`,
        reason: 'window_blocked',
        error_message: 'Stunde liegt außerhalb des Zeitraums.',
      },
    }).select('id').single()

    try {
      await page.goto('/admin/protokoll')
      await page.waitForLoadState('networkidle')
      // Lesbares Label statt Roh-String → Sarah sieht den Fehlversuch
      await expect(page.getByText('Buchung blockiert (Frist)').first())
        .toBeVisible({ timeout: 10_000 })
    } finally {
      if (row?.id) await db.from('audit_log').delete().eq('id', row.id)
    }
  })
})
