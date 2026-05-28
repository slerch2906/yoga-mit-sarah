/**
 * Display-Helper für Sessions (Welle 2.7, Sarah 2026-05-26).
 *
 * Hintergrund: Einzelstunden + Events hängen in unsichtbaren SYS-Container-
 * Kursen ("SYS · Einzelstunden", "SYS · Events (kostenlos)", etc.). Direkt
 * `session.course.name` rendern würde den Container-Namen zeigen → verwirrend.
 *
 * Stattdessen: Title-Prefix nach session_type + session.name als Inhalt.
 * Bestehende Kursstunden (course_session) fallen auf course.name zurück
 * — dort hängt der echte Titel ja am Kurs.
 */

export type SessionLike = {
  session_type?: string | null
  name?: string | null
  course?: { name?: string | null } | null
} | null | undefined

/**
 * "Einzelstunde · X" / "Event · X" / Kursname (Fallback).
 */
export function sessionDisplayName(s: SessionLike): string {
  if (!s) return '—'
  const own = s.name ?? null
  if (s.session_type === 'single') return `Einzelstunde · ${own ?? 'Unbenannt'}`
  if (
    s.session_type === 'event_free' ||
    s.session_type === 'event_paid'
  ) {
    return `Event · ${own ?? 'Unbenannt'}`
  }
  return own ?? s.course?.name ?? '—'
}

/**
 * True wenn die Session eine Einzelstunde oder ein Event ist (= NICHT
 * `course_session`). Praktisch um UI-Spezialfälle zu erkennen.
 */
export function isSingleOrEvent(s: SessionLike): boolean {
  return !!s?.session_type && s.session_type !== 'course_session'
}
