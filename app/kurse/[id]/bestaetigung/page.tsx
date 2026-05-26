'use client'

import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/auth'
import { Email } from '@/lib/email'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'
import { sessionDisplayName } from '@/lib/session-display'

function BestaetigungInner() {
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const type = searchParams.get('type') // 'booked', 'waitlist', 'notify'
  const [session, setSession] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const user = await getCurrentUser()
      const [{ data: sess }, { data: prof }] = await Promise.all([
        supabase.from('sessions').select('*, course:courses(name, is_free)').eq('id', id).single(),
        // Welle 2.6: session.name + session_type via `*` — overriden den SYS-Container-Namen.
        user ? supabase.from('profiles').select('*').eq('id', user.id).single() : Promise.resolve({ data: null }),
      ])
      setSession(sess)
      setProfile(prof)
    }
    load()
  }, [id])

  async function handleUndo() {
    const user = await getCurrentUser()
    if (!user) return
    const { data: booking } = await supabase.from('bookings')
      .select('*').eq('session_id', id).eq('user_id', user.id).eq('status', 'active').single()
    if (booking) {
      await supabase.from('bookings').update({
        status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: false
      }).eq('id', booking.id)
      // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
    }
    // Abmeldungs-Email
    if (profile && session) {
      await Email.bookingCancelled({
        email: profile.email,
        firstName: profile.first_name || 'Yogi',
        courseName: session.course?.name || '',
        date: session.date,
        timeStart: session.time_start,
        creditReturned: !within3h,
      })
    }

    // Wartelisten-Nachrücken + Notify-Versand server-side via SECURITY DEFINER RPC
    // (verhindert dass Yogi fremde profile.email direkt liest – DSGVO)
    try {
      const { data: result } = await supabase.rpc('process_cancellation_with_waitlist', { p_session_id: id })

      if (result?.promoted?.email) {
        await Email.waitlistPromoted({
          email: result.promoted.email,
          firstName: result.promoted.first_name || 'Yogi',
          courseName: result.promoted.course_name || '',
          date: result.promoted.date || '',
          timeStart: result.promoted.time_start || '',
        })
      }

      for (const nu of (result?.notify_users || [])) {
        if (nu?.email) {
          await Email.notifyPlaceFree({
            email: nu.email,
            firstName: nu.first_name || 'Yogi',
            courseName: nu.course_name || '',
            date: nu.date || '',
            timeStart: nu.time_start || '',
            sessionId: nu.session_id || id,
          })
        }
      }
    } catch(e) { console.error('Waitlist promotion error:', e) }

    router.push('/kurse')
  }

  function generateICS() {
    if (!session) return
    const dt = new Date(`${session.date}T${session.time_start}`)
    const dtEnd = new Date(dt.getTime() + session.duration_min * 60000)
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z'
    // Welle 2.6: bei Events/Einzelstunden session.name in der Kalender-Summary statt SYS-Container.
    const icsTitle = session.session_type && session.session_type !== 'course_session'
      ? (session.name ?? 'Yoga-Event')
      : (session.name ?? session.course?.name ?? 'Yoga')
    const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:${icsTitle}\r\nDTSTART:${fmt(dt)}\r\nDTEND:${fmt(dtEnd)}\r\nEND:VEVENT\r\nEND:VCALENDAR`
    // Data URI statt Blob URL - funktioniert auf Android/Google Kalender
    const encoded = encodeURIComponent(ics)
    const a = document.createElement('a')
    a.href = 'data:text/calendar;charset=utf-8,' + encoded
    a.download = 'termin.ics'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  if (!session) return null

  // Welle 2.7: zentraler Helper differenziert Einzelstunde / Event / Kursname
  const displayName = sessionDisplayName(session)

  const sessionDate = new Date(`${session.date}T${session.time_start}`)
  const within3h = (sessionDate.getTime() - Date.now()) < 3 * 60 * 60 * 1000
  const deadline = new Date(sessionDate.getTime() - 3 * 60 * 60 * 1000)
    .toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'

  // WARTELISTE BESTÄTIGUNG
  if (type === 'waitlist') {
    async function handleLeaveWaitlist() {
      const user = await getCurrentUser()
      if (!user) return
      await supabase.from('waitlist').delete()
        .eq('session_id', id).eq('user_id', user.id)
      router.push('/kurse')
    }

    return (
      <div className="max-w-md mx-auto min-h-screen">
        <AppHeader title="Auf der Warteliste" isAdmin={profile?.is_admin} />
        <div className="px-5 py-8 text-center">
          <div className="w-14 h-14 rounded-full bg-yoga-amber-bg flex items-center justify-center mx-auto mb-4">
            <i className="ti ti-list text-2xl text-yoga-amber-text" />
          </div>
          <h2 className="text-lg font-bold mb-2">Du stehst auf der Warteliste!</h2>
          <p className="text-sm text-yoga-text/60 mb-1">{displayName}</p>
          <p className="text-sm text-yoga-text/60 mb-5">
            {sessionDate.toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'long' })} · {session.time_start?.slice(0,5)} Uhr
          </p>

          <div className="bg-yoga-amber-bg border border-yoga-amber-text/30 rounded-yoga p-4 text-left mb-5">
            <p className="text-sm font-bold text-yoga-amber-text mb-2">
              <i className="ti ti-alert-circle mr-1" /> Wichtig – bitte beachten:
            </p>
            <p className="text-sm text-yoga-amber-text leading-relaxed">
              Wenn ein Platz frei wird, rückst du <strong>bis 90 Minuten vor Beginn</strong> automatisch nach. Du hast dann <strong>1 Stunde Zeit</strong>, dich kostenlos abzumelden. Reagierst du nicht, wird dein <strong>Credit verbraucht</strong> und der Platz ist verbindlich gebucht.
            </p>
          </div>

          <button onClick={() => router.push('/warteliste')} className="btn-primary mb-2">
            Meine Warteliste ansehen
          </button>
          <button onClick={handleLeaveWaitlist} className="btn-danger mb-2">
            <i className="ti ti-x mr-1" /> Doch wieder austragen
          </button>
          <button onClick={() => router.back()} className="btn-ghost">
            Zurück zur Kursübersicht
          </button>
        </div>
      </div>
    )
  }

  // BENACHRICHTIGUNG BESTÄTIGUNG
  if (type === 'notify') {
    return (
      <div className="max-w-md mx-auto min-h-screen">
        <AppHeader title="Benachrichtigung aktiv" isAdmin={profile?.is_admin} />
        <div className="px-5 py-8 text-center">
          <div className="w-14 h-14 rounded-full bg-yoga-green-bg flex items-center justify-center mx-auto mb-4">
            <i className="ti ti-bell text-2xl text-yoga-green-text" />
          </div>
          <h2 className="text-lg font-bold mb-2">Benachrichtigung aktiviert!</h2>
          <p className="text-sm text-yoga-text/60 mb-1">{displayName}</p>
          <p className="text-sm text-yoga-text/60 mb-5">
            {sessionDate.toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'long' })} · {session.time_start?.slice(0,5)} Uhr
          </p>

          <div className="bg-yoga-green-bg border border-yoga-green-text/20 rounded-yoga p-4 text-left mb-5">
            <p className="text-sm text-yoga-green-text leading-relaxed">
              Sobald ein Platz frei wird, bekommst du eine E-Mail mit einem direkten Link zum Einbuchen. Du buchst dann selbst – wer zuerst klickt, bekommt den Platz.
            </p>
          </div>

          <button onClick={() => router.back()} className="btn-primary">
            Zurück zur Kursübersicht
          </button>
        </div>
      </div>
    )
  }

  // NORMALE BUCHUNGS-BESTÄTIGUNG
  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Buchung bestätigt" isAdmin={profile?.is_admin} />
      <div className="px-5 py-8 text-center">
        <div className="w-14 h-14 rounded-full bg-yoga-green-bg flex items-center justify-center mx-auto mb-4">
          <i className="ti ti-check text-2xl text-yoga-green-text" />
        </div>
        <h2 className="text-lg font-bold mb-2">Du bist dabei!</h2>
        <p className="text-sm text-yoga-text/60 mb-1">{displayName}{session.session_type === 'course_session' ? ' · Einzelstunde' : ''}</p>
        <p className="text-sm text-yoga-text/60 mb-5">
          {sessionDate.toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'long' })} · {session.time_start?.slice(0,5)} Uhr
        </p>

        {session.course?.is_free ? (
          // Charity: kein Credit → keine Frist
          <div className="bg-yoga-card border border-yoga-border rounded-yoga p-3 text-left mb-5">
            <p className="text-sm text-yoga-text/70 leading-relaxed">
              Abmeldung jederzeit möglich.
            </p>
          </div>
        ) : within3h ? (
          <div className="bg-yoga-amber-bg border border-yoga-amber-text/20 rounded-yoga p-3 text-left mb-5">
            <p className="text-sm text-yoga-amber-text leading-relaxed">
              <strong>Kurzfristige Buchung:</strong> Abmeldung nicht mehr möglich. Dein Credit ist verbraucht – viel Freude!
            </p>
          </div>
        ) : (
          <div className="bg-yoga-card border border-yoga-border rounded-yoga p-3 text-left mb-5">
            <p className="text-sm text-yoga-text/70 leading-relaxed">
              Abmeldung kostenlos bis <strong>{deadline}</strong>. Danach gilt die Stunde als wahrgenommen.
            </p>
          </div>
        )}

        <button onClick={generateICS} className="btn-primary mb-2">
          <i className="ti ti-calendar-plus mr-1" /> Zum Kalender hinzufügen
        </button>
        {!within3h && (
          <button onClick={handleUndo} className="btn-danger mb-2">
            <i className="ti ti-arrow-back-up mr-1" /> Buchung rückgängig machen
          </button>
        )}
        <button onClick={() => router.push('/meine')} className="btn-ghost">Zu Meine</button>
      </div>
      <BottomNav isAdmin={profile?.is_admin} />
    </div>
  )
}

export default function BestaetigungPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>}>
      <BestaetigungInner />
    </Suspense>
  )
}
