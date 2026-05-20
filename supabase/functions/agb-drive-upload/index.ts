import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const DRIVE_FOLDER_ID = '1CMD8ItxOg1kqFi7l0inP0dUzWCYgRz4z'

async function getAccessToken(): Promise<string> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const refreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN')

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google OAuth secrets not configured')
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  const data = await res.json()
  if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data))
  return data.access_token
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    })
  }

  try {
    const { base64Pdf, filename } = await req.json()
    if (!base64Pdf || !filename) {
      return new Response(JSON.stringify({ error: 'Missing data' }), { status: 400 })
    }

    const accessToken = await getAccessToken()
    const boundary = 'yoga_agb_boundary_xyz'

    const metadata = JSON.stringify({
      name: filename,
      mimeType: 'application/pdf',
      parents: [DRIVE_FOLDER_ID],
    })

    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      `--${boundary}`,
      'Content-Type: application/pdf',
      'Content-Transfer-Encoding: base64',
      '',
      base64Pdf,
      `--${boundary}--`,
    ].join('\r\n')

    const driveRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary="${boundary}"`,
        },
        body,
      }
    )

    const driveData = await driveRes.json()
    if (!driveRes.ok) throw new Error(JSON.stringify(driveData))

    return new Response(JSON.stringify({ ok: true, fileId: driveData.id }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  } catch (e) {
    console.error('Edge function error:', e)
    return new Response(JSON.stringify({ ok: true, skipped: true, error: String(e) }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
})
