'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/auth'
import { useSwipe } from '@/lib/useSwipe'
import { getCurrentAgbVersion } from '@/lib/agb-version'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'
import WeekPickerPopover from '@/components/WeekPickerPopover'
import AdminAnnouncementBubble from '@/components/AdminAnnouncementBubble'
import YogiCreditExpiryBanner from '@/components/YogiCreditExpiryBanner'
import YogiCancelNotifications from '@/components/YogiCancelNotifications'
// Welle S3/Pattern 3 (Sarah 2026-05-27): defensive Date-Parsing.
import { parseSessionDateTime, berlinDateStr } from '@/lib/session-time'
import OnboardingTour from '@/components/OnboardingTour'

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
function isToday(date: Date): boolean {
  const t = new Date()
  return date.getFullYear() === t.getFullYear()
    && date.getMonth() === t.getMonth()
    && date.getDate() === t.getDate()
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
      // Welle S3/N1 (Sarah 2026-05-27): parseInt mit expliziter Basis 10.
      return saved ? parseInt(saved, 10) : 0
    }
    return 0
  })
  const [sessions, setSessions] = useState<any[]>([])
  const [profile, setProfile] = useState<any>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [isNewYogi, setIsNewYogi] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [loading, setLoading] = useState(true)
  // Welle 6 (Sarah 2026-05-27): "Sarah trägt dich ein"-Banner wegklickbar.
  // dismissed-state via localStorage, damit das Banner nicht jede Session
  // wiederkehrt sondern dauerhaft verschwindet.
  const [newYogiDismissed, setNewYogiDismissed] = useState(false)
  useEffect(() => {
    try { setNewYogiDismissed(localStorage.getItem('new_yogi_banner_dismissed') === '1') } catch {}
  }, [])
  function dismissNewYogi() {
    try { localStorage.setItem('new_yogi_banner_dismissed', '1') } catch {}
    setNewYogiDismissed(true)
  }
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function init() {
      try {
        const user = await getCurrentUser()
        if (!user) { window.location.href = '/login'; return }
        const [{ data: prof }, agb] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', user.id).single(),
          getCurrentAgbVersion(supabase),
        ])
        const currentOrder = agb?.sort_order ?? 1
        if (prof && (!prof.legal_accepted_at || (prof.agb_version ?? 0) < currentOrder)) {
          window.location.href = '/rechtliches'; return
        }
        setProfile(prof)
        setUserId(user.id)

        // Onboarding-Tour zeigen wenn noch nicht durchlaufen
        if (!prof?.is_admin && prof?.onboarding_completed === false) {
          setShowOnboarding(true)
        }
        // Sarah-Wunsch 2026-05-25: PWA-Install-Banner darf erst NACH der Tour
        // erscheinen. Für Bestandsuser (Tour bereits absolviert) UND Admins
        // Flag direkt setzen, sonst sehen sie das Banner nie.
        if (prof?.is_admin || prof?.onboarding_completed === true) {
          try { localStorage.setItem('onboarding_completed', '1') } catch {}
        }

        // Sarah-Wunsch 2026-05-23: Neu-Yogi-Hinweis. Wenn Yogi noch NIE eine Buchung
        // hatte (auch keine stornierte) → Banner "Sarah trägt dich nach der
        // Bezahlung in einen Kurs ein". Verschwindet sobald irgendeine Buchung
        // existiert (auch wenn alle storniert sind = er war mal in einem Kurs).
        const { count: bookingCount } = await supabase.from('bookings')
          .select('id', { count: 'exact', head: true }).eq('user_id', user.id)
        setIsNewYogi(!prof?.is_admin && (bookingCount ?? 0) === 0)
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
    // KEIN setLoading(true) hier — nur initial loading. Refresh-Lade (z.B. Wochenwechsel
    // via Swipe) soll alte Liste sichtbar lassen, sonst Flackern + leerer Spinner.
    const monday = getMonday(new Date())
    const weekStart = addDays(monday, offset * 7)
    const weekEnd = addDays(weekStart, 6)

    // Welle 2.5 (Sarah 2026-05-26): session-eigene Felder mitladen (Einzelstunden/
    // Events haben eigenen name/max_spots/etc., der Container-Kurs hat NULL/0).
    // Welle S1/H4 (Sarah 2026-05-27): KEIN bookings-JOIN mehr — sonst leakt
    // user_id-Liste an alle Yogis. Counts via RPC + eigene Buchung separat.
    const { data, error } = await supabase
      .from('sessions')
      .select(`id, date, time_start, duration_min, session_type, name, location, description, max_spots, image_url, price_eur, bring_along, difficulty, external_participants_count, course:courses(id, name, max_spots, difficulty, is_free, image_url, location, description, bring_along)`)
      .gte('date', berlinDateStr(weekStart))
      .lte('date', berlinDateStr(weekEnd))
      .eq('is_cancelled', false)
      .order('date').order('time_start')

    if (error) { console.error('Sessions:', error); setLoading(false); return }

    // Ersatzstunden-Mapping: welche der sichtbaren Sessions sind selbst Ersatzstunden
    // (= eine andere, abgesagte Session zeigt mit replacement_session_id auf sie).
    const visibleIds = (data || []).map((s: any) => s.id)
    let originMap: Record<string, any> = {}
    if (visibleIds.length > 0) {
      const { data: origins } = await supabase
        .from('sessions')
        .select('id, date, time_start, replacement_session_id')
        .in('replacement_session_id', visibleIds)
      for (const o of (origins || []) as any[]) {
        if (o.replacement_session_id) originMap[o.replacement_session_id] = o
      }
    }

    // Welle S1/H4 (Sarah 2026-05-27): Booking-Counts via RPC (SECURITY DEFINER)
    // statt JOIN — die RPC liefert nur den Count, keine user_ids. Eigene Buchungen
    // separat ueber user_id-Filter. Ergebnis im UI identisch.
    const countMap: Record<string, number> = {}
    const myBookingMap: Record<string, any> = {}
    if (visibleIds.length > 0) {
      const { data: counts } = await supabase.rpc('get_session_booking_counts', {
        p_session_ids: visibleIds,
      })
      for (const row of (counts || []) as any[]) {
        countMap[row.session_id] = row.booking_count ?? 0
      }
      const { data: myBookings } = await supabase
        .from('bookings')
        .select('id, session_id, status')
        .eq('user_id', userId!)
        .eq('status', 'active')
        .in('session_id', visibleIds)
      for (const b of (myBookings || []) as any[]) {
        myBookingMap[b.session_id] = b
      }
    }

    const now = new Date()
    // Welle 2.5: für Container-Sessions (single/event_*) zeigt course.name den
    // SYS-Container ("SYS · Events (bezahlt)") — daher session.name als Override.
    // Gleiche Fallback-Strategie für max_spots, image_url, location, description,
    // bring_along, difficulty.
    const enriched = (data || []).map((s: any) => {
      const display_name = s.name ?? s.course?.name
      const display_max_spots = s.max_spots ?? s.course?.max_spots
      const display_image_url = s.image_url ?? s.course?.image_url
      const display_location = s.location ?? s.course?.location
      const display_description = s.description ?? s.course?.description
      const display_bring_along = s.bring_along ?? s.course?.bring_along
      const display_difficulty = s.difficulty ?? s.course?.difficulty
      return {
        ...s,
        // Welle S1/H4 (Sarah 2026-05-27): Count + own booking aus separaten Quellen
        // (s. RPC + my-bookings-Query oben). Vorher: bookings-JOIN mit user_id-Leak.
        booking_count: countMap[s.id] ?? 0,
        my_booking: myBookingMap[s.id] || null,
        // Welle S3/Pattern 3: bei null-Werten defensiv "nicht past".
        is_past: (() => { const dt = parseSessionDateTime(s.date, s.time_start); return dt ? dt < now : false })(),
        is_replacement: !!originMap[s.id],
        original_session: originMap[s.id] || null,
        display_name, display_max_spots, display_image_url, display_location,
        display_description, display_bring_along, display_difficulty,
      }
    })
    setSessions(enriched)
    setLoading(false)
  }

  const monday = getMonday(new Date())
  const weekStart = addDays(monday, offset * 7)
  const weekLabel = offset === 0 ? 'Diese Woche'
    : offset === 1 ? 'Nächste Woche'
    : offset === -1 ? 'Vorherige Woche'
    : formatWeekRange(weekStart)

  // Welle 2.5 (Sarah 2026-05-26): Events-Sektion oben (mehr Vermarktungs-Wirkung),
  // dann reguläre Kursstunden. Sarah-Wunsch 2026-05-26 Welle 2.8:
  // NUR Events (event_free/paid) in "Events diese Woche" — einzelstunden
  // (session_type='single') gehoeren zu den normalen Stunden ("Stunden diese
  // Woche") weil sie wie Drop-Ins wirken.
  const isEvent = (s: any) =>
    s.session_type === 'event_free' || s.session_type === 'event_paid'
  const eventSessions = sessions.filter(isEvent)
  const courseSessions = sessions.filter((s: any) => !isEvent(s))

  const byDay: Record<string, any[]> = {}
  courseSessions.forEach(s => { if (!byDay[s.date]) byDay[s.date] = []; byDay[s.date].push(s) })
  const myNextSession = sessions.find(s => s.my_booking && !s.is_past)

  function getBadge(s: any) {
    if (s.is_past) return <span className="badge bg-yoga-gray text-yoga-text/40">Vergangen</span>
    if (s.my_booking) return <span className="badge badge-mine">Angemeldet</span>
    // Sarah-BugFix 2026-05-26: max_spots aus session (Container hat 0 → "Ausgebucht").
    // Welle 2.11: external_participants_count auch abziehen.
    const free = (s.display_max_spots || 0) - s.booking_count - (s.external_participants_count || 0)
    if (free <= 0) return <span className="badge badge-full">Ausgebucht</span>
    if (free === 1) return <span className="badge badge-wait">1 Platz frei</span>
    return <span className="badge badge-free">{free} Plätze frei</span>
  }

  // Welle 2.5: Typ-Badge für Events-Sektion (Preis bei paid, "Kostenlos" bei free,
  // "Einzelstunde" bei single).
  function getEventBadge(s: any) {
    if (s.session_type === 'event_paid') return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-yoga-amber-bg text-yoga-amber-text text-[10px] font-semibold">
        {s.price_eur} €
      </span>
    )
    if (s.session_type === 'event_free') return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-yoga-green-bg text-yoga-green-text text-[10px] font-semibold">
        Kostenlos
      </span>
    )
    // single
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-yoga-gray text-yoga-text/60 text-[10px] font-semibold">
        Einzelstunde
      </span>
    )
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

      {/* Onboarding-Tour für neue Yogis (einmalig nach AGB-Akzeptanz) */}
      {showOnboarding && <OnboardingTour onComplete={() => setShowOnboarding(false)} />}

      {/* Sarah-Nachricht (nur sichtbar wenn Admin sie aktiviert hat) */}
      <AdminAnnouncementBubble />

      {/* Welle 6.1 (Sarah 2026-05-27): Banner für abgesagte Stunden/Events
          die der Yogi gebucht hatte. Weißer Hintergrund, kein Icon, wegklickbar. */}
      {!profile?.is_admin && <YogiCancelNotifications />}

      {/* Sarah-Wunsch 2026-05-25: Credit-Ablauf-Warnungen — NUR fuer Yogis,
          nicht fuer Admins (Admins haben i.d.R. keine eigenen Credits zu tracken) */}
      {!profile?.is_admin && <YogiCreditExpiryBanner />}

      {/* Neu-Yogi-Hinweis: noch keine einzige Buchung in der Historie.
          Welle 3 (Sarah 2026-05-26): jetzt auch Einzelstunden + Events erwähnen,
          damit es für Yogis ohne Kursbuchung nicht irreführend wirkt. */}
      {isNewYogi && !newYogiDismissed && (
        <div className="mx-4 mt-3 bg-yoga-amber-bg border border-yoga-amber-text/20 rounded-yoga px-4 py-3 flex items-start gap-2 relative">
          <i className="ti ti-info-circle text-yoga-amber-text text-base mt-0.5 flex-shrink-0" />
          <p className="text-sm text-yoga-text/80 leading-snug pr-5">
            {/* Welle 6 (Sarah 2026-05-27): Text-Update — explizit "nach der
                Bezahlung / nach deiner Anmeldung in einen Kurs". */}
            Sarah trägt dich nach der Bezahlung / nach deiner Anmeldung in einen Kurs ein. Einzelstunden &amp; Events kannst du direkt selbst buchen.
          </p>
          <button onClick={dismissNewYogi} aria-label="Hinweis schließen"
            className="absolute top-1 right-1 p-1 text-yoga-text/40 hover:text-yoga-text/70 bg-transparent border-0 cursor-pointer">
            <i className="ti ti-x text-base" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <button onClick={() => goWeek(-1)}
          className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 border border-yoga-text/30 rounded-full text-yoga-text">
          <i className="ti ti-chevron-left text-sm" /> Vorherige
        </button>
        <WeekPickerPopover
          currentWeekStart={weekStart}
          onSelectWeek={(mon) => {
            const today = new Date(); today.setHours(0,0,0,0)
            const todayMon = getMonday(today)
            const diffDays = Math.round((mon.getTime() - todayMon.getTime()) / 86400000)
            const n = Math.round(diffDays / 7)
            sessionStorage.setItem('kurse_week_offset', String(n))
            setOffset(n)
          }}>
          {weekLabel}
        </WeekPickerPopover>
        <button onClick={() => goWeek(+1)}
          className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 border border-yoga-text/30 rounded-full text-yoga-text">
          Nächste <i className="ti ti-chevron-right text-sm" />
        </button>
      </div>

      {/* Welle 6 (Sarah 2026-05-27): "Du hast X Stunden diese Woche"-Kachel
          entfernt — Sarah fand sie redundant. Statt dessen wird der grüne
          Rahmen um die eigene gebuchte Stunde dicker (border-[3px]). */}

      <div className="px-4 pb-4 mt-3">
        {/* Welle 2.5 (Sarah 2026-05-26): Events-Sektion oben — Vermarktungs-Wirkung.
            Zeigt Einzelstunden + Events (alle session_type != 'course_session'). */}
        {!loading && eventSessions.length > 0 && (
          <div className="mb-5">
            {/* Welle 6 (Sarah 2026-05-27): zentriert */}
            <p className="text-xs font-bold mb-2 mt-1 uppercase tracking-wide text-yoga-text text-center">
              Events diese Woche
            </p>
            {eventSessions.map(s => {
              const dObj = new Date(s.date)
              // Welle 2.6 (Sarah 2026-05-26): Foto VORNE, Uhrzeit+Dauer als Fließtext
              // in der Mitte. So unterscheiden sich Events optisch von Kursstunden
              // (die ihre Uhrzeit links groß tragen).
              return (
                <button key={s.id}
                  onClick={() => { if (!s.is_past && !s.is_cancelled) router.push(`/kurse/${s.id}`) }}
                  disabled={s.is_past || s.is_cancelled}
                  className={`w-full flex items-center gap-3 mb-2 text-left transition-colors rounded-yoga border p-3
                    ${(s.is_past || s.is_cancelled) ? 'opacity-40 cursor-default pointer-events-none' : 'hover:border-yoga-border2 active:scale-[0.98]'}
                    ${s.my_booking && !s.is_past && !s.is_cancelled ? 'border-[3px] border-yoga-green-text bg-white' : 'border-yoga-border bg-white'}`}>
                  {s.display_image_url ? (
                    <img src={s.display_image_url} alt="" className="w-16 h-16 rounded-yoga object-cover flex-shrink-0 border border-yoga-border" />
                  ) : (
                    <div className="w-16 h-16 rounded-yoga bg-yoga-card flex items-center justify-center flex-shrink-0 border border-yoga-border">
                      <i className="ti ti-confetti text-yoga-text/40 text-2xl" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-bold truncate ${s.is_past ? 'line-through' : ''}`}>
                      {s.display_name}
                    </div>
                    <div className="text-xs text-yoga-text/55 mt-0.5">
                      {dObj.toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short' })}
                      {' · '}{s.time_start?.slice(0,5)}
                      {' · '}{s.duration_min} min
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      {getEventBadge(s)}
                      {s.display_difficulty && (
                        <span className="text-xs text-yoga-text/50">{s.display_difficulty}</span>
                      )}
                    </div>
                  </div>
                  {getBadge(s)}
                </button>
              )
            })}
          </div>
        )}
        {/* Welle 6 (Sarah 2026-05-27): "Stunden diese Woche"-Header nur wenn
            ZUSÄTZLICH Events angezeigt werden — sonst ist die Überschrift
            redundant (die Stunden stehen ohnehin direkt darunter). Wenn
            beide gezeigt werden, beide zentriert. */}
        {!loading && courseSessions.length > 0 && eventSessions.length > 0 && (
          <p className="text-xs font-bold mb-2 uppercase tracking-wide text-yoga-text/70 text-center">
            Stunden diese Woche
          </p>
        )}
        {loading ? (
          <div className="text-center py-10 text-yoga-text/40">
            <i className="ti ti-loader-2 animate-spin text-3xl block mb-2" />
            <p className="text-sm">Wird geladen...</p>
          </div>
        ) : (Object.keys(byDay).length === 0 && eventSessions.length === 0) ? (
          <div className="text-center py-10 text-yoga-text/40">
            <i className="ti ti-moon text-3xl block mb-2" />
            <p className="text-sm">Keine Stunden diese Woche</p>
          </div>
        ) : Object.entries(byDay).map(([date, daySessions]) => {
          const dObj = new Date(date)
          const today = isToday(dObj)
          return (
          <div key={date} className="mb-4">
            <p className="text-xs font-bold mb-1 mt-3 uppercase tracking-wide">
              {today ? (
                <>
                  <span className="text-yoga-text">HEUTE</span>
                  <span className="text-yoga-text/50"> · {formatDate(dObj)}</span>
                </>
              ) : (
                <span className="text-yoga-text/70">{formatDate(dObj)}</span>
              )}
            </p>
            {daySessions.map(s => (
              <button key={s.id}
                onClick={() => { if (!s.is_past && !s.is_cancelled) router.push(`/kurse/${s.id}`) }}
                disabled={s.is_past || s.is_cancelled}
                className={`w-full flex items-center gap-3 mb-2 text-left transition-colors rounded-yoga border p-3
                  ${(s.is_past || s.is_cancelled) ? 'opacity-40 cursor-default pointer-events-none' : 'hover:border-yoga-border2 active:scale-[0.98]'}
                  ${s.my_booking && !s.is_past && !s.is_cancelled ? 'border-[3px] border-yoga-green-text bg-white' : 'border-yoga-border bg-white'}`}>
                <div className="text-center flex-shrink-0 w-12">
                  <div className={`text-base font-bold ${s.is_past ? 'line-through' : ''}`}>
                    {s.time_start?.slice(0,5)}
                  </div>
                  <div className="text-xs text-yoga-text/40">{s.duration_min} min</div>
                </div>
                <div className="w-px h-8 bg-yoga-border2 flex-shrink-0" />
                {/* Variante A v2: Bild ZWISCHEN Trenner und Titel (Sarah-Wunsch 2026-05-24) */}
                {s.display_image_url && (
                  <img src={s.display_image_url} alt="" className="w-12 h-12 rounded-yoga object-cover flex-shrink-0 border border-yoga-border" />
                )}
                <div className="flex-1 min-w-0">
                  {/* Sarah-Wunsch 2026-05-24: Reihenfolge — Kurstitel,
                      Ersatzstunde-Hinweis (eigene Zeile), Level, Charity-Pille */}
                  <div className="text-sm font-semibold truncate">{s.display_name}</div>
                  {s.is_replacement && s.original_session && (
                    <div className="text-xs text-yoga-text font-semibold mt-0.5">
                      Ersatzstunde für {new Date(s.original_session.date).toLocaleDateString('de-DE', { day:'numeric', month:'short' })} · {s.original_session.time_start?.slice(0,5)} Uhr
                    </div>
                  )}
                  {s.display_difficulty && (
                    <div className="text-xs text-yoga-text/50 mt-0.5">{s.display_difficulty}</div>
                  )}
                  {s.course?.is_free && (
                    <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full bg-yoga-green-bg text-yoga-green-text text-[10px] font-semibold">
                      Kostenlos
                    </span>
                  )}
                </div>
                {getBadge(s)}
              </button>
            ))}
          </div>
          )
        })}
      </div>
      <BottomNav isAdmin={profile?.is_admin} />
    </div>
  )
}
