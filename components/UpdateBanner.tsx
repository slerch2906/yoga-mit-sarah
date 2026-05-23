'use client'

/**
 * Update-Banner: erkennt wenn auf Vercel eine neue App-Version deployt wurde
 * und bietet dem User einen 1-Klick-Reload an (Sarah-Wunsch 2026-05-23).
 *
 * Funktion:
 *  - Beim ersten Mount: holt aktuellen Build-SHA von /api/version
 *  - Alle 3 Minuten: re-fetcht und vergleicht mit initialer SHA
 *  - Wenn unterschiedlich → Banner anzeigen
 *  - Banner-Click → window.location.reload() (Service-Worker-Cache wird durch
 *    no-cache headers eh übersprungen, simpler Reload reicht)
 *
 * Dezent: erscheint nur ein einziges Mal pro neuer Version, ist klein,
 *   kann nicht weggeklickt werden (damit der User es wirklich macht), aber
 *   blockt auch nichts (sticky am unteren Bildschirmrand, über BottomNav).
 */

import { useEffect, useState } from 'react'

const POLL_INTERVAL_MS = 3 * 60 * 1000 // 3 Minuten
const INITIAL_DELAY_MS = 30 * 1000     // 30 Sek nach Mount erst loslegen (nicht direkt)

export default function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    let initialSha: string | null = null
    let cancelled = false
    let intervalId: number | undefined

    async function fetchVersion(): Promise<string | null> {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return null
        const json = await res.json()
        return json?.sha || null
      } catch {
        return null
      }
    }

    async function init() {
      // Initial-Hash holen (das ist die Version die der User aktuell sieht)
      initialSha = await fetchVersion()
      if (!initialSha || cancelled) return

      // Polling starten nach kurzer Verzögerung
      setTimeout(() => {
        if (cancelled) return
        intervalId = window.setInterval(async () => {
          const current = await fetchVersion()
          if (!current || !initialSha) return
          if (current !== initialSha) {
            setUpdateAvailable(true)
            // Polling stoppen — Banner ist da, weitere Checks nicht nötig
            if (intervalId) window.clearInterval(intervalId)
          }
        }, POLL_INTERVAL_MS)
      }, INITIAL_DELAY_MS)
    }

    init()
    return () => {
      cancelled = true
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [])

  if (!updateAvailable) return null

  return (
    <div className="fixed left-0 right-0 z-50 px-3 pointer-events-none"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)' }}>
      <div className="max-w-md mx-auto pointer-events-auto">
        <div className="bg-yoga-text text-yoga-bg rounded-yoga shadow-lg flex items-center gap-3 px-4 py-3">
          <i className="ti ti-rocket text-xl flex-shrink-0" />
          <p className="text-sm flex-1 min-w-0">
            Neue Version verfügbar
          </p>
          <button
            onClick={() => { setReloading(true); window.location.reload() }}
            disabled={reloading}
            className="text-xs font-bold bg-yoga-bg text-yoga-text rounded-full px-4 py-1.5 hover:opacity-90 disabled:opacity-50 flex-shrink-0"
          >
            {reloading ? '…' : 'Neu laden'}
          </button>
        </div>
      </div>
    </div>
  )
}
