'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/auth'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

export default function MeinePage() {
  const [profile, setProfile] = useState<any>(null)
  const [enrollments, setEnrollments] = useState<any[]>([])
  const [singleBookings, setSingleBookings] = useState<any[]>([])
  const [courseSessions, setCourseSessions] = useState<Record<string, any[]>>({})
  const [credits, setCredits] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    try {
      const user = await getCurrentUser()
      if (!user) { window.location.href = '/login'; return }

      const [{ data: prof }, { data: enrols }, { data: singles }, { data: crds }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('enrollments').select('*, course:courses(*)').eq('user_id', user.id),
        // Einzelstunden: nur aktive (nicht stornierte)
        supabase.from('bookings')
          .select('*, session:sessions(*, course:courses(name))')
          .eq('user_id', user.id)
          .eq('type', 'single')
          .eq('status', 'active')
          .order('created_at', { ascending: false }),
        supabase.from('credits').select('*, course:courses(name)').eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString()),
      ])

      if (prof && !prof.legal_accepted_at) { router.push('/rechtliches'); return }
      setProfile(prof)
      setEnrollments(enrols || [])
      setSingleBookings(singles || [])
      setCredits(crds || [])

      if (enrols && enrols.length > 0) {
        const sessionsMap: Record<string, any[]> = {}
        for (const enrol of enrols) {
          // Nur Stunden ab Einbuchungsdatum anzeigen
          const enrolledFrom = enrol.created_at ? enrol.created_at.split('T')[0] : '2000-01-01'
          const { data: sessions } = await supabase
            .from('sessions').select('*').eq('course_id', enrol.course_id)
            .gte('date', enrolledFrom).order('date')
          const { data: myBookings } = await supabase
            .from('bookings').select('*').eq('user_id', user.id)
            .in('session_id', (sessions || []).map((s: any) => s.id))
          // Ausgeschlossene Stunden nie anzeigen; abgesagte anzeigen (ausgegraut)
          sessionsMap[enrol.course_id] = (sessions || [])
            .filter((s: any) => s.cancel_reason !== 'excluded')
            .map((s: any) => ({
              ...s, myBooking: myBookings?.find((b: any) => b.session_id === s.id),
            }))
        }
        setCourseSessions(sessionsMap)
      }
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  // Kursstunden: alle anzeigen mit Status
  function getStatusBadge(session: any) {
    const mb = session.myBooking
    if (session.is_cancelled) return <span className="badge" style={{background:'var(--yoga-red-bg)',color:'var(--yoga-red-text)'}}>Abgesagt</span>
    if (!mb || mb.status === 'cancelled') return <span className="badge badge-left">Abgemeldet</span>
    const sessionEnd = new Date(`${session.date}T${session.time_start}`)
    sessionEnd.setMinutes(sessionEnd.getMinutes() + (session.duration_min || 60))
    if (sessionEnd < new Date()) return <span className="badge badge-done">Teilgenommen</span>
    return <span className="badge badge-enrolled">Angemeldet</span>
  }

  function generateAllICS(enrollment: any, sessions: any[]) {
    const events = sessions.map(s => {
      const dt = new Date(`${s.date}T${s.time_start}`)
      const dtEnd = new Date(dt.getTime() + s.duration_min * 60000)
      const fmt = (d: Date) => d.toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z'
      return `BEGIN:VEVENT\r\nSUMMARY:${enrollment.course?.name}\r\nDTSTART:${fmt(dt)}\r\nDTEND:${fmt(dtEnd)}\r\nEND:VEVENT`
    }).join('\r\n')
    const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR`
    const encoded = encodeURIComponent(ics)
    const a = document.createElement('a')
    a.href = 'data:text/calendar;charset=utf-8,' + encoded
    a.download = (enrollment.course?.name || 'termin') + '.ics'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const totalFreeCredits = credits.reduce((sum, c) => sum + Math.max(0, c.total - c.used), 0)
  const firstExpiry = [...credits].sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())[0]

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Meine" isAdmin={profile?.is_admin} />
      <div className="px-4 py-4">
        {/* Credits Detail-Anzeige – immer sichtbar */}
        {credits.length > 0 && (
          <div className="mb-4">
            <p className="text-sm text-yoga-text/60 mb-2 font-semibold">Deine Credits</p>
            {credits.map(c => {
              const free = Math.max(0, c.total - c.used)
              return (
                <div key={c.id} className="card mb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-2xl font-bold ${free === 0 ? 'text-yoga-text/30' : ''}`}>{free}</span>
                        <span className="text-sm text-yoga-text/60">
                          {c.model === 'course'
                            ? (c.course?.name ? `Kurs: ${c.course?.name}` : 'Kurs-Credits')
                            : c.model === 'guthaben' ? 'Guthaben'
                            : `Einzelstunden-${c.total === 1 ? 'Credit' : 'Credits'}`}
                        </span>
                      </div>
                      {c.model === 'guthaben' && free > 0 && (
                        <div className="text-xs text-yoga-amber-text mt-1"> Guthaben aus abgesagtem Kurs</div>
                      )}
                      {free === 0
                        ? <div className="text-xs text-yoga-text/40 mt-1">Alle Credits verbraucht</div>
                        : c.model !== 'guthaben'
                          ? <div className="text-xs text-yoga-text/40 mt-1">Verfallen am {new Date(c.expires_at).toLocaleDateString('de-DE', { day:'numeric', month:'long', year:'numeric' })}</div>
                          : <div className="text-xs text-yoga-text/40 mt-1">Gültig bis {new Date(c.expires_at).toLocaleDateString('de-DE', { day:'numeric', month:'long', year:'numeric' })}</div>
                      }
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-yoga-text/40">{c.used} / {c.total} genutzt</div>
                      <div className="h-1.5 w-16 bg-yoga-border rounded-full mt-1">
                        <div className="h-full bg-yoga-text/40 rounded-full"
                          style={{ width: `${(c.used/c.total)*100}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {enrollments.map(enrol => {
          const sessions = courseSessions[enrol.course_id] || []
          const done = sessions.filter(s => new Date(s.date) < new Date() && s.myBooking?.status === 'active').length
          return (
            <div key={enrol.id} className="mb-6">
              <div className="card mb-2">
                <div className="text-base font-bold mb-1">{enrol.course?.name}</div>
                <div className="text-sm text-yoga-text/55 mb-2">{enrol.course?.weekday} · {enrol.course?.time_start?.slice(0,5)} Uhr</div>
                <div className="h-1 bg-yoga-border rounded-full mb-1">
                  <div className="h-full bg-yoga-text/40 rounded-full"
                    style={{ width: sessions.length > 0 ? `${(done/sessions.length)*100}%` : '0%' }} />
                </div>
                <div className="text-xs text-yoga-text/50 mb-3">{done} von {sessions.length} Stunden absolviert</div>
                <button onClick={() => generateAllICS(enrol, sessions)}
                  className="flex items-center gap-2 text-sm text-yoga-text/70 border border-yoga-border2 rounded-full px-3 py-1.5">
                  <i className="ti ti-calendar-plus" /> Alle Termine exportieren
                </button>
              </div>
              <p className="section-label">Kursstunden</p>
              {/* Kursstunden: ausgeschlossene gefiltert, abgesagte ausgegraut */}
              {sessions.map(s => {
                const isCancelled = s.is_cancelled
                return (
                  <button key={s.id}
                    onClick={() => router.push(`/kurse/${s.id}`)}
                    className={`w-full card flex items-center gap-2.5 mb-1.5 text-left ${isCancelled ? 'opacity-50 cursor-default' : ''}`}>
                    <div className="flex-shrink-0 w-20">
                      <div className="text-sm font-bold">{new Date(s.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short' })}</div>
                      <div className="text-xs text-yoga-text/50">{s.time_start?.slice(0,5)} Uhr</div>
                    </div>
                    <div className="w-px h-6 bg-yoga-border2 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{enrol.course?.name}</div>
                    </div>
                    {getStatusBadge(s)}
                  </button>
                )
              })}
            </div>
          )
        })}

        {/* Einzelstunden: nur aktive (nicht stornierte) */}
        {singleBookings.length > 0 && (
          <div className="mb-6">
            <p className="section-label">Einzelstunden</p>
            {singleBookings.map(b => (
              <button key={b.id} onClick={() => router.push(`/kurse/${b.session?.id}`)}
                className="w-full card flex items-center gap-2.5 mb-1.5 text-left border-l-4 border-l-yoga-text/20">
                <div className="flex-shrink-0 w-20">
                  <div className="text-sm font-bold">{new Date(b.session?.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short' })}</div>
                  <div className="text-xs text-yoga-text/50">{b.session?.time_start?.slice(0,5)} Uhr</div>
                </div>
                <div className="w-px h-6 bg-yoga-border2 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{b.session?.course?.name}</div>
                  <div className="text-xs text-yoga-text/45">Einzelstunde · 1 Credit</div>
                </div>
                {(() => {
                  const end = new Date(`${b.session?.date}T${b.session?.time_start}`)
                  end.setMinutes(end.getMinutes() + (b.session?.duration_min || 60))
                  return end < new Date()
                    ? <span className="badge badge-done">Teilgenommen </span>
                    : <span className="badge badge-enrolled">Gebucht</span>
                })()}
              </button>
            ))}
          </div>
        )}

        {enrollments.length === 0 && singleBookings.length === 0 && (
          <div className="text-center py-12 text-yoga-text/40">
            <i className="ti ti-heart text-3xl block mb-3" />
            <p className="text-sm">Noch keine Buchungen</p>
          </div>
        )}
      </div>
      <BottomNav isAdmin={profile?.is_admin} />
    </div>
  )
}
