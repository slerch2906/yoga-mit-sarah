'use client'

/**
 * Sprechblase mit Sarah-Avatar + Nachricht (Sarah-Wunsch 2026-05-23).
 *
 * Wird auf /kurse zwischen Header und Wochen-Navigation angezeigt,
 * NUR wenn admin_announcement.is_active=true UND message nicht leer.
 *
 * Daten kommen aus public.admin_announcement (Single-Row-Tabelle).
 * Avatar: /public/sarah.jpg (Fallback: App-Logo).
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const FALLBACK_AVATAR = 'https://yogamitsarah.me/wp-content/uploads/2025/09/Logo-300x300.png'

export default function AdminAnnouncementBubble() {
  const [message, setMessage] = useState<string | null>(null)
  const [avatarSrc, setAvatarSrc] = useState('/sarah.jpg')

  useEffect(() => {
    const supabase = createClient()
    supabase.from('admin_announcement')
      .select('message, is_active')
      .eq('id', 1).maybeSingle()
      .then(({ data }) => {
        if (data?.is_active && data?.message?.trim()) {
          setMessage(data.message.trim())
        }
      })
  }, [])

  if (!message) return null

  return (
    <div className="px-4 pt-3 bubble-breathe">
      <div className="flex items-center gap-3">
        {/* Avatar (größer + leichter Schatten) */}
        <img
          src={avatarSrc}
          alt="Sarah"
          onError={() => setAvatarSrc(FALLBACK_AVATAR)}
          className="w-14 h-14 rounded-full object-cover flex-shrink-0 border-2 border-yoga-bg shadow-sm"
        />
        {/* Sprechblase — bg-white + yoga-border, Text mittig zentriert */}
        <div className="relative flex-1 min-w-0">
          {/* Pfeil-Technik: zwei CSS-Triangles übereinander (Outline + Fill).
              Outline-Farbe IDENTISCH zu Bubble-Border (rgba(68,60,60,0.15)
              = Tailwind border-yoga-border). Inner-Triangle weiß deckt die
              rechte Outline-Hälfte ab — so geht der Pfeil nahtlos in die
              Bubble über, gleicher Rand wie die Bubble selbst. */}
          <div className="absolute -left-[7px] top-1/2 -translate-y-1/2 w-0 h-0"
            style={{ borderTop: '7px solid transparent', borderBottom: '7px solid transparent', borderRight: '7px solid rgba(68,60,60,0.15)' }} />
          <div className="absolute -left-[6px] top-1/2 -translate-y-1/2 w-0 h-0"
            style={{ borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderRight: '6px solid #ffffff' }} />
          <div className="relative bg-white border border-yoga-border rounded-yoga px-4 py-3 text-center">
            <p className="text-sm text-yoga-text/85 leading-snug">
              {message}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
