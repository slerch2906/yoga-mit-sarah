'use client'

/**
 * Mini-Kalender-Popover für Wochenauswahl (Sarah-Wunsch 2026-05-23, Option B).
 *
 * Klick auf den Wochen-Label öffnet ein kleines Pop-up mit Monatsraster.
 * Klick auf eine Wochenzeile springt direkt zur entsprechenden Woche.
 *
 * Verwendung:
 *   <WeekPickerPopover currentWeekStart={weekStart} onSelectWeek={d => setOffset(weekOffsetFrom(d))}>
 *     {label}
 *   </WeekPickerPopover>
 */

import { useState, useRef, useEffect } from 'react'

interface Props {
  /** Erster Tag (Montag) der aktuell angezeigten Woche */
  currentWeekStart: Date
  /** Wird mit dem Montag der ausgewählten Woche aufgerufen */
  onSelectWeek: (mondayOfWeek: Date) => void
  /** Inhalt des Triggers (z.B. „Diese Woche" oder Datums-Range) */
  children: React.ReactNode
}

const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
const WEEKDAYS = ['Mo','Di','Mi','Do','Fr','Sa','So']

/** ISO-Kalenderwoche (DIN 1355 / ISO 8601). */
function getISOWeek(d: Date): number {
  const date = new Date(d.getTime())
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + 4 - (date.getDay() || 7))
  const yearStart = new Date(date.getFullYear(), 0, 1)
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function startOfDay(d: Date): Date {
  const x = new Date(d); x.setHours(0,0,0,0); return x
}
function getMonday(d: Date): Date {
  const x = startOfDay(d)
  const day = x.getDay() // 0=So
  const diff = day === 0 ? -6 : 1 - day
  x.setDate(x.getDate() + diff)
  return x
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d); x.setDate(x.getDate() + n); return x
}
function sameWeek(a: Date, b: Date): boolean {
  return getMonday(a).getTime() === getMonday(b).getTime()
}
function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime()
}

/** Liefert 6 Wochen (Mo-So) die den Monat abdecken inkl. Lead-/Trail-Tage. */
function getMonthGrid(viewMonth: Date): Date[][] {
  const firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
  const firstMon = getMonday(firstOfMonth)
  const weeks: Date[][] = []
  for (let w = 0; w < 6; w++) {
    const week: Date[] = []
    for (let d = 0; d < 7; d++) {
      week.push(addDays(firstMon, w * 7 + d))
    }
    weeks.push(week)
  }
  return weeks
}

export default function WeekPickerPopover({ currentWeekStart, onSelectWeek, children }: Props) {
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState<Date>(new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), 1))
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const today = startOfDay(new Date())

  // Bei jedem Öffnen den Monat-View auf die aktuell sichtbare Woche resetten
  useEffect(() => {
    if (open) {
      setViewMonth(new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), 1))
    }
  }, [open, currentWeekStart])

  // Click-outside + Escape schließen
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node
      if (popoverRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const grid = getMonthGrid(viewMonth)
  const monthLabel = `${MONTHS[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`

  return (
    <span className="relative inline-block">
      <button ref={triggerRef} type="button" onClick={() => setOpen(o => !o)}
        className="text-sm font-bold inline-flex items-center gap-1.5 px-2 py-1 -mx-2 -my-1 rounded-md hover:bg-yoga-gray/40 transition-colors">
        {children}
        <i className={`ti ti-chevron-down text-base text-yoga-text/70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div ref={popoverRef}
          className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-40 bg-yoga-bg border border-yoga-border rounded-yoga shadow-lg p-3"
          style={{ width: '300px' }}>

          {/* Monat-Navigation */}
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-yoga-gray text-yoga-text/60">
              <i className="ti ti-chevron-left text-base" />
            </button>
            <button type="button" onClick={() => setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
              className="text-sm font-semibold px-2 py-1 rounded-md hover:bg-yoga-gray/40">
              {monthLabel}
            </button>
            <button type="button" onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-yoga-gray text-yoga-text/60">
              <i className="ti ti-chevron-right text-base" />
            </button>
          </div>

          {/* Header-Zeile: KW + 7 Wochentage */}
          <div className="grid gap-0.5 mb-1" style={{ gridTemplateColumns: '28px repeat(7, 1fr)' }}>
            <div className="text-[10px] text-yoga-text/40 text-center font-semibold py-0.5">KW</div>
            {WEEKDAYS.map(d => (
              <div key={d} className="text-[10px] text-yoga-text/40 text-center font-semibold py-0.5">{d}</div>
            ))}
          </div>

          {/* Wochen-Raster: pro Zeile = KW-Zahl + 7 Tage (alles klickbar) */}
          <div className="space-y-0.5">
            {grid.map((week, wi) => {
              const isCurrent = sameWeek(week[0], currentWeekStart)
              const isoWeek = getISOWeek(week[0])
              return (
                <button key={wi} type="button"
                  onClick={() => { onSelectWeek(week[0]); setOpen(false) }}
                  className={`w-full grid gap-0.5 py-0.5 rounded-md transition-colors text-center ${
                    isCurrent
                      ? 'bg-yoga-text/10 ring-1 ring-yoga-text/40'
                      : 'hover:bg-yoga-gray/50'
                  }`}
                  style={{ gridTemplateColumns: '28px repeat(7, 1fr)' }}>
                  {/* KW-Spalte */}
                  <div className="text-[11px] py-1 text-yoga-text/45 font-semibold border-r border-yoga-border/40">
                    {isoWeek}
                  </div>
                  {week.map((day, di) => {
                    const isToday = sameDay(day, today)
                    const isOtherMonth = day.getMonth() !== viewMonth.getMonth()
                    return (
                      <div key={di} className={`text-xs py-1 ${
                        isToday ? 'font-bold' : ''
                      } ${isOtherMonth ? 'text-yoga-text/25' : 'text-yoga-text/80'}`}>
                        {isToday ? (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-yoga-text text-yoga-bg text-[11px]">
                            {day.getDate()}
                          </span>
                        ) : day.getDate()}
                      </div>
                    )
                  })}
                </button>
              )
            })}
          </div>

          {/* Footer: Quick-Jump „Heute" */}
          {/* Welle 6 (Sarah 2026-05-27): "HEUTE" groß + fett, klar als Sprungziel erkennbar. */}
          <button type="button"
            onClick={() => { onSelectWeek(getMonday(today)); setOpen(false) }}
            className="w-full mt-2 text-xs text-yoga-text/60 hover:text-yoga-text py-1.5 rounded-md hover:bg-yoga-gray/40 transition-colors">
            Zu <span className="text-base font-bold text-yoga-text">HEUTE</span>
          </button>
        </div>
      )}
    </span>
  )
}
