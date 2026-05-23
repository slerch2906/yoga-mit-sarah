/**
 * Bulk-Mail an alle aktiven Yogis (Sarah-Wunsch 2026-05-23).
 *
 * POST /api/admin/bulk-mail mit { subject, body }
 *
 * Sicherheit:
 *  - Erfordert eingeloggten Admin (via Bearer-Token + profiles.is_admin)
 *  - Service-Role-Client für die Yogi-Liste + Email-Versand
 *
 * Filter: is_admin=false, is_dummy=false, email NOT NULL, first_name <> 'Gelöschter'
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const { subject, body } = await req.json()
  if (!subject?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'subject + body sind Pflicht' }, { status: 400 })
  }

  // Service-Role-Client (kann profiles + Edge Function ohne RLS-Stress)
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Auth-Check: nur Admin
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: userRes } = await sb.auth.getUser(token)
  if (!userRes?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: prof } = await sb.from('profiles')
    .select('is_admin').eq('id', userRes.user.id).maybeSingle()
  if (!prof?.is_admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Empfänger-Liste laden
  const { data: recipients } = await sb.from('profiles')
    .select('id, first_name, email')
    .eq('is_dummy', false)
    .eq('is_admin', false)
    .not('email', 'is', null)
    .neq('first_name', 'Gelöschter')

  if (!recipients || recipients.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, total: 0 })
  }

  // Pro Empfänger einzeln senden (kein bcc — DSGVO: keine Email-Liste-Leak)
  let sent = 0; let failed = 0
  for (const r of recipients) {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          'x-function-secret': process.env.EDGE_FUNCTION_SECRET || process.env.NEXT_PUBLIC_EDGE_SECRET || '',
        },
        body: JSON.stringify({
          type: 'admin_bulk_announcement',
          data: { email: r.email, firstName: r.first_name || 'Yogi', subject, body },
        }),
      })
      if (res.ok) sent += 1
      else failed += 1
    } catch (e) {
      failed += 1
    }
  }

  // Audit-Log
  await sb.from('audit_log').insert({
    user_id: userRes.user.id,
    action: 'admin_bulk_mail',
    details: { subject, recipients: recipients.length, sent, failed },
  }).then(() => {}, () => {})

  return NextResponse.json({ sent, failed, total: recipients.length })
}
