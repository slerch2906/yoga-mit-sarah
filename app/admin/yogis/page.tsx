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
  const [showDummyForm, setShowDummyForm] = useState(false)
  const [dummyForm, setDummyForm] = useState({ first_name: '', last_name: '' })
  const [savingDummy, setSavingDummy] = useState(false)
  const [dummyError, setDummyError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data: yogiList } = await supabase
      .from('profiles')
      .select('*, credits(*), enrollments(*, course:courses(name))')
      .order('last_name')
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

  const filtered = yogis.filter(y =>
    `${y.first_name} ${y.last_name} ${y.email}`.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-yoga-text/50 text-sm">Wird geladen...</p>
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
            className="flex-1 btn-secondary flex items-center justify-center gap-2 text-sm">
            <i className="ti ti-mail-forward" />
            Yogi einladen
          </button>
          <button onClick={() => { setShowDummyForm(true); setDummyError('') }}
            className="flex-1 btn-secondary flex items-center justify-center gap-2 text-sm">
            <i className="ti ti-user-plus" />
            Dummy anlegen
          </button>
        </div>

        <p className="section-label">Alle Yogis</p>
        {filtered.length === 0 ? (
          <p className="text-center text-yoga-text/40 text-sm py-6">Keine Yogis gefunden</p>
        ) : filtered.map(yogi => (
          <button key={yogi.id} onClick={() => router.push(`/admin/yogis/${yogi.id}`)}
            className="w-full card mb-2 text-left hover:border-yoga-border2 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-base font-semibold flex items-center gap-2">
                  {getDisplayName(yogi)}
                  {yogi.is_dummy && (
                    <span className="text-xs bg-yoga-text text-white rounded-full px-2 py-0.5 font-normal">
                      Dummy
                    </span>
                  )}
                </div>
                <div className="text-sm text-yoga-text/50 mt-0.5">
                  {yogi.email || 'Kein Login'}
                </div>
                <div className="text-sm text-yoga-text/40 mt-0.5">
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
              <i className="ti ti-chevron-right text-base text-yoga-text/30" />
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
