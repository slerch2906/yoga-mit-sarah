'use client'

/**
 * Wartelisten-Austrag per Email-Link.
 *
 * Sarah 2026-05-22: Klick auf "Wieder austragen" in der Warteliste-Email muss
 *   - ohne Login funktionieren (Yogi kommt direkt aus dem Mail-Programm)
 *   - automatisch austragen (kein zusätzlicher Klick nötig)
 *   - sichtbar bestätigen, dass er entfernt wurde (Kursname + Datum/Zeit)
 *
 * Token-basiert: die RPC `leave_waitlist_by_token` löscht den waitlist-Eintrag
 * mit dem passenden Token (SECURITY DEFINER). Idempotent — zweiter Klick zeigt
 * "bereits entfernt", kein Fehler.
 */

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
const WEEKDAYS = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag']

function formatGermanDate(dateStr: string, timeStr?: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const base = `${WEEKDAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  return timeStr ? `${base} um ${timeStr.slice(0,5)} Uhr` : base
}

function AustragenInner() {
  const params = useSearchParams()
  const token = params.get('token')
  const [state, setState] = useState<'loading' | 'success' | 'already' | 'invalid' | 'error'>('loading')
  const [info, setInfo] = useState<{ courseName: string; date: string; timeStart: string; type: string } | null>(null)

  useEffect(() => {
    async function leave() {
      if (!token) { setState('invalid'); return }
      const supabase = createClient()
      const { data, error } = await supabase.rpc('leave_waitlist_by_token', { p_token: token })
      if (error) { setState('error'); return }
      if (!data?.ok) {
        if (data?.reason === 'already_removed') setState('already')
        else setState('invalid')
        return
      }
      // Welle 6 (Sarah 2026-05-27): die RPC liefert noch immer course.name —
      // bei Container-Sessions (Events/Einzelstunden) ist das "SYS · Events"
      // o.ä. Solange die RPC nicht erweitert ist (Migration siehe Report),
      // ersetzen wir den SYS-Namen client-side durch einen verständlichen
      // Fallback aus session_name/session_type.
      const rawCourse = data.course_name || ''
      const sessionName = data.session_name || ''
      const sessionType = data.session_type || ''
      let displayName = rawCourse
      if (rawCourse.startsWith('SYS · ') || !rawCourse) {
        if (sessionType === 'single') displayName = sessionName ? `Einzelstunde · ${sessionName}` : 'Einzelstunde'
        else if (sessionType === 'event_free' || sessionType === 'event_paid' || sessionType === 'event_credit') displayName = sessionName ? `Event · ${sessionName}` : 'Event'
        else if (sessionName) displayName = sessionName
      }
      setInfo({
        courseName: displayName,
        date: data.date || '',
        timeStart: data.time_start || '',
        type: data.type || 'waitlist',
      })
      setState('success')
    }
    leave()
  }, [token])

  return (
    <div className="max-w-md mx-auto min-h-screen bg-yoga-bg">
      {/* Slim Header, ohne Login-Logik — der Yogi kommt evtl. unangemeldet hier rein */}
      <div className="app-header sticky top-0 z-10 relative overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center pointer-events-none"
          style={{ backgroundImage: "url('/header-bg.jpg?v=2')", opacity: 0.4 }} />
        <div className="relative z-10 flex-1 min-w-0 text-right">
          <h1 className="text-lg font-bold truncate">Yoga mit Sarah</h1>
        </div>
        <div className="relative z-10 w-[73px] h-[73px] flex-shrink-0 flex items-center justify-center">
          <img
            src="https://yogamitsarah.me/wp-content/uploads/2025/09/Logo-300x300.png"
            alt="Yoga mit Sarah Logo"
            className="w-[73px] h-[73px] object-contain"
            onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png' }}
          />
        </div>
      </div>

      <div className="px-4 py-8">
        {state === 'loading' && (
          <div className="text-center py-12 text-yoga-text/60">
            <i className="ti ti-loader-2 animate-spin text-3xl block mb-3" />
            <p className="text-sm">Wird ausgetragen...</p>
          </div>
        )}

        {state === 'success' && info && (
          <div className="card text-center">
            <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-yoga-green-bg flex items-center justify-center">
              <i className="ti ti-check text-3xl text-yoga-green-text" />
            </div>
            <h2 className="text-lg font-bold mb-2">
              {info.type === 'notify' ? 'Benachrichtigung entfernt' : 'Von der Warteliste ausgetragen'}
            </h2>
            <p className="text-sm text-yoga-text/70 mb-4">
              Du wurdest erfolgreich {info.type === 'notify' ? 'von der Benachrichtigungsliste' : 'von der Warteliste'} für folgende Stunde ausgetragen:
            </p>
            <div className="bg-yoga-gray border border-yoga-border rounded-yoga p-4 text-left">
              <p className="text-base font-bold mb-1">{info.courseName}</p>
              <p className="text-sm text-yoga-text/65">{formatGermanDate(info.date, info.timeStart)}</p>
            </div>
            <p className="text-xs text-yoga-text/55 mt-4">
              Falls du dich wieder anmelden möchtest, kannst du das jederzeit in der App tun.
            </p>
            <a href="/" className="inline-block mt-5 text-sm font-bold bg-yoga-text text-yoga-bg rounded-full px-5 py-2.5">
              Zur App
            </a>
          </div>
        )}

        {state === 'already' && (
          <div className="card text-center">
            <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-yoga-gray flex items-center justify-center">
              <i className="ti ti-info-circle text-3xl text-yoga-text/50" />
            </div>
            <h2 className="text-lg font-bold mb-2">Bereits ausgetragen</h2>
            <p className="text-sm text-yoga-text/70">
              Du stehst nicht mehr auf dieser Warteliste — entweder hast du dich bereits ausgetragen oder bist schon nachgerückt.
            </p>
            <a href="/" className="inline-block mt-5 text-sm font-bold bg-yoga-text text-yoga-bg rounded-full px-5 py-2.5">
              Zur App
            </a>
          </div>
        )}

        {(state === 'invalid' || state === 'error') && (
          <div className="card text-center">
            <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-yoga-red-bg flex items-center justify-center">
              <i className="ti ti-alert-triangle text-3xl text-yoga-red-text" />
            </div>
            <h2 className="text-lg font-bold mb-2">Link ungültig</h2>
            <p className="text-sm text-yoga-text/70">
              Der Austragungs-Link ist ungültig oder abgelaufen. Du kannst dich direkt in der App von der Warteliste austragen.
            </p>
            <a href="/" className="inline-block mt-5 text-sm font-bold bg-yoga-text text-yoga-bg rounded-full px-5 py-2.5">
              Zur App
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

export default function WartelisteAustragenPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" />
      </div>
    }>
      <AustragenInner />
    </Suspense>
  )
}
