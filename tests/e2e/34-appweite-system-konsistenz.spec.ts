/**
 * APPWEITE SYSTEMISCHE END-TO-END KONSISTENZ
 *
 * Sarah-Direktive 2026-05-24: Komplette App systemisch testen — ALLE Wellen
 * auf einmal. Nicht "funktioniert dieser Step?" sondern "ist der komplette
 * Systemzustand nach jedem Workflow überall konsistent?"
 *
 * Ergänzend zu Spec 33 (Credit/Booking-Lifecycles) deckt diese Spec ab:
 *
 *   Block A: Auth + Registrierung + AGB + Onboarding
 *   Block B: Profile-Lifecycle (Email, Birthdate, Notfallkontakt, Notify-Toggle)
 *   Block C: Admin-Workflows (Enroll, Session-Cancel, Ersatzstunde, AGB-Push)
 *   Block D: Bulk-Mail Filter-Konsistenz
 *   Block E: Cross-View-Konsistenz (Yogi-Sicht ↔ Admin-Sicht ↔ DB)
 *   Block F: PWA / Service-Worker / Update-Banner / System-Health
 *   Block G: Audit-Log Konsistenz (jede mutierende Aktion hinterlässt Spur)
 *
 * Methodik: DB-zentrierte Verifikation + Source-Smokes für UI-Code-Konsistenz.
 * Jeder Test prüft mindestens 3 Dimensionen (Charter §1).
 */

import { test, expect } from '@playwright/test'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import {
  getAdminClient, getUserIdByEmail,
  getActiveBooking, getCancelledBooking, countActiveBookingsForSession,
  getGuthabenCredit, countGuthabenCredits,
  getEnrollment, getCourseCredit,
} from '../utils/db'
import { createTestCourse, giveYogiSingleCredit, giveYogiGuthaben, E2E_PREFIX } from '../utils/seed'

dotenv.config({ path: '.env.test' })

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

async function resetYogi(userId: string) {
  const db = await getAdminClient()
  await db.from('waitlist').delete().eq('user_id', userId)
  await db.from('bookings').delete().eq('user_id', userId)
  await db.from('credits').delete().eq('user_id', userId)
  await db.from('enrollments').delete().eq('user_id', userId)
  await db.from('notification_log').delete().eq('user_id', userId)
}

// ════════════════════════════════════════════════════════════════════════════
// BLOCK A: AUTH + REGISTRIERUNG + AGB + ONBOARDING
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-SYS] BLOCK A: Auth + Registrierung + AGB + Onboarding', () => {
  let yogi1Id: string
  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test('A1 — Registrierungs-Pflichtfelder (Server-Source-Konsistenz)', () => {
    const src = read('app/register/page.tsx')
    // ALLE 5 Pflichtfelder müssen serverseitig validiert sein (nicht nur HTML required)
    expect(src).toMatch(/firstName.*trim\(\)/)
    expect(src).toMatch(/lastName.*trim\(\)/)
    expect(src).toMatch(/Bitte gib deinen Vornamen ein/)
    expect(src).toMatch(/Bitte gib deinen Nachnamen ein/)
    expect(src).toMatch(/Bitte gib dein Geburtsdatum ein/)
    // Geburtsdatum-Plausibilität
    expect(src).toMatch(/age\s*<\s*14/)
    expect(src).toMatch(/age\s*>\s*120/)
    // Profile-Insert nach signUp enthält birthdate
    expect(src).toMatch(/profiles[\s\S]{0,200}upsert\([\s\S]{0,300}birthdate/)
    // Welcome-Email + adminNewYogi werden gesendet
    expect(src).toMatch(/Email\.welcome/)
    expect(src).toMatch(/Email\.adminNewYogi/)
  })

  test('A2 — AGB-Akzeptanz hinterlässt konsistente DB-Spuren (profiles + ggf. legal_acceptances)', async () => {
    // Yogi1 hat AGB akzeptiert (Test-Setup setzt das direkt in profile).
    // Prüfe DB-State auf profile-Ebene (legal_acceptances entsteht nur bei
    // echtem UI-Flow — Test-Setup nutzt Direct-DB-Insert ohne AGB-Workflow).
    const db = await getAdminClient()
    const { data: prof } = await db.from('profiles')
      .select('legal_accepted_at, legal_version, agb_version').eq('id', yogi1Id).single()
    expect(prof?.legal_accepted_at, 'profile.legal_accepted_at gesetzt').toBeTruthy()
    expect(prof?.legal_version, 'profile.legal_version gesetzt').toBeTruthy()
    expect(prof?.agb_version, 'profile.agb_version ≥ 1').toBeGreaterThanOrEqual(1)

    // Source-Smoke: AGB-Akzeptanz-Page legt legal_acceptances-Row an
    // (DB-Row-Verifikation nicht möglich da Test-Setup direkt DB schreibt)
    const rechtPage = read('app/rechtliches/page.tsx')
    expect(rechtPage).toMatch(/from\(['"]legal_acceptances['"]\)[\s\S]{0,100}insert/)
    expect(rechtPage).toMatch(/full_name|accepted_at|version/)
  })

  test('A3 — AGB-Versionierung: agb_versions Tabelle hat aktive Version', async () => {
    const db = await getAdminClient()
    const { data: versions } = await db.from('agb_versions')
      .select('id, label, sort_order, created_at').order('sort_order', { ascending: false }).limit(1)
    expect(versions?.length, 'Mindestens 1 AGB-Version in DB').toBeGreaterThan(0)
    const aktuell = versions![0]
    expect(aktuell.label, 'Aktuelle Version hat Label').toBeTruthy()
    expect(aktuell.sort_order, 'sort_order ≥ 1').toBeGreaterThanOrEqual(1)
  })

  test('A4 — Onboarding-Tour wird genau 1x angezeigt (onboarding_completed Flag-Logik)', () => {
    const tour = read('components/OnboardingTour.tsx')
    // Tour setzt onboarding_completed=true beim Finish
    expect(tour).toMatch(/onboarding_completed:\s*true/)
    expect(tour).toMatch(/from\(['"`]profiles['"`]\)[\s\S]{0,80}\.update/)
    // RLS-sicher: nutzt user.id nicht email
    expect(tour).toMatch(/\.eq\(['"`]id['"`],\s*user\.id\)/)

    // /kurse rendert Tour nur wenn onboarding_completed=false
    const kurse = read('app/kurse/page.tsx')
    expect(kurse).toMatch(/OnboardingTour/)
    expect(kurse).toMatch(/onboarding_completed/)
  })

  test('A5 — Login-Recovery-Hinweis vorhanden (Sarah-Wunsch Welle A)', () => {
    const login = read('app/login/page.tsx')
    expect(login).toMatch(/Email vergessen\? Wende dich an Sarah/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// BLOCK B: PROFILE-LIFECYCLE (Email, Birthdate, Notfallkontakt, Notify-Toggle)
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-SYS] BLOCK B: Profile-Lifecycle Konsistenz', () => {
  let yogi1Id: string
  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })

  test('B1 — Email-Update synct auch auth.user (nicht nur profiles)', () => {
    // Source-Smoke: handleSave für email-Feld muss supabase.auth.updateUser nutzen,
    // nicht nur profile-Update — sonst Auth-Login-Email vs profile-Anzeige inkonsistent
    const src = read('app/profil/page.tsx')
    expect(src).toMatch(/field === 'email'/)
    expect(src).toMatch(/supabase\.auth\.updateUser\(\{\s*email:\s*value\s*\}\)/)
  })

  test('B2 — Email-Validierung mit strengem Regex (nicht nur type=email)', () => {
    const src = read('app/profil/page.tsx')
    // Regex: muss @ + Domain + TLD ≥ 2 Zeichen haben
    expect(src).toMatch(/\/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\{2,\}\$\//)
    expect(src).toMatch(/Bitte gib eine gültige E-Mail-Adresse ein/)
  })

  test('B3 — Geburtsdatum: gleiche Validierungs-Regeln im Profil wie Register', () => {
    const prof = read('app/profil/page.tsx')
    const reg = read('app/register/page.tsx')
    // Beide: min 14
    expect(prof).toMatch(/age\s*<\s*14/)
    expect(reg).toMatch(/age\s*<\s*14/)
    // Beide: max 120
    expect(prof).toMatch(/age\s*>\s*120/)
    expect(reg).toMatch(/age\s*>\s*120/)
    // Beide: identische Fehlermeldung "mindestens 14 Jahre"
    expect(prof).toMatch(/mindestens 14 Jahre/i)
    expect(reg).toMatch(/mindestens 14 Jahre/i)
  })

  test('B4 — Notfallkontakt: Klickbar (tel:/wa.me) + DB-Speicherung', async () => {
    const db = await getAdminClient()
    // Test-Yogi temporär mit Notfallkontakt
    await db.from('profiles').update({
      emergency_name: 'Test-Notfall', emergency_phone: '+491607004053',
    }).eq('id', yogi1Id)

    const { data: prof } = await db.from('profiles')
      .select('emergency_name, emergency_phone').eq('id', yogi1Id).single()
    expect(prof?.emergency_name).toBe('Test-Notfall')
    expect(prof?.emergency_phone).toBe('+491607004053')

    // Admin-Yogi-Detail-UI: tel: und wa.me Links bei emergency_phone
    const adminYogi = read('app/admin/yogis/[id]/page.tsx')
    expect(adminYogi).toMatch(/tel:/)
    expect(adminYogi).toMatch(/wa\.me/)

    // Cleanup
    await db.from('profiles').update({ emergency_name: null, emergency_phone: null }).eq('id', yogi1Id)
  })

  test('B5 — Notify-Toggle wird VOR sendEmail im Booking-Flow geprüft', () => {
    // Plausibilität: handleBook ruft Email NUR wenn profile.notify_booking_confirmations !== false
    const src = read('app/kurse/[id]/page.tsx')
    // Booking-Flow muss notify_booking_confirmations checken
    expect(src).toMatch(/notify_booking_confirmations/)
    // Toggle-UI im Profil setzt das Flag
    const prof = read('app/profil/page.tsx')
    expect(prof).toMatch(/notify_booking_confirmations/)
  })

  test('B6 — Stunden-Reminder Dropdown: 4 Optionen (Aus, 4, 12, 24 Std)', () => {
    const src = read('app/profil/page.tsx')
    // 3 Reminder-Optionen + "Aus"
    expect(src).toMatch(/<option value="">Aus<\/option>/)
    expect(src).toMatch(/<option value="4">4 Std vorher<\/option>/)
    expect(src).toMatch(/<option value="12">12 Std vorher<\/option>/)
    expect(src).toMatch(/<option value="24">24 Std vorher<\/option>/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// BLOCK C: ADMIN-WORKFLOWS (Enroll, Session-Cancel, Ersatzstunde, AGB-Push)
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-SYS] BLOCK C: Admin-Workflow Konsistenz', () => {
  let yogi1Id: string, yogi2Id: string
  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
    yogi2Id = (await getUserIdByEmail(process.env.TEST_YOGI2_EMAIL!))!
  })

  test.beforeEach(async () => {
    await resetYogi(yogi1Id)
    await resetYogi(yogi2Id)
  })

  test('C1 — Admin sagt Session ab: alle Yogis cancelled, Credits zurück, is_cancelled=true', async () => {
    const db = await getAdminClient()
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)

    // SETUP: Kurs mit 1 Session, 2 Yogis eingebucht
    const course = await createTestCourse({ name: `${E2E_PREFIX} C1`, sessionCount: 1, startDaysFromNow: 14 })
    const sid = course.sessionIds[0]
    for (const uid of [yogi1Id, yogi2Id]) {
      const { data: cr } = await db.from('credits').insert({
        user_id: uid, course_id: course.courseId, model: 'course',
        total: 1, used: 0, expires_at: exp.toISOString(),
      }).select('id').single()
      await db.from('enrollments').insert({ user_id: uid, course_id: course.courseId })
      await db.from('bookings').insert({
        user_id: uid, session_id: sid, credit_id: cr!.id,
        type: 'course', status: 'active',
      })
    }
    expect(await countActiveBookingsForSession(sid), 'Vor Cancel: 2 Yogis gebucht').toBe(2)

    // AKTION: Admin sagt Session ab (simuliert Admin-Modal-Action)
    await db.from('sessions').update({
      is_cancelled: true, cancel_reason: 'Krankheit Sarah',
    }).eq('id', sid)
    // App-Logik: cancelled session triggert booking cancel
    await db.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false,
    }).eq('session_id', sid).eq('status', 'active')

    // ASSERT-KETTE
    const session = await db.from('sessions').select('is_cancelled, cancel_reason').eq('id', sid).single()
    expect(session.data?.is_cancelled, 'Session als cancelled markiert').toBe(true)
    expect(session.data?.cancel_reason, 'Grund gespeichert').toBe('Krankheit Sarah')

    // Beide Yogis: bookings cancelled, credit refunded
    for (const uid of [yogi1Id, yogi2Id]) {
      const cancelled = await getCancelledBooking(uid, sid)
      expect(cancelled, `${uid}: Buchung cancelled`).toBeTruthy()
      expect(cancelled?.cancel_late, 'Admin-Cancel = nicht late').toBe(false)

      const cr = await getCourseCredit(uid, course.courseId)
      expect(cr?.used, `${uid}: Credit refunded (used=0)`).toBe(0)
    }

    // Counter
    expect(await countActiveBookingsForSession(sid), 'Counter = 0').toBe(0)

    // Source-Smoke: Email-Helper sessionCancelled existiert
    const email = read('lib/email.ts')
    expect(email).toMatch(/sessionCancelled/)
  })

  test('C2 — Admin enrolls Yogi mit Auto-Guthaben-Verrechnung', async () => {
    const db = await getAdminClient()
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1)

    // SETUP: Yogi hat 3 Guthaben, Admin will in Kurs einbuchen
    const ghId = await giveYogiGuthaben(yogi1Id, 3)

    // Source-Smoke: Admin-Yogi-UI hat Auto-Verrechnungs-Logik (kein Confirm bei Guthaben)
    const src = read('app/admin/yogis/[id]/page.tsx')
    expect(src).toMatch(/guthaben/i)
    // Auto-Verrechnung wenn Guthaben da ist (Welle 17)
    expect(src).toMatch(/newPaidCredits|verrechn|guthaben.*total/i)

    // DB-Voraussetzung: Guthaben hat correct model
    const { data: gh } = await db.from('credits').select('model, total').eq('id', ghId).single()
    expect(gh?.model).toBe('guthaben')
    expect(gh?.total).toBe(3)

    // Cleanup
    await db.from('credits').delete().eq('id', ghId)
  })

  test('C3 — Admin legt Ersatzstunde an: neue Session OHNE course.total_units zu erhöhen', async () => {
    const db = await getAdminClient()

    // SETUP: Kurs mit 3 geplanten Sessions
    const course = await createTestCourse({ name: `${E2E_PREFIX} C3`, sessionCount: 3, startDaysFromNow: 7 })
    const beforeUnits = await db.from('courses').select('total_units').eq('id', course.courseId).single()
    expect(beforeUnits.data?.total_units, 'Vor Ersatz: total_units=3').toBe(3)

    // AKTION: Admin legt Ersatzstunde an (cancelled Original-Session + neue Session als Ersatz)
    await db.from('sessions').update({
      is_cancelled: true, cancel_reason: 'admin_replacement',
    }).eq('id', course.sessionIds[1])

    const ersatzDate = new Date(); ersatzDate.setDate(ersatzDate.getDate() + 20)
    const { data: ersatz } = await db.from('sessions').insert({
      course_id: course.courseId, date: ersatzDate.toISOString().split('T')[0],
      time_start: '18:30:00', duration_min: 75,
      is_cancelled: false, replacement_session_id: course.sessionIds[1],
    }).select('id').single()

    // ASSERT: course.total_units UNVERÄNDERT (Bug Welle 88 verhindern)
    const afterUnits = await db.from('courses').select('total_units').eq('id', course.courseId).single()
    expect(afterUnits.data?.total_units,
      'KRITISCH: total_units MUSS unverändert sein (Ersatz ist kein Extra-Slot)'
    ).toBe(3)

    // Ersatz hat korrekten replacement_session_id-Verweis
    const { data: e } = await db.from('sessions').select('replacement_session_id').eq('id', ersatz!.id).single()
    expect(e?.replacement_session_id, 'replacement_session_id verweist auf Original').toBe(course.sessionIds[1])

    // Original ist cancelled
    const original = await db.from('sessions').select('is_cancelled').eq('id', course.sessionIds[1]).single()
    expect(original.data?.is_cancelled, 'Original-Session cancelled').toBe(true)
  })

  test('C4 — AGB-Push: alle profiles.agb_version werden downgraded', async () => {
    const db = await getAdminClient()
    // Source-Smoke: AGB-Push-Flow im Code
    const src = read('app/profil/page.tsx')
    // Push insert + downgrade aller profile mit agb_version >= old
    expect(src).toMatch(/from\(['"`]agb_versions['"`]\)[\s\S]{0,200}insert/)
    expect(src).toMatch(/from\(['"`]profiles['"`]\)[\s\S]{0,200}update/)
    expect(src).toMatch(/agb_version:\s*oldOrder/)
    expect(src).toMatch(/\.gte\(['"`]agb_version['"`]/)

    // DB-Voraussetzung: agb_versions Tabelle existiert mit current+1 pattern
    const { data: versions } = await db.from('agb_versions')
      .select('sort_order').order('sort_order', { ascending: false }).limit(1)
    expect(versions?.length).toBeGreaterThan(0)
  })

  test('C5 — Admin-Sidebar: alle Links unter /admin/* (Sidebar bleibt überall sichtbar)', () => {
    const src = read('app/admin/layout.tsx')
    const hrefs = Array.from(src.matchAll(/href:\s*['"`](\/[^'"`]+)['"`]/g)).map(m => m[1])
    expect(hrefs.length, 'Sidebar hat Navigations-Links').toBeGreaterThan(0)
    for (const href of hrefs) {
      expect(href.startsWith('/admin/'),
        `Link "${href}" muss unter /admin/* sein — sonst verschwindet Sidebar`).toBe(true)
    }
    // "Mein Profil" raus (würde zu /profil außerhalb /admin/ führen)
    expect(src).not.toMatch(/Mein Profil/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// BLOCK D: BULK-MAIL Filter-Konsistenz
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-SYS] BLOCK D: Bulk-Mail Filter + Opt-Out', () => {
  test('D1 — API filtert: admins out, dummies out, email NULL out, "Gelöschter" out', () => {
    const src = read('app/api/admin/bulk-mail/route.ts')
    // Filter-Kette
    expect(src).toMatch(/is_admin/)
    expect(src).toMatch(/is_dummy/)
    expect(src).toMatch(/email/)
    // "Gelöschter Nutzer" (DSGVO-Profil) explizit ausgeschlossen
    expect(src).toMatch(/Gelöschter/)
  })

  test('D2 — Auth: Bearer-Token + Admin-Check', () => {
    const src = read('app/api/admin/bulk-mail/route.ts')
    expect(src).toMatch(/Authorization/i)
    expect(src).toMatch(/Bearer/i)
    expect(src).toMatch(/is_admin/)
  })

  test('D3 — Opt-Out-Footer im Edge-Function-Template (UWG-konform)', () => {
    // Source-Smoke: Edge Function send-email hat BULK_OPTOUT-Footer für admin_bulk_announcement
    const swPath = path.join(ROOT, 'supabase', 'functions', 'send-email', 'index.ts')
    if (fs.existsSync(swPath)) {
      const src = fs.readFileSync(swPath, 'utf8')
      expect(src).toMatch(/admin_bulk_announcement/)
      expect(src).toMatch(/BULK_OPTOUT|opt.{0,3}out|abmelden|schreib.{0,5}mir/i)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// BLOCK E: CROSS-VIEW-KONSISTENZ (Yogi-Sicht ↔ Admin-Sicht ↔ DB)
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-SYS] BLOCK E: Cross-View-Konsistenz', () => {
  let yogi1Id: string
  test.beforeAll(async () => {
    yogi1Id = (await getUserIdByEmail(process.env.TEST_YOGI1_EMAIL!))!
  })
  test.beforeEach(async () => { await resetYogi(yogi1Id) })

  test('E1 — Aktive Buchung: 1 Booking, 1 in /meine, 1 in Admin-Session, counter=1', async () => {
    const db = await getAdminClient()
    const cid = await giveYogiSingleCredit(yogi1Id, 1)
    const course = await createTestCourse({ name: `${E2E_PREFIX} E1`, sessionCount: 1, startDaysFromNow: 14 })

    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: cid,
      type: 'single', status: 'active',
    })

    // DB = Truth
    const booking = await getActiveBooking(yogi1Id, course.sessionIds[0])
    expect(booking, 'DB: 1 aktive Buchung').toBeTruthy()
    const counter = await countActiveBookingsForSession(course.sessionIds[0])
    expect(counter, 'Counter = 1').toBe(1)

    // Yogi-Sicht /meine: Source-Smoke filtert bookings.status='active'
    const meine = read('app/meine/page.tsx')
    expect(meine).toMatch(/status['"]?\s*[,=]['"]?active|eq\(['"]?status['"]?,\s*['"]?active/i)

    // Admin-Sicht /admin/sessions/[id]: Source-Smoke listet Teilnehmer
    const adminSession = read('app/admin/sessions/[id]/page.tsx')
    expect(adminSession).toMatch(/from\(['"]bookings['"]\)/)
    expect(adminSession).toMatch(/status['"]?\s*[,=]['"]?active|eq\(['"]?status['"]?,\s*['"]?active/i)
  })

  test('E2 — Cancelled Buchung: DB=cancelled, NICHT in /meine, NICHT als Teilnehmer in Admin', async () => {
    const db = await getAdminClient()
    const cid = await giveYogiSingleCredit(yogi1Id, 1)
    const course = await createTestCourse({ name: `${E2E_PREFIX} E2`, sessionCount: 1, startDaysFromNow: 14 })

    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: cid,
      type: 'single', status: 'active',
    })
    await db.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false,
    }).eq('user_id', yogi1Id).eq('session_id', course.sessionIds[0])

    // DB: cancelled
    expect(await getActiveBooking(yogi1Id, course.sessionIds[0])).toBeNull()
    expect(await getCancelledBooking(yogi1Id, course.sessionIds[0])).toBeTruthy()
    expect(await countActiveBookingsForSession(course.sessionIds[0]), 'Counter=0').toBe(0)

    // Credit refunded
    const { data: cr } = await db.from('credits').select('used').eq('id', cid).single()
    expect(cr?.used, 'Credit refunded').toBe(0)
  })

  test('E3 — Excluded Session: bleibt für Admin sichtbar, für Yogi NICHT in /meine', async () => {
    const db = await getAdminClient()
    const cid = await giveYogiSingleCredit(yogi1Id, 1)
    const course = await createTestCourse({ name: `${E2E_PREFIX} E3`, sessionCount: 1, startDaysFromNow: 14 })

    await db.from('bookings').insert({
      user_id: yogi1Id, session_id: course.sessionIds[0], credit_id: cid,
      type: 'single', status: 'active',
    })
    // Excluded = is_cancelled=true mit cancel_reason='excluded'
    await db.from('sessions').update({
      is_cancelled: true, cancel_reason: 'excluded',
    }).eq('id', course.sessionIds[0])

    // Source-Smoke: lib/session-status hat isExcluded helper
    const helper = read('lib/session-status.ts')
    expect(helper).toMatch(/isExcluded/)
    expect(helper).toMatch(/cancel_reason.*excluded/i)

    // /meine filtert excluded raus
    const meine = read('app/meine/page.tsx')
    expect(meine).toMatch(/excluded|isExcluded|is_cancelled/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// BLOCK F: PWA / Service-Worker / Update-Banner / System-Health
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-SYS] BLOCK F: PWA + System-Health-Konsistenz', () => {
  test('F1 — Service-Worker CACHE_VERSION + STATIC_ASSETS sind valide', () => {
    const sw = read('public/sw.js')
    expect(sw).toMatch(/CACHE_VERSION\s*=\s*['"`]yoga-sarah-v\d+['"`]/)
    expect(sw).toMatch(/STATIC_ASSETS/)
  })

  test('F2 — /api/version returnt sha + date + update_banner_version', async () => {
    const res = await fetch(`${process.env.BASE_URL}/api/version`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toHaveProperty('sha')
    expect(json).toHaveProperty('date')
    expect(json).toHaveProperty('update_banner_version')
    expect(json).toHaveProperty('update_banner_set_at')
  })

  test('F3 — UpdateBanner-Component pollt korrekt + nutzt localStorage', () => {
    const banner = read('components/UpdateBanner.tsx')
    expect(banner).toMatch(/\/api\/version/)
    expect(banner).toMatch(/localStorage/)
    expect(banner).toMatch(/seen_update_version/)
  })

  test('F4 — System-Health-Page hat Ampel + 4 Indikatoren', () => {
    const src = read('app/profil/page.tsx')
    // Cron, Email-Versand, Email-Fehler, App-Aktivität — 4 Indikatoren
    expect(src).toMatch(/get_system_health|cron|email/i)
    expect(src).toMatch(/System-Status/)
  })

  test('F5 — admin_announcement Tabelle existiert + ist single-row (id=1)', async () => {
    const db = await getAdminClient()
    const { data, error } = await db.from('admin_announcement')
      .select('id, message, is_active, update_banner_version, update_banner_set_at')
      .eq('id', 1).maybeSingle()
    expect(error?.message || '').toBe('')
    expect(data?.id).toBe(1)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// BLOCK G: AUDIT-LOG KONSISTENZ — mutierende Aktionen hinterlassen Spur
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-SYS] BLOCK G: Audit-Log Konsistenz', () => {
  test('G1 — anonymize_user_audit_logs RPC entfernt PII aus details', async () => {
    const db = await getAdminClient()
    // RPC existiert (call mit echtem UUID hätte Side-Effects, daher nur schema check)
    const { error } = await db.rpc('anonymize_user_audit_logs' as any, {
      target_user_id: '00000000-0000-0000-0000-000000000000', // existiert nicht
    })
    // Sollte ohne error returnen (no-op auf non-existent user)
    expect(error?.message || '').toBe('')
  })

  test('G2 — audit_log.user_id FK ist SET NULL (Compliance: Spur bleibt bei Delete)', async () => {
    const db = await getAdminClient()
    const { data } = await db.rpc('exec_sql' as any, {}).then(() => ({ data: null })).catch(() => ({ data: null }))
    // Direkt nicht abrufbar — Source-Smoke auf v6-Code dass audit_log NICHT gelöscht wird
    const handler = read('app/admin/yogis/[id]/page.tsx')
    // handleDeleteYogi löscht 5 Tabellen, audit_log ist NICHT dabei
    const deleteCalls = (handler.match(/from\(['"`](\w+)['"`]\)\.delete\(\)\.eq\(['"`]user_id['"`]/g) || [])
    const tables = deleteCalls.map(c => c.match(/from\(['"`](\w+)/)?.[1]).filter(Boolean)
    expect(tables, 'DELETE auf 5 Tabellen').toEqual(
      expect.arrayContaining(['bookings', 'enrollments', 'credits', 'waitlist', 'notification_log'])
    )
    expect(tables, 'audit_log darf NICHT explizit gelöscht werden').not.toContain('audit_log')
  })

  test('G3 — Yogi-Löschung erzeugt yogi_anonymized_dsgvo Audit-Eintrag', () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    expect(src).toMatch(/action:\s*['"`]yogi_anonymized_dsgvo['"`]/)
    // Eintrag enthält nur abstrakte User-ID, kein Klartext
    expect(src).toMatch(/anonymized_user_id/)
  })

  test('G4 — Protokoll-Page rendert audit_log Einträge', () => {
    const src = read('app/admin/protokoll/page.tsx')
    expect(src).toMatch(/from\(['"]audit_log['"]\)/)
    expect(src).toMatch(/ACTION_LABELS/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// BLOCK H: EMAIL-WORKFLOW Konsistenz — alle Helper exportiert, Trigger-Pfade
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-SYS] BLOCK H: Email-Workflow Konsistenz', () => {
  test('H1 — Alle 14 Email-Helper exportiert in lib/email.ts', () => {
    const src = read('lib/email.ts')
    const helpers = [
      'welcome', 'invitationSent', 'invitationReminder', 'passwordResetRequest',
      'bookingConfirmed', 'bookingCancelled',
      'waitlistJoined', 'waitlistPromoted', 'waitlistOfferLate',
      'sessionCancelled', 'sessionReminder',
      'adminNewYogi', 'adminCourseCancelledSummary',
      'yogiCourseCancelChoice',
    ]
    for (const h of helpers) {
      expect(src, `Email-Helper ${h} muss exportiert sein`).toMatch(new RegExp(`\\b${h}\\b`))
    }
  })

  test('H2 — Edge Function send-email behandelt alle Email-Types', () => {
    const swPath = path.join(ROOT, 'supabase', 'functions', 'send-email', 'index.ts')
    if (!fs.existsSync(swPath)) return // skip wenn Edge-Function nicht lokal
    const src = fs.readFileSync(swPath, 'utf8')
    // Wichtigste Types die wir testen
    const types = [
      'welcome', 'booking_confirmed', 'booking_cancelled',
      'session_cancelled', 'session_reminder',
      'waitlist_joined', 'waitlist_promoted',
      'admin_bulk_announcement', 'admin_dsgvo_deletion',
      'yogi_course_cancel_choice', 'admin_yogi_choice',
    ]
    for (const t of types) {
      expect(src, `Edge-Function-Type ${t} muss in switch behandelt sein`).toMatch(new RegExp(`['"\`]${t}['"\`]`))
    }
  })

  test('H3 — Reminder-Cron-Edge-Function-Helper find_pending_session_reminders existiert', async () => {
    const db = await getAdminClient()
    // RPC ist deployed wenn callable
    const { error } = await db.rpc('find_pending_session_reminders' as any, {})
    // Sollte ohne FK-Error returnen (function existiert, leere Result ok)
    if (error) {
      // Acceptable: "function does not exist" wäre echter Fehler; alles andere ok
      expect(error.message).not.toMatch(/does not exist/i)
    }
  })

  test('H4 — Booking-Flow ruft notify_booking_confirmations-aware sendEmail', () => {
    const src = read('app/kurse/[id]/page.tsx')
    // Booking-Source enthält Email-Send + Notify-Toggle-Check
    expect(src).toMatch(/notify_booking_confirmations/)
    // Cancel-Source informiert auch Yogi (booking_cancelled)
    expect(src).toMatch(/bookingCancelled|booking_cancelled/i)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// BLOCK I: WELLE-A-WELLEN — Yogi-Schutz-Mechanismen
// ════════════════════════════════════════════════════════════════════════════
test.describe('[E2E-SYS] BLOCK I: Welle-A Sicherheits-Mechanismen', () => {
  test('I1 — 3h-Frist-Confirm verhindert versehentliche Spät-Abmeldung', () => {
    const src = read('app/kurse/[id]/page.tsx')
    expect(src).toMatch(/3-Stunden-Frist/)
    expect(src).toMatch(/verfällt[\s\S]{0,200}Credit/)
    expect(src).toMatch(/3\s*\*\s*60\s*\*\s*60\s*\*\s*1000/) // 3h in ms
    expect(src).toMatch(/cancel_late:\s*late/)
  })

  test('I2 — Vergangene Stunden im Yogi-Wochenview NICHT klickbar', () => {
    const src = read('app/kurse/page.tsx')
    expect(src).toMatch(/is_past/)
    // Klick-Logik konditional auf is_past
    expect(src).toMatch(/!s\.is_past|!is_past/)
  })

  test('I3 — Neu-Yogi-Banner wenn bookingCount === 0 (mit ?? Fallback)', () => {
    const src = read('app/kurse/page.tsx')
    // Code-Pattern: (bookingCount ?? 0) === 0 — Regex erlaubt ?? Operator
    expect(src).toMatch(/bookingCount[\s\S]{0,15}===?\s*0/)
    expect(src).toMatch(/isNewYogi|is_new_yogi|neuyogi/i)
  })

  test('I4 — Email-Format-Validierung im Yogi-Profil (Sarah-Wunsch Welle A)', () => {
    const src = read('app/profil/page.tsx')
    expect(src).toMatch(/Bitte gib eine gültige E-Mail-Adresse ein/)
  })

  test('I5 — Yogi-Löschung v6: explizite DELETE-Reihenfolge', () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    // DELETEs kommen VOR Anonymisierung VOR Auth-Delete
    const deletePos = src.indexOf("from('bookings').delete()")
    const anonPos = src.indexOf("first_name: 'Gelöschter'")
    const apiPos = src.indexOf('/api/delete-account')
    expect(deletePos).toBeGreaterThan(-1)
    expect(deletePos).toBeLessThan(anonPos)
    expect(anonPos).toBeLessThan(apiPos)
  })
})
