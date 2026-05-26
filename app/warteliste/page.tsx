'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/auth'
import AppHeader from '@/components/layout/AppHeader'
import BottomNav from '@/components/layout/BottomNav'
import { getCurrentAgbVersion } from '@/lib/agb-version'

export default function WartelistePage() {
  const [profile, setProfile] = useState<any>(null)
  const [waitlistItems, setWaitlistItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    try {
      const user = await getCurrentUser()
      if (!user) { window.location.href = '/login'; return }

      const [{ data: prof }, { data: wl }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('waitlist')
          .select('*, session:sessions(*, course:courses(name))')
          .eq('user_id', user.id).order('created_at'),
      ])
      const agb = await getCurrentAgbVersion(supabase)
      const currentOrder = agb?.sort_order ?? 1
      if (prof && (!prof.legal_accepted_at || (prof.agb_version ?? 0) < currentOrder)) {
        window.location.href = '/rechtliches'; return
      }
      setProfile(prof)
      setWaitlistItems(wl || [])
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  async function handleLeave(id: string) {
    await supabase.from('waitlist').delete().eq('id', id)
    setWaitlistItems(prev => prev.filter(w => w.id !== id))
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><i className="ti ti-loader-2 animate-spin text-3xl text-yoga-text/40" /></div>

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <AppHeader title="Warteliste" isAdmin={profile?.is_admin} />
      <div className="px-4 py-4">
        {waitlistItems.length === 0 ? (
          <div className="text-center py-12 text-yoga-text/40">
            <i className="ti ti-list text-3xl block mb-3" />
            <p className="text-sm">Du stehst auf keiner Warteliste</p>
          </div>
        ) : (
          <>
            <p className="section-label">Du stehst auf der Warteliste</p>
            {waitlistItems.map(w => (
              <div key={w.id} className="card mb-3">
                {/* Welle 2.6: bei Events/Einzelstunden session.name statt SYS-Container */}
                <div className="text-base font-bold mb-1">
                  {w.session?.session_type && w.session.session_type !== 'course_session'
                    ? `Event · ${w.session.name ?? 'Unbenannt'}`
                    : (w.session?.name ?? w.session?.course?.name)}
                </div>
                <div className="text-sm text-yoga-text/55 mb-3">
                  {new Date(w.session?.date).toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'long' })} · {w.session?.time_start?.slice(0,5)} Uhr
                </div>
                <div className="flex items-center justify-between">
                  {w.type === 'waitlist' ? (
                    <span className="text-sm px-3 py-1 rounded-full bg-yoga-amber-bg text-yoga-amber-text font-bold">Position {w.position}</span>
                  ) : (
                    <span className="text-sm px-3 py-1 rounded-full bg-yoga-gray text-yoga-text font-semibold">Benachrichtigung aktiv</span>
                  )}
                  <button onClick={() => handleLeave(w.id)}
                    className="text-sm text-yoga-red-text bg-yoga-red-bg border-0 rounded-full px-3 py-1 cursor-pointer font-semibold">
                    Austragen
                  </button>
                </div>
              </div>
            ))}
            <div className="mt-4 bg-yoga-gray border border-yoga-border rounded-yoga p-3">
              <p className="text-sm text-yoga-text/65 leading-relaxed">
                Wenn ein Platz frei wird, rückst du automatisch nach und hast <strong>1 Stunde</strong> Zeit dich kostenlos abzumelden.
              </p>
            </div>
          </>
        )}
      </div>
      <BottomNav isAdmin={profile?.is_admin} />
    </div>
  )
}
