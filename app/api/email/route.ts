/**
 * Welle S1/H6 (Sarah 2026-05-27):
 * Server-side Email-Proxy. lib/email.ts ruft diese Route an statt der
 * Edge-Function direkt — damit verlaesst NEXT_PUBLIC_EDGE_SECRET das
 * Browser-Bundle. Die Route forwarded an Supabase send-email Edge Function
 * mit dem server-only Secret EDGE_FUNCTION_SECRET.
 *
 * Auth-Modell:
 *  - Eingeloggte Yogis: Bearer-Token aus Authorization Header → sb.auth.getUser
 *  - Auth-lose Email-Typen (Register/PasswordReset-Flow): Whitelist erlaubt
 *    Versand ohne Login. Sonst koennte z.B. niemand eine Password-Reset-Mail
 *    starten oder die Welcome-Mail nach SignUp triggern (Bearer-Token gibt es
 *    zu dem Zeitpunkt noch nicht zuverlaessig).
 *  - admin_*-Typen: wenn eingeloggt → Caller muss is_admin sein. Wenn nicht
 *    eingeloggt → erlauben (kommt z.B. aus dem DSGVO-Loeschen-Flow direkt vor
 *    dem Auth-Delete, wo signOut bereits passiert ist).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Whitelist: Email-Typen die OHNE Login versendet werden duerfen.
// Begruendung:
//  - welcome / invitation_*: Register-Flow vor erstem Login
//  - password_reset_request: Yogi ist ausgeloggt
//  - admin_*: kommen aus Service-Role-Pfaden (Cron, DSGVO-Delete nach SignOut)
//    bzw. admin-only Frontend-Aktionen — Auth-Check passiert dort.
const PUBLIC_TYPES = new Set([
  'welcome',
  'invitation_sent',
  'invitation_reminder',
  'password_reset_request',
  'admin_dsgvo_deletion',
  'admin_new_yogi',
])

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const type = body?.type as string
  const data = body?.data
  if (!type || !data) {
    return NextResponse.json({ error: 'missing type/data' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const edgeSecret = process.env.EDGE_FUNCTION_SECRET || process.env.NEXT_PUBLIC_EDGE_SECRET || ''

  // Auth-Check: Bearer-Token optional je nach Typ.
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()

  let callerUserId: string | null = null
  let callerIsAdmin = false
  if (token) {
    try {
      const sb = createClient(supabaseUrl, serviceKey)
      const { data: userRes } = await sb.auth.getUser(token)
      if (userRes?.user) {
        callerUserId = userRes.user.id
        const { data: prof } = await sb.from('profiles').select('is_admin').eq('id', callerUserId).maybeSingle()
        callerIsAdmin = !!prof?.is_admin
      }
    } catch (e) {
      console.error('email-route auth:', e)
    }
  }

  const isPublic = PUBLIC_TYPES.has(type)
  const isAdminType = type.startsWith('admin_')

  if (!callerUserId && !isPublic) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  // admin_*-Typ + eingeloggt aber kein Admin → blockieren (Anti-Spoof) — ABER NICHT
  // bei den als PUBLIC gewhitelisteten admin_*-Typen. Grund: 'admin_new_yogi' wird
  // genau vom frisch registrierten (eingeloggten, NICHT-Admin) Yogi ausgelöst; die
  // 403-Sperre hat diese Admin-Benachrichtigung bisher still geschluckt → kam nie an.
  // (Sarah 2026-06-02 Fix.)
  if (isAdminType && callerUserId && !callerIsAdmin && !isPublic) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // 1:1-Forward an Edge Function send-email mit server-only Secret.
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'x-function-secret': edgeSecret,
      },
      body: JSON.stringify({ type, data }),
    })
    const json = await res.json().catch(() => ({}))
    return NextResponse.json(json, { status: res.status })
  } catch (e: any) {
    console.error('email proxy error:', e)
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
