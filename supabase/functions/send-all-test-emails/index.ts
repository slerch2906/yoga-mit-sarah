import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Test-Hilfsfunktion (Sarah-Wunsch 2026-05-28): schickt EINMAL jedes Email-
// Template (inkl. aller Event-/Einzelstunden-Varianten) an eine Zieladresse,
// damit Sarah in Brevo alle Mails optisch prüfen kann. Die E2E-Suite verschickt
// bewusst keine Mails (Source-/DB-Checks), daher dieser separate Vollständigkeits-
// Versand. verify_jwt ist aus → einfacher GET-Aufruf der Funktions-URL genügt.
// Aufruf: GET .../functions/v1/send-all-test-emails?to=DEINE@MAIL.de

const APP_URL = 'https://kurse.yogamitsarah.me'

serve(async (req) => {
  const url = new URL(req.url)
  const target = url.searchParams.get('to') || 'slerch2906@gmail.com'
  const firstName = url.searchParams.get('name') || 'Sarah'
  const userId = url.searchParams.get('userId') || 'ac5563aa-3ebb-42dd-b322-544550051d26'

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  // send-email hat verify_jwt:true → der anon-Key (neues sb_-Format) ist kein
  // gültiges JWT → 401. Wie die App nutzen wir daher den Service-Role-Key als Bearer.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!
  const secret = Deno.env.get('EDGE_FUNCTION_SECRET') || ''

  const today = new Date()
  const inDays = (n: number) => {
    const d = new Date(today); d.setDate(d.getDate() + n)
    return d.toISOString().split('T')[0]
  }
  const courseName = 'Body & Mind'
  const singleName = 'Einzelstunde Rücken'
  const eventFreeName = 'Charity-Yoga (kostenlos)'
  const eventPaidName = 'Workshop Faszien (bezahlt)'
  const date = inDays(7)
  const inviteLink = APP_URL + '/register?token=DEMO_TOKEN_FOR_PREVIEW'
  const guthabenUrl = APP_URL + '/kursabbruch/DEMO_TOKEN'
  const offerToken = 'DEMO_OFFER_TOKEN'
  const demoSession = '00000000-0000-0000-0000-000000000001'
  const unsubToken = '00000000-0000-0000-0000-000000000000'
  const ts = '18:30:00'

  const templates: Array<{ label: string, type: string, data: any }> = [
    { label: '01 welcome', type: 'welcome', data: { email: target, firstName, courseName } },
    { label: '02 invitation_sent', type: 'invitation_sent', data: { email: target, firstName, inviteLink, courseName } },
    { label: '03 invitation_reminder', type: 'invitation_reminder', data: { email: target, firstName, inviteLink, courseName } },
    { label: '04 admin_bulk_announcement', type: 'admin_bulk_announcement', data: {
      email: target, firstName, subject: 'Info: Studio bleibt nächste Woche geschlossen',
      body: 'Liebe Yogis,\n\nnächste Woche ist das Studio wegen Renovierung geschlossen.\nWir sehen uns in zwei Wochen wieder!\n\nNamasté',
    } },
    { label: '05 yogi_enrolled_by_admin (mid-course)', type: 'yogi_enrolled_by_admin', data: {
      email: target, firstName, courseName,
      weekday: 'Dienstag', timeStart: ts, durationMin: 75,
      totalUnits: 8, remainingUnits: 6, dateStart: inDays(-14), firstSessionDate: date,
    } },
    // booking_confirmed — alle 4 Typen
    { label: '06 booking_confirmed (Kursstunde)', type: 'booking_confirmed', data: {
      email: target, firstName, courseName, date, timeStart: ts, durationMin: 75, sessionType: 'course_session',
    } },
    { label: '07 booking_confirmed (Einzelstunde)', type: 'booking_confirmed', data: {
      email: target, firstName, courseName: singleName, date, timeStart: ts, durationMin: 75, sessionType: 'single',
    } },
    { label: '08 booking_confirmed (Event kostenlos)', type: 'booking_confirmed', data: {
      email: target, firstName, courseName: eventFreeName, date, timeStart: ts, durationMin: 75, sessionType: 'event_free',
    } },
    { label: '09 booking_confirmed (Event bezahlt)', type: 'booking_confirmed', data: {
      email: target, firstName, courseName: eventPaidName, date, timeStart: ts, durationMin: 75, sessionType: 'event_paid',
    } },
    // booking_cancelled — Kurs (credit/kein credit) + Events
    { label: '10 booking_cancelled (Credit zurück)', type: 'booking_cancelled', data: {
      email: target, firstName, courseName, date, timeStart: ts, creditReturned: true, sessionType: 'course_session',
    } },
    { label: '11 booking_cancelled (kein Credit / zu spät)', type: 'booking_cancelled', data: {
      email: target, firstName, courseName, date, timeStart: ts, creditReturned: false, sessionType: 'course_session',
    } },
    { label: '12 booking_cancelled (Event kostenlos)', type: 'booking_cancelled', data: {
      email: target, firstName, courseName: eventFreeName, date, timeStart: ts, creditReturned: false, sessionType: 'event_free',
    } },
    { label: '13 booking_cancelled (Event bezahlt)', type: 'booking_cancelled', data: {
      email: target, firstName, courseName: eventPaidName, date, timeStart: ts, creditReturned: false, sessionType: 'event_paid',
    } },
    // waitlist_joined — Kurs + Events
    { label: '14 waitlist_joined (Kurs)', type: 'waitlist_joined', data: {
      email: target, firstName, courseName, date, timeStart: ts, position: 2, unsubscribeToken: unsubToken, sessionType: 'course_session',
    } },
    { label: '15 waitlist_joined (Event kostenlos)', type: 'waitlist_joined', data: {
      email: target, firstName, courseName: eventFreeName, date, timeStart: ts, position: 2, unsubscribeToken: unsubToken, sessionType: 'event_free',
    } },
    { label: '16 waitlist_joined (Event bezahlt)', type: 'waitlist_joined', data: {
      email: target, firstName, courseName: eventPaidName, date, timeStart: ts, position: 2, unsubscribeToken: unsubToken, sessionType: 'event_paid',
    } },
    // waitlist_promoted (Auto-Nachrücken) — Kurs/Einzel (mit Wieder-absagen-Button) + Events
    { label: '17 waitlist_promoted (Kurs)', type: 'waitlist_promoted', data: {
      email: target, firstName, courseName, date, timeStart: ts, sessionType: 'course_session', sessionId: demoSession,
    } },
    { label: '18 waitlist_promoted (Einzelstunde)', type: 'waitlist_promoted', data: {
      email: target, firstName, courseName: singleName, date, timeStart: ts, sessionType: 'single', sessionId: demoSession,
    } },
    { label: '19 waitlist_promoted (Event kostenlos)', type: 'waitlist_promoted', data: {
      email: target, firstName, courseName: eventFreeName, date, timeStart: ts, sessionType: 'event_free',
    } },
    { label: '20 waitlist_promoted (Event bezahlt)', type: 'waitlist_promoted', data: {
      email: target, firstName, courseName: eventPaidName, date, timeStart: ts, sessionType: 'event_paid',
    } },
    // waitlist_offer_late (Spätangebot ≤90min) — Kurs/Einzel/Event
    { label: '21 waitlist_offer_late (Kurs)', type: 'waitlist_offer_late', data: {
      email: target, firstName, courseName, date, timeStart: ts, offerToken, sessionType: 'course_session',
    } },
    { label: '22 waitlist_offer_late (Einzelstunde)', type: 'waitlist_offer_late', data: {
      email: target, firstName, courseName: singleName, date, timeStart: ts, offerToken, sessionType: 'single',
    } },
    { label: '23 waitlist_offer_late (Event)', type: 'waitlist_offer_late', data: {
      email: target, firstName, courseName: eventFreeName, date, timeStart: ts, offerToken, sessionType: 'event_free',
    } },
    { label: '24 waitlist_removed_credit_used_elsewhere', type: 'waitlist_removed_credit_used_elsewhere', data: {
      email: target, firstName, courseName, date, timeStart: ts,
    } },
    { label: '25 notify_place_free', type: 'notify_place_free', data: {
      email: target, firstName, courseName, date, timeStart: ts, sessionId: demoSession,
    } },
    { label: '26 session_reminder', type: 'session_reminder', data: {
      email: target, firstName, courseName, date, timeStart: ts, durationMin: 75, hoursBefore: 4,
    } },
    // session_cancelled — Kursstunde (ohne/mit Ersatz) + Events
    { label: '27 session_cancelled (Kursstunde, ohne Ersatz)', type: 'session_cancelled', data: {
      email: target, firstName, courseName, date, timeStart: ts, reason: 'Ich bin krank, sorry.', sessionType: 'course_session',
    } },
    { label: '28 session_cancelled (Kursstunde, mit Ersatz)', type: 'session_cancelled', data: {
      email: target, firstName, courseName, date, timeStart: ts, reason: 'Krankheit',
      replacementDate: inDays(10), replacementTime: ts, sessionType: 'course_session',
    } },
    { label: '29 session_cancelled (Event kostenlos)', type: 'session_cancelled', data: {
      email: target, firstName, courseName: eventFreeName, date, timeStart: ts, reason: 'Wetter', sessionType: 'event_free',
    } },
    { label: '30 session_cancelled (Event bezahlt)', type: 'session_cancelled', data: {
      email: target, firstName, courseName: eventPaidName, date, timeStart: ts, reason: 'Zu wenig Anmeldungen', sessionType: 'event_paid',
    } },
    { label: '31 session_added (Ersatztermin)', type: 'session_added', data: {
      email: target, firstName, courseName, date: inDays(10), timeStart: ts, durationMin: 75,
      originalDate: date, originalTime: ts,
    } },
    { label: '32 course_time_changed', type: 'course_time_changed', data: {
      email: target, firstName, courseName, oldTime: '18:00:00', newTime: ts,
    } },
    { label: '33 course_cancelled (yogi_choice)', type: 'course_cancelled', data: {
      email: target, firstName, courseName, reason: 'Kurs muss leider entfallen',
      remainingSessions: 4, refundMode: 'yogi_choice', guthabenUrl,
    } },
    { label: '34 course_cancelled (all_refund)', type: 'course_cancelled', data: {
      email: target, firstName, courseName, reason: 'Kurs entfällt',
      remainingSessions: 4, refundMode: 'all_refund', guthabenUrl: null,
    } },
    { label: '35 admin_course_cancelled_summary', type: 'admin_course_cancelled_summary', data: {
      courseName, reason: 'Kurs entfällt', remainingSessions: 4,
      yogis: [
        { firstName: 'Anna', lastName: 'Beispiel', email: 'anna@example.com' },
        { firstName: 'Bernd', lastName: 'Muster', email: 'bernd@example.com' },
      ],
    } },
    { label: '36 admin_yogi_choice (guthaben)', type: 'admin_yogi_choice', data: {
      userId, courseName, choice: 'guthaben', remainingSessions: 4,
    } },
    { label: '37 admin_yogi_choice (erstattung)', type: 'admin_yogi_choice', data: {
      userId, courseName, choice: 'erstattung', remainingSessions: 4,
    } },
    { label: '38 yogi_course_cancel_choice (guthaben)', type: 'yogi_course_cancel_choice', data: {
      email: target, firstName, courseName, choice: 'guthaben', refundCredits: 4, newPaidCredits: 2,
    } },
    { label: '39 yogi_course_cancel_choice (erstattung, mit verrechnetem Altguthaben)', type: 'yogi_course_cancel_choice', data: {
      email: target, firstName, courseName, choice: 'erstattung', refundCredits: 4, newPaidCredits: 2,
    } },
    { label: '40 yogi_course_cancel_choice (erstattung, ohne Altguthaben)', type: 'yogi_course_cancel_choice', data: {
      email: target, firstName, courseName, choice: 'erstattung', refundCredits: 3, newPaidCredits: 3,
    } },
    { label: '41 admin_guthaben_verrechnet', type: 'admin_guthaben_verrechnet', data: {
      yogiName: 'Anna Beispiel', yogiEmail: 'anna@example.com', courseName,
      guthabenAmount: 2, courseTotal: 6, newCreditsCount: 4, guthabenRemaining: 1,
    } },
    { label: '42 illness_credit', type: 'illness_credit', data: {
      email: target, firstName, courseName, hoursCredited: 3, expiresAt: inDays(730),
    } },
    { label: '43 admin_guthaben_2y_expiry', type: 'admin_guthaben_2y_expiry', data: {
      yogiName: 'Anna Beispiel', yogiEmail: 'anna@example.com', unusedCredits: 3,
      originalCourseName: courseName, creditCreatedAt: inDays(-730),
    } },
    { label: '44 admin_dsgvo_deletion', type: 'admin_dsgvo_deletion', data: {
      fullName: 'Anna Beispiel', email: 'anna@example.com',
    } },
    { label: '45 admin_new_yogi', type: 'admin_new_yogi', data: {
      fullName: 'Anna Beispiel', email: 'anna@example.com', courseName,
    } },
    { label: '46 account_deleted_yogi', type: 'account_deleted_yogi', data: {
      email: target, firstName,
    } },
  ]

  const results: Array<{ label: string, type: string, status: number }> = []
  for (const t of templates) {
    try {
      const res = await fetch(supabaseUrl + '/functions/v1/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + serviceKey,
          'apikey': serviceKey,
          'x-function-secret': secret,
        },
        body: JSON.stringify({ type: t.type, data: t.data }),
      })
      results.push({ label: t.label, type: t.type, status: res.status })
    } catch (_e) {
      results.push({ label: t.label, type: t.type, status: -1 })
    }
    // Brevo Rate-Limit schützen + Reihenfolge im Postfach
    await new Promise(r => setTimeout(r, 800))
  }

  return new Response(JSON.stringify({
    ok: true,
    sent_to: target,
    total: templates.length,
    results,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } })
})
