'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/auth'
import { isActive, isExcluded, isCancelled, isStarted } from '@/lib/session-status'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'
import { getCurrentAgbVersion } from '@/lib/agb-version'

export default function MeinePage() {
  const [profile, setProfile] = useState<any>(null)
  const [enrollments, setEnrollments] = useState<any[]>([])
  // Sarah-Regel 2026-05-22 (final):
  // "Einzelstunden" = ALLE active bookings die NICHT in einer Session des eigenen
  // aktiv-enrolled Kurses sind. Egal welcher booking.type, egal welcher Credit.
  // Beispiele:
  // - Drop-In in fremder Kurs-Session → Einzelstunde
  // - Vorhol/Nachhol mit Course-Credit aus altem Kurs in fremder Session → Einzelstunde
  // - Drop-In aus Tenpack/Single-Credit → Einzelstunde
  // - Buchung in eigener Kursstunde (auch nach Ab+Wiederanmeldung) → Kurs-Block
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

      const [{ data: prof }, { data: enrols }, { data: allBookings }, { data: crds }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('enrollments').select('*, course:courses(*)').eq('user_id', user.id),
        // ALLE active bookings laden. UI-Filter trennt Kurs-Block (eigener Kurs)
        // von Einzelstunden (alle anderen Sessions).
        supabase.from('bookings')
          .select('*, session:sessions!bookings_session_id_fkey(*, course:courses(name))')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('created_at', { ascending: false }),
        supabase.from('credits').select('*, course:courses(name)').eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString()),
      ])

      const agb = await getCurrentAgbVersion(supabase)
      const currentOrder = agb?.sort_order ?? 1
      if (prof && (!prof.legal_accepted_at || (prof.agb_version ?? 0) < currentOrder)) {
        router.push('/rechtliches'); return
      }
      setProfile(prof)
      // Beendete Kurse (date_end < heute) für Yogi ausblenden – Credits bleiben sichtbar via expires_at
      const today = new Date().toISOString().split('T')[0]
      const activeEnrols = (enrols || []).filter((e: any) =>
        !e.course?.date_end || e.course.date_end >= today
      )
      setEnrollments(activeEnrols)
      setSingleBookings(allBookings || [])
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
            .from('bookings').select('*, origin:sessions!bookings_origin_session_id_fkey(id, date, time_start, course:courses(name))').eq('user_id', user.id)
            .in('session_id', (sessions || []).map((s: any) => s.id))
          // Ausgeschlossene Stunden nie anzeigen (Setup-Excluded zählt nicht als Termin).
          const visibleSessions = (sessions || []).filter((s: any) => !isExcluded(s))
          // Range anwenden: nur Einheiten zwischen enrolled_from_unit und enrolled_until_unit
          const fromUnit = enrol.enrolled_from_unit ?? 1
          const untilUnit = enrol.enrolled_until_unit ?? visibleSessions.length
          // Unit-Index basiert auf AKTIVEN Sessions in chronologischer Reihenfolge
          const activeOrdered = visibleSessions.filter(isActive)
          const rangeIds = new Set(
            activeOrdered.slice(fromUnit - 1, untilUnit).map((s: any) => s.id)
          )
          // Ersatzstunden-Mapping: eine Session ist eine Ersatzstunde, wenn eine ANDERE
          // (abgesagte) Session mit replacement_session_id auf sie verweist.
          // Wir bauen den Lookup aus ALLEN sessions des Kurses (nicht nur visible),
          // da die abgesagte Original-Session evtl. nicht im range/visible-Set steckt.
          const replacementOrigin: Record<string, any> = {}
          for (const s of (sessions || []) as any[]) {
            if (s.replacement_session_id) {
              replacementOrigin[s.replacement_session_id] = { date: s.date, time_start: s.time_start }
            }
          }
          // Anzeigen: aktive im Range + abgesagte (mit "Abgesagt"-Badge); excluded sind raus.
          sessionsMap[enrol.course_id] = visibleSessions
            .filter((s: any) => rangeIds.has(s.id) || isCancelled(s))
            .map((s: any) => ({
              ...s,
              myBooking: myBookings?.find((b: any) => b.session_id === s.id),
              is_replacement: !!replacementOrigin[s.id],
              original_session: replacementOrigin[s.id] || null,
            }))
        }
        setCourseSessions(sessionsMap)
      }
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  // Kursstunden Badge — kanonisches Status-Modell aus lib/session-status.ts
  function getStatusBadge(session: any) {
    const mb = session.myBooking
    // Excluded sollte hier eigentlich nicht ankommen (vorher gefiltert), aber sicher ist sicher
    if (isExcluded(session))
      return <span className="badge badge-left">Ausgeschlossen</span>
    if (isCancelled(session))
      return <span className="badge" style={{background:'var(--yoga-red-bg)',color:'var(--yoga-red-text)'}}>Abgesagt</span>
    if (!mb || mb.status === 'cancelled')
      return <span className="badge badge-left">Abgemeldet</span>
    if (isStarted(session))
      return <span className="badge badge-done">Teilgenommen</span>
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

  // Modell-bewusste Credit-Werte für die Yogi-Anzeige:
  //
  // COURSE-CREDIT (Sarah's Mentalmodell, pro KURS aggregiert über ggf. mehrere
  // Credits wie Guthaben+neuer Course-Credit zusammen):
  //   total   = Anzahl Stunden, in die der Yogi insgesamt eingebucht ist im Kurs
  //             (= aktive + abgemeldete bookings für diesen Kurs)
  //   used    = aktive bookings (= aktuell für die Stunde angemeldet)
  //   free    = total - used = Stunden für die sich der Yogi abgemeldet hat
  //             (Credit ggf. refundable bzw. später wieder buchbar)
  //
  // GUTHABEN / TENPACK / SINGLE: behält DB-Semantik (used aus DB-Trigger).
  // Sarah-Regel 2026-05-22: Anzeige folgt direkt der DB-Wahrheit (credit.total/used).
  // Der DB-Trigger pflegt credit.used korrekt — inkl. Drop-Ins in fremde Stunden,
  // Ersatzstunden (cancelled sessions zählen nicht), und cancelled bookings.
  // Damit ist die /meine-Anzeige immer konsistent mit dem tatsächlichen
  // Credit-Stand: wenn ein Drop-In den Credit aufzehrt, sieht der Yogi 1 frei
  // weniger.
  function computeUsedDisplay(c: any) { return c.used }
  function computeTotalDisplay(c: any) { return c.total }
  function computeFreeMeine(c: any) { return Math.max(0, c.total - c.used) }
  // Anzeige-Filter: Guthaben/Tenpack/Single mit 0 freien Credits ausblenden
  // (sind komplett aufgebraucht und liefern dem Yogi keine Info mehr).
  // Course-Credits IMMER zeigen (zeigen Kursfortschritt + Verfallsdatum).
  const visibleCredits = credits.filter((c: any) => {
    if (c.model === 'course') return true
    return Math.max(0, c.total - c.used) > 0
  })
  const totalFreeCredits = visibleCredits.reduce((sum, c) => sum + computeFreeMeine(c), 0)
  const firstExpiry = [...visibleCredits].sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())[0]

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Meine" isAdmin={profile?.is_admin} />
      <div className="px-4 py-4">
        {/* Credits Detail-Anzeige – "Freie Credits" = Credits aus Abmeldungen */}
        {visibleCredits.length > 0 ? (
          <div className="mb-4">
            <p className="section-label">Deine freien Credits</p>
            {visibleCredits.map(c => {
              const free = computeFreeMeine(c)
              const used = computeUsedDisplay(c)
              const totalDisplay = computeTotalDisplay(c)
              return (
                <div key={c.id} className="card mb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-2xl font-bold ${free === 0 ? 'text-yoga-text/30' : ''}`}>{free}</span>
                        <span className="text-sm text-yoga-text/60">
                          {c.model === 'course'
                            ? (c.course?.name ? `aus Kurs: ${c.course?.name}` : 'aus Kurs-Credits')
                            : c.model === 'guthaben' ? 'Guthaben'
                            : `Einzelstunden-${c.total === 1 ? 'Credit' : 'Credits'}`}
                        </span>
                      </div>
                      {c.model === 'guthaben' && (
                        <>
                          <div className="text-xs text-yoga-amber-text mt-1">Guthaben aus abgesagtem Kurs</div>
                          <div className="text-xs text-yoga-text/50 mt-0.5">Nicht für Einzelstunden, nur verrechenbar mit neuem Kurs</div>
                        </>
                      )}
                      {c.model === 'guthaben'
                        ? <div className="text-xs text-yoga-text/40 mt-1">Gültig bis {new Date(c.expires_at).toLocaleDateString('de-DE', { day:'numeric', month:'long', year:'numeric' })}</div>
                        : <div className="text-xs text-yoga-text/40 mt-1">Verfallen am {new Date(c.expires_at).toLocaleDateString('de-DE', { day:'numeric', month:'long', year:'numeric' })}</div>
                      }
                    </div>
                    {c.model !== 'guthaben' && (
                      <div className="text-right">
                        <div className="text-xs text-yoga-text/40">{used} / {totalDisplay} genutzt</div>
                        <div className="h-1.5 w-16 bg-yoga-border rounded-full mt-1">
                          <div className="h-full bg-yoga-text/40 rounded-full"
                            style={{ width: `${(used/Math.max(1,totalDisplay))*100}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="mb-4">
            <p className="section-label">Deine freien Credits</p>
            <div className="card text-center py-4">
              <p className="text-sm text-yoga-text/50">Keine Credits</p>
            </div>
          </div>
        )}

        {enrollments.length > 0 && (
          <p className="section-label">{enrollments.length === 1 ? 'Dein Kurs' : 'Deine Kurse'}</p>
        )}
        {enrollments.map((enrol, idx) => {
          const sessions = courseSessions[enrol.course_id] || []
          // Absolviert erst wenn Session zeitlich vorbei ist (date+time+duration), nicht nur date
          const done = sessions.filter(s => isStarted(s) && s.myBooking?.status === 'active').length
          return (
            // Sarah-Wunsch 2026-05-24: visuelle Gruppe pro Kurs.
            // - Mehr Luft zwischen Kursen (mb-8 statt mb-6)
            // - Ab dem 2. Kurs ein sehr dezenter Querstreifen darüber als Trenner
            // - Header + Stunden eng zusammen (mb-1.5 statt mb-2 + section-label weg)
            <div key={enrol.id} className={`mb-8 ${idx > 0 ? 'pt-4 border-t border-yoga-border' : ''}`}>
              <div className="card mb-1.5">
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
                      <div className="text-sm font-semibold truncate">
                        {enrol.course?.name}
                        {/* Sarah-Klarstellung 2026-05-24: "Ersatzstunde"-Tag NUR bei
                            Admin-angelegten Ersatz-Sessions (is_replacement =
                            sessions.replacement_session_id zeigt von einer
                            abgesagten Original-Session auf diese hier).
                            Yogi-initiierte Nachhol-Buchungen (booking.origin_session_id)
                            sind reine INTERNE Verrechnungs-Logik — kein UI-Tag. */}
                        {s.is_replacement && (
                          <span className="text-yoga-amber-text font-semibold"> · Ersatzstunde</span>
                        )}
                      </div>
                      {s.is_replacement && s.original_session && (
                        <div className="text-xs text-yoga-amber-text mt-0.5 truncate">
                          für {new Date(s.original_session.date).toLocaleDateString('de-DE', { day:'numeric', month:'short' })} · {s.original_session.time_start?.slice(0,5)} Uhr
                        </div>
                      )}
                    </div>
                    {getStatusBadge(s)}
                  </button>
                )
              })}
            </div>
          )
        })}

        {/* Einzelstunden — alle Buchungen die NICHT in einem aktiv-enrolled Kurs sind.
            Regel (Sarah 2026-05-22): egal welcher booking.type oder Credit-Modell.
            Drop-In, Vorhol/Nachhol, Tenpack-Stunde, etc. — alles was außerhalb der
            eigenen Kurse läuft, landet hier. Buchungen in eigenen Kursstunden bleiben
            immer im Kurs-Block oben (auch nach Ab- und Wiederanmeldung). */}
        {(() => {
          const enrolledCourseIds = new Set(enrollments.map((e: any) => e.course_id))
          const nowMs = Date.now()
          const singles = singleBookings
            .filter((b: any) => !b.session?.course_id || !enrolledCourseIds.has(b.session.course_id))
            // Sarah-Bug-Fix 2026-05-23 (Eva-Dressbach-Befund): vergangene Einzelstunden
            // ausblenden — Yogi sieht in /meine nur ZUKÜNFTIGE Stunden in der Liste.
            // Past-Stunden bleiben im DB-Audit, sind nur nicht mehr im aktiven Feed.
            .filter((b: any) => {
              if (!b.session?.date || !b.session?.time_start) return false
              const sessDt = new Date(`${b.session.date}T${b.session.time_start}`).getTime()
              return sessDt >= nowMs
            })
            .sort((a: any, b: any) => {
              const ad = new Date(`${a.session?.date}T${a.session?.time_start}`).getTime()
              const bd = new Date(`${b.session?.date}T${b.session?.time_start}`).getTime()
              return ad - bd
            })
          if (singles.length === 0) return null
          return (
          <div className="mb-6">
            <p className="section-label">Einzelstunden</p>
            {singles.map(b => (
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
                {new Date(`${b.session?.date}T${b.session?.time_start}`) < new Date()
                  ? <span className="badge badge-done">Teilgenommen </span>
                  : <span className="badge badge-enrolled">Angemeldet</span>}
              </button>
            ))}
          </div>
          )
        })()}

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
