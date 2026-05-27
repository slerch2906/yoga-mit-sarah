// Wird von pg_cron alle 15 Minuten gerufen. Sendet Stunden-Erinnerungs-Emails.
// Welle 6.1 (Sarah 2026-05-27): sessionType wird durchgereicht damit send-email
// das richtige Kurs-Label (Einzelstunde / Event / Kurs) im Subject + Body verwendet.
// Welle S3/N9 (Sarah 2026-05-27): Source ins Repo gespiegelt für Audit + Versionierung.
//
// Deployment-Version: v4+ (siehe supabase/migrations und git log).
// Deno-Runtime: Edge-Function. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + ANON_KEY + EDGE_FUNCTION_SECRET als Env.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: pending, error: qErr } = await sb.rpc('find_pending_session_reminders')
  if (qErr) {
    console.error('find_pending_session_reminders error:', qErr)
    return new Response(JSON.stringify({ ok: false, error: qErr.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  let sent = 0, failed = 0
  const sendEmailUrl = Deno.env.get('SUPABASE_URL')! + '/functions/v1/send-email'
  const edgeSecret = Deno.env.get('EDGE_FUNCTION_SECRET') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''

  for (const r of (pending || [])) {
    try {
      const emailRes = await fetch(sendEmailUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + anonKey,
          'apikey': anonKey,
          'x-function-secret': edgeSecret,
        },
        body: JSON.stringify({
          type: 'session_reminder',
          data: {
            email: r.email,
            firstName: r.first_name || 'Yogi',
            courseName: r.course_name || '',
            sessionType: r.session_type || 'course_session',
            date: r.session_date,
            timeStart: r.session_time,
            durationMin: r.duration_min || 75,
            hoursBefore: r.hours_before,
          }
        }),
      })
      if (!emailRes.ok) { failed++; console.error('Email failed:', await emailRes.text()); continue }
      await sb.rpc('log_notification_sent', { p_user_id: r.user_id, p_session_id: r.session_id, p_type: 'session_reminder' })
      sent++
    } catch (e) {
      failed++
      console.error('Reminder send error:', e)
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, failed, total: (pending || []).length }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
