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
      .select('choice')
      .eq('token', token)
      .maybeSingle()
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
  if (choice === 'erstattung') {
    // Verrechnetes Altguthaben dauerhaft entfernen (anti-Trigger-Refund).
    // Der Trigger hat es beim Session-Cancel auto-refundet — wir reduzieren credits.total
    // um den verrechneten Anteil, damit der Yogi nur sein ursprünglich freies Guthaben behält.
    // Wert wird stattdessen in Geld erstattet.
    const { error: rpcErr } = await supabase.rpc('apply_cancellation_refund', { p_response_id: updated.id })
    if (rpcErr) console.error('apply_cancellation_refund:', rpcErr)
  } else if (choice === 'guthaben') {
    // Nur die NEU bezahlten Stunden als neues Guthaben gutschreiben.
    // Das alte verrechnete Guthaben ist vom Trigger schon freigegeben — das ist genau richtig
    // (der Yogi behält den Gegenwert, den er vor dem Kurs schon hatte).
    if (newCreditsCount > 0) {
      const expiry = new Date()
      expiry.setFullYear(expiry.getFullYear() + 2)
      await supabase.from('credits').insert({
        user_id: updated.user_id,
        course_id: null,
        model: 'guthaben',
        total: newCreditsCount,
        used: 0,
        expires_at: expiry.toISOString(),
      })
    }
  }

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
        guthabenCredits: newCreditsCount,
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
