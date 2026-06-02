'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'
import { berlinTodayStr } from '@/lib/session-time'

export default function NachweisePage() {
  const [acceptances, setAcceptances] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data } = await supabase
      .from('legal_acceptances')
      .select('*, profile:profiles(first_name, last_name, email)')
      .order('accepted_at', { ascending: false })
    setAcceptances(data || [])
    setLoading(false)
  }

  function exportCSV() {
    const rows = [
      ['Name', 'E-Mail', 'AGB-Version', 'Akzeptiert am', 'User-Agent', 'User-ID'],
      ...acceptances.map(a => [
        a.full_name || `${a.profile?.first_name} ${a.profile?.last_name}`,
        a.profile?.email || '',
        a.agb_version || a.version || '2025-12',
        new Date(a.accepted_at || a.created_at).toLocaleString('de-DE'),
        a.user_agent || '',
        a.user_id,
      ])
    ]
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const encoded = encodeURIComponent('\uFEFF' + csv) // BOM für Excel
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encoded
    a.download = `AGB-Nachweise-${berlinTodayStr()}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="AGB-Nachweise" isAdmin />
      <div className="px-4 py-4">

        <div className="card mb-4 bg-yoga-green-bg border-yoga-green-text/20">
          <p className="text-sm text-yoga-green-text leading-relaxed">
            <i className="ti ti-shield-check mr-1" />
            Diese Liste ist dein rechtlicher Nachweis. Jeder Eintrag enthält Name, E-Mail, Zeitstempel und Geräteinformationen der Zustimmung (§126b BGB).
          </p>
        </div>

        <button onClick={exportCSV} className="btn-primary mb-4">
          <i className="ti ti-download mr-1" /> Als CSV exportieren (für Excel)
        </button>

        <p className="section-label">{acceptances.length} Bestätigungen</p>

        {acceptances.map(a => (
          <div key={a.id} className="card mb-3">
            <div className="flex items-start justify-between mb-2">
              {/* Sarah-Wunsch: Yogi-Name klickbar → Yogi-Profil */}
              <button
                onClick={() => router.push(`/admin/yogis/${a.user_id}`)}
                className="text-left bg-transparent border-0 p-0 cursor-pointer hover:opacity-70 transition-opacity flex-1 min-w-0">
                <div className="text-sm font-bold">
                  {a.full_name || `${a.profile?.first_name} ${a.profile?.last_name}`}
                </div>
                <div className="text-xs text-yoga-text/55">{a.profile?.email}</div>
              </button>
              <span className="badge badge-done text-xs">
                v{a.agb_version || a.version || '2025-12'}
              </span>
            </div>
            <div className="text-xs text-yoga-text/45 space-y-0.5">
              <div><i className="ti ti-calendar mr-1" />
                {new Date(a.accepted_at || a.created_at).toLocaleString('de-DE', {
                  day:'numeric', month:'long', year:'numeric',
                  hour:'2-digit', minute:'2-digit'
                })} Uhr
              </div>
              {a.user_agent && (
                <div className="truncate"><i className="ti ti-device-mobile mr-1" />{a.user_agent.slice(0, 60)}...</div>
              )}
            </div>
          </div>
        ))}

        {acceptances.length === 0 && (
          <p className="text-center text-yoga-text/40 text-sm py-8">Noch keine Bestätigungen</p>
        )}
      </div>
      <BottomNav isAdmin />
    </div>
  )
}
