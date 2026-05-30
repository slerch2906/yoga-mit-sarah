'use client'

/**
 * Sarah-Wunsch 2026-05-25: Banner auf der Yogi-Wochenübersicht (/kurse),
 * der Yogi auf bald-ablaufende Credits hinweist. Design analog zum
 * Admin-Benachrichtigungsfeld (Border-Left in Farbe + Card + Text).
 *
 * Anzeige-Logik:
 *  - Kurs-Credit (model='course'): Hinweise zeigen wenn date_end des Kurses
 *    ≤ 7 Tage entfernt ODER expires_at = heute (Tag 8 nach Kursende).
 *    7-Tage-Hinweis: "Dein Kurs [name] endet am [datum], deine Credits sind noch bis zum [datum] gültig (8 Tage nach Kursende)."
 *    Verfalls-Tag: "Deine Credits aus Kurs [name] verfallen heute."
 *  - Punktekarte (model='single'/'tenpack'): Hinweis am Tag des Verfalls.
 *  - Quartal-Abo (model='quarterly'): Hinweis am Tag des Verfalls.
 *
 * Die Component ist clientseitig: lädt eigene Credits + alle aktiven Kurse,
 * berechnet pro Credit ob ein Hinweis fällig ist.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUser } from '@/lib/auth'

type Reminder = { id: string; kind: 'warn' | 'alert'; text: string }

function daysBetween(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000))
}

// Sarah-Wunsch 2026-05-25: Hinweisboxen wegklickbar (localStorage per Reminder-ID)
const DISMISS_KEY = 'yogi-credit-expiry-dismissed'
function loadDismissed(): string[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]') } catch { return [] }
}
function saveDismissed(ids: string[]) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify(ids)) } catch {}
}

export default function YogiCreditExpiryBanner() {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [dismissed, setDismissed] = useState<string[]>([])

  useEffect(() => { setDismissed(loadDismissed()) }, [])

  function dismiss(id: string) {
    const next = [...dismissed, id]
    setDismissed(next)
    saveDismissed(next)
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      const supabase = createClient()
      const user = await getCurrentUser()
      if (!user) return

      const nowIso = new Date().toISOString()
      // Eigene Credits + zugehöriger Kurs (für course-credits: date_end)
      const { data: credits } = await supabase.from('credits')
        .select('*, course:courses(id, name, date_end)')
        .eq('user_id', user.id)
        .gt('expires_at', nowIso)
      const list: Reminder[] = []
      const today = new Date(); today.setHours(0, 0, 0, 0)

      for (const c of (credits || []) as any[]) {
        const free = (c.total ?? 0) - (c.used ?? 0)
        if (free <= 0) continue
        // valid_from in der Zukunft: noch nicht relevant für Verfall
        if (c.valid_from && new Date(c.valid_from) > today) continue
        const expDate = new Date(c.expires_at); expDate.setHours(0, 0, 0, 0)
        const daysToExpire = daysBetween(expDate, today)

        const fmtDay = (d: Date) => d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })

        if (c.model === 'course' && c.course?.date_end) {
          const courseEnd = new Date(`${c.course.date_end}T23:59:59`); courseEnd.setHours(0, 0, 0, 0)
          const daysToCourseEnd = daysBetween(courseEnd, today)
          if (daysToCourseEnd <= 7 && daysToCourseEnd > 0) {
            list.push({
              id: `course-warn-${c.id}`,
              kind: 'warn',
              text: `Dein Kurs „${c.course.name}" endet am ${fmtDay(courseEnd)}. Deine freien Credits sind noch bis zum ${fmtDay(expDate)} gültig (8 Tage nach Kursende).`,
            })
          } else if (daysToExpire === 0) {
            list.push({
              id: `course-alert-${c.id}`,
              kind: 'alert',
              text: `Deine Credits aus Kurs „${c.course.name}" verfallen heute.`,
            })
          }
        } else if (c.model === 'guthaben' && c.source === 'illness') {
          // Sarah 2026-05-30: Krankheits-Guthaben läuft nach 10 Monaten HART ab und
          // wird danach gelöscht — 4 Wochen (28 Tage) vorher den Yogi warnen.
          if (daysToExpire === 0) {
            list.push({
              id: `ill-alert-${c.id}`,
              kind: 'alert',
              text: `Dein Krankheits-Guthaben verfällt heute und wird gelöscht.`,
            })
          } else if (daysToExpire <= 28 && daysToExpire > 0) {
            const wochen = Math.ceil(daysToExpire / 7)
            const frist = daysToExpire <= 7
              ? `${daysToExpire} ${daysToExpire === 1 ? 'Tag' : 'Tagen'}`
              : `${wochen} Wochen`
            list.push({
              id: `ill-warn-${c.id}`,
              kind: 'warn',
              text: `Dein Krankheits-Guthaben läuft in ${frist} ab (gültig bis ${fmtDay(expDate)}) und wird danach gelöscht.`,
            })
          }
        } else if (c.model === 'quarterly') {
          // Sarah-Regel 2026-05-25: Quartal = 14 Tage Vorwarnung
          if (daysToExpire === 0) {
            list.push({
              id: `q-alert-${c.id}`,
              kind: 'alert',
              text: `Deine Quartals-Credits verfallen heute.`,
            })
          } else if (daysToExpire <= 14 && daysToExpire > 0) {
            list.push({
              id: `q-warn-${c.id}`,
              kind: 'warn',
              text: `Deine Quartals-Credits laufen in ${daysToExpire} ${daysToExpire === 1 ? 'Tag' : 'Tagen'} ab (gültig bis ${fmtDay(expDate)}).`,
            })
          }
        } else if (c.model === 'single' || c.model === 'tenpack') {
          // Sarah-Regel 2026-05-25: Punktekarte = 7 Tage Vorwarnung
          if (daysToExpire === 0) {
            list.push({
              id: `pk-alert-${c.id}`,
              kind: 'alert',
              text: `Deine Punktekarte verfällt heute.`,
            })
          } else if (daysToExpire <= 7 && daysToExpire > 0) {
            list.push({
              id: `pk-warn-${c.id}`,
              kind: 'warn',
              text: `Deine Punktekarte läuft in ${daysToExpire === 7 ? '1 Woche' : `${daysToExpire} ${daysToExpire === 1 ? 'Tag' : 'Tagen'}`} ab (gültig bis ${fmtDay(expDate)}).`,
            })
          }
        }
      }

      if (active) setReminders(list)
    })()
    return () => { active = false }
  }, [])

  const visible = reminders.filter(r => !dismissed.includes(r.id))
  if (visible.length === 0) return null

  return (
    <div className="px-4 pt-3 space-y-2">
      {visible.map(r => (
        <div key={r.id} className="card relative pr-9">
          <button onClick={() => dismiss(r.id)} aria-label="Hinweis schließen"
            className="absolute top-2 right-2 bg-transparent border-0 cursor-pointer text-yoga-text/40 hover:text-yoga-text/70 p-1 leading-none">
            <i className="ti ti-x text-base" />
          </button>
          <p className={`text-sm font-semibold ${r.kind === 'alert' ? 'text-yoga-red-text' : 'text-yoga-amber-text'}`}>
            {r.kind === 'alert' ? 'Achtung — heute' : 'Hinweis'}
          </p>
          <p className="text-sm text-yoga-text/80 mt-0.5 leading-snug">{r.text}</p>
        </div>
      ))}
    </div>
  )
}
