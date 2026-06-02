'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { sessionDisplayName } from '@/lib/session-display'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

const LABELS: Record<string, string> = {
  buchungen: 'Buchungen',
  abmeldungen: 'Abmeldungen',
  warteliste: 'Warteliste',
}

export default function AdminStatsPage() {
  const { type } = useParams<{ type: string }>()
  const router = useRouter()
  const search = useSearchParams()
  const supabase = createClient()
  const [items, setItems] = useState<any[]>([])
  const [sessionMap, setSessionMap] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [type])

  async function loadData() {
    setLoading(true)
    // Sarah 2026-06-02: alle 3 Typen messen REINE YOGI-AKTIVITÄT über audit_log,
    // gefenstert auf die Woche aus ?ws=YYYY-MM-DD (Montag) — identisch zur Kachel.
    // Ohne ?ws: aktuelle Woche.
    const wsParam = search?.get('ws')
    let monday: Date
    if (wsParam && /^\d{4}-\d{2}-\d{2}$/.test(wsParam)) {
      const [y, m, d] = wsParam.split('-').map(Number)
      monday = new Date(y, m - 1, d, 0, 0, 0)
    } else {
      const now = new Date()
      const dayOfWeek = (now.getDay() + 6) % 7 // 0 = Montag
      monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek, 0, 0, 0)
    }
    const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7, 0, 0, 0)

    const action = type === 'buchungen' ? 'booking_created'
      : type === 'abmeldungen' ? 'booking_cancelled'
      : 'waitlist_joined'

    const { data } = await supabase
      .from('audit_log')
      .select('*, profile:profiles!audit_log_user_id_fkey(first_name, last_name, email)')
      .eq('action', action)
      .gte('created_at', monday.toISOString())
      .lt('created_at', nextMonday.toISOString())
      .order('created_at', { ascending: false })
      .limit(200)
    const rows = data || []
    setItems(rows)

    // Echten Stunden-Titel über details.session_id auflösen (kein SYS-Container-Name).
    const ids = Array.from(new Set(rows.map((r: any) => r.details?.session_id).filter(Boolean)))
    if (ids.length > 0) {
      const { data: sess } = await supabase
        .from('sessions')
        .select('id, date, time_start, session_type, name, course:courses(name)')
        .in('id', ids as string[])
      const map: Record<string, any> = {}
      for (const s of sess || []) map[(s as any).id] = s
      setSessionMap(map)
    } else {
      setSessionMap({})
    }
    setLoading(false)
  }

  const title = LABELS[type] || type
  const isBuchungenOrAbmeldungen = type === 'buchungen' || type === 'abmeldungen'

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('de-DE', {
      weekday: 'short', day: 'numeric', month: 'short',
    })
  }

  function formatTime(timeStr: string) {
    return timeStr?.slice(0, 5) || ''
  }

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title={title} isAdmin />
      <div className="px-4 py-4">

        {type === 'buchungen' && (
          <p className="text-xs text-yoga-text/40 mb-4">Diese Woche</p>
        )}
        {type === 'abmeldungen' && (
          <p className="text-xs text-yoga-text/40 mb-4">Diese Woche</p>
        )}
        {type === 'warteliste' && (
          <p className="text-xs text-yoga-text/40 mb-4">Diese Woche</p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <i className="ti ti-loader-2 animate-spin text-2xl text-yoga-text/30" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-yoga-text/40 text-center py-8">Keine Einträge</p>
        ) : (
          <div className="card p-0 overflow-hidden">
            {items.map((item, i) => {
              const details = item.details || {}
              // Echten Titel über die Session auflösen (kein SYS-Container-Name, keine
              // leeren Zeilen). Fallback auf das alte Audit-Detail, falls die Session
              // bereits gelöscht wurde.
              const sess = details.session_id ? sessionMap[details.session_id] : null
              const sessLabel = sess ? sessionDisplayName(sess) : (details.course_name || '—')
              const sessDate = sess?.date || details.session_date
              const sessTime = sess?.time_start || details.session_time
              return (
                /* Sarah-Wunsch: Yogi-Zeile klickbar → Yogi-Profil */
                <button key={item.id}
                  onClick={() => item.user_id && router.push(`/admin/yogis/${item.user_id}`)}
                  className={`px-4 py-3 w-full text-left bg-transparent border-0 cursor-pointer hover:opacity-70 transition-opacity ${i < items.length - 1 ? 'border-b border-yoga-border' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {item.profile?.first_name} {item.profile?.last_name}
                      </div>
                      <div className="text-xs text-yoga-text/50 truncate">{item.profile?.email}</div>
                      <div className="text-xs text-yoga-text/60 mt-0.5">
                        {sessLabel}{(sessDate || sessTime) ? ' · ' : ''}{sessDate ? formatDate(sessDate) : ''} {sessTime ? formatTime(sessTime) : ''}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-xs text-yoga-text/40">
                      {new Date(item.created_at).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <BottomNav isAdmin />
    </div>
  )
}
