import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Welle S1/H1 (Sarah 2026-05-27): Auth-Check für DSGVO-Account-Loeschung.
// Vorher: jeder konnte mit fremder userId einen Admin-Delete ausloesen. Jetzt:
// Bearer-Token Pflicht. User darf nur sich selbst loeschen, ausser er ist Admin.
export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'No userId' }, { status: 400 })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    if (!serviceKey) {
      return NextResponse.json({ error: 'Service key not configured' }, { status: 500 })
    }

    // Welle S1/H1: Bearer-Token aus Authorization-Header pruefen.
    const authHeader = req.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const sb = createClient(supabaseUrl, serviceKey)
    const { data: userRes, error: userErr } = await sb.auth.getUser(token)
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const callerId = userRes.user.id

    // Admin-Override: Admin darf fremde User loeschen (selten, aber DSGVO-Helfer).
    let allowed = callerId === userId
    if (!allowed) {
      const { data: prof } = await sb.from('profiles').select('is_admin').eq('id', callerId).maybeSingle()
      allowed = !!prof?.is_admin
    }
    if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

    // Auth-User loeschen (das invalidiert automatisch alle Sessions)
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
      // Sarah-Fix 2026-05-29 (Fall 4, "voll absichern"): NICHT mehr faelschlich
      // success:true zurueckgeben. Der Auth-User existiert dann noch (Profil ist
      // zwar anonymisiert, aber Login/Session waere theoretisch wieder moeglich).
      // Stattdessen ehrlich melden UND Admin benachrichtigen, damit Sarah den
      // Auth-User manuell im Supabase-Dashboard loeschen kann.
      try {
        await sb.from('admin_notifications').insert({
          type: 'auth_delete_failed',
          message: 'DSGVO-Loeschung: Auth-User konnte NICHT geloescht werden — bitte manuell im Supabase-Dashboard entfernen.',
          details: { user_id: userId, status: res.status, error: errText?.slice(0, 500) },
          read: false,
        })
      } catch (notifErr) { console.error('admin_notifications auth_delete_failed:', notifErr) }
      return NextResponse.json(
        { success: false, error: 'auth_deletion_failed', detail: errText?.slice(0, 500) },
        { status: 502 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('delete-account error:', e)
    return NextResponse.json({ success: false, error: e?.message || 'unknown' }, { status: 500 })
  }
}
