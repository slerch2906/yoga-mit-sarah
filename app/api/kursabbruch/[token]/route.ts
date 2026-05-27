import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Email } from '@/lib/email'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const { choice } = await req.json()

  if (choice !== 'guthaben' && choice !== 'erstattung') {
    return NextResponse.json({ error: 'Invalid choice' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  // Atomic update – only if choice is still null
  const now = new Date().toISOString()
  const { data: updated, error } = await supabase
    .from('course_cancellation_responses')
    .update({ choice, responded_at: now })
    .eq('token', token)
    .is('choice', null)
    .select('*, course:courses(name), profile:profiles(email, first_name)')
    .maybeSingle()

  if (error) {
    console.error('kursabbruch choice error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!updated) {
    // Already chosen – return current state
    const { data: existing } = await supabase
      .from('course_cancellation_responses')
      .select('choice, user_id, course_id, created_at')
      .eq('token', token)
      .maybeSingle()
    // Welle S2/H13 (Sarah 2026-05-27): Re-Klicks auf den Token-Link wurden
    // bisher stillschweigend verworfen. Jetzt Audit-Spur, damit Sarah merkt,
    // wenn Yogis verwirrt nochmal klicken (Hinweis auf UX-Problem oder
    // Email-Client-Prefetch).
    try {
      await supabase.from('audit_log').insert({
        action: 'kursabbruch_token_reclicked',
        details: {
          token,
          user_id: existing?.user_id ?? null,
          course_id: existing?.course_id ?? null,
          original_choice: existing?.choice ?? null,
          original_choice_at: existing?.created_at ?? null,
        },
      })
    } catch (auditErr) {
      console.error('Audit kursabbruch_token_reclicked:', auditErr)
    }
    return NextResponse.json({ alreadyChosen: existing?.choice })
  }

  const courseName = updated.course?.name || ''
  const yogiEmail = updated.profile?.email
  const yogiFirstName = updated.profile?.first_name || 'Yogi'
  const newCreditsCount = updated.new_credits_count ?? 0
  const guthabenVerrechnet = (Array.isArray(updated.guthaben_breakdown) ? updated.guthaben_breakdown : [])
    .reduce((s: number, item: any) => s + (item?.count ?? 0), 0)
  const totalRefundCredits = updated.remaining_sessions ?? (guthabenVerrechnet + newCreditsCount)

  // === Wirtschaftslogik je nach Wahl ===
  // Provisorisches Guthaben wurde schon beim Cancel angelegt (sichtbar während Wahlfrist).
  // Hier nur noch je nach Choice das Endergebnis herstellen.
  if (choice === 'erstattung') {
    // Welle S2/M5 (Sarah 2026-05-27): Reihenfolge umgedreht — vorher wurde
    // erst der provisorische Credit geloescht und danach apply_cancellation_refund
    // aufgerufen; bei RPC-Fehler war das Yogi-Guthaben weg ohne Erstattung.
    // Jetzt: 1) RPC zuerst — wenn die fehlschlaegt, abbrechen + Audit, Credit
    // bleibt vorhanden. 2) Nur bei RPC-Erfolg den provisorischen Credit loeschen.
    const { error: rpcErr } = await supabase.rpc('apply_cancellation_refund', { p_response_id: updated.id })
    if (rpcErr) {
      console.error('apply_cancellation_refund:', rpcErr)
      try {
        await supabase.from('audit_log').insert({
          user_id: updated.user_id,
          action: 'apply_cancellation_refund_failed',
          details: {
            response_id: updated.id,
            course_id: updated.course_id,
            provisional_credit_id: updated.provisional_credit_id,
            error_message: rpcErr.message,
          },
        })
      } catch (auditErr) { console.error('Audit refund_failed:', auditErr) }
      try {
        await supabase.from('admin_notifications').insert({
          type: 'apply_cancellation_refund_failed',
          message: `Erstattung beim Kursabbruch fehlgeschlagen — Yogi-Guthaben unveraendert. Bitte manuell pruefen.`,
          details: {
            response_id: updated.id,
            user_id: updated.user_id,
            course_id: updated.course_id,
            course_name: courseName,
            error_message: rpcErr.message,
          },
          read: false,
        })
      } catch (notifErr) { console.error('admin_notifications refund_failed:', notifErr) }
      return NextResponse.json({ error: 'refund_failed', message: rpcErr.message }, { status: 500 })
    }
    // RPC ok → provisorisches Guthaben loeschen (Yogi bekommt den Wert in Geld erstattet).
    if (updated.provisional_credit_id) {
      const { error: delErr } = await supabase.from('credits').delete().eq('id', updated.provisional_credit_id)
      if (delErr) console.error('provisional credit delete after refund:', delErr)
    }
  }
  // choice === 'guthaben': nichts mehr tun. Der provisorische Credit bleibt als finale
  // Gutschrift, und das auto-refundete Altguthaben bleibt frei. Yogi behält den vollen Wert.

  // Audit-Log
  try {
    await supabase.from('audit_log').insert({
      user_id: updated.user_id,
      action: 'yogi_course_cancellation_choice',
      details: {
        course_id: updated.course_id,
        course_name: courseName,
        choice,
        remaining_sessions: totalRefundCredits,
        guthaben_verrechnet: guthabenVerrechnet,
        new_credits_count: newCreditsCount,
      },
    })
  } catch (auditErr) {
    console.error('Audit-Log Kursabbruch-Wahl:', auditErr)
  }

  // Yogi-Bestätigungs-Email (Best-Effort)
  if (yogiEmail) {
    try {
      await Email.yogiCourseCancelChoice({
        email: yogiEmail,
        firstName: yogiFirstName,
        courseName,
        choice,
        refundCredits: totalRefundCredits,
        // newPaidCredits = "neu bezahlte Anteile" (provisional credit) — wird vom
        // Edge-Function-Template gebraucht um den verrechneten Altguthaben-Anteil
        // auszurechnen: verrechnet = refundCredits − newPaidCredits.
        newPaidCredits: newCreditsCount,
      })
    } catch (emailErr) {
      console.error('Yogi-Bestätigung Kursabbruch-Wahl:', emailErr)
    }
  }

  // Admin-Email (Best-Effort, schluckt aber loggt)
  try {
    await Email.adminYogiChoice({
      userId: updated.user_id,
      courseName,
      choice,
      remainingSessions: totalRefundCredits,
    })
  } catch (emailErr) {
    console.error('Admin-Email Kursabbruch-Wahl:', emailErr)
  }

  return NextResponse.json({ ok: true, choice })
}
