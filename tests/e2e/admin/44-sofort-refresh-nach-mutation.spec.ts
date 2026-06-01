/**
 * Sofort-Refresh nach Admin-Mutation (Sarah 2026-06-01)
 *
 * Bug: Nach dem Hinzufuegen/Absagen eines Teilnehmers luden mehrere Admin-Handler
 * nur das Detail-Modal neu (loadSessionDetail / loadParticipants), aber NICHT die
 * uebergeordnete Liste (loadData). Dadurch blieb der Teilnehmer-Counter auf der
 * Karte/Kachel alt, bis der Browser manuell aktualisiert wurde.
 *
 * Fix: Nach dem Detail-Refresh wird zusaetzlich loadData() aufgerufen — der bereits
 * etablierte Listen-Refresh, der die Karten-Counter neu berechnet.
 *
 * Diese Source-Checks sichern den Fix gegen Regression ab: wuerde jemand das
 * loadData() wieder entfernen, schlaegt der Test fehl. (Reine Datei-Checks, kein
 * Server/DB noetig — Konvention wie 20/21-Spec.)
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

test.describe('Sofort-Refresh der Karten nach Admin-Mutation', () => {
  test('Dashboard: confirmCancelBooking + addYogiToSession (beide Pfade) rufen nach loadSessionDetail auch loadData() auf', () => {
    const dash = read('app/admin/dashboard/page.tsx')
    // confirmCancelBooking (Absage), addYogiToSession Pfad 1 (Event/Dummy),
    // addYogiToSession Pfad 2 (Kurs-Credit) — alle: loadSessionDetail(selectedSession) → loadData()
    const seq = dash.match(/loadSessionDetail\(selectedSession\)\s*\n\s*loadData\(\)/g) || []
    expect(seq.length).toBeGreaterThanOrEqual(3)
  })

  test('Dashboard: promoteWaitlistFromDashboard aktualisiert ebenfalls die Liste', () => {
    const dash = read('app/admin/dashboard/page.tsx')
    // Bereits vor diesem Fix korrekt — als Sicherung mitgeprueft (loadSessionDetail(sess) → loadData()).
    expect(dash).toMatch(/loadSessionDetail\(sess\)\s*\n\s*loadData\(\)/)
  })

  test('Kurse: addYogiToCourse (Dummy- + Haupt-Pfad) rufen nach loadParticipants auch loadData() auf', () => {
    const kurse = read('app/admin/kurse/page.tsx')
    const seq = kurse.match(/loadParticipants\(course\)\s*\n\s*loadData\(\)/g) || []
    expect(seq.length).toBeGreaterThanOrEqual(2)
  })

  test('Kurse Session-Modal: addYogiToSessionFromModal + cancelBookingFromModal aktualisieren die Liste', () => {
    const kurse = read('app/admin/kurse/page.tsx')
    // loadSessionParticipants(...) → loadData() — beide Modal-Handler (waren bereits korrekt).
    const seq = kurse.match(/loadSessionParticipants\([a-zA-Z]+\)\s*\n\s*loadData\(\)/g) || []
    expect(seq.length).toBeGreaterThanOrEqual(2)
  })
})
