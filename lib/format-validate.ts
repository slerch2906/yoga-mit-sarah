/**
 * Welle S3/N6 (Sarah 2026-05-27): Format-Validierung-Helpers
 *
 * Kleine, defensive Parser-Funktionen die NULL statt Crash zurueckgeben.
 * - parseGermanPrice: deutsche Komma-Notation in float ("5,50" → 5.5)
 * - parseTimeHHMM:    "HH:MM" / "HH:MM:SS" normalisieren
 * - safeTimeSlice:    safe Variante von time.slice(0,5) — kein TypeError bei null
 */

export function parseGermanPrice(s: string): number | null {
  if (s == null) return null
  const trimmed = String(s).trim().replace(/\s+/g, '').replace(/,/g, '.')
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null
  const n = parseFloat(trimmed)
  return isNaN(n) ? null : n
}

export function parseTimeHHMM(s: string): string | null {
  if (s == null) return null
  const trimmed = String(s).trim()
  // HH:MM oder HH:MM:SS
  const m = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (isNaN(h) || isNaN(min)) return null
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function safeTimeSlice(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s).slice(0, 5)
}
