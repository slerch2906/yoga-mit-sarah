/**
 * Liefert die aktuell deployte App-Version (Vercel-Commit-SHA).
 * Wird vom UpdateBanner alle paar Minuten gepollt um zu erkennen ob
 * eine neue Version deployt wurde (Sarah-Wunsch 2026-05-23).
 *
 * No-cache-Headers, damit der Browser/CDN nie eine alte Version returnt.
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return NextResponse.json(
    {
      sha: process.env.NEXT_PUBLIC_BUILD_SHA || 'local',
      date: process.env.NEXT_PUBLIC_BUILD_DATE || null,
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
