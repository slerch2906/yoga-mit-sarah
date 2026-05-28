// Welle S1/H6 (Sarah 2026-05-27):
// Im Browser → POST an /api/email mit Bearer-Token (Server-Proxy versteckt das
// Edge-Secret). Im Server-Kontext (API-Routes, RPC-Handler, Edge-Cron-Trigger)
// → direkter Edge-Function-Call mit server-only EDGE_FUNCTION_SECRET. So bleibt
// das Secret aus dem Client-Bundle, ohne dass Server-Code einen HTTP-Hop ueber
// sich selbst nimmt.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Welle S2/H21 (Sarah 2026-05-27): 15s-Timeout via AbortController, damit ein
// haengender Brevo/Edge-Call den aufrufenden UI-Flow nicht blockiert. Bei
// AbortError gracefully zurueck — ok:false statt UI-Hang. Return-Shape:
// { ok: boolean, status: number, error?: string } statt void, damit Caller
// (z.B. notifyAllSubscribers, M4) den Erfolg pro Empfaenger tracken koennen.
async function sendEmail(type: string, data: Record<string, any>): Promise<{ ok: boolean; status: number; error?: string }> {
  // Server-side: direkter Edge-Call mit server-only Secret.
  if (typeof window === 'undefined') {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15_000)
    try {
      const edgeSecret = process.env.EDGE_FUNCTION_SECRET || process.env.NEXT_PUBLIC_EDGE_SECRET || ''
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'x-function-secret': edgeSecret,
        },
        body: JSON.stringify({ type, data }),
        signal: controller.signal,
      })
      const result = await res.json().catch(() => ({}))
      console.log('Email sent (server):', type, res.status, result)
      return { ok: res.ok, status: res.status }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        console.error('Email-Edge timeout (server):', type)
        return { ok: false, status: 0, error: 'timeout' }
      }
      console.error('Email send error (server):', type, e)
      return { ok: false, status: 0, error: e?.message || 'unknown' }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // Client-side: ueber /api/email-Proxy. Bearer-Token best-effort beilegen,
  // damit der Server eingeloggte vs. ausgeloggte Caller unterscheiden kann.
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15_000)
  try {
    let accessToken = ''
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const sb = createClient()
      const { data: { session } } = await sb.auth.getSession()
      accessToken = session?.access_token || ''
    } catch {}
    const res = await fetch('/api/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ type, data }),
      signal: controller.signal,
    })
    const result = await res.json().catch(() => ({}))
    console.log('Email sent (client):', type, res.status, result)
    return { ok: res.ok, status: res.status }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      console.error('Email-Edge timeout (client):', type)
      return { ok: false, status: 0, error: 'timeout' }
    }
    console.error('Email send error (client):', type, e)
    return { ok: false, status: 0, error: e?.message || 'unknown' }
  } finally {
    clearTimeout(timeoutId)
  }
}

export const Email = {
  welcome: (data: { email: string; firstName: string; courseName?: string }) =>
    sendEmail('welcome', data),

  // Sarah-Wunsch 2026-05-25: bei is_single Stunden wird im Email-Text
  // "Einzelstunde:" statt "Kurs:" angezeigt. Optional, Default = Kurs.
  // Welle 3.5 (Sarah 2026-05-26): zusätzlich sessionType — Edge Function
  // differenziert dann Texte/Subjects für event_free / event_paid / single.
  bookingConfirmed: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; durationMin: number; isSingle?: boolean; sessionType?: string }) =>
    sendEmail('booking_confirmed', data),

  bookingCancelled: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; creditReturned: boolean; durationMin?: number; isSingle?: boolean; sessionType?: string }) =>
    sendEmail('booking_cancelled', data),

  waitlistJoined: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; position: number; unsubscribeToken?: string; isSingle?: boolean; sessionType?: string }) =>
    sendEmail('waitlist_joined', data),

  waitlistPromoted: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; isSingle?: boolean; sessionType?: string; sessionId?: string }) =>
    sendEmail('waitlist_promoted', data),

  waitlistOfferLate: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; offerToken: string; isSingle?: boolean; sessionType?: string }) =>
    sendEmail('waitlist_offer_late', data),

  sessionCancelled: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; reason?: string; replacementDate?: string; replacementTime?: string; isSingle?: boolean; sessionType?: string }) =>
    sendEmail('session_cancelled', data),

  sessionAdded: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; durationMin: number; originalDate?: string; originalTime?: string; isSingle?: boolean; sessionType?: string }) =>
    sendEmail('session_added', data),

  sessionReminder: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; durationMin: number; hoursBefore: number; isSingle?: boolean; sessionType?: string }) =>
    sendEmail('session_reminder', data),

  waitlistRemovedCreditUsedElsewhere: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; isSingle?: boolean; sessionType?: string }) =>
    sendEmail('waitlist_removed_credit_used_elsewhere', data),

  notifyPlaceFree: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; sessionId: string; isSingle?: boolean; sessionType?: string }) =>
    sendEmail('notify_place_free', data),

  adminNewYogi: (data: { fullName: string; email: string; courseName?: string }) =>
    sendEmail('admin_new_yogi', data),

  invitationSent: (data: { email: string; firstName: string; inviteLink: string; courseName?: string }) =>
    sendEmail('invitation_sent', data),

  invitationReminder: (data: { email: string; firstName: string; inviteLink: string; courseName?: string }) =>
    sendEmail('invitation_reminder', data),

  yogiEnrolledByAdmin: (data: { email: string; firstName: string; courseName: string; weekday: string; timeStart: string; durationMin: number; totalUnits?: number; remainingUnits?: number; dateStart?: string; firstSessionDate?: string }) =>
    sendEmail('yogi_enrolled_by_admin', data),

  // (notifyPlaceFree wurde 2026-05-25 nach oben verschoben mit isSingle-Support)

  courseTimeChanged: (data: { email: string; firstName: string; courseName: string; oldTime: string; newTime: string }) =>
    sendEmail('course_time_changed', data),

  courseCancelled: (data: { email: string; firstName: string; courseName: string; reason: string; remainingSessions: number; refundMode: string; guthabenUrl: string | null }) =>
    sendEmail('course_cancelled', data),

  adminCourseCancelledSummary: (data: { courseName: string; reason: string; remainingSessions: number; yogis: Array<{firstName: string; lastName: string; email: string}> }) =>
    sendEmail('admin_course_cancelled_summary', data),

  // Welle S2/H11 (Sarah 2026-05-27): Admin-Info wenn beim Anlegen eines
  // Ersatztermins der Credit eines Yogis ausserhalb seines Gueltigkeits-
  // Fensters liegt (valid_from in Zukunft oder expires_at vor Ersatztermin).
  // Yogi wird NICHT automatisch eingebucht; Sarah erfaehrt es per Mail +
  // admin_notifications-Eintrag.
  adminReplacementCreditInvalid: (data: { adminEmail?: string; yogiName: string; courseName: string; originalDate: string; replacementDate: string; reason: 'expires_before_replacement' | 'valid_from_after_replacement' }) =>
    sendEmail('admin_replacement_credit_invalid', data),

  adminYogiChoice: (data: { userId: string; courseName: string; choice: 'guthaben' | 'erstattung'; remainingSessions: number }) =>
    sendEmail('admin_yogi_choice', data),

  yogiCourseCancelChoice: (data: { email: string; firstName: string; courseName: string; choice: 'guthaben' | 'erstattung'; refundCredits: number; newPaidCredits: number }) =>
    sendEmail('yogi_course_cancel_choice', data),

  adminGuthabenVerrechnet: (data: { yogiName: string; yogiEmail: string; courseName: string; guthabenAmount: number; courseTotal: number; newCreditsCount: number; guthabenRemaining: number }) =>
    sendEmail('admin_guthaben_verrechnet', data),

  passwordResetRequest: (data: { email: string }) =>
    sendEmail('password_reset_request', data),

  // Welle G (2026-05-25): Krankheits-Austragung mit Guthaben.
  // Yogi wurde krankheitsbedingt aus dem Kurs ausgetragen, bekommt Guthaben
  // ueber die Reststunden (10 Monate gueltig — eigene Frist, weicht von
  // den 2 Jahren des Kursabbruch-Guthabens ab).
  illnessCredit: (data: { email: string; firstName: string; courseName: string; hoursCredited: number; expiresAt: string }) =>
    sendEmail('illness_credit', data),

  // Sarah-Befund 2026-05-25: zentral statt direkter fetch in profil/admin —
  // sonst fehlt x-function-secret und Edge Function antwortet 401.
  adminDsgvoDeletion: (data: { fullName: string; email: string }) =>
    sendEmail('admin_dsgvo_deletion', data),

  // Welle DSGVO-Bestaetigung 2026-05-25: Yogi bekommt VOR dem finalen Auth-Delete
  // eine Bestaetigungs-Mail (Art. 12 DSGVO Transparenz). Diese Mail ist die letzte
  // Nachricht — danach wird auch die Email-Adresse aus der DB entfernt.
  accountDeletedYogi: (data: { email: string; firstName: string }) =>
    sendEmail('account_deleted_yogi', data),
}
