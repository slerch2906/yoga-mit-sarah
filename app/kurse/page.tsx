'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/auth'
import { useSwipe } from '@/lib/useSwipe'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const MONTHS = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']

function getMonday(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff); return d
}
function addDays(date: Date, days: number) {
  const d = new Date(date); d.setDate(d.getDate() + days); return d
}
function formatDate(date: Date) {
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()}. ${MONTHS[date.getMonth()]}`
}

function formatWeekRange(start: Date): string {
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const startDay = start.getDate()
  const endDay = end.getDate()
  const startMonth = MONTHS[start.getMonth()]
  const endMonth = MONTHS[end.getMonth()]
  if (start.getMonth() === end.getMonth()) {
    return `${startDay}. – ${endDay}. ${startMonth}`
  }
  return `${startDay}. ${startMonth} – ${endDay}. ${endMonth}`
}

export default function KursePage() {
  const [offset, setOffset] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('kurse_week_offset')
      return saved ? parseInt(saved) : 0
    }
    return 0
  })
  const [sessions, setSessions] = useState<any[]>([])
  const [profile, setProfile] = useState<any>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function init() {
      try {
        const user = await getCurrentUser()
        if (!user) { window.location.href = '/login'; return }
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single()
        if (prof && !prof.legal_accepted_at) { window.location.href = '/rechtliches'; return }
        setProfile(prof)
        setUserId(user.id)
      } catch (e) {
        console.error('Init error:', e)
        setLoading(false)
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (userId) loadSessions()
  }, [offset, userId])

  async function loadSessions() {
    setLoading(true)
    const monday = getMonday(new Date())
    const weekStart = addDays(monday, offset * 7)
    const weekEnd = addDays(weekStart, 6)

    const { data, error } = await supabase
      .from('sessions')
      .select(`id, date, time_start, duration_min, course:courses(id, name, max_spots), bookings!bookings_session_id_fkey(id, user_id, status)`)
      .gte('date', weekStart.toISOString().split('T')[0])
      .lte('date', weekEnd.toISOString().split('T')[0])
      .eq('is_cancelled', false)
      .order('date').order('time_start')

    if (error) { console.error('Sessions:', error); setLoading(false); return }

    const now = new Date()
    const enriched = (data || []).map((s: any) => ({
      ...s,
      booking_count: s.bookings.filter((b: any) => b.status === 'active').length,
      my_booking: s.bookings.find((b: any) => b.user_id === userId && b.status === 'active') || null,
      is_past: new Date(`${s.date}T${s.time_start}`) < now,
    }))
    setSessions(enriched)
    setLoading(false)
  }

  const monday = getMonday(new Date())
  const weekStart = addDays(monday, offset * 7)
  const weekLabel = offset === 0 ? 'Diese Woche'
    : offset === 1 ? 'Nächste Woche'
    : offset === -1 ? 'Vorherige Woche'
    : formatWeekRange(weekStart)

  const byDay: Record<string, any[]> = {}
  sessions.forEach(s => { if (!byDay[s.date]) byDay[s.date] = []; byDay[s.date].push(s) })
  const myNextSession = sessions.find(s => s.my_booking && !s.is_past)

  function getBadge(s: any) {
    if (s.is_past) return <span className="badge bg-yoga-gray text-yoga-text/40">Vergangen</span>
    if (s.my_booking) return <span className="badge badge-mine">Angemeldet</span>
    const free = (s.course?.max_spots || 0) - s.booking_count
    if (free <= 0) return <span className="badge badge-full">Ausgebucht</span>
    if (free === 1) return <span className="badge badge-wait">1 Platz frei</span>
    return <span className="badge badge-free">{free} Plätze frei</span>
  }

  const goWeek = (delta: number) => {
    const n = offset + delta
    sessionStorage.setItem('kurse_week_offset', String(n))
    setOffset(n)
  }
  // Swipe: links→nächste Woche, rechts→vorherige Woche
  const swipeHandlers = useSwipe({
    onSwipeLeft: () => goWeek(+1),
    onSwipeRight: () => goWeek(-1),
  })

  return (
    <div className="max-w-md mx-auto min-h-screen" {...swipeHandlers}>
      <AppHeader title="Yoga mit Sarah" isAdmin={profile?.is_admin} />

      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <button onClick={() => goWeek(-1)}
          className="flex items-center gap-1 text-sm font-semibold px-3 py-2 border-2 border-yoga-text/30 rounded-full text-yoga-text">
          <i className="ti ti-chevron-left" /> Vorherige
        </button>
        <span className="text-sm font-bold">{weekLabel}</span>
        <button onClick={() => goWeek(+1)}
          className="flex items-center gap-1 text-sm font-semibold px-3 py-2 border-2 border-yoga-text/30 rounded-full text-yoga-text">
          Nächste <i className="ti ti-chevron-right" />
        </button>
      </div>

      {(() => {
        const bookedCount = sessions.filter(s => s.my_booking).length
        if (!bookedCount) return null
        return (
          <div className="mx-4 mt-2 bg-yoga-gray border border-yoga-border rounded-yoga px-3 py-2 flex items-center gap-2">
            <i className="ti ti-circle-check text-base opacity-50" />
            <p className="text-sm text-yoga-text/75">
              Du hast <strong>{bookedCount} {bookedCount === 1 ? 'Stunde' : 'Stunden'}</strong> in dieser Woche
            </p>
          </div>
        )
      })()}

      <div className="px-4 pb-4 mt-3">
        {loading ? (
          <div className="text-center py-10 text-yoga-text/40">
            <i className="ti ti-loader-2 animate-spin text-3xl block mb-2" />
            <p className="text-sm">Wird geladen...</p>
          </div>
        ) : Object.keys(byDay).length === 0 ? (
          <div className="text-center py-10 text-yoga-text/40">
            <i className="ti ti-moon text-3xl block mb-2" />
            <p className="text-sm">Keine Stunden diese Woche</p>
          </div>
        ) : Object.entries(byDay).map(([date, daySessions]) => (
          <div key={date} className="mb-4">
            <p className="text-xs font-bold text-yoga-text/70 mb-1 mt-3 uppercase tracking-wide">{formatDate(new Date(date))}</p>
            {daySessions.map(s => (
              <button key={s.id}
                onClick={() => router.push(`/kurse/${s.id}`)}
                className={`w-full flex items-center gap-3 mb-2 text-left transition-colors rounded-yoga border p-3
                  ${s.is_past ? 'opacity-40 cursor-default' : 'hover:border-yoga-border2'}
                  ${s.my_booking && !s.is_past ? 'border-2 border-yoga-green-text bg-white' : 'border-yoga-border bg-white'}`}>
                <div className="text-center flex-shrink-0 w-12">
                  <div className={`text-base font-bold ${s.is_past ? 'line-through' : ''}`}>
                    {s.time_start?.slice(0,5)}
                  </div>
                  <div className="text-xs text-yoga-text/40">{s.duration_min} min</div>
                </div>
                <div className="w-px h-8 bg-yoga-border2 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{s.course?.name}</div>
                </div>
                {getBadge(s)}
              </button>
            ))}
          </div>
        ))}
      </div>
      <BottomNav isAdmin={profile?.is_admin} />
    </div>
  )
}
