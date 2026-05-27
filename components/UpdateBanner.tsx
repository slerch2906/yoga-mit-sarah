'use client'

/**
 * Update-Banner: erscheint NUR wenn Sarah im Mehr-Menü manuell den
 * "Update-Banner anzeigen"-Trigger anklickt (Sarah-Wunsch Option C, 2026-05-23).
 *
 * Funktion:
 *  - Polled alle 3 Min /api/version
 *  - Server returnt admin_announcement.update_banner_version (NULL = aus)
 *  - Wenn Wert != null UND != localStorage.seen_update_version → Banner
 *  - User klickt "Neu laden":
 *     1. localStorage.seen_update_version = aktuelle update_banner_version
 *     2. window.location.reload()
 *  - Sarah schaltet Toggle aus → version wird NULL → Banner verschwindet bei nächstem Poll
 *  - Sarah pusht später erneut (mit neuem BUILD_SHA) → neuer Wert → alle Yogis sehen wieder
 *
 * Vorteil gegenüber Auto-Diff: nervt nicht bei jedem Vercel-Deploy.
 * Sarah entscheidet wann ein Update wichtig genug für einen Banner ist.
 */

import { useEffect, useState } from 'react'

const POLL_INTERVAL_MS = 3 * 60 * 1000 // 3 Min
const INITIAL_DELAY_MS = 30 * 1000     // 30 Sek nach Mount

const LS_KEY = 'seen_update_version'

export default function UpdateBanner() {
  const [currentBannerVersion, setCurrentBannerVersion] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    // Welle S3/M17 (Sarah 2026-05-27): drei Probleme behoben —
    // 1) AbortController fuer in-flight fetches beim Unmount.
    // 2) Per-call Timeout (8s) damit ein haengender Request den naechsten
    //    Poll nicht blockiert.
    // 3) Tab-Hidden Polling-Pause via visibilitychange — kein Strom-/
    //    Bandbreiten-Verbrauch wenn der Tab im Hintergrund liegt.
    let cancelled = false
    let intervalId: number | undefined
    let initialTimeoutId: number | undefined
    const controllers = new Set<AbortController>()

    async function check() {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.hidden) return
      const controller = new AbortController()
      controllers.add(controller)
      const callTimeout = window.setTimeout(() => controller.abort(), 8000)
      try {
        const res = await fetch('/api/version', { cache: 'no-store', signal: controller.signal })
        if (!res.ok) return
        const json = await res.json()
        const v = json?.update_banner_version || null
        if (!v) {
          setCurrentBannerVersion(null)
          return
        }
        const seen = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null
        if (seen === v) {
          // Yogi hat dieses Update schon bestätigt
          setCurrentBannerVersion(null)
        } else {
          setCurrentBannerVersion(v)
        }
      } catch {}
      finally {
        window.clearTimeout(callTimeout)
        controllers.delete(controller)
      }
    }

    function startInterval() {
      if (intervalId !== undefined) return
      intervalId = window.setInterval(check, POLL_INTERVAL_MS)
    }
    function stopInterval() {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId)
        intervalId = undefined
      }
    }

    function onVisibility() {
      if (cancelled) return
      if (document.hidden) {
        stopInterval()
      } else {
        // Sofort prüfen + Polling wieder starten
        check()
        startInterval()
      }
    }

    // Initial-Check nach kurzer Verzögerung
    initialTimeoutId = window.setTimeout(() => {
      if (cancelled) return
      check()
      startInterval()
    }, INITIAL_DELAY_MS)

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }

    return () => {
      cancelled = true
      if (initialTimeoutId !== undefined) window.clearTimeout(initialTimeoutId)
      stopInterval()
      controllers.forEach(c => c.abort())
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [])

  if (!currentBannerVersion) return null

  function handleReload() {
    setReloading(true)
    try { localStorage.setItem(LS_KEY, currentBannerVersion!) } catch {}
    window.location.reload()
  }

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
            onClick={handleReload}
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
