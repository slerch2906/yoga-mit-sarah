'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  href: string
  label: string
  icon: string
}

const yogiNav: NavItem[] = [
  { href: '/kurse',      label: 'Kurse',      icon: 'ti-calendar-week' },
  { href: '/warteliste', label: 'Warteliste',  icon: 'ti-list' },
  { href: '/meine',      label: 'Meine',       icon: 'ti-heart' },
  { href: '/profil',     label: 'Profil',      icon: 'ti-user' },
]

const adminNav: NavItem[] = [
  { href: '/admin/dashboard',   label: 'Dashboard',   icon: 'ti-dashboard' },
  { href: '/admin/yogis',       label: 'Yogis',        icon: 'ti-users' },
  { href: '/admin/kurse',       label: 'Kurse',        icon: 'ti-calendar' },
  { href: '/admin/einladen',    label: 'Einladen',     icon: 'ti-user-plus' },
  { href: '/admin/einladungen', label: 'Einladungen',  icon: 'ti-mail' },
  { href: '/profil',            label: 'Profil',       icon: 'ti-user' },
]

interface BottomNavProps {
  isAdmin?: boolean
}

export default function BottomNav({ isAdmin }: BottomNavProps) {
  const pathname = usePathname()
  const items = isAdmin ? adminNav : yogiNav

  // Admin hat Sidebar auf Desktop → BottomNav nur auf Mobile
  // Yogi hat keine Sidebar → BottomNav immer
  const navClass = isAdmin ? 'bottom-nav md:hidden' : 'bottom-nav'
  const spacerClass = isAdmin ? 'h-20 md:hidden' : 'h-20'

  return (
    <>
      <div className={spacerClass} />
      <nav className={navClass} aria-label="Hauptnavigation">
        {items.map(item => {
          const active = pathname === item.href ||
            (item.href !== '/kurse' && item.href !== '/admin/dashboard' &&
             item.href !== '/profil' && pathname.startsWith(item.href))
          return (
            <Link key={item.href} href={item.href}
              className={`nav-item ${active ? 'active' : ''}`}>
              <i className={`ti ${item.icon} text-2xl`} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
