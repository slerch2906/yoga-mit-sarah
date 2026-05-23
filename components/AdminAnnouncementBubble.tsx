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
        {/* Sprechblase */}
        <div className="relative flex-1 min-w-0">
          {/* Pfeilchen links unten zur Avatar-Seite */}
          <div className="absolute -left-1.5 bottom-2 w-3 h-3 rotate-45 bg-yoga-amber-bg border-l border-b border-yoga-amber-text/20" />
          <div className="relative bg-yoga-amber-bg border border-yoga-amber-text/20 rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-sm">
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
