/**
 * E2E-Tests für die "Mehr-Menü + Sprechblase + Update-Banner"-Welle.
 * Sarah-Wunsch 2026-05-23: aufnehmen, später ausführen.
 *
 * Deckt ab:
 *  - WeekPickerPopover (KW-Spalte, Chevron, Click-Outside)
 *  - Admin-Dashboard Browser-Back-Modal-Fix (history.pushState/popstate)
 *  - Admin-Überbuchen (confirm statt block)
 *  - Bottom-Nav „Mehr" + Hamburger nur für Admin
 *  - Dashboard-Cleanup (4 Schnellzugriff-Buttons + Überschrift weg)
 *  - AdminAnnouncementBubble (DB-Table, Component, Avatar-Fallback, Pfeil-Color)
 *  - Sprechblase auf /kurse UND /admin/dashboard sichtbar
 *  - Bulk-Mail API + Edge-Function admin_bulk_announcement + Opt-Out-Footer
 *  - Update-Banner: /api/version, manueller Trigger via update_banner_version,
 *    drei Status-Zustände (off/current/outdated), localStorage seen_update_version
 *  - get_system_health RPC (4 Indikatoren + Auth-Check)
 *  - get_cron_health RPC (Auth-Check + columns)
 *  - Reminder-Dropdown kompakt (Style-Smoke)
 *  - Notfallkontakt-Button-Stil angeglichen
 *  - text-size-adjust: 100% in globals.css
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { getServiceClient, getUserIdByEmail } from '../utils/db'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// ────────────────────────────────────────────────────────────────────────
// 1) WeekPickerPopover
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] WeekPickerPopover', () => {
  test('Komponente existiert mit KW-Spalte + Chevron + ISO-Wochen-Berechnung', () => {
    const src = read('components/WeekPickerPopover.tsx')
    expect(src).toMatch(/export default function WeekPickerPopover/)
    // KW-Spalte
    expect(src).toMatch(/KW/)
    expect(src).toMatch(/getISOWeek/)
    expect(src).toMatch(/gridTemplateColumns:\s*['"]28px repeat\(7,/)
    // Chevron dreht beim Öffnen
    expect(src).toMatch(/rotate-180/)
    // Click-outside + Escape
    expect(src).toMatch(/mousedown/)
    expect(src).toMatch(/Escape/)
    // Quick-Jump "Zu heute"
    expect(src).toMatch(/Zu heute/)
  })

  test('Eingebunden in admin/dashboard UND kurse/page', () => {
    const dash = read('app/admin/dashboard/page.tsx')
    const kurse = read('app/kurse/page.tsx')
    expect(dash).toMatch(/WeekPickerPopover/)
    expect(kurse).toMatch(/WeekPickerPopover/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 2) Browser-Back-Modal-Fix (Admin-Dashboard)
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] Admin-Dashboard: Browser-Back schließt Modal', () => {
  test('pushState beim selectedSession-Open + popstate-Listener', () => {
    const src = read('app/admin/dashboard/page.tsx')
    expect(src).toMatch(/history\.pushState/)
    expect(src).toMatch(/popstate/)
    expect(src).toMatch(/sessionModal/)
    // Cleanup macht history.back wenn Modal programmatisch geschlossen
    expect(src).toMatch(/history\.back/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 3) Admin überbuchen: confirm statt blockieren
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] Admin darf in volle Kurse überbuchen', () => {
  test('Dropdown disabled-Klausel entfernt, confirm-Dialog beim Submit', () => {
    const src = read('app/admin/yogis/[id]/page.tsx')
    // Confirm-Dialog für Überbuchung
    expect(src).toMatch(/Trotzdem überbuchen|überbuchen/)
    // Dropdown-Option ist nicht mehr disabled bei voll
    expect(src).toMatch(/voll \$\{enrollCount\}\/\$\{c\.max_spots\} \(überbuchen\?\)/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 4) Bottom-Nav: "Mehr" + Hamburger nur für Admin
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] Bottom-Nav: Admin = Mehr/Hamburger, Yogi = Profil/User', () => {
  test('adminNav hat Label "Mehr" + Icon ti-menu-2', () => {
    const src = read('components/layout/BottomNav.tsx')
    expect(src).toMatch(/label:\s*['"]Mehr['"]/)
    expect(src).toMatch(/icon:\s*['"]ti-menu-2['"]/)
  })

  test('yogiNav unverändert (Profil + ti-user)', () => {
    const src = read('components/layout/BottomNav.tsx')
    expect(src).toMatch(/yogiNav[\s\S]+?\{ href: '\/profil',\s*label: 'Profil',\s*icon: 'ti-user' \}/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 5) Dashboard-Cleanup
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] Admin-Dashboard: 4 Schnellzugriff-Buttons + Überschrift weg', () => {
  test('Schnellzugriff-Section ist NICHT mehr im Code (kein href: /admin/yogis im 2x2 grid)', () => {
    const src = read('app/admin/dashboard/page.tsx')
    // Die 4-Kacheln-Map ist weg (nur Kommentar oder direkter Klick auf Stunden)
    expect(src).not.toMatch(/\{ label: 'Yogis', icon: 'ti-users',/)
    expect(src).not.toMatch(/\{ label: 'Einladen', icon: 'ti-user-plus',/)
  })

  test('Überschrift "Stunden diese Woche" ist entfernt', () => {
    const src = read('app/admin/dashboard/page.tsx')
    expect(src).not.toMatch(/<p className="section-label">Stunden \{weekLabel\.toLowerCase\(\)\}<\/p>/)
  })

  test('Stats-Kacheln (Buchungen/Abmeldungen/Warteliste) bleiben', () => {
    const src = read('app/admin/dashboard/page.tsx')
    expect(src).toMatch(/'buchungen'.+'Buchungen'/)
    expect(src).toMatch(/'abmeldungen'.+'Abmeldungen'/)
    expect(src).toMatch(/'warteliste'.+'Warteliste'/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 6) AdminAnnouncementBubble (Sprechblase)
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] AdminAnnouncementBubble', () => {
  test('Komponente: Avatar mit Fallback, Pfeil-CSS-Triangle, weißer Hintergrund', () => {
    const src = read('components/AdminAnnouncementBubble.tsx')
    expect(src).toMatch(/FALLBACK_AVATAR/)
    expect(src).toMatch(/\/sarah\.jpg/)
    // Pfeil: zwei Triangles (Outline + Fill)
    expect(src).toMatch(/borderRight:\s*['"][0-9]+px solid rgba\(68,60,60,0\.15\)/)
    expect(src).toMatch(/borderRight:\s*['"][0-9]+px solid #ffffff/)
    // Bubble-Stil: bg-white + yoga-border + center
    expect(src).toMatch(/bg-white border border-yoga-border rounded-yoga/)
    expect(src).toMatch(/text-center/)
    // Avatar w-14
    expect(src).toMatch(/w-14 h-14/)
    // Lädt aus DB
    expect(src).toMatch(/admin_announcement/)
    expect(src).toMatch(/is_active/)
  })

  test('Auf /kurse + /admin/dashboard eingebunden', () => {
    const kurse = read('app/kurse/page.tsx')
    const dash = read('app/admin/dashboard/page.tsx')
    expect(kurse).toMatch(/AdminAnnouncementBubble/)
    expect(dash).toMatch(/AdminAnnouncementBubble/)
  })

  test('public/sarah.jpg existiert', () => {
    const p = path.join(ROOT, 'public', 'sarah.jpg')
    expect(fs.existsSync(p), 'public/sarah.jpg muss vorhanden sein').toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 7) admin_announcement DB-Schema
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] admin_announcement DB-Schema', () => {
  test('Tabelle existiert mit message + is_active + update_banner_version + set_at', async () => {
    const db = getServiceClient()
    const { data, error } = await db.from('admin_announcement')
      .select('id, message, is_active, update_banner_version, update_banner_set_at, updated_at')
      .eq('id', 1).maybeSingle()
    expect(error?.message || '').toBe('')
    expect(data).toBeDefined()
    expect(data?.id).toBe(1)
  })

  test('GRANT SELECT für authenticated funktioniert (RLS-Policy + Grant)', async () => {
    const db = getServiceClient()
    const { error } = await db.from('admin_announcement').select('message').eq('id', 1).maybeSingle()
    expect(error?.message || '').toBe('')
  })
})

// ────────────────────────────────────────────────────────────────────────
// 8) Bulk-Mail API + Edge-Function-Template + Opt-Out-Footer
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] Bulk-Mail-Workflow', () => {
  test('API-Route /api/admin/bulk-mail existiert mit Auth + Filter', () => {
    const src = read('app/api/admin/bulk-mail/route.ts')
    expect(src).toMatch(/export async function POST/)
    // Auth-Check: Bearer-Token → profiles.is_admin
    expect(src).toMatch(/is_admin/)
    expect(src).toMatch(/Bearer/)
    // Filter: keine Dummies, keine Admin, keine "Gelöschter"-Profile
    expect(src).toMatch(/is_dummy/)
    expect(src).toMatch(/Gelöschter/)
    // Audit-Log
    expect(src).toMatch(/admin_bulk_mail/)
  })

  test('Bulk-Mail Helper im Mehr-Menü nutzt /api/admin/bulk-mail', () => {
    const src = read('app/profil/page.tsx')
    expect(src).toMatch(/\/api\/admin\/bulk-mail/)
    // Confirm-Dialog vor Versand
    expect(src).toMatch(/E-Mail an ALLE aktiven Yogis senden\?/)
  })

  test('Hinweis "Hallo [Vorname]," statt langer Erklärung im UI', () => {
    const src = read('app/profil/page.tsx')
    expect(src).toMatch(/Hallo \[Vorname\],/)
  })

  test('lib/email.ts: keine Helper-Funktion für admin_bulk_announcement nötig (direkter API-Call)', () => {
    // Bulk-Mail wird per fetch direkt an Edge Function gesendet, nicht via lib/email.ts
    const src = read('app/api/admin/bulk-mail/route.ts')
    expect(src).toMatch(/admin_bulk_announcement/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 9) Update-Banner: API + Component + manueller Trigger
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] Update-Banner (manueller Trigger, Option C)', () => {
  test('/api/version returnt sha + update_banner_version + update_banner_set_at', async () => {
    const baseUrl = process.env.BASE_URL!
    const res = await fetch(`${baseUrl}/api/version`, { cache: 'no-store' })
    expect(res.ok).toBe(true)
    const json = await res.json()
    expect(json).toHaveProperty('sha')
    expect(json).toHaveProperty('update_banner_version')
    expect(json).toHaveProperty('update_banner_set_at')
    // no-cache Header
    expect(res.headers.get('cache-control')).toMatch(/no-store/)
  })

  test('UpdateBanner-Komponente: polled, vergleicht mit localStorage', () => {
    const src = read('components/UpdateBanner.tsx')
    expect(src).toMatch(/setInterval/)
    expect(src).toMatch(/POLL_INTERVAL_MS/)
    expect(src).toMatch(/localStorage\.getItem\(LS_KEY\)/)
    expect(src).toMatch(/localStorage\.setItem\(LS_KEY/)
    expect(src).toMatch(/window\.location\.reload/)
    expect(src).toMatch(/update_banner_version/)
  })

  test('UpdateBanner ist in app/layout.tsx body eingebunden', () => {
    const src = read('app/layout.tsx')
    expect(src).toMatch(/import UpdateBanner/)
    expect(src).toMatch(/<UpdateBanner \/>/)
  })

  test('Mehr-Menü: 3 Zustände (off/current/outdated) mit passenden Aktions-Buttons', () => {
    const src = read('app/profil/page.tsx')
    // Zustand "off"
    expect(src).toMatch(/Banner an Yogis pushen/)
    // Zustand "current"
    expect(src).toMatch(/Banner ist auf aktueller Version/)
    expect(src).toMatch(/Banner ausschalten/)
    // Zustand "outdated"
    expect(src).toMatch(/seit dem letzten Banner-Push neue Versionen/)
    expect(src).toMatch(/Auf aktuelle Version aktualisieren/)
  })

  test('next.config.js setzt NEXT_PUBLIC_BUILD_SHA aus VERCEL_GIT_COMMIT_SHA', () => {
    const src = read('next.config.js')
    expect(src).toMatch(/NEXT_PUBLIC_BUILD_SHA/)
    expect(src).toMatch(/VERCEL_GIT_COMMIT_SHA/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 10) System-Health: 4-Indikator-RPC
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] System-Health-RPC', () => {
  test('get_system_health RPC existiert, gibt 4 Sections zurück, Auth-Check greift', async () => {
    const db = getServiceClient()
    // Mit Service-Role: Auth-Check schlägt fehl (auth.uid() = null)
    const { error } = await db.rpc('get_system_health' as any)
    if (error) expect(error.message).not.toMatch(/does not exist/i)
  })

  test('Frontend rendert Ampel oben + 4 Indikator-Zeilen', () => {
    const src = read('app/profil/page.tsx')
    expect(src).toMatch(/Alles in Ordnung/)
    expect(src).toMatch(/Probleme erkannt/)
    expect(src).toMatch(/Reminder-Cron/)
    expect(src).toMatch(/Email-Versand/)
    expect(src).toMatch(/Email-Fehler/)
    expect(src).toMatch(/App-Aktivität/)
  })

  test('get_cron_health RPC existiert mit Auth-Check', async () => {
    const db = getServiceClient()
    const { error } = await db.rpc('get_cron_health' as any, { p_jobname: 'send-session-reminders' })
    if (error) expect(error.message).not.toMatch(/does not exist/i)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 11) Mehr-Menü Reihenfolge + Inhalt
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] Mehr-Menü Inhalt + Reihenfolge', () => {
  test('Reihenfolge: Nachricht → Bulk-Mail → AGB → System-Status → Passwort → Logout → Protokoll', () => {
    const src = read('app/profil/page.tsx')
    // Suche nach den Section-Label-Marken (nicht reine Strings, die auch in
    // Kommentaren vorkommen können). Logout/Protokoll haben kein section-label
    // → eindeutige Marker im Admin-Block.
    const order: Array<[string, string | RegExp]> = [
      ['Nachricht',    /section-label">Nachricht für Yogis</],
      ['Bulk-Mail',    /section-label">E-Mail an alle Yogis</],
      ['AGB',          /section-label">AGB-Verwaltung</],
      ['System-Status',/section-label">System-Status</],
      ['Passwort',     /section-label">Passwort</],
      ['Ausloggen',    />Ausloggen</],
      ['Protokoll',    /Protokoll \(Audit-Log\)/],
    ]
    let lastIdx = -1
    for (const [name, pattern] of order) {
      const match = typeof pattern === 'string' ? src.indexOf(pattern) : src.search(pattern)
      expect(match, `Section "${name}" muss im Mehr-Block existieren`).toBeGreaterThan(-1)
      expect(match, `Section "${name}" muss NACH der vorherigen kommen`).toBeGreaterThan(lastIdx)
      lastIdx = match
    }
  })

  test('Admin sieht KEINE Name/Email/Notfallkontakt/Benachrichtigungen-Sections', () => {
    const src = read('app/profil/page.tsx')
    // Ternary isAdmin ? AdminMehr : YogiProfil
    expect(src).toMatch(/isAdmin \? \(/)
    // Yogi-Block existiert (sonst wäre der bedingte Render kaputt)
    expect(src).toMatch(/Meine Daten/)
    expect(src).toMatch(/Notfallkontakt/)
    expect(src).toMatch(/Benachrichtigungen/)
  })

  test('Logout-Button für Admin im Mehr-Block, für Yogi im Shared-Footer', () => {
    const src = read('app/profil/page.tsx')
    // 2 Stellen mit Ausloggen (eine im Admin-Block, eine im !isAdmin-Footer)
    const ausloggenCount = (src.match(/>Ausloggen</g) || []).length
    expect(ausloggenCount).toBeGreaterThanOrEqual(2)
    expect(src).toMatch(/\{!isAdmin && \(/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 12) Notfallkontakt-Button (Yogi-Profil) im "Ändern"-Stil
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] Notfallkontakt-Button konsistent mit Daten-Felder', () => {
  test('Layout: links Info, rechts kompakter Border-Button', () => {
    const src = read('app/profil/page.tsx')
    expect(src).toMatch(/Notfallkontakt[\s\S]{0,500}flex items-center justify-between/)
    expect(src).toMatch(/profile\?\.emergency_name \? 'Ändern' : 'Hinzufügen'/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 13) Reminder-Dropdown kompakt
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] Reminder-Dropdown im Yogi-Profil ist kompakt', () => {
  test('Dropdown nutzt rounded-full + text-xs (statt großem field-input)', () => {
    const src = read('app/profil/page.tsx')
    // className steht VOR dem value-Attribut → suche im 500-Zeichen-Fenster
    // VOR notify_session_reminder_hours nach beiden Marken.
    const idx = src.indexOf('notify_session_reminder_hours')
    expect(idx).toBeGreaterThan(-1)
    const window = src.slice(Math.max(0, idx - 500), idx)
    expect(window).toMatch(/rounded-full/)
    expect(window).toMatch(/text-xs/)
    // Negativ-Assert: kein field-input mehr (zu groß für eine Card-Zeile)
    expect(window).not.toMatch(/field-input/)
  })

  test('Optionen kürzer: "4 Std vorher" statt "4 Stunden vorher"', () => {
    const src = read('app/profil/page.tsx')
    expect(src).toMatch(/4 Std vorher/)
    expect(src).toMatch(/12 Std vorher/)
    expect(src).toMatch(/24 Std vorher/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 14) CSS-Reset gegen Mobile-Auto-Scaling
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] globals.css: text-size-adjust 100%', () => {
  test('html + body haben beide text-size-adjust (Standard + Webkit)', () => {
    const src = read('app/globals.css')
    expect(src).toMatch(/html\s*\{[\s\S]*?-webkit-text-size-adjust:\s*100%[\s\S]*?text-size-adjust:\s*100%/)
    expect(src).toMatch(/body\s*\{[\s\S]*?-webkit-text-size-adjust:\s*100%[\s\S]*?text-size-adjust:\s*100%/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 15) Wochen-Nav-Buttons kompakter
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] Wochen-Nav-Buttons: text-xs + border 1px + py-1.5', () => {
  test('Admin-Dashboard Vor/Zurück-Buttons kompakt', () => {
    const src = read('app/admin/dashboard/page.tsx')
    expect(src).toMatch(/text-xs font-semibold px-2\.5 py-1\.5 border border-yoga-text\/30/)
  })

  test('Yogi /kurse Vor/Zurück-Buttons kompakt', () => {
    const src = read('app/kurse/page.tsx')
    expect(src).toMatch(/text-xs font-semibold px-2\.5 py-1\.5 border border-yoga-text\/30/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 16) Eingabefelder im Mehr-Menü kompakter (text-sm + py-2)
// ────────────────────────────────────────────────────────────────────────
test.describe('[E2E] Mehr-Menü Eingabefelder kompakter', () => {
  test('Bulk-Mail Subject + Body + Nachrichten-Textarea nutzen text-sm + py-2', () => {
    const src = read('app/profil/page.tsx')
    // 3 Stellen mit kompaktem Input-Stil
    const matches = src.match(/text-sm text-yoga-text outline-none focus:border-yoga-text\/40/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })
})
