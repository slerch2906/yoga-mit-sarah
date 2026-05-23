/**
 * Liefert die aktuell deployte App-Version (Vercel-Commit-SHA).
 * Wird vom UpdateBanner alle paar Minuten gepollt um zu erkennen ob
 * eine neue Version deployt wurde (Sarah-Wunsch 2026-05-23).
 *
 * No-cache-Headers, damit der Browser/CDN nie eine alte Version returnt.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  // Update-Banner-Version aus DB lesen (Sarah-Wunsch Option C: manueller Trigger)
  let updateBannerVersion: string | null = null
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data } = await sb.from('admin_announcement')
      .select('update_banner_version').eq('id', 1).maybeSingle()
    updateBannerVersion = (data as any)?.update_banner_version || null
  } catch {}

  return NextResponse.json(
    {
      sha: process.env.NEXT_PUBLIC_BUILD_SHA || 'local',
      date: process.env.NEXT_PUBLIC_BUILD_DATE || null,
      update_banner_version: updateBannerVersion,
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'CDN-Cache-Control': 'no-store',
        'Vercel-CDN-Cache-Control': 'no-store',
      },
    }
  )
}
