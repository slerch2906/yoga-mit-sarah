'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Email } from '@/lib/email'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

function AnwesenheitInner() {
  const [session, setSession] = useState<any>(null)
  const [bookings, setBookings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('session')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { loadData() }, [sessionId])

  async function loadData() {
    // Wenn keine Session-ID, zeige heutige Sessions
    if (!sessionId) {
      const today = new Date().toISOString().split('T')[0]
      const { data: sessions } = await supabase
        .from('sessions')
        .select('*, course:courses(name, max_spots)')
        // Welle 2.6: session.name + session_type via `*` schon dabei.
        .eq('date', today)
        .eq('is_cancelled', false)
        .order('time_start')
      setSession(sessions || [])
      setLoading(false)
      return
    }

    const [{ data: sess }, { data: bookingData }] = await Promise.all([
      // Welle 2.6: session.name + session_type via `*` schon dabei.
      supabase.from('sessions').select('*, course:courses(name, max_spots)').eq('id', sessionId).single(),
      supabase.from('bookings').select('*, profile:profiles(first_name, last_name, email), credits(total, used)')
        .eq('session_id', sessionId).eq('status', 'active'),
    ])
    setSession(sess)
    setBookings(bookingData || [])
    setLoading(false)
  }

  async function cancelSession() {
    if (!sessionId) return
    if (!confirm('Diese Stunde wirklich absagen? Alle Teilnehmer bekommen ihren Credit zurück.')) return
    setCancelling(true)

    await supabase.from('sessions').update({ is_cancelled: true }).eq('id', sessionId)

    for (const b of bookings) {
      await supabase.from('bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', b.id)
      // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
      // Email an jeden Yogi
      if (b.profile?.email) {
        await Email.sessionCancelled({
          email: b.profile.email,
          firstName: b.profile.first_name || 'Yogi',
          courseName: (session as any)?.course?.name || '',
          date: (session as any)?.date || '',
          timeStart: (session as any)?.time_start || '',
        })
      }
    }

    await supabase.from('audit_log').insert({
      action: 'session_cancelled',
      details: { session_id: sessionId }
    })

    router.push('/admin/dashboard')
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><p className="text-yoga-text/50 text-sm">Wird geladen...</p></div>

  // Ohne Session-ID: Liste heutiger Sessions
  if (!sessionId) {
    const sessions = Array.isArray(session) ? session : []
    return (
      <div className="max-w-md mx-auto min-h-screen">
        <AppHeader title="Anwesenheit" isAdmin />
        <div className="px-4 py-4">
          <p className="section-label">Heutige Stunden</p>
          {sessions.length === 0 ? (
            <p className="text-center text-yoga-text/40 text-sm py-8">Heute keine Stunden</p>
          ) : sessions.map((s: any) => (
            <button key={s.id} onClick={() => router.push(`/admin/anwesenheit?session=${s.id}`)}
              className="w-full card mb-3 text-left hover:border-yoga-border2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold">
                    {/* Welle 2.6: SYS-Container-Name unterdrücken */}
                    {s.session_type && s.session_type !== 'course_session'
                      ? `Event · ${s.name ?? 'Unbenannt'}`
                      : (s.name ?? s.course?.name)}
                  </div>
                  <div className="text-sm text-yoga-text/50">{s.time_start?.slice(0,5)} Uhr</div>
                </div>
                <i className="ti ti-chevron-right text-base opacity-40" />
              </div>
            </button>
          ))}
        </div>
        <BottomNav isAdmin />
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Anwesenheit" isAdmin />
      <div className="px-4 py-4">
        <div className="card mb-4">
          <div className="text-base font-bold mb-1">
            {/* Welle 2.6: SYS-Container-Name unterdrücken */}
            {(session as any)?.session_type && (session as any).session_type !== 'course_session'
              ? `Event · ${(session as any).name ?? 'Unbenannt'}`
              : ((session as any)?.name ?? (session as any)?.course?.name)}
          </div>
          <div className="text-sm text-yoga-text/50">
            {(session as any)?.time_start?.slice(0,5)} Uhr · {bookings.length} von {(session as any)?.course?.max_spots} angemeldet
          </div>
        </div>

        <p className="section-label">Angemeldete Yogis</p>
        {bookings.length === 0 ? (
          <p className="text-center text-yoga-text/40 text-sm py-6">Niemand angemeldet</p>
        ) : bookings.map(b => (
          <div key={b.id} className="card mb-2 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{b.profile?.first_name} {b.profile?.last_name}</div>
              <div className="text-xs text-yoga-text/50">{b.profile?.email}</div>
            </div>
            <span className="badge badge-enrolled">Angemeldet</span>
          </div>
        ))}

        <button onClick={cancelSession} disabled={cancelling}
          className="btn-danger mt-4">
          <i className="ti ti-calendar-x mr-1" />
          {cancelling ? 'Wird abgesagt...' : 'Diese Stunde absagen'}
        </button>
      </div>
      <BottomNav isAdmin />
    </div>
  )
}

export default function AnwesenheitPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-yoga-text/50 text-sm">Wird geladen...</p></div>}>
      <AnwesenheitInner />
    </Suspense>
  )
}
