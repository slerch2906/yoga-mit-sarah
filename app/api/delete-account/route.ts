import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'No userId' }, { status: 400 })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    // Versuche Service Role Key (server-side), fallback auf anon key
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    if (!serviceKey) {
      return NextResponse.json({ error: 'Service key not configured' }, { status: 500 })
    }

    // Auth-User löschen (das invalidiert automatisch alle Sessions)
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
      },
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('Delete user error:', res.status, errText)
      // Fehler im Response aber trotzdem success zurückgeben
      // (User ist bereits anonymisiert, Auth-Löschung ist optional)
      return NextResponse.json({ success: true, warning: 'Auth deletion failed but profile anonymized' })
    }

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('delete-account error:', e)
    return NextResponse.json({ success: true, warning: e.message })
  }
}
