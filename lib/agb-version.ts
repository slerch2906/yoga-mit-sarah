/**
 * AGB-Versionierung — Sarah-Wunsch 2026-05-23.
 *
 * Wenn die AGB geändert werden:
 * 1. CURRENT_AGB_VERSION hier erhöhen (z.B. 1 → 2)
 * 2. AGB_CHANGELOG-Eintrag für die neue Version ergänzen (User-sichtbar)
 * 3. AGB-Text in app/rechtliches/page.tsx aktualisieren
 *
 * Effekt: alle Yogis mit profile.agb_version < CURRENT_AGB_VERSION werden
 * beim nächsten Seitenaufruf zu /rechtliches umgeleitet — sehen den
 * Changelog und müssen neu bestätigen. Beim Bestätigen wird agb_version
 * auf CURRENT_AGB_VERSION gesetzt.
 */

export const CURRENT_AGB_VERSION = 1

/**
 * Pro Version: was hat sich geändert. Wird auf /rechtliches angezeigt
 * für Yogis die re-bestätigen müssen.
 */
export const AGB_CHANGELOG: Record<number, { date: string; changes: string[] }> = {
  1: {
    date: '2025-09-01',
    changes: ['Erste Version der AGB.'],
  },
  // 2: { date: '2026-XX-XX', changes: ['Neue Regel: ...', 'Klarstellung zu ...'] },
}
