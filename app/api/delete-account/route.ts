import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Email } from '@/lib/email'

// Welle S1/H1 (Sarah 2026-05-27): Auth-Check für DSGVO-Account-Loeschung.
// Vorher: jeder konnte mit fremder userId einen Admin-Delete ausloesen. Jetzt:
// Bearer-Token Pflicht. User darf nur sich selbst loeschen, ausser er ist Admin.
//
// Sarah 2026-06-01: Die Loesch-Nebenwirkungen (Yogi-Bestaetigungsmail, Admin-Info-Mail,
// Admin-Benachrichtigung) laufen jetzt HIER server-seitig mit Service-Rolle — nicht mehr
// clientseitig. Grund: bei der Selbst-Loeschung lief das clientseitig als Yogi, scheiterte
// teils an RLS (admin_notifications ist "Admin only") bzw. brach durch Navigation/Logout ab
// → Sarah bekam keine Info-Mail. Server-seitig greift es zuverlaessig bei BEIDEN Wegen.
export async function POST(req: NextRequest) {
  try {
    const { userId, email, fullName, firstName } = await req.json()
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

    // Yogi-Bestaetigungsmail VOR dem Auth-Delete (DSGVO Art. 12 — danach ist die
    // Email-Adresse weg). email/firstName kommen vom Client (vor der Anonymisierung erfasst).
    if (email) {
      try { await Email.accountDeletedYogi({ email, firstName: firstName || 'Yogi' }) }
      catch (e) { console.error('accountDeletedYogi (route):', e) }
    }

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

    // Nach erfolgreicher Loeschung: Admin informieren — server-seitig (Service-Rolle,
    // RLS-immun) und unabhaengig vom Client-Flow. Greift damit AUCH bei Selbst-Loeschung.
    try {
      await Email.adminDsgvoDeletion({ fullName: fullName || 'Unbekannt', email: email || '' })
    } catch (e) { console.error('adminDsgvoDeletion (route):', e) }
    try {
      await sb.from('admin_notifications').insert({
        type: 'account_deleted_dsgvo',
        message: `DSGVO: ${fullName || 'Ein Account'}${email ? ` (${email})` : ''} wurde gelöscht. Bitte die AGB-PDF im Google Drive manuell löschen.`,
        details: { user_id: userId, email: email || null, full_name: fullName || null },
        read: false,
      })
    } catch (e) { console.error('account_deleted_dsgvo notif (route):', e) }

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('delete-account error:', e)
    return NextResponse.json({ success: false, error: e?.message || 'unknown' }, { status: 500 })
  }
}
