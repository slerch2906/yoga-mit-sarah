/**
 * SCHUTZ-TEST (Sarah 2026-05-29): Nach einer erfolgreichen Selbst-Abmeldung von
 * einer Stunde MUSS dem Yogi eine sichtbare Bestätigung erscheinen — nicht nur
 * ein stummes Stundenfenster / eine leere Weiterleitung.
 *
 * Umsetzung (mit Sarah abgestimmt):
 *   - app/kurse/[id]/page.tsx · handleCancel leitet in BEIDEN Pfaden
 *     (≤ 90 Min via promoteWaitlistOrOfferLate, > 90 Min via RPC) nach
 *     /meine?abgemeldet=1 weiter. (Vorher: ≤90 → /meine ohne Flag, >90 →
 *     router.back() = stummes Fenster.)
 *   - app/meine/page.tsx liest den Query-Param und zeigt oben einen grünen
 *     Erfolgs-Banner "Deine Abmeldung war erfolgreich", räumt danach die URL auf.
 *
 * Die Logik deckt Kursstunden, Einzelstunden UND Events ab, weil alle Typen
 * dieselbe Stundenseite + dieselbe handleCancel-Funktion nutzen.
 *
 * Schlägt dieser Test fehl, wurde die Abmelde-Bestätigung unbeauftragt verändert
 * — dann mit Sarah abstimmen, bevor irgendetwas committed wird.
 */
import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const SRC_SESSION = () => fs.readFileSync(path.join(process.cwd(), 'app/kurse/[id]/page.tsx'), 'utf8')
const SRC_MEINE = () => fs.readFileSync(path.join(process.cwd(), 'app/meine/page.tsx'), 'utf8')

// Exakter Banner-Text (mit Sarah abgestimmt, NUR auf ihren Auftrag ändern).
const BANNER_TITEL = 'Deine Abmeldung war erfolgreich'
const BANNER_SUBTEXT = 'Du wurdest von dieser Stunde abgemeldet.'
const FLAG = '/meine?abgemeldet=1'

test.describe('[E2E-Text] Abmelde-Bestätigung nach Selbst-Abmeldung (Sarah-Spec)', () => {
  test('handleCancel leitet in BEIDEN Pfaden nach /meine?abgemeldet=1 weiter', () => {
    const src = SRC_SESSION()
    // Beide Weiterleitungen müssen das Erfolgs-Flag tragen.
    const matches = src.match(/router\.push\('\/meine\?abgemeldet=1'\)/g) || []
    expect(matches.length).toBe(2)
  })

  test('Kein stummer router.back() mehr am Ende des > 90-Min-Pfads (kein Rückfall)', () => {
    const src = SRC_SESSION()
    // Der frühere stumme Abschluss (router.back direkt nach dem Waitlist-Catch)
    // darf in handleCancel nicht mehr existieren.
    expect(src).not.toContain('} catch(e) { console.error(\'Waitlist promotion error:\', e) }\n\n    router.back()')
  })

  test('/meine liest das Flag, zeigt den grünen Erfolgs-Banner und räumt die URL auf', () => {
    const src = SRC_MEINE()
    // Query-Param wird gelesen
    expect(src).toMatch(/abgemeldet'\)\s*===\s*'1'/)
    // Banner-Text exakt vorhanden
    expect(src).toContain(BANNER_TITEL)
    expect(src).toContain(BANNER_SUBTEXT)
    // URL wird nach dem Anzeigen gesäubert (kein Re-Trigger beim Reload)
    expect(src).toMatch(/history\.replaceState\([^)]*'\/meine'\)/)
    // Banner-Sichtbarkeit ist an State gekoppelt
    expect(src).toMatch(/cancelToast/)
  })

  test('Banner nutzt die grüne Erfolgs-Optik (yoga-green)', () => {
    const src = SRC_MEINE()
    expect(src).toMatch(/cancelToast\s*&&/)
    expect(src).toMatch(/bg-yoga-green-bg/)
  })
})
