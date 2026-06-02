/**
 * Zeitzonen-Welle 2 (Sarah 2026-06-02): überall Europe/Berlin (DST-sicher).
 *
 * Hintergrund-Bug: `new Date().toISOString().split('T')[0]` liefert das UTC-Datum.
 * Kurz nach Mitternacht Berlin (UTC noch Vortag) wurden dadurch z.B. beim Einbuchen
 * bereits vergangene Stunden noch als "heute/Zukunft" gewertet ("Teilgenommen" für
 * eine Stunde, in die der Yogi nie eingebucht war).
 *
 * Fix: zentrale Helfer in lib/session-time.ts:
 *   - berlinTodayStr() / berlinDateStr(d)  → Berlin-Kalenderdatum 'YYYY-MM-DD' (en-CA + timeZone)
 *   - parseSessionDateTimeBerlin(date,time) → korrekter UTC-Instant einer Berliner Wandzeit
 * Diese werden überall statt der UTC-Abkürzungen verwendet.
 *
 * Source-Checks als Regressions-Schutz (staging-sicher, kein Prod-Eingriff).
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

test.describe('Zeitzonen-Welle 2: überall Berlin (DST-sicher)', () => {
  test('Helfer berlinTodayStr/berlinDateStr nutzen Europe/Berlin + en-CA', () => {
    const src = read('lib/session-time.ts')
    expect(src).toMatch(/export function berlinTodayStr/)
    expect(src).toMatch(/export function berlinDateStr/)
    expect(src).toMatch(/toLocaleDateString\('en-CA',\s*\{\s*timeZone:\s*'Europe\/Berlin'\s*\}\)/)
  })

  test('Einbuchen: Berlin-Datum + minutengenauer Zukunfts-Filter (beide Pfade)', () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    // Kein UTC-heute mehr für die Stunden-Auswahl
    expect(src).not.toMatch(/\.gte\('date', new Date\(\)\.toISOString\(\)\.split/)
    // Beide Enroll-Queries nutzen berlinTodayStr()
    const enrollGtes = src.match(/\.gte\('date', berlinTodayStr\(\)\)/g) || []
    expect(enrollGtes.length).toBeGreaterThanOrEqual(2)
    // Minuten-genauer Berlin-Filter auf den Stundenstart
    expect(src).toMatch(/parseSessionDateTimeBerlin\(s\.date, s\.time_start\)/)
    // time_start wird jetzt mitgeladen (sonst kein Minuten-Vergleich möglich)
    expect(src).toMatch(/\.select\('id, date, time_start'\)/)
  })

  test('Status-Logik (session-status) ist Berlin-verankert', () => {
    const src = read('lib/session-status.ts')
    expect(src).toMatch(/import \{[^}]*parseSessionDateTimeBerlin[^}]*\} from '\.\/session-time'/)
    // isStarted nutzt Berlin-Instant
    expect(src).toMatch(/parseSessionDateTimeBerlin\(s\.date, s\.time_start\)/)
    // Tag-Vergleiche gegen Berlin-Datum (kein lokales setHours-Mitternacht mehr in isPastDay)
    expect(src).toMatch(/s\.date < berlinTodayStr\(\)/)
  })

  test('Serverseitige 90-Min-Frist (waitlist-offer) nutzt Berlin', () => {
    const src = read('app/api/waitlist-offer/[token]/route.ts')
    expect(src).toMatch(/parseSessionDateTimeBerlin\(/)
    expect(src).not.toMatch(/new Date\(`\$\{[^}]*\}T\$\{[^}]*\}`\)\.getTime\(\)/)
  })

  test('Jede Datei, die einen Berlin-Helfer AUFRUFT, importiert ihn auch (Crash-Schutz)', () => {
    // Regression Sarah 2026-06-02: app/admin/kurse/page.tsx rief berlinDateStr() auf,
    // ohne es zu importieren -> "berlinDateStr is not defined" -> weisse Seite beim
    // Kurs-Anlegen. next build faengt das NICHT (typescript.ignoreBuildErrors: true).
    // Dieser Test prueft den Import/Aufruf-Abgleich fuer alle Berlin-Helfer projektweit.
    const HELPERS = ['berlinTodayStr', 'berlinDateStr', 'parseSessionDateTimeBerlin']
    const dirs = ['app', 'lib', 'components']
    const walk = (dir: string): string[] => {
      const full = path.join(ROOT, dir)
      if (!fs.existsSync(full)) return []
      const out: string[] = []
      for (const e of fs.readdirSync(full, { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) out.push(...walk(rel))
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel)
      }
      return out
    }
    const files = dirs.flatMap(walk)
    for (const f of files) {
      const src = read(f)
      for (const h of HELPERS) {
        // Aufruf = Helfername direkt gefolgt von '(' . Definition/Import zaehlt nicht als Aufruf.
        const isCall = new RegExp(`(?<![\\w.])${h}\\s*\\(`).test(src)
        if (!isCall) continue
        if (f === 'lib/session-time.ts') continue // dort definiert
        const imported = new RegExp(`import\\s*\\{[^}]*\\b${h}\\b[^}]*\\}\\s*from\\s*['"]@?/?.*session-time`).test(src)
        expect(imported, `${f} ruft ${h}() auf, importiert es aber nicht aus session-time`).toBeTruthy()
      }
    }
  })

  test('Kein UTC-heute-Muster mehr in den umgestellten Kern-Dateien', () => {
    const files = [
      'app/admin/anwesenheit/page.tsx',
      'app/admin/dashboard/page.tsx',
      'app/kurse/page.tsx',
      'app/meine/page.tsx',
    ]
    for (const f of files) {
      const src = read(f)
      expect(src, `${f} darf kein new Date().toISOString().split('T')[0] mehr enthalten`)
        .not.toMatch(/new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/)
    }
  })
})
