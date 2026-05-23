/**
 * Waitlist-Offer-Annahme API (Sarah-Wunsch 2026-05-23).
 *
 * Wenn ein Yogi den magic-Link aus der waitlist_offer_late-Email klickt,
 * landet er auf der Page → die ruft diese Route auf.
 *
 * Atomic: nur 1 Yogi kann pro Session den Platz gewinnen. Race-safe via
 * UPDATE...WHERE resolved_winner_user_id IS NULL Condition.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // 1) Offer holen
  const { data: offer } = await supabase.from('waitlist_offers')
    .select('*, session:sessions(id, date, time_start, is_cancelled, course:courses(name))')
    .eq('token', token).maybeSingle()
  if (!offer) return NextResponse.json({ error: 'invalid_token' }, { status: 404 })

  // 2) Bereits abgelaufen? (Session-Start vorbei)
  const sessionStart = new Date(`${(offer as any).session?.date}T${(offer as any).session?.time_start}`).getTime()
  if (Date.now() >= sessionStart || (offer as any).session?.is_cancelled) {
    return NextResponse.json({ error: 'expired' }, { status: 410 })
  }

  // 3) Bereits jemand schneller? Pro Session-ID nur 1 Gewinner
  const { data: existingWinner } = await supabase.from('waitlist_offers')
    .select('user_id, resolved_winner_user_id')
    .eq('session_id', (offer as any).session_id)
    .not('resolved_winner_user_id', 'is', null)
    .maybeSingle()
  if (existingWinner) {
    if ((existingWinner as any).resolved_winner_user_id === (offer as any).user_id) {
      return NextResponse.json({ ok: true, already_won: true })
    }
    return NextResponse.json({ error: 'too_late' }, { status: 409 })
  }

  // 4) Atomically: setze resolved_winner_user_id auf diesen User für ALLE offers dieser session
  //    Aber nur wenn noch kein Gewinner gesetzt ist (UPDATE WHERE)
  const { data: claimedRows } = await supabase.from('waitlist_offers')
    .update({ resolved_winner_user_id: (offer as any).user_id, claimed_at: new Date().toISOString() })
    .eq('session_id', (offer as any).session_id)
    .is('resolved_winner_user_id', null)
    .select('id')
  if (!claimedRows || claimedRows.length === 0) {
    return NextResponse.json({ error: 'too_late' }, { status: 409 })
  }

  // 5) Yogi-Credit picken (single oder course)
  const nowIso = new Date().toISOString()
  const { data: credits } = await supabase.from('credits')
    .select('id, total, used, model').eq('user_id', (offer as any).user_id)
    .gt('expires_at', nowIso)
  const free = (credits || []).filter((c: any) => c.total > c.used && c.model !== 'guthaben')
  if (free.length === 0) {
    // Yogi hat keine Credits mehr — Angebot zurückrollen damit nächster Yogi noch klicken kann
    await supabase.from('waitlist_offers').update({ resolved_winner_user_id: null, claimed_at: null })
      .eq('session_id', (offer as any).session_id)
    return NextResponse.json({ error: 'no_credit' }, { status: 402 })
  }
  const credit = free[0]

  // 6) Booking anlegen
  await supabase.from('bookings').upsert({
    user_id: (offer as any).user_id, session_id: (offer as any).session_id,
    credit_id: credit.id, type: 'single', status: 'active',
    cancelled_at: null, cancel_late: false,
  }, { onConflict: 'user_id,session_id' })

  // 7) Waitlist-Eintrag entfernen
  await supabase.from('waitlist')
    .delete().eq('user_id', (offer as any).user_id).eq('session_id', (offer as any).session_id)

  // 8) Audit-Log
  await supabase.from('audit_log').insert({
    user_id: (offer as any).user_id,
    action: 'waitlist_offer_late_accepted',
    details: { session_id: (offer as any).session_id, offer_id: (offer as any).id },
  })

  return NextResponse.json({
    ok: true,
    courseName: (offer as any).session?.course?.name,
    date: (offer as any).session?.date,
    timeStart: (offer as any).session?.time_start,
  })
}
