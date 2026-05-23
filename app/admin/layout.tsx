'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const navItems = [
  { href: '/admin/dashboard',   label: 'Dashboard',   icon: 'ti-dashboard' },
  { href: '/admin/yogis',       label: 'Yogis',        icon: 'ti-users' },
  { href: '/admin/kurse',       label: 'Kurse',        icon: 'ti-calendar' },
  // Sarah-Wunsch 2026-05-23: Einladungs-Liste in /admin/einladen integriert
  { href: '/admin/einladen',    label: 'Einladen',     icon: 'ti-user-plus' },
  { href: '/admin/protokoll',   label: 'Protokoll',    icon: 'ti-list-details' },
  { href: '/admin/nachweise',   label: 'AGB-Nachweise', icon: 'ti-shield-check' },
  // Sarah-Wunsch 2026-05-23 v5: "Mehr" innerhalb /admin/ damit Sidebar bleibt.
  // Re-Export von /profil — selber Mehr-Block (Nachricht, Bulk-Mail, AGB,
  // System-Status, Passwort, Logout, Protokoll-Toggle).
  { href: '/admin/mehr',        label: 'Mehr',         icon: 'ti-menu-2' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<any>(null)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) { router.push('/login'); return }
      supabase.from('profiles').select('*').eq('id', session.user.id).single()
        .then(({ data }) => {
          if (!data?.is_admin) { router.push('/kurse'); return }
          setProfile(data)
        })
    })
  }, [])

  // Immer nur Sidebar auf Desktop, nur BottomNav auf Mobile – nie beides
  // BottomNav in den einzelnen Pages wird durch isAdmin=true gesteuert
  // Auf Desktop: Sidebar-Layout, BottomNav in Pages gibt null zurück wenn isLaptop
  // → Wir steuern das hier zentral: Admin-Layout rendert Sidebar auf Desktop
  // und auf Mobile nur children (BottomNav kommt aus den Pages)

  return (
    <>
      {/* Desktop Sidebar – nur ab 768px sichtbar */}
      <div className="hidden md:flex min-h-screen" style={{ background: 'var(--yoga-bg)' }}>
        <div className="w-56 flex-shrink-0 border-r flex flex-col fixed h-full" style={{ background: 'var(--yoga-card)', borderColor: 'var(--yoga-border2)' }}>
          <div className="p-5 border-b flex items-center gap-3" style={{ borderColor: 'var(--yoga-border)' }}>
            <img src="https://yogamitsarah.me/wp-content/uploads/2025/09/Logo-300x300.png" alt="Logo" className="w-9 h-9 object-contain" />
            <div>
              <div className="font-bold text-sm" style={{ color: 'var(--yoga-text)' }}>Yoga mit Sarah</div>
              <div className="text-xs opacity-50" style={{ color: 'var(--yoga-text)' }}>Admin</div>
            </div>
          </div>
          <nav className="flex-1 p-3">
            {navItems.map(item => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <button key={item.href} onClick={() => router.push(item.href)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-yoga mb-1 text-left transition-all cursor-pointer border-0"
                  style={{
                    background: active ? 'var(--yoga-bg)' : 'transparent',
                    color: 'var(--yoga-text)',
                    opacity: active ? 1 : 0.6,
                    fontWeight: active ? 700 : 500,
                    fontSize: '14px',
                  }}>
                  <i className={`ti ${item.icon} text-xl`} />
                  {item.label}
                </button>
              )
            })}
          </nav>
          <div className="p-4 border-t text-xs opacity-50" style={{ borderColor: 'var(--yoga-border)', color: 'var(--yoga-text)' }}>
            {profile?.first_name} {profile?.last_name}
          </div>
        </div>
        <div className="flex-1 ml-56 overflow-auto">
          <div className="max-w-3xl mx-auto">
            {children}
          </div>
        </div>
      </div>

      {/* Mobile – nur children, BottomNav kommt aus den Pages */}
      <div className="md:hidden">
        {children}
      </div>
    </>
  )
}
