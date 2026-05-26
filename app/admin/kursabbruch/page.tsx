'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'

export default function AdminKursabbruchPage() {
  const [responses, setResponses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data } = await supabase
      .from('course_cancellation_responses')
      .select('*, course:courses(name), profile:profiles(first_name, last_name, email)')
      .order('created_at', { ascending: false })
    setResponses(data || [])
    setLoading(false)
  }

  async function markRefundPaid(id: string) {
    await supabase.from('course_cancellation_responses').update({ refund_paid: true }).eq('id', id)
    loadData()
  }

  const grouped = responses.reduce((acc: any, r) => {
    const key = r.course_id
    if (!acc[key]) acc[key] = { name: r.course?.name, items: [] }
    acc[key].items.push(r)
    return acc
  }, {})

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl" /></div>

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Kursabbrüche" isAdmin />
      <div className="px-4 py-4">
        {Object.keys(grouped).length === 0 ? (
          <p className="text-sm text-yoga-text/40 text-center py-8">Keine Kursabbrüche vorhanden</p>
        ) : Object.entries(grouped).map(([courseId, group]: any) => (
          <div key={courseId} className="mb-6">
            <p className="section-label">{group.name}</p>
            {group.items.map((r: any) => {
              const isExpired = new Date(r.expires_at) < new Date()
              const status = r.choice || (isExpired ? 'guthaben_auto' : null)
              return (
                <div key={r.id} className="card mb-2">
                  <div className="flex items-center justify-between">
                    {/* Sarah-Wunsch: Yogi-Name klickbar → Yogi-Profil */}
                    <button
                      onClick={() => router.push(`/admin/yogis/${r.user_id}`)}
                      className="text-left bg-transparent border-0 p-0 cursor-pointer hover:opacity-70 transition-opacity min-w-0 flex-1">
                      <div className="text-sm font-semibold">
                        {r.profile?.first_name} {r.profile?.last_name}
                      </div>
                      <div className="text-xs text-yoga-text/50">{r.profile?.email || 'Kein Login'}</div>
                      <div className="text-xs text-yoga-text/40 mt-0.5">{r.remaining_sessions} Stunden offen</div>
                    </button>
                    <div className="text-right flex-shrink-0 ml-3">
                      {!status && (
                        <span className="text-xs bg-yoga-amber-bg text-yoga-amber-text rounded-full px-2 py-0.5"> Offen</span>
                      )}
                      {(status === 'guthaben' || status === 'guthaben_auto') && (
                        <span className="text-xs bg-yoga-green-bg text-yoga-green-text rounded-full px-2 py-0.5"> Guthaben</span>
                      )}
                      {status === 'erstattung' && (
                        <div>
                          {r.refund_paid
                            ? <span className="text-xs bg-yoga-green-bg text-yoga-green-text rounded-full px-2 py-0.5"> Erstattet</span>
                            : <button onClick={() => markRefundPaid(r.id)}
                                className="text-xs bg-yoga-red-bg text-yoga-red-text rounded-full px-2 py-0.5 border-0 cursor-pointer">
                                 Als erstattet markieren
                              </button>
                          }
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {/* Statistik */}
            <div className="text-xs text-yoga-text/40 mt-1">
              {group.items.filter((r:any) => r.choice === 'guthaben').length} Guthaben ·{' '}
              {group.items.filter((r:any) => r.choice === 'erstattung').length} Erstattung ·{' '}
              {group.items.filter((r:any) => !r.choice).length} Offen
            </div>
          </div>
        ))}
      </div>
      <BottomNav isAdmin />
    </div>
  )
}
