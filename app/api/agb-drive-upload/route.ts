import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { base64Pdf, filename } = await req.json()
    if (!base64Pdf || !filename) {
      return NextResponse.json({ error: 'Missing data' }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseKey) {
      console.warn('Supabase env missing – skipping Drive upload')
      return NextResponse.json({ ok: true, skipped: true })
    }

    // Supabase Edge Function aufrufen
    const res = await fetch(`${supabaseUrl}/functions/v1/agb-drive-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ base64Pdf, filename }),
    })

    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    console.error('Drive upload route error:', e)
    // Nie den User blockieren
    return NextResponse.json({ ok: true, error: String(e) })
  }
}
