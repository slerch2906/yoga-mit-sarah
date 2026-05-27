'use client'

/**
 * Welle 6.1 (Sarah 2026-05-27): Admin-Banner für Yogis die diese Woche
 * Geburtstag haben. Zeigt: "Vorname Nachname wird diese Woche X — am
 * Wochentag, d.m.!"
 *
 * Logik:
 *  - Query alle Yogi-Profile (is_admin=false, is_dummy=false) mit birthdate
 *  - Filter auf (birthdate.month, birthdate.day) liegt zwischen Wochenstart
 *    (Montag) und Wochenende (Sonntag) der aktuellen Woche.
 *  - Alter aus birthdate-Jahr berechnen (aktuelles Jahr - Geburtsjahr).
 *  - Wochentag formatieren.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface BirthdayYogi {
  id: string
  first_name: string
  last_name: string
  birthdate: string
  weekday: string
  dateStr: string
  age: number
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

function getMonday(d: Date): Date {
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const m = new Date(d)
  m.setDate(diff)
  m.setHours(0, 0, 0, 0)
  return m
}

export default function AdminBirthdayBanner() {
  const [yogis, setYogis] = useState<BirthdayYogi[]>([])
  const supabase = createClient()

  useEffect(() => { void load() }, [])

  async function load() {
    const { data } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, birthdate')
      .eq('is_admin', false)
      .or('is_dummy.is.null,is_dummy.eq.false')
      .not('birthdate', 'is', null)

    if (!data) return

    const today = new Date()
    const monday = getMonday(today)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    sunday.setHours(23, 59, 59, 999)

    const matches: BirthdayYogi[] = []
    for (const p of data) {
      if (!p.birthdate) continue
      const bd = new Date(p.birthdate + 'T12:00:00Z')
      // Geburtstag dieses Jahr
      const thisYearBirthday = new Date(today.getFullYear(), bd.getMonth(), bd.getDate())
      if (thisYearBirthday >= monday && thisYearBirthday <= sunday) {
        const age = today.getFullYear() - bd.getFullYear()
        matches.push({
          id: p.id,
          first_name: p.first_name || '',
          last_name: p.last_name || '',
          birthdate: p.birthdate,
          weekday: WEEKDAYS[thisYearBirthday.getDay()],
          dateStr: `${thisYearBirthday.getDate()}.${thisYearBirthday.getMonth() + 1}.`,
          age,
        })
      }
    }
    matches.sort((a, b) => a.dateStr.localeCompare(b.dateStr))
    setYogis(matches)
  }

  if (yogis.length === 0) return null

  return (
    <div className="mx-4 mt-3 bg-yoga-amber-bg border border-yoga-amber-text/30 rounded-yoga px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <i className="ti ti-cake text-yoga-amber-text text-base" />
        <p className="text-sm font-bold text-yoga-amber-text">Geburtstage diese Woche</p>
      </div>
      <ul className="space-y-1 mt-1">
        {yogis.map(y => (
          <li key={y.id} className="text-sm text-yoga-text/85 leading-snug">
            <strong>{y.first_name} {y.last_name}</strong> wird diese Woche <strong>{y.age}</strong> — am {y.weekday}, {y.dateStr}!
          </li>
        ))}
      </ul>
    </div>
  )
}
