const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function sendEmail(type: string, data: Record<string, any>): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'x-function-secret': process.env.NEXT_PUBLIC_EDGE_SECRET || '',
      },
      body: JSON.stringify({ type, data }),
    })
    const result = await res.json().catch(() => ({}))
    console.log('Email sent:', type, res.status, result)
  } catch (e) {
    console.error('Email send error:', type, e)
  }
}

export const Email = {
  welcome: (data: { email: string; firstName: string; courseName?: string }) =>
    sendEmail('welcome', data),

  bookingConfirmed: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; durationMin: number }) =>
    sendEmail('booking_confirmed', data),

  bookingCancelled: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; creditReturned: boolean }) =>
    sendEmail('booking_cancelled', data),

  waitlistJoined: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; position: number; unsubscribeToken?: string }) =>
    sendEmail('waitlist_joined', data),

  waitlistPromoted: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string }) =>
    sendEmail('waitlist_promoted', data),

  // Sarah-Wunsch 2026-05-23: 90-Min-Cutoff → alle Waitlist-Yogis kriegen gleichzeitig
  // diese Mail mit magic-Link. Wer zuerst klickt, kriegt den Platz.
  waitlistOfferLate: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; offerToken: string }) =>
    sendEmail('waitlist_offer_late', data),

  sessionCancelled: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; reason?: string; replacementDate?: string; replacementTime?: string }) =>
    sendEmail('session_cancelled', data),

  sessionAdded: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; durationMin: number; originalDate?: string; originalTime?: string }) =>
    sendEmail('session_added', data),

  sessionReminder: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; durationMin: number; hoursBefore: number }) =>
    sendEmail('session_reminder', data),

  waitlistRemovedCreditUsedElsewhere: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string }) =>
    sendEmail('waitlist_removed_credit_used_elsewhere', data),

  adminNewYogi: (data: { fullName: string; email: string; courseName?: string }) =>
    sendEmail('admin_new_yogi', data),

  invitationSent: (data: { email: string; firstName: string; inviteLink: string; courseName?: string }) =>
    sendEmail('invitation_sent', data),

  invitationReminder: (data: { email: string; firstName: string; inviteLink: string; courseName?: string }) =>
    sendEmail('invitation_reminder', data),

  yogiEnrolledByAdmin: (data: { email: string; firstName: string; courseName: string; weekday: string; timeStart: string; durationMin: number; totalUnits?: number; remainingUnits?: number; dateStart?: string; firstSessionDate?: string }) =>
    sendEmail('yogi_enrolled_by_admin', data),

  notifyPlaceFree: (data: { email: string; firstName: string; courseName: string; date: string; timeStart: string; sessionId: string }) =>
    sendEmail('notify_place_free', data),

  courseTimeChanged: (data: { email: string; firstName: string; courseName: string; oldTime: string; newTime: string }) =>
    sendEmail('course_time_changed', data),

  courseCancelled: (data: { email: string; firstName: string; courseName: string; reason: string; remainingSessions: number; refundMode: string; guthabenUrl: string | null }) =>
    sendEmail('course_cancelled', data),

  adminCourseCancelledSummary: (data: { courseName: string; reason: string; remainingSessions: number; yogis: Array<{firstName: string; lastName: string; email: string}> }) =>
    sendEmail('admin_course_cancelled_summary', data),

  adminYogiChoice: (data: { userId: string; courseName: string; choice: 'guthaben' | 'erstattung'; remainingSessions: number }) =>
    sendEmail('admin_yogi_choice', data),

  yogiCourseCancelChoice: (data: { email: string; firstName: string; courseName: string; choice: 'guthaben' | 'erstattung'; refundCredits: number; newPaidCredits: number }) =>
    sendEmail('yogi_course_cancel_choice', data),

  adminGuthabenVerrechnet: (data: { yogiName: string; yogiEmail: string; courseName: string; guthabenAmount: number; courseTotal: number; newCreditsCount: number; guthabenRemaining: number }) =>
    sendEmail('admin_guthaben_verrechnet', data),

  passwordResetRequest: (data: { email: string }) =>
    sendEmail('password_reset_request', data),
}
