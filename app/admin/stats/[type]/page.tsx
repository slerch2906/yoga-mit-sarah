'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
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
  const supabase = createClient()
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [type])

  async function loadData() {
    setLoading(true)
    if (type === 'warteliste') {
      const { data } = await supabase
        .from('waitlist')
        .select('*, profile:profiles(first_name, last_name, email), session:sessions(date, time_start, course:courses(name))')
        .order('created_at', { ascending: false })
        .limit(100)
      setItems(data || [])
    } else {
      const action = type === 'buchungen' ? 'booking_created' : 'booking_cancelled'
      // Diese Woche: ab Montag 00:00 Lokalzeit
      const now = new Date()
      const dayOfWeek = (now.getDay() + 6) % 7 // 0 = Montag
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek, 0, 0, 0)
      const { data } = await supabase
        .from('audit_log')
        .select('*, profile:profiles!audit_log_user_id_fkey(first_name, last_name, email)')
        .eq('action', action)
        .gte('created_at', monday.toISOString())
        .order('created_at', { ascending: false })
        .limit(100)
      setItems(data || [])
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
          <p className="text-xs text-yoga-text/40 mb-4">Aktuelle Einträge</p>
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
              if (type === 'warteliste') {
                const sess = item.session
                const course = sess?.course
                return (
                  <div key={item.id}
                    className={`px-4 py-3 ${i < items.length - 1 ? 'border-b border-yoga-border' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">
                          {item.profile?.first_name} {item.profile?.last_name}
                        </div>
                        <div className="text-xs text-yoga-text/50 truncate">{item.profile?.email}</div>
                        <div className="text-xs text-yoga-text/60 mt-0.5">
                          {course?.name} · {formatDate(sess?.date)} {formatTime(sess?.time_start)}
                        </div>
                      </div>
                      <span className={`badge flex-shrink-0 text-xs ${item.type === 'waitlist' ? 'badge-wait' : 'badge-mine'}`}>
                        {item.type === 'waitlist' ? `Pos. ${item.position}` : 'Benach.'}
                      </span>
                    </div>
                  </div>
                )
              }

              // buchungen / abmeldungen
              const details = item.details || {}
              return (
                <div key={item.id}
                  className={`px-4 py-3 ${i < items.length - 1 ? 'border-b border-yoga-border' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {item.profile?.first_name} {item.profile?.last_name}
                      </div>
                      <div className="text-xs text-yoga-text/50 truncate">{item.profile?.email}</div>
                      <div className="text-xs text-yoga-text/60 mt-0.5">
                        {details.course_name} · {details.session_date ? formatDate(details.session_date) : ''} {details.session_time ? formatTime(details.session_time) : ''}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-xs text-yoga-text/40">
                      {new Date(item.created_at).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <BottomNav isAdmin />
    </div>
  )
}
