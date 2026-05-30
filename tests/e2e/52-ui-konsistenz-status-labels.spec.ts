/**
 * FINDINGS U1–U3 (Deep-QA Phase 2, Sarah 2026-05-29) — Status-Label-Konsistenz
 * rund um Absage / Abmeldung / Austragung.
 *
 * STAND 2026-05-29 — Welle "Akteur-Logik": U1 + U2 sind GEFIXT.
 *   Sarahs Produkt-Entscheid: neue Spalte bookings.cancelled_by ('self'|'admin').
 *     - Yogi meldet sich selbst ab   → "Abgemeldet"   (cancelled_by='self' / NULL)
 *     - Admin trägt den Yogi aus      → "Ausgetragen"  (cancelled_by='admin')
 *     - Ganze Stunde wurde abgesagt   → "Abgesagt"     (sessions.is_cancelled, Vorrang)
 *   Zentrale Helfer in lib/session-status.ts:
 *     - cancelledActorLabel(booking)          → 'Ausgetragen' | 'Abgemeldet'
 *     - bookingStatusLabel(session, booking)  → volles Wort inkl. Präzedenz
 *
 *   U1 (war: Buchungsliste "Ausgetragen" vs. Kalender-Grid "Abgemeldet" auf
 *      DERSELBEN Admin-Seite): GEFIXT — beide Stellen leiten das cancelled-Wort
 *      jetzt aus demselben Akteur (cancelled_by) ab → keine Divergenz mehr möglich.
 *   U2 (war: admin getStatusBadge kannte kein "Abgesagt"): GEFIXT — getStatusBadge
 *      delegiert an bookingStatusLabel, das die Session-Absage ZUERST prüft.
 *   U3 (In-App-Banner nur bei Events): unverändert — reiner Regressions-Schutz.
 *
 * Stil: [E2E-Text] Struktur-Guards (lesen den Quelltext) PLUS — seit Sarahs
 * Freigabe "wir starten jetzt" (2026-05-29) — ein echter [E2E] DB-Lauf der
 * Akteur-Logik (unten, ehemals test.fixme). Der DB-Lauf prüft die geshippten
 * Helfer gegen echte bookings/sessions-Zeilen inkl. der Spalte cancelled_by;
 * die UI-Verdrahtung deckt der Struktur-Guard-Teil ab (kein Browser nötig,
 * daher auch keine Mails). Testdaten: [E2E]-Prefix, Bereinigung im Teardown.
 */
import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { cancelledActorLabel, bookingStatusLabel } from '../../lib/session-status'
import { createTestCourse, E2E_PREFIX } from '../utils/seed'
import { getAdminClient, getUserIdByEmail, getCancelledBooking, getSession } from '../utils/db'

dotenv.config({ path: '.env.test' })

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const SRC_MEINE = () => read('app/meine/page.tsx')
const SRC_YOGI_DETAIL = () => read('app/admin/yogis/[id]/page.tsx')
const SRC_DASHBOARD = () => read('app/admin/dashboard/page.tsx')
const SRC_ADMIN_KURSE = () => read('app/admin/kurse/page.tsx')
const SRC_STATUS = () => read('lib/session-status.ts')
const SRC_MIGRATION = () => read('supabase/migrations/20260529_bookings_cancelled_by.sql')

// Body einer benannten Funktion grob ausschneiden (für Reihenfolge-/Präzedenz-Checks).
const sliceFrom = (src: string, marker: string, len = 1000) => {
  const i = src.indexOf(marker)
  return i === -1 ? '' : src.slice(i, i + len)
}

test.describe('[E2E-Text] Finding U — Status-Labels & Akteur-Logik (cancelled_by)', () => {

  // ── Schema: additive Spalte (kein Trigger, keine Architektur-Änderung) ─────
  test('Migration: bookings.cancelled_by additiv ergänzt, CHECK self|admin', () => {
    const sql = SRC_MIGRATION()
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS cancelled_by text/)
    expect(sql).toMatch(/cancelled_by IN \('self','admin'\)/)
  })

  // ── Zentrale Helfer existieren & haben die richtige Präzedenz ──────────────
  test('lib/session-status: cancelledActorLabel → admin=Ausgetragen, sonst=Abgemeldet', () => {
    const src = SRC_STATUS()
    expect(src).toContain('export function cancelledActorLabel(')
    expect(src).toMatch(/cancelled_by === 'admin' \? 'Ausgetragen' : 'Abgemeldet'/)
  })

  test('lib/session-status: bookingStatusLabel prüft Absage VOR dem Akteur-Wort', () => {
    const body = sliceFrom(SRC_STATUS(), 'export function bookingStatusLabel(')
    expect(body, 'bookingStatusLabel gefunden').toBeTruthy()
    const iExcluded = body.indexOf('isExcluded(session)')
    const iCancelled = body.indexOf('isCancelled(session)')
    const iActor = body.indexOf('cancelledActorLabel(booking)')
    const iStarted = body.indexOf('isStarted(session)')
    // Reihenfolge: Ausgeschlossen → Abgesagt → Akteur-Wort → Teilgenommen
    expect(iExcluded).toBeGreaterThan(-1)
    expect(iCancelled).toBeGreaterThan(iExcluded)
    expect(iActor).toBeGreaterThan(iCancelled)
    expect(iStarted).toBeGreaterThan(iActor)
  })

  // ── U2 GEFIXT: admin Buchungs-Badge zeigt "Abgesagt" via zentralem Helfer ──
  test('FINDING U2 [gefixt]: admin getStatusBadge delegiert an bookingStatusLabel (Absage-Präzedenz)', () => {
    const fn = sliceFrom(SRC_YOGI_DETAIL(), 'function getStatusBadge(b: any)')
    expect(fn).toContain('bookingStatusLabel(b.session, b)')
    // Wenn das Label "Abgesagt" ist, wird auch "Abgesagt" gerendert.
    expect(fn).toMatch(/label === 'Abgesagt'\) return <span[^>]*>Abgesagt</)
  })

  // ── U1 GEFIXT: cancelled-Wort kommt überall aus dem Akteur-Helfer ──────────
  test('FINDING U1 [gefixt]: Liste & Kalender-Grid leiten cancelled-Label aus cancelled_by ab', () => {
    const src = SRC_YOGI_DETAIL()
    // Buchungsliste: über bookingStatusLabel (liefert Ausgetragen|Abgemeldet aus cancelled_by)
    expect(sliceFrom(src, 'function getStatusBadge(b: any)')).toContain('bookingStatusLabel(b.session, b)')
    // Kalender-Grid: cancelled-Zweig nutzt cancelledActorLabel(myBooking)
    expect(src).toMatch(/myBooking\?\.status === 'cancelled'\) \{[\s\S]{0,260}cancelledActorLabel\(myBooking\)/)
    // Kein hartkodiertes, divergierendes Wort mehr im Grid-cancelled-Zweig
    expect(src).not.toMatch(/myBooking\?\.status === 'cancelled'\) \{\s*badge = \{ label: '(Abgemeldet|Ausgetragen)'/)
  })

  // ── /meine nutzt denselben Helfer & behält "Abgesagt"-Präzedenz ────────────
  test('/meine getStatusBadge: nutzt bookingStatusLabel, rendert Abgesagt + Akteur-Wort', () => {
    const fn = sliceFrom(SRC_MEINE(), 'function getStatusBadge(session: any)')
    expect(fn).toContain('bookingStatusLabel(session, mb)')
    expect(fn).toMatch(/label === 'Ausgetragen' \|\| label === 'Abgemeldet'/)
    expect(fn).toMatch(/>Abgesagt<\/span>/)
  })

  // ── Dashboard per-Yogi-Badge ist akteur-bewusst ───────────────────────────
  test('admin dashboard: cancelled-Badge je Yogi nutzt cancelledActorLabel', () => {
    const src = SRC_DASHBOARD()
    expect(src).toContain("import { cancelledActorLabel } from '@/lib/session-status'")
    expect(src).toMatch(/badge badge-left">\{cancelledActorLabel\(b\)\}<\/span>/)
  })

  // ── Alle Storno-Schreibstellen setzen cancelled_by ────────────────────────
  test('Storno-Sites schreiben cancelled_by: Yogi-Pfade self, Admin-Pfade admin', () => {
    // Selbst-Abmeldung (Yogi)
    expect(read('app/kurse/[id]/page.tsx')).toContain("cancelled_by: 'self'")
    expect(read('app/kurse/[id]/bestaetigung/page.tsx')).toContain("cancelled_by: 'self'")
    expect(read('app/profil/page.tsx')).toContain("cancelled_by: 'self'")
    // Admin-Austrag / Session- & Kurs-Absage
    expect(SRC_DASHBOARD()).toContain("cancelled_by: 'admin'")
    expect(SRC_YOGI_DETAIL()).toContain("cancelled_by: 'admin'")
    expect(SRC_ADMIN_KURSE()).toContain("cancelled_by: 'admin'")
    expect(read('app/admin/sessions/[id]/page.tsx')).toContain("cancelled_by: 'admin'")
    expect(read('app/admin/anwesenheit/page.tsx')).toContain("cancelled_by: 'admin'")
  })

  // ── U3 unverändert (Regressions-Schutz) ───────────────────────────────────
  test('admin cancelEventOrSingle: Mail an ALLE Betroffenen, In-App-Banner NUR Events (gewollt)', () => {
    const src = SRC_ADMIN_KURSE()
    expect(src).toContain('Email.sessionCancelled(')
    expect(src).toMatch(/if \(\(sessType === 'event_free' \|\| sessType === 'event_paid'\) && b\.user_id\)[\s\S]*?yogi_notifications/)
    expect(src).toContain("type: 'event_cancelled'")
  })

  // ── DB End-to-End — Akteur-Logik gegen die echte DB (Sarah: "wir starten jetzt", 2026-05-29) ──
  // Prüft die GESHIPPTE Helfer-Logik (lib/session-status) gegen echte
  // bookings/sessions-Zeilen inkl. der neuen Spalte cancelled_by. Kein Browser,
  // keine Server-Action → es werden KEINE Mails versendet. Testdaten tragen den
  // [E2E]-Prefix und werden vom globalTeardown bereinigt.
  test('Akteur-Logik end-to-end (DB): self→Abgemeldet, admin→Ausgetragen, Absage/Ausschluss haben Vorrang', async () => {
    const db = await getAdminClient()
    const yogi1 = await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!)
    const yogi2 = await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!)
    expect(yogi1, 'TEST_YOGI1_EMAIL existiert').toBeTruthy()
    expect(yogi2, 'TEST_YOGI2_EMAIL existiert').toBeTruthy()

    // 4 zukünftige Stunden — je eine pro Fall (in Vorrang-Reihenfolge).
    const course = await createTestCourse({
      name: `${E2E_PREFIX} Akteur-Logik`,
      maxSpots: 5,
      sessionCount: 4,
      startDaysFromNow: 10,
    })
    const [sSelf, sAdmin, sAbsage, sExcl] = course.sessionIds

    // Aktive Buchung anlegen, dann als (Akteur) stornieren.
    // WICHTIG: erst buchen, DANN ggf. Session absagen — sonst greift der
    // BEFORE-INSERT-Trigger trg_prevent_booking_cancelled. credit_id bleibt NULL,
    // damit trg_sync_credit_used nichts verrechnet.
    const bookThenCancel = async (userId: string, sessionId: string, actor: 'self' | 'admin') => {
      await db.from('bookings').insert({ user_id: userId, session_id: sessionId, type: 'course', status: 'active' })
      await db.from('bookings')
        .update({ status: 'cancelled', cancelled_by: actor, cancelled_at: new Date().toISOString() })
        .eq('user_id', userId).eq('session_id', sessionId)
    }

    // 1) Yogi meldet sich SELBST ab → cancelled_by='self' → "Abgemeldet"
    await bookThenCancel(yogi1!, sSelf, 'self')
    const bSelf = await getCancelledBooking(yogi1!, sSelf)
    expect(bSelf?.cancelled_by).toBe('self')
    expect(cancelledActorLabel(bSelf)).toBe('Abgemeldet')
    expect(bookingStatusLabel(await getSession(sSelf), bSelf)).toBe('Abgemeldet')

    // 2) Admin trägt den Yogi aus → cancelled_by='admin' → "Ausgetragen"
    await bookThenCancel(yogi2!, sAdmin, 'admin')
    const bAdmin = await getCancelledBooking(yogi2!, sAdmin)
    expect(bAdmin?.cancelled_by).toBe('admin')
    expect(cancelledActorLabel(bAdmin)).toBe('Ausgetragen')
    expect(bookingStatusLabel(await getSession(sAdmin), bAdmin)).toBe('Ausgetragen')

    // 3) Ganze Stunde abgesagt → "Abgesagt" hat VORRANG vor dem Akteur-Wort,
    //    selbst wenn die Buchung als admin-storniert markiert ist.
    await bookThenCancel(yogi1!, sAbsage, 'admin')
    await db.from('sessions').update({ is_cancelled: true, cancel_reason: 'Abgesagt' }).eq('id', sAbsage)
    const bAbsage = await getCancelledBooking(yogi1!, sAbsage)
    expect(bookingStatusLabel(await getSession(sAbsage), bAbsage)).toBe('Abgesagt')

    // 4) Ausgeschlossene Stunde → "Ausgeschlossen" hat den HÖCHSTEN Vorrang.
    await bookThenCancel(yogi2!, sExcl, 'self')
    await db.from('sessions').update({ is_cancelled: true, cancel_reason: 'excluded' }).eq('id', sExcl)
    const bExcl = await getCancelledBooking(yogi2!, sExcl)
    expect(bookingStatusLabel(await getSession(sExcl), bExcl)).toBe('Ausgeschlossen')
  })
})
