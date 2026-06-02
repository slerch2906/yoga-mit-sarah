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
  { href: '/admin/kursabbruch', label: 'Kursabbrüche', icon: 'ti-calendar-off' },
  { href: '/admin/protokoll',   label: 'Protokoll',    icon: 'ti-list-details' },
  { href: '/admin/nachweise',   label: 'AGB-Nachweise', icon: 'ti-shield-check' },
  // Sarah-Wunsch 2026-05-23 v5: "Mehr" innerhalb /admin/ damit Sidebar bleibt.
  // Re-Export von /profil — selber Mehr-Block (Nachricht, Bulk-Mail, AGB,
  // System-Status, Passwort, Logout, Protokoll-Toggle).
  { href: '/admin/mehr',        label: 'Mehr',         icon: 'ti-menu-2' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<any>(null)
  // Sarah 2026-06-02: Recovery-State statt stiller Demotion auf /kurse.
  // Wenn der Profil-Check transient haengt, landen wir NICHT mehr auf der
  // Yogi-Seite (= Sackgasse ohne Logout), sondern zeigen einen klaren
  // Wiederherstellungs-Screen mit "Neu laden" + "Neu anmelden".
  const [authError, setAuthError] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  useEffect(() => {
    let cancelled = false

    // Warum dieser Umbau (Sarah 2026-06-02):
    //  - Vorher: getSession() (nur lokal, ungeprueft) + .single(). Ein totes
    //    Token oder ein kurzer RLS-/Netz-Haenger lieferte ein leeres Profil →
    //    der Code dachte "kein Admin" → router.push('/kurse'). Folge: Admin in
    //    Yogi-Ansicht OHNE Sidebar und OHNE Logout (Sackgasse).
    //  - Jetzt:
    //    1) getUser() validiert SERVERSEITIG → kein blindes Vertrauen auf ein
    //       lokales (evtl. totes) Token → keine Zombie-Session.
    //    2) maybeSingle() statt single() → leeres Ergebnis wirft nicht.
    //    3) Transiente Fehler (Netz/RLS) werden RETRYt und fuehren nie zu
    //       /kurse, sondern schlimmstenfalls zum Recovery-Screen.
    //    4) Nur ein EINDEUTIGES is_admin === false leitet auf /kurse.
    async function check(attempt = 0) {
      const retryOrRecover = () => {
        if (cancelled) return
        if (attempt < 2) { setTimeout(() => check(attempt + 1), 800) }
        else setAuthError(true)
      }

      let userRes
      try {
        userRes = await supabase.auth.getUser()
      } catch {
        retryOrRecover(); return
      }
      if (cancelled) return

      const user = userRes?.data?.user
      const userErr: any = userRes?.error
      if (!user) {
        const status = userErr?.status
        if (status === 401 || status === 403) {
          // Token wirklich ungueltig → sauber zum Login (lokalen Cache leeren)
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
          if (!cancelled) router.replace('/login')
          return
        }
        // Sonst (z.B. Netz weg) → transient behandeln, NICHT ausloggen
        retryOrRecover(); return
      }

      let profRes
      try {
        profRes = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      } catch {
        retryOrRecover(); return
      }
      if (cancelled) return

      if (profRes?.error) { retryOrRecover(); return }
      const data = profRes?.data
      if (!data) { retryOrRecover(); return }

      if (data.is_admin === false) {
        // Eindeutig kein Admin → Yogi-Ansicht
        if (!cancelled) router.replace('/kurse')
        return
      }
      // is_admin === true
      if (!cancelled) setProfile(data)
    }

    check()
    return () => { cancelled = true }
  }, [])

  async function handleRelogin() {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    router.replace('/login')
  }

  // Recovery-Screen — funktioniert auf Desktop UND Mobile, immer mit Auswegen.
  if (authError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--yoga-bg)' }}>
        <div className="w-full max-w-sm rounded-yoga p-6 text-center" style={{ background: 'var(--yoga-card)', border: '1px solid var(--yoga-border2)' }}>
          <i className="ti ti-refresh-alert text-3xl" style={{ color: 'var(--yoga-text)', opacity: 0.6 }} />
          <h2 className="font-bold mt-3 mb-1" style={{ color: 'var(--yoga-text)' }}>Sitzung konnte nicht geladen werden</h2>
          <p className="text-sm mb-5" style={{ color: 'var(--yoga-text)', opacity: 0.6 }}>
            Das war nur ein kurzer Verbindungs-Hänger. Deine Daten sind unberührt.
          </p>
          <button onClick={() => window.location.reload()}
            className="w-full rounded-yoga py-2.5 font-bold mb-2 cursor-pointer border-0"
            style={{ background: 'var(--yoga-text)', color: 'var(--yoga-bg)' }}>
            Neu laden
          </button>
          <button onClick={handleRelogin}
            className="w-full rounded-yoga py-2.5 font-medium cursor-pointer"
            style={{ background: 'transparent', color: 'var(--yoga-text)', border: '1px solid var(--yoga-border2)' }}>
            Neu anmelden
          </button>
        </div>
      </div>
    )
  }

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
