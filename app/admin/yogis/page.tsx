'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

export default function AdminYogisPage() {
  const [yogis, setYogis] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // Sarah-Wunsch 2026-08-18: Filter-Leiste ueber der Yogi-Liste.
  const [activeFilter, setActiveFilter] = useState<'all' | 'in_course' | 'no_course' | 'credits'>('all')
  const [showDummyForm, setShowDummyForm] = useState(false)
  const [dummyForm, setDummyForm] = useState({ first_name: '', last_name: '' })
  const [savingDummy, setSavingDummy] = useState(false)
  const [dummyError, setDummyError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    // Bugfix (Sarah 2026-08-18): is_active des Kurses mitladen, um zwischen
    // "aktuell in einem laufenden Kurs" und einer Enrollment in einem
    // archivierten Kurs unterscheiden zu koennen (siehe hasActiveEnrollment).
    const { data: yogiList } = await supabase
      .from('profiles')
      .select('*, credits(*), enrollments(*, course:courses(name, is_active))')
    setYogis((yogiList || []).filter((y: any) => !y.is_admin && y.first_name !== 'Gelöschter'))
    setLoading(false)
  }

  // Sarah-Plausibilitäts-Fix 2026-05-26: Credits und Guthaben sind NICHT
  // das Gleiche. Yogi mit 12 Guthaben + 0 Course-Credits hatte hier
  // irreführend "12 Credits" gezeigt. Jetzt getrennt: Credits (course/
  // tenpack/single/quarterly) und Guthaben (model='guthaben').
  function getFreeCredits(yogi: any) {
    return (yogi.credits || []).reduce((sum: number, c: any) => {
      if (c.model === 'guthaben') return sum
      if (new Date(c.expires_at) > new Date()) return sum + Math.max(0, c.total - c.used)
      return sum
    }, 0)
  }
  function getGuthaben(yogi: any) {
    return (yogi.credits || []).reduce((sum: number, c: any) => {
      if (c.model !== 'guthaben') return sum
      if (new Date(c.expires_at) > new Date()) return sum + Math.max(0, c.total - c.used)
      return sum
    }, 0)
  }

  function getCurrentCourse(yogi: any) {
    return yogi.enrollments?.[0]?.course?.name || '—'
  }

  // Sarah-Wunsch 2026-08-18: Filter-Kriterien für die Yogi-Übersicht.
  // "Aktiv" = mind. eine Einschreibung in einen laufenden (nicht archivierten)
  // Kurs — es gibt kein eigenes Aktiv/Inaktiv-Flag am Profil (das 24-Monats-
  // Inaktivitäts-Konzept für die Auto-Löschung ist etwas anderes, siehe
  // find_inactive_accounts in der DB).
  function hasActiveEnrollment(yogi: any) {
    return (yogi.enrollments || []).some((e: any) => e.course?.is_active !== false)
  }
  function hasOpenCredits(yogi: any) {
    return getFreeCredits(yogi) > 0
  }

  function getDisplayName(yogi: any) {
    const name = `${yogi.first_name || ''} ${yogi.last_name || ''}`.trim()
    return name || yogi.email || 'Unbekannt'
  }

  async function createDummy() {
    if (!dummyForm.first_name.trim() || !dummyForm.last_name.trim()) return
    setSavingDummy(true)
    setDummyError('')

    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-dummy-user`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          first_name: dummyForm.first_name.trim(),
          last_name: dummyForm.last_name.trim(),
        }),
      }
    )

    const result = await res.json()
    if (!res.ok || result.error) {
      setDummyError(result.error || 'Unbekannter Fehler')
      setSavingDummy(false)
      return
    }

    setDummyForm({ first_name: '', last_name: '' })
    setShowDummyForm(false)
    setSavingDummy(false)
    loadData()
  }

  const filtered = yogis
    .filter(y => `${y.first_name} ${y.last_name} ${y.email}`.toLowerCase().includes(search.toLowerCase()))
    .filter(y => {
      if (activeFilter === 'in_course') return hasActiveEnrollment(y)
      if (activeFilter === 'no_course') return !hasActiveEnrollment(y)
      if (activeFilter === 'credits') return hasOpenCredits(y)
      return true
    })
    // Sarah-Wunsch 2026-08-18: standardmäßig nach Vorname sortiert (passt zur
    // Anzeige "Vorname Nachname"), Nachname als Tie-Breaker. Locale-aware
    // (de) statt der DB-Sortierung, damit Umlaute/Groß-Kleinschreibung
    // korrekt einsortiert werden.
    .sort((a, b) => {
      const byFirst = (a.first_name || '').localeCompare(b.first_name || '', 'de', { sensitivity: 'base' })
      if (byFirst !== 0) return byFirst
      return (a.last_name || '').localeCompare(b.last_name || '', 'de', { sensitivity: 'base' })
    })

  const FILTERS: { key: typeof activeFilter; label: string }[] = [
    { key: 'all', label: 'Alle' },
    { key: 'in_course', label: 'In Kursen' },
    { key: 'no_course', label: 'Ohne Kurs' },
    { key: 'credits', label: 'Credits' },
  ]

  // Performance-Fix 2026-08-18 (Sarah): Header + BottomNav bleiben auch
  // während des Ladens sichtbar (statt die ganze Seite durch einen Spinner
  // zu ersetzen) — verhindert das "alles baut sich neu auf"-Gefühl beim
  // Seitenwechsel.
  if (loading) return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Yogis" isAdmin />
      <div className="flex items-center justify-center py-20">
        <i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" />
      </div>
      <BottomNav isAdmin />
    </div>
  )

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Yogis" subtitle={`${yogis.length} Teilnehmer`} isAdmin />
      <div className="px-4 py-3">
        <input className="field-input mb-3" placeholder="Name oder E-Mail suchen..."
          value={search} onChange={e => setSearch(e.target.value)} />

        <div className="flex gap-2 mb-4">
          <button onClick={() => router.push('/admin/einladen')}
            className="flex-1 btn-primary flex items-center justify-center gap-2 text-sm">
            <i className="ti ti-mail-forward" />
            Yogi einladen
          </button>
          <button onClick={() => { setShowDummyForm(true); setDummyError('') }}
            className="flex-1 btn-primary flex items-center justify-center gap-2 text-sm">
            <i className="ti ti-user-plus" />
            Dummy anlegen
          </button>
        </div>

        {/* Sarah-Wunsch 2026-08-18: Filter-Leiste über der Yogi-Liste — alle 4
            Buttons in einer Zeile, kein horizontales Scrollen. */}
        <div className="grid grid-cols-4 gap-1.5 mb-4">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setActiveFilter(f.key)}
              className={`text-center text-[11px] font-semibold rounded-full px-1 py-1.5 border-0 cursor-pointer transition-colors truncate ${
                activeFilter === f.key
                  ? 'bg-yoga-text text-yoga-bg'
                  : 'bg-white text-yoga-text/60 border border-yoga-border'
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        <p className="section-label">
          {activeFilter === 'all' ? 'Alle Yogis' : `Yogis (${filtered.length})`}
        </p>
        {filtered.length === 0 ? (
          <p className="text-center text-yoga-text/40 text-sm py-6">Keine Yogis gefunden</p>
        ) : filtered.map(yogi => (
          <button key={yogi.id} onClick={() => router.push(`/admin/yogis/${yogi.id}`)}
            className="w-full bg-white rounded-yoga border border-yoga-border p-3 mb-2 text-left hover:border-yoga-border2 transition-colors">
            {/* Sarah-Wunsch 2026-06-01: Karten-Formatierung wie die Kurs-Kacheln im
                Yogi-Dashboard (/kurse) — Name fett oben, Rest klein normal darunter,
                kompaktere Schrift + Abstand, damit die Karten kleiner werden. */}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-bold flex items-center gap-1.5 truncate">
                  {getDisplayName(yogi)}
                  {yogi.is_dummy && (
                    <span className="text-[10px] bg-yoga-text text-white rounded-full px-1.5 py-0.5 font-normal flex-shrink-0">
                      Dummy
                    </span>
                  )}
                </div>
                {/* Sarah-Wunsch 2026-06-01: E-Mail aus der Uebersicht raus (Karte kleiner).
                    Suche nach E-Mail bleibt erhalten; Adresse steht weiter im Yogi-Detail. */}
                <div className="text-xs text-yoga-text/50 mt-0.5 truncate">
                  {(() => {
                    const credits = getFreeCredits(yogi)
                    const guthaben = getGuthaben(yogi)
                    const parts: string[] = []
                    if (credits > 0) parts.push(`${credits} Credits`)
                    if (guthaben > 0) parts.push(`${guthaben} Guthaben`)
                    if (parts.length === 0) parts.push('0 Credits')
                    return `${getCurrentCourse(yogi)} · ${parts.join(' · ')}`
                  })()}
                </div>
              </div>
              <i className="ti ti-chevron-right text-sm text-yoga-text/30 flex-shrink-0" />
            </div>
          </button>
        ))}
      </div>

      {showDummyForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end modal-overlay" onClick={() => setShowDummyForm(false)}>
          <div className="bg-yoga-card w-full rounded-t-2xl p-6 pb-10" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">Dummy-User anlegen</h3>
              <button onClick={() => setShowDummyForm(false)} className="bg-transparent border-0 cursor-pointer text-yoga-text/40">
                <i className="ti ti-x text-xl" />
              </button>
            </div>
            <p className="text-sm text-yoga-text/60 mb-4">
              Dummy-User können eingebucht werden ohne E-Mail oder Login. Nützlich als Platzhalter.
            </p>
            <input className="field-input mb-3" placeholder="Vorname" value={dummyForm.first_name}
              onChange={e => setDummyForm({...dummyForm, first_name: e.target.value})} />
            <input className="field-input mb-4" placeholder="Nachname" value={dummyForm.last_name}
              onChange={e => setDummyForm({...dummyForm, last_name: e.target.value})}
              onKeyDown={e => e.key === 'Enter' && createDummy()} />
            {dummyError && (
              <p className="text-sm text-red-500 mb-3">{dummyError}</p>
            )}
            <button onClick={createDummy} disabled={savingDummy || !dummyForm.first_name || !dummyForm.last_name}
              className="btn-primary w-full">
              {savingDummy ? 'Wird angelegt...' : 'Dummy-User anlegen'}
            </button>
          </div>
        </div>
      )}

      <BottomNav isAdmin />
    </div>
  )
}
