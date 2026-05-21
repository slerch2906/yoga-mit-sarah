'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getServerNow } from '@/lib/server-time'
import { Email } from '@/lib/email'
import { getCurrentUser } from '@/lib/auth'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [session, setSession] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [myBooking, setMyBooking] = useState<any>(null)
  const [myWaitlist, setMyWaitlist] = useState<any>(null)
  const [freeCredits, setFreeCredits] = useState(0)
  const [bestCredit, setBestCredit] = useState<any>(null)
  const [hasGuthabenOnly, setHasGuthabenOnly] = useState(false)
  const [freeSpots, setFreeSpots] = useState(0)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { loadData() }, [id])

  async function loadData() {
    const user = await getCurrentUser()
    if (!user) { window.location.href = '/login'; return }

    const [{ data: prof }, { data: sess }, { data: myBook }, { data: myWait }, { data: allCredits }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('sessions').select('*, course:courses(*), replacement:sessions!sessions_replacement_session_id_fkey(id, date, time_start, is_cancelled)').eq('id', id).single(),
      supabase.from('bookings').select('*').eq('session_id', id).eq('user_id', user.id).eq('status', 'active').maybeSingle(),
      supabase.from('waitlist').select('*').eq('session_id', id).eq('user_id', user.id).maybeSingle(),
      supabase.from('credits').select('*').eq('user_id', user.id).gt('expires_at', new Date().toISOString()),
    ])

    const { count: bookingCount } = await supabase
      .from('bookings').select('*', { count: 'exact', head: true })
      .eq('session_id', id).eq('status', 'active')

    setProfile(prof)
    setSession(sess)
    setMyBooking(myBook)
    setMyWaitlist(myWait)
    setFreeSpots(((sess as any)?.course?.max_spots || 0) - (bookingCount || 0))

    // Freie Credits berechnen: Guthaben (aus Kursabbruch) ist nur für neue Kurse, nicht für Einzelstunden
    const available = (allCredits || []).filter(c => c.total > c.used && c.model !== 'guthaben')
    const totalFree = available.reduce((sum, c) => sum + (c.total - c.used), 0)
    setFreeCredits(totalFree)
    const guthabenOnly = totalFree === 0 && (allCredits || []).some(c => c.model === 'guthaben' && c.total > c.used)
    setHasGuthabenOnly(guthabenOnly)
    // Besten Credit wählen: zuerst ablaufende
    const sorted = available.sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())
    setBestCredit(sorted[0] || null)

    setLoading(false)
  }

  function isWithin3Hours() {
    if (!session) return false
    const dt = new Date(`${session.date}T${session.time_start}`)
    const diff = dt.getTime() - Date.now()
    return diff < 3 * 60 * 60 * 1000 && diff > 0
  }

  function isPast() {
    if (!session) return false
    return new Date(`${session.date}T${session.time_start}`) < new Date()
  }

  function cancelDeadline() {
    if (!session) return ''
    const dt = new Date(`${session.date}T${session.time_start}`)
    dt.setHours(dt.getHours() - 3)
    return dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'
  }

  async function handleBook() {
    if (!bestCredit) return
    setActionLoading(true)
    const user = await getCurrentUser()

    // Prüfe ob bereits eine (cancelled) Buchung existiert → dann updaten statt inserieren
    const { data: existingBooking } = await supabase.from('bookings')
      .select('*').eq('session_id', id).eq('user_id', user!.id).maybeSingle()

    let error = null
    if (existingBooking) {
      // Bestehende Buchung reaktivieren
      const { error: updateError } = await supabase.from('bookings').update({
        status: 'active', credit_id: bestCredit.id,
        cancelled_at: null, cancel_late: false
      }).eq('id', existingBooking.id)
      error = updateError
    } else {
      // Neue Buchung anlegen
      const { error: insertError } = await supabase.from('bookings').insert({
        user_id: user!.id, session_id: id,
        credit_id: bestCredit.id, type: 'single', status: 'active'
      })
      error = insertError
    }

    if (!error) {
      // credit.used wird automatisch durch trg_sync_credit_used aktualisiert
      await supabase.from('audit_log').insert({
        user_id: user!.id, action: 'booking_created',
        details: { session_id: id, type: 'single', course_name: session?.course?.name, session_date: session?.date, session_time: session?.time_start }
      })
      // Buchungsbestätigung Email
      try {
        const { data: prof } = await supabase.from('profiles').select('email, first_name').eq('id', user!.id).single()
        if (prof) await Email.bookingConfirmed({
          email: prof.email,
          firstName: prof.first_name || 'Yogi',
          courseName: session?.course?.name || '',
          date: session?.date || '',
          timeStart: session?.time_start || '',
          durationMin: session?.duration_min || 60,
        })
      } catch(e) {}
      router.push(`/kurse/${id}/bestaetigung`)
    } else {
      alert('Fehler beim Buchen: ' + error.message)
    }
    setActionLoading(false)
  }

  async function handleCancel() {
    setActionLoading(true)
    const user = await getCurrentUser()
    // Server-Zeit verwenden statt Browser-Zeit
    const serverNow = await getServerNow()
    const sessionStart = new Date(`${session.date}T${session.time_start}`)
    const deadline3h = new Date(sessionStart.getTime() - 3 * 60 * 60 * 1000)
    const late = serverNow > deadline3h

    await supabase.from('bookings').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_late: late
    }).eq('id', myBooking.id)

    // credit.used wird automatisch durch trg_sync_credit_used aktualisiert

    await supabase.from('audit_log').insert({
      user_id: user!.id, action: 'booking_cancelled',
      details: { session_id: id, late, course_name: session?.course?.name, session_date: session?.date, session_time: session?.time_start }
    })

    // Email an Yogi senden
    try {
      const { data: prof } = await supabase.from('profiles')
        .select('email, first_name').eq('id', user!.id).single()
      if (prof?.email) {
        await Email.bookingCancelled({
          email: prof.email,
          firstName: prof.first_name || 'Yogi',
          courseName: session?.course?.name || '',
          date: session?.date || '',
          timeStart: session?.time_start || '',
          durationMin: session?.duration_min || 75,
          creditReturned: !late,
        })
      }
    } catch (e) { console.error('Cancel email error:', e) }

    // Wartelisten-Nachrücken + Notify-Versand server-side via SECURITY DEFINER RPC
    // (verhindert dass Yogi fremde profile.email direkt liest – DSGVO)
    try {
      const { data: result } = await supabase.rpc('process_cancellation_with_waitlist', { p_session_id: id })

      // Email an Wartelisten-Promoted-User (Daten kommen kontrolliert aus der RPC)
      if (result?.promoted?.email) {
        await Email.waitlistPromoted({
          email: result.promoted.email,
          firstName: result.promoted.first_name || 'Yogi',
          courseName: result.promoted.course_name || '',
          date: result.promoted.date || '',
          timeStart: result.promoted.time_start || '',
        })
      }

      // Notify-Users emailen
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

    router.back()
  }

  async function handleWaitlist(type: 'waitlist' | 'notify') {
    setActionLoading(true)
    const user = await getCurrentUser()
    const { data: prof } = await supabase.from('profiles').select('email, first_name').eq('id', user!.id).single()

    // Atomic Insert via SECURITY DEFINER RPC (verhindert dass Yogi alle waitlist-Counts lesen muss)
    const { data: result } = await supabase.rpc('join_waitlist', {
      p_session_id: id, p_type: type,
    })
    const position = result?.position ?? 0

    if (type === 'waitlist' && prof) {
      try {
        await Email.waitlistJoined({
          email: prof.email,
          firstName: prof.first_name || 'Yogi',
          courseName: session?.course?.name || '',
          date: session?.date || '',
          timeStart: session?.time_start || '',
          position,
        })
      } catch(e) {}
    }
    router.push(`/kurse/${id}/bestaetigung?type=${type}`)
    setActionLoading(false)
  }

  async function handleLeaveWaitlist() {
    setActionLoading(true)
    await supabase.from('waitlist').delete().eq('id', myWaitlist.id)
    router.push('/kurse')
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>
  if (!session) return null

  const course = (session as any).course
  const past = isPast()
  const within3h = isWithin3Hours()
  const deadline = cancelDeadline()

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="" isAdmin={profile?.is_admin} />

      {/* Header */}
      <div className="px-4 py-3 border-b border-yoga-border bg-yoga-bg">
        <button onClick={() => router.back()}
          className="flex items-center gap-1 text-sm text-yoga-text/60 mb-2.5 hover:opacity-80">
          <i className="ti ti-arrow-left" /> Zurück
        </button>
        <h2 className="text-lg font-bold mb-1">{course?.name}</h2>
        <p className="text-sm text-yoga-text/55 mb-2">
          {new Date(session.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'long' })} · {session.time_start?.slice(0,5)} Uhr · {session.duration_min} min
        </p>
        {course?.location && (
          <p className="text-sm text-yoga-text/50 mb-1"><i className="ti ti-map-pin mr-1" />{course.location}</p>
        )}
        {course?.difficulty && (
          <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-yoga-gray text-yoga-text/60 font-semibold">{course.difficulty}</span>
        )}
        {past && (
          <span className="inline-block mt-2 text-xs px-2 py-1 rounded-full bg-yoga-gray text-yoga-text/50 font-semibold">
            Diese Stunde ist bereits vergangen
          </span>
        )}
      </div>

      <div className="px-4 py-4">
        {/* Info grid */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="info-tile">
            <div className="lbl">{myBooking ? 'Dein Status' : 'Freie Plätze'}</div>
            <div className={`val ${myBooking ? 'text-yoga-green-text' : freeSpots <= 0 ? 'text-yoga-red-text' : ''}`}>
              {myBooking ? 'Angemeldet ' : past ? '—' : freeSpots <= 0 ? 'Ausgebucht' : `${freeSpots} frei`}
            </div>
          </div>
          <div className="info-tile">
            <div className="lbl">Abmeldefrist</div>
            <div className={`val ${within3h && !past ? 'text-yoga-amber-text' : ''}`}>
              {past ? 'Vergangen' : deadline}
            </div>
          </div>
          <div className="info-tile">
            <div className="lbl">Deine Credits</div>
            <div className={`val ${freeCredits === 0 ? 'text-yoga-red-text' : ''}`}>
              {freeCredits} verfügbar
            </div>
          </div>
          <div className="info-tile">
            <div className="lbl">Warteliste</div>
            <div className="val">{myWaitlist ? (myWaitlist.type === 'notify' ? 'Benachrichtigung aktiv' : `Pos. ${myWaitlist.position}`) : '—'}</div>
          </div>
        </div>

        {/* Kursbeschreibung */}
        {(course?.description || course?.bring_along) && (
          <div className="card mb-4">
            {course?.description && (
              <div className="mb-3">
                <p className="text-xs text-yoga-text/40 uppercase tracking-wider font-bold mb-1">Über diesen Kurs</p>
                <p className="text-sm text-yoga-text/80 leading-relaxed">{course.description}</p>
              </div>
            )}
            {course?.bring_along && (
              <div>
                <p className="text-xs text-yoga-text/40 uppercase tracking-wider font-bold mb-1">Was mitbringen</p>
                <p className="text-sm text-yoga-text/80 leading-relaxed"><i className="ti ti-backpack mr-1" />{course.bring_along}</p>
              </div>
            )}
          </div>
        )}

        {/* VERGANGEN – gesperrt */}
        {past && (
          <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-4 mb-4 text-center">
            <i className="ti ti-lock text-2xl text-yoga-text/30 block mb-2" />
            <p className="text-sm text-yoga-text/50">Diese Stunde ist bereits vergangen und kann nicht mehr gebucht oder geändert werden.</p>
          </div>
        )}

        {/* ABGESAGT – keine Buchung möglich, ggf. Link zur Ersatzstunde */}
        {!past && session.is_cancelled && (
          <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-4 mb-4 text-center">
            <i className="ti ti-calendar-cancel text-2xl text-yoga-text/30 block mb-2" />
            <p className="text-sm font-semibold text-yoga-text/50 mb-1">Diese Stunde wurde abgesagt</p>
            <p className="text-sm text-yoga-text/40">Buchungen und Warteliste sind nicht möglich.</p>
            {(session as any).replacement && !(session as any).replacement.is_cancelled && (
              <button onClick={() => router.push(`/kurse/${(session as any).replacement.id}`)}
                className="btn-primary mt-3 w-full">
                <i className="ti ti-calendar-event mr-1" />
                Zur Ersatzstunde am {new Date((session as any).replacement.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })} · {(session as any).replacement.time_start?.slice(0,5)} Uhr
              </button>
            )}
            <button onClick={() => router.back()} className="btn-ghost mt-3">Zurück</button>
          </div>
        )}

        {/* ANGEMELDET */}
        {!past && !session.is_cancelled && myBooking && !showCancel && (
          <>
            <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-3 mb-4">
              <p className="text-sm text-yoga-text/80 leading-relaxed">
                Du bist angemeldet. Abmeldung kostenlos bis <strong>{deadline}</strong> – danach gilt die Stunde als wahrgenommen.
              </p>
            </div>
            <button onClick={() => setShowCancel(true)} className="btn-danger mb-2">
              <i className="ti ti-calendar-minus mr-1" /> Von dieser Stunde abmelden
            </button>
            <button onClick={() => router.back()} className="btn-ghost">Zurück</button>
          </>
        )}

        {/* ABMELDE-BESTÄTIGUNG */}
        {!past && !session.is_cancelled && myBooking && showCancel && (
          <>
            <div className={`rounded-yoga p-3 mb-4 ${within3h ? 'bg-yoga-red-bg text-yoga-red-text' : 'bg-yoga-green-bg text-yoga-green-text'}`}>
              <p className="text-sm font-semibold mb-1">
                {within3h ? ' Zu spät für kostenlose Abmeldung' : 'Rechtzeitige Abmeldung'}
              </p>
              <p className="text-sm leading-relaxed opacity-90">
                {within3h ? 'Credit wird nicht zurückgebucht.' : 'Dein Credit wird zurückgebucht.'}
              </p>
            </div>
            <button onClick={handleCancel} className="btn-danger mb-2" disabled={actionLoading}>
              {actionLoading ? 'Wird abgemeldet...' : 'Ja, abmelden'}
            </button>
            <button onClick={() => setShowCancel(false)} className="btn-ghost">Abbrechen</button>
          </>
        )}

        {/* NICHT ANGEMELDET + KEIN WARTELISTENEINTRAG */}
        {!past && !session.is_cancelled && !myBooking && !myWaitlist && (
          <>
            {/* Kurs gesperrt für externe Buchungen */}
            {!course?.is_open && freeSpots > 0 && freeCredits > 0 && (
              <div className="bg-yoga-amber-bg border border-yoga-amber-text/30 rounded-yoga p-4 mb-4">
                <p className="text-sm font-bold text-yoga-amber-text mb-1">
                  <i className="ti ti-lock mr-1" /> Kurs noch nicht freigegeben
                </p>
                <p className="text-sm text-yoga-amber-text/90 leading-relaxed">
                  Dieser Kurs ist noch nicht für Einzelstunden-Buchungen freigegeben. Bitte wende dich an Sarah.
                </p>
              </div>
            )}
            {course?.is_open && freeSpots > 0 && freeCredits > 0 ? (
              <>
                {within3h ? (
                  <>
                    <div className="bg-amber-50 border border-yoga-amber-text/30 rounded-yoga p-3 mb-4">
                      <p className="text-sm font-bold text-yoga-amber-text mb-2">
                        <i className="ti ti-alert-triangle mr-1" /> Innerhalb der 3-Stunden-Frist
                      </p>
                      <p className="text-sm text-yoga-amber-text/90 leading-relaxed">
                        Kurs beginnt in weniger als 3 Stunden. Abmeldung danach <strong>nicht möglich</strong> – Credit verfällt auch bei Nichterscheinen.
                      </p>
                    </div>
                    <div className="bg-yoga-red-bg border border-yoga-red-text/20 rounded-yoga p-3 mb-4">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-0.5 w-5 h-5" />
                        <span className="text-sm text-yoga-red-text leading-relaxed">
                          Ich verstehe, dass mein Credit verfällt und ich mich nicht mehr abmelden kann.
                        </span>
                      </label>
                    </div>
                    <button onClick={handleBook} disabled={!confirmed || actionLoading}
                      className={`btn-primary mb-2 ${!confirmed ? 'opacity-40 cursor-not-allowed' : ''}`}
                      style={{ background: confirmed ? '#8a6020' : undefined }}>
                      {actionLoading ? 'Wird eingetragen...' : 'Trotzdem eintragen'}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-3 mb-4">
                      <p className="text-sm text-yoga-text/80 leading-relaxed">
                        Abmeldung kostenlos bis <strong>{deadline}</strong> – Credit kommt zurück.
                      </p>
                    </div>
                    <button onClick={handleBook} className="btn-primary mb-2" disabled={actionLoading}>
                      {actionLoading ? 'Wird eingetragen...' : 'Für diese Stunde eintragen'}
                    </button>
                  </>
                )}
                <button onClick={() => router.back()} className="btn-ghost">Abbrechen</button>
              </>
            ) : (
              <>
                {freeCredits === 0 && (
                  <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-3 mb-4">
                    <p className="text-sm text-yoga-text/80">
                      Du hast keine freien Credits. Bitte wende dich an Sarah.
                    </p>
                  </div>
                )}
                {freeSpots <= 0 && (
                  <>
                    {freeCredits === 0 ? (
                      // Kein Credit: nur Benachrichtigung möglich
                      <>
                        <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-3 mb-4">
                          <p className="text-sm font-semibold text-yoga-text/80 mb-1">
                            <i className="ti ti-list-x mr-1" /> Warteliste nicht möglich
                          </p>
                          <p className="text-sm text-yoga-text/60 leading-relaxed">
                            Du hast keine freien Credits. Wenn du nachrückst würdest du keinen Platz belegen können. Du kannst dich aber benachrichtigen lassen – vielleicht hast du dann einen Credit.
                          </p>
                        </div>
                        <button onClick={() => handleWaitlist('notify')} className="btn-secondary mb-2" disabled={actionLoading}>
                          <i className="ti ti-bell mr-1" /> Benachrichtige mich wenn ein Platz frei wird
                        </button>
                      </>
                    ) : (
                      // Hat Credits: Warteliste + Benachrichtigung
                      <>
                        <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-3 mb-4">
                          <p className="text-sm text-yoga-text/80 leading-relaxed">
                            Diese Stunde ist ausgebucht. Du kannst dich auf die Warteliste setzen oder benachrichtigt werden wenn ein Platz frei wird.
                          </p>
                        </div>
                        <button onClick={() => handleWaitlist('waitlist')} className="btn-primary mb-2" disabled={actionLoading}>
                          <i className="ti ti-list mr-1" /> Auf die Warteliste setzen
                        </button>
                        <button onClick={() => handleWaitlist('notify')} className="btn-secondary mb-2" disabled={actionLoading}>
                          <i className="ti ti-bell mr-1" /> Benachrichtige mich wenn ein Platz frei wird
                        </button>
                      </>
                    )}
                  </>
                )}
                <button onClick={() => router.back()} className="btn-ghost">Zurück</button>
              </>
            )}
          </>
        )}

        {/* AUF WARTELISTE */}
        {!past && !session.is_cancelled && myWaitlist && (
          <>
            <div className="bg-yoga-amber-bg border border-yoga-amber-text/30 rounded-yoga p-3 mb-4">
              <p className="text-sm font-bold text-yoga-amber-text mb-1">
                {myWaitlist.type === 'waitlist' ? `Du bist auf Position ${myWaitlist.position} der Warteliste` : 'Du wirst benachrichtigt'}
              </p>
              <p className="text-sm text-yoga-amber-text/90 leading-relaxed">
                {myWaitlist.type === 'waitlist'
                  ? 'Du rückst automatisch nach wenn ein Platz frei wird. Du hast dann 1 Stunde Zeit dich kostenlos abzumelden.'
                  : 'Sobald ein Platz frei wird, bekommst du eine Benachrichtigung.'}
              </p>
            </div>
            <button onClick={handleLeaveWaitlist} className="btn-danger mb-2" disabled={actionLoading}>
              {myWaitlist.type === 'waitlist' ? 'Von Warteliste austragen' : 'Benachrichtigung deaktivieren'}
            </button>
            <button onClick={() => router.back()} className="btn-ghost">Zurück</button>
          </>
        )}
      </div>

      <BottomNav isAdmin={profile?.is_admin} />
    </div>
  )
}
