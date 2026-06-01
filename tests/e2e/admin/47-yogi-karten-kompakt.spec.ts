/**
 * Admin-Yogi-Liste: kompakte Karten im Dashboard-Stil (Sarah 2026-06-01)
 *
 * Sarah-Wunsch: Die Yogi-Karten in /admin/yogis sollen wie die Kurs-Kacheln im
 * Yogi-Dashboard (/kurse) aussehen — Name fett oben, Rest klein/normal darunter,
 * kompaktere Schrift + Abstand, damit die Karten kleiner werden. Reine UX, der
 * Inhalt (Name, aktueller Kurs, Credits/Guthaben) bleibt unveraendert.
 *
 * Source-Check als Regressions-Schutz gegen ein Zurueckfallen auf die grossen Karten.
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const SRC = 'app/admin/yogis/page.tsx'

test.describe('Admin-Yogi-Liste: kompakte Karten', () => {
  test('Karte nutzt kompaktes Padding (p-3) statt der grossen .card-Klasse', () => {
    const src = read(SRC)
    // Die Yogi-Listen-Karte ist der Button mit dem Detail-Routing.
    const idx = src.indexOf("router.push(`/admin/yogis/${yogi.id}`)")
    expect(idx, 'Yogi-Karten-Button vorhanden').toBeGreaterThan(-1)
    const card = src.slice(idx, idx + 400)
    expect(card, 'kompaktes Padding p-3').toMatch(/p-3/)
    expect(card, 'keine grosse .card-Klasse mehr auf der Listen-Karte').not.toMatch(/className="w-full card /)
  })

  test('Name fett + klein (text-sm font-bold), Untertitel klein (text-xs)', () => {
    const src = read(SRC)
    const idx = src.indexOf("router.push(`/admin/yogis/${yogi.id}`)")
    const card = src.slice(idx, idx + 900)
    expect(card, 'Name: text-sm font-bold').toMatch(/text-sm font-bold/)
    expect(card, 'Untertitel: text-xs').toMatch(/text-xs text-yoga-text\/50/)
    // Nicht mehr die grosse Variante:
    expect(card, 'kein text-base font-semibold mehr').not.toMatch(/text-base font-semibold/)
  })

  test('Inhalt unveraendert: Kurs + Credits/Guthaben bleiben in der Karte', () => {
    const src = read(SRC)
    expect(src, 'aktueller Kurs').toMatch(/getCurrentCourse\(yogi\)/)
    expect(src, 'Credits-Logik').toMatch(/getFreeCredits\(yogi\)/)
    expect(src, 'Guthaben-Logik').toMatch(/getGuthaben\(yogi\)/)
  })
})
