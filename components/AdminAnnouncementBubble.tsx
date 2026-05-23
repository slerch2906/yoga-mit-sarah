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
    <div className="px-4 pt-3">
      <div className="flex items-end gap-2.5">
        {/* Avatar */}
        <img
          src={avatarSrc}
          alt="Sarah"
          onError={() => setAvatarSrc(FALLBACK_AVATAR)}
          className="w-11 h-11 rounded-full object-cover flex-shrink-0 border-2 border-yoga-bg shadow-sm"
        />
        {/* Sprechblase — gleicher Stil wie normale Stunden-Karten (bg-white + yoga-border) */}
        <div className="relative flex-1 min-w-0">
          {/* Pfeilchen links unten zur Avatar-Seite (weiß mit gleichem Border) */}
          <div className="absolute -left-1.5 bottom-3 w-2.5 h-2.5 rotate-45 bg-white border-l border-b border-yoga-border" />
          <div className="relative bg-white border border-yoga-border rounded-yoga px-4 py-2.5">
            <p className="text-sm text-yoga-text/85 leading-snug">
              {message}
            </p>
            <p className="text-[10px] text-yoga-text/45 mt-1 font-medium">
              Sarah
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
