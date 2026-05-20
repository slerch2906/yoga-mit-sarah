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
    .select('*, course:courses(name)')
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

  // Credit anlegen bei Guthaben-Wahl
  if (choice === 'guthaben') {
    const expiry = new Date()
    expiry.setFullYear(expiry.getFullYear() + 2)
    await supabase.from('credits').insert({
      user_id: updated.user_id,
      course_id: null,
      model: 'guthaben',
      total: updated.remaining_sessions,
      used: 0,
      expires_at: expiry.toISOString(),
    })
  }

  // Admin-Email – server-side, kein fire-and-forget
  await Email.adminYogiChoice({
    userId: updated.user_id,
    courseName: updated.course?.name || '',
    choice,
    remainingSessions: updated.remaining_sessions,
  })

  return NextResponse.json({ ok: true, choice })
}
