import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Welle S1/H8 (Sarah 2026-05-27): Auth-Check fuer AGB-PDF-Upload an Drive.
// Vorher: anonyme POSTs moeglich (denial-of-service / fremde PDFs hochladen).
// Jetzt: Bearer-Token Pflicht. Caller muss eingeloggter Yogi sein — sonst 401.
export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseKey) {
      console.warn('Supabase env missing – skipping Drive upload')
      return NextResponse.json({ ok: true, skipped: true })
    }

    // Welle S1/H8: Bearer-Token pruefen.
    const authHeader = req.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const sb = createClient(supabaseUrl, supabaseKey)
    const { data: userRes, error: userErr } = await sb.auth.getUser(token)
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const payload = await req.json()
    if (!payload || (!payload.base64Pdf && !payload.fullName)) {
      return NextResponse.json({ error: 'Missing data' }, { status: 400 })
    }

    // Supabase Edge Function aufrufen (Body 1:1 forwarden)
    const res = await fetch(`${supabaseUrl}/functions/v1/agb-drive-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify(payload),
    })

    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch (e) {
    console.error('Drive upload route error:', e)
    // Nie den User blockieren — AGB-Akzeptanz darf nicht an einem Drive-Hiccup haengen.
    return NextResponse.json({ ok: true, error: String(e) })
  }
}
