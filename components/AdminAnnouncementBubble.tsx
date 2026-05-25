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
  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  const [linkLabel, setLinkLabel] = useState<string>('Jetzt anschauen')
  // Sarah-Wunsch 2026-05-25: Cache-Bust nach neuem Foto-Upload — Browser laedt
  // sonst die alte Datei aus dem PWA/SW-Cache. Query-String aendern = neue URL = frischer Fetch.
  const [avatarSrc, setAvatarSrc] = useState('/sarah.jpg?v=20260525b')

  useEffect(() => {
    const supabase = createClient()
    supabase.from('admin_announcement')
      .select('message, is_active, link_url, link_label')
      .eq('id', 1).maybeSingle()
      .then(({ data }) => {
        if (data?.is_active && data?.message?.trim()) {
          setMessage(data.message.trim())
          if (data.link_url) {
            // Link normalisieren: wenn weder absolute URL (http/https)
            // noch interner Pfad (/) → https:// voranstellen.
            // Sonst zerstoert der Browser den relativen Link mit
            // aktueller Domain (Bug 2026-05-24).
            const raw = data.link_url.trim()
            const normalized = /^https?:\/\//i.test(raw) || raw.startsWith('/')
              ? raw
              : `https://${raw}`
            setLinkUrl(normalized)
          }
          if (data.link_label) setLinkLabel(data.link_label)
        }
      })
  }, [])

  if (!message) return null

  return (
    <div className="px-4 pt-3">
      <div className="flex items-center gap-3">
        {/* Avatar (größer + leichter Schatten) */}
        <img
          src={avatarSrc}
          alt="Sarah"
          onError={() => setAvatarSrc(FALLBACK_AVATAR)}
          className="w-[73px] h-[73px] rounded-full object-cover flex-shrink-0 border-2 border-yoga-bg shadow-sm"
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
            {linkUrl && (() => {
              // App-interne Pfade (/...) im selben Tab oeffnen.
              // Externe Links (http/https zu anderer Domain) IMMER in neuem Tab —
              // sonst verlaesst der Yogi die App und kann nicht zurueck.
              const isInternal = linkUrl.startsWith('/')
              return (
                <a href={linkUrl}
                  {...(isInternal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                  className="inline-block mt-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-yoga-text text-white hover:opacity-90">
                  {linkLabel}
                </a>
              )
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}
