'use client'

/**
 * Welle 6.1 (Sarah 2026-05-27): Yogi-Dashboard-Banner für abgesagte
 * Stunden / Events.
 *
 * Zeigt für jeden offenen Eintrag in `yogi_notifications` (type='event_cancelled'
 * oder 'session_cancelled') einen weißen Banner mit:
 *  - "Dein Event/Deine Stunde „{Titel}" wurde abgesagt"
 *  - Grund (falls vorhanden)
 *  - Bei event_paid: "Gebühr wird zurückerstattet!"
 *  - Bei event_free / Kursstunde / Einzelstunde: kein Bezahl-Hinweis
 *  - X-Button zum Wegklicken (UPDATE dismissed_at=now())
 *
 * Style: weißer Hintergrund, kein Icon, dezenter Rand — Sarah-Wahl.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/auth'

interface YogiNotification {
  id: string
  type: string
  payload: any
  created_at: string
}

export default function YogiCancelNotifications() {
  const [items, setItems] = useState<YogiNotification[]>([])
  // Welle S3/M1 (Sarah 2026-05-27): user_id im Component-State halten, damit
  // wir bei dismiss() denselben Filter wie beim Read mitgeben koennen.
  const [userId, setUserId] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => { void load() }, [])

  async function load() {
    // Welle S3/M1 (Sarah 2026-05-27): Defense-in-Depth — zusaetzlich zu RLS
    // einen expliziten user_id-Filter mitgeben. Falls RLS jemals bricht,
    // sieht der Yogi trotzdem keine fremden Notifications.
    const user = await getCurrentUser()
    if (!user) { setItems([]); return }
    setUserId(user.id)
    const { data } = await supabase
      .from('yogi_notifications')
      .select('id, type, payload, created_at')
      .eq('user_id', user.id)
      .is('dismissed_at', null)
      .in('type', ['event_cancelled', 'session_cancelled'])
      .order('created_at', { ascending: false })
    setItems(data || [])
  }

  async function dismiss(id: string) {
    // Welle S3/M1 (Sarah 2026-05-27): Defense-in-Depth — Update nur fuer
    // Notifications des eigenen Users. Schuetzt vor RLS-Luecken.
    if (!userId) return
    await supabase
      .from('yogi_notifications')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  if (items.length === 0) return null

  return (
    <div className="mx-4 mt-3 space-y-2">
      {items.map(n => {
        const p = n.payload || {}
        const isEvent = n.type === 'event_cancelled'
        const isPaidEvent = p.session_type === 'event_paid'
        const subjectNoun = isEvent ? 'Dein Event' : (p.session_type === 'single' ? 'Deine Einzelstunde' : 'Deine Stunde')
        const title = p.title || ''
        const reason = p.reason && p.reason !== 'Abgesagt' ? p.reason : null
        const dateLabel = p.date
          ? new Date(`${p.date}T${(p.time_start || '00:00')}`).toLocaleString('de-DE', {
              weekday: 'short', day: 'numeric', month: 'short',
              hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
            })
          : ''
        return (
          <div key={n.id}
            className="bg-white border border-yoga-border rounded-yoga px-4 py-3 relative pr-9 shadow-sm">
            <button
              onClick={() => dismiss(n.id)}
              aria-label="Hinweis schließen"
              className="absolute top-2 right-2 w-7 h-7 rounded-full hover:bg-yoga-gray text-yoga-text/50 hover:text-yoga-text flex items-center justify-center cursor-pointer bg-transparent border-0">
              <i className="ti ti-x text-base" />
            </button>
            <p className="text-sm font-semibold text-yoga-text">
              {subjectNoun} „{title}" wurde abgesagt
            </p>
            {dateLabel && (
              <p className="text-xs text-yoga-text/60 mt-0.5">{dateLabel}</p>
            )}
            {reason && (
              <p className="text-sm text-yoga-text/70 mt-1 italic">{reason}</p>
            )}
            {isPaidEvent && (
              <p className="text-sm text-yoga-green-text mt-1 font-semibold">
                Gebühr wird zurückerstattet!
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
