'use client'

import { useRef } from 'react'

/**
 * Touch-Swipe-Hook für mobile Navigation.
 *
 * Sarah-Anforderung 2026-05-21: Wochenansicht (Admin + Yogi) per Swipe wechseln.
 *   - Finger nach links (X verringert sich) → onSwipeLeft  → "nächste Woche"
 *   - Finger nach rechts (X erhöht sich)    → onSwipeRight → "vorherige Woche"
 *
 * Nur horizontaler Swipe. Wenn vertikale Bewegung dominant → Scrollen, kein Trigger.
 * Min-Distanz default 50px (verhindert Fehl-Trigger beim Scrollen).
 */
export function useSwipe(opts: {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  minDistance?: number
}) {
  const startX = useRef<number | null>(null)
  const startY = useRef<number | null>(null)
  const minDistance = opts.minDistance ?? 50

  return {
    onTouchStart: (e: React.TouchEvent) => {
      startX.current = e.touches[0].clientX
      startY.current = e.touches[0].clientY
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (startX.current === null || startY.current === null) return
      const endX = e.changedTouches[0].clientX
      const endY = e.changedTouches[0].clientY
      const dx = startX.current - endX
      const dy = startY.current - endY
      // Nur wenn horizontale Bewegung dominiert (kein vertikales Scrollen)
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > minDistance) {
        if (dx > 0) opts.onSwipeLeft?.()
        else opts.onSwipeRight?.()
      }
      startX.current = null
      startY.current = null
    },
  }
}
