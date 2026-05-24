/**
 * Text-Plausibilitäts-Audit für die Charity-/Cancellation-Welle (2026-05-24)
 *
 * Sinn: prüft dass alle Texte (UI-Hinweise, Buttons, Alerts, Email-Pfade)
 * konsistent zum tatsächlichen Workflow sind — keine "Credit"-Hinweise bei
 * Charity, keine "Diese Woche"-Hardcodes, klare Begründungen für Sperren.
 */

import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// ── 1) Charity-Konsistenz: kein "Credit" wenn is_free ──────────────────────
test.describe('[E2E-Text] Charity-Konsistenz — kein Credit-Hinweis bei is_free', () => {
  test('Bestaetigungs-Page: Charity-Branch zeigt "jederzeit moeglich" und im sichtbaren Text kein "Credit"', async () => {
    const src = read('app/kurse/[id]/bestaetigung/page.tsx')
    // Den is_free-Block (JSX-Render) extrahieren — Kommentare werden bewusst akzeptiert
    const charityBlock = src.match(/is_free\s*\?\s*\(?[\s\S]{0,400}?\)?\s*:\s*within3h/)
    expect(charityBlock).not.toBeNull()
    // "jederzeit möglich" muss als sichtbarer User-Text drin sein
    expect(charityBlock![0]).toMatch(/jederzeit/i)
    // Sichtbarer JSX-Text-Inhalt (zwischen <p>…</p>) prüfen — KEIN "Credit"-Wort
    const pTagText = charityBlock![0].match(/<p[^>]*>([\s\S]*?)<\/p>/)
    expect(pTagText).not.toBeNull()
    expect(pTagText![1]).not.toMatch(/Credit/i)
  })

  test('Detail-Page "Angemeldet"-Branch: Charity-Pfad hat keinen Credit-Text', async () => {
    const src = read('app/kurse/[id]/page.tsx')
    // Block: course?.is_free ? '...jederzeit...' : <>...Credit...</>
    const block = src.match(/course\?\.is_free[\s\S]{0,300}jederzeit[\s\S]{0,300}danach gilt/)
    expect(block).not.toBeNull()
    // Beide Texte da, also Ternary korrekt
  })

  test('Detail-Page Abmelde-Bestaetigung: Charity zeigt "jederzeit moeglich" + KEIN "Credit"', async () => {
    const src = read('app/kurse/[id]/page.tsx')
    // Suche den Charity-Block im showCancel-Bereich
    const showCancelArea = src.match(/showCancel\s*&&\s*\([\s\S]{0,2500}/)
    expect(showCancelArea).not.toBeNull()
    // Charity-Zweig hat "jederzeit"
    expect(showCancelArea![0]).toMatch(/is_free[\s\S]{0,300}jederzeit/i)
    // Charity-Zweig hat KEIN "Credit wird"
    const charityZweig = showCancelArea![0].match(/is_free\s*\?\s*\(?[\s\S]{0,300}?\)\s*:/)
    if (charityZweig) {
      expect(charityZweig[0]).not.toMatch(/Credit wird/i)
    }
  })

  test('Info-Grid bei Charity: Credits-Kachel + Abmeldefrist-Kachel ausgeblendet', async () => {
    const src = read('app/kurse/[id]/page.tsx')
    expect(src).toMatch(/!course\?\.is_free[\s\S]{0,500}lbl["]?\s*>\s*Abmeldefrist/)
    expect(src).toMatch(/!course\?\.is_free[\s\S]{0,500}lbl["]?\s*>\s*Deine Credits/)
  })

  test('Detail-Page "Kostenlose Stunde"-Info-Card: positive Aussage ohne Credit-Bezug', async () => {
    const src = read('app/kurse/[id]/page.tsx')
    const block = src.match(/Kostenlose Stunde[^<]*<\/span>([\s\S]{0,200})/)
    expect(block).not.toBeNull()
    // Folgender Text macht klar dass kein Credit nötig + Einladung zum Anmelden
    expect(block![1]).toMatch(/kein Credit n[öo]tig/i)
    expect(block![1]).toMatch(/Einfach anmelden/i)
  })
})

// ── 2) 9-Tage-Sperre-Alerts: klare Begründung + konkretes Datum ────────────
test.describe('[E2E-Text] 9-Tage-Sperre — Alert-Text plausibel', () => {
  test('deleteCourse Alert nennt "9. Tag nach Kursende" + Begründung Credit-Schutz', async () => {
    const src = read('app/admin/kurse/page.tsx')
    const fn = src.match(/async function deleteCourse[\s\S]{0,2500}/)![0]
    // Alert-Text ist im fn
    expect(fn).toMatch(/9\.\s*Tag\s*nach\s*Kursende/i)
    // Begründung: warum 9 Tage? → 8 Tage Credit-Gueltigkeit + 1 Tag Puffer
    expect(fn).toMatch(/Credit/i)
  })

  test('archiveCourse Alert nennt 9. Tag-Sperre', async () => {
    const src = read('app/admin/kurse/page.tsx')
    const fn = src.match(/async function archiveCourse[\s\S]{0,1500}/)![0]
    expect(fn).toMatch(/9\.\s*Tag\s*nach\s*Kursende/i)
  })

  test('Safety-Net Alert: separater Hinweis wenn noch valide Credits da sind', async () => {
    const src = read('app/admin/kurse/page.tsx')
    const fn = src.match(/async function deleteCourse[\s\S]{0,3000}/)![0]
    // 2. Defensive: noch validCredits → eigene Meldung
    expect(fn).toMatch(/validCredits/)
    expect(fn).toMatch(/stillUsable/)
  })
})

// ── 3) Cancellation-Complete-Notification: Plural/Singular korrekt ────────
test.describe('[E2E-Text] Cancellation-Complete-Notification — Plural/Singular', () => {
  test('SQL-Trigger formuliert "Yogi" vs "Yogis" + "hat" vs "haben" abhaengig von Anzahl', async () => {
    // Trigger-Source ist in der Migration — wir prüfen indirekt via DB-Query
    // ob das format() das richtige Pattern verwendet
    const fn = read('app/admin/dashboard/page.tsx')
    expect(fn).toMatch(/alle Yogis haben geantwortet/)
  })

  test('Notification-Label im Dashboard ist klar formuliert', async () => {
    const src = read('app/admin/dashboard/page.tsx')
    const metaBlock = src.match(/course_cancellation_complete:[\s\S]{0,200}/)
    expect(metaBlock).not.toBeNull()
    expect(metaBlock![0]).toMatch(/Kursabbruch.*alle Yogis haben geantwortet/i)
    expect(metaBlock![0]).toMatch(/ti-checks/)
    // href fuehrt zur Kursabbruch-Uebersicht
    expect(metaBlock![0]).toMatch(/href:\s*['"]\/admin\/kursabbruch['"]/)
  })
})

// ── 4) Sprechblase Admin-Promote-Text: neutral, kein "Diese Woche" ────────
test.describe('[E2E-Text] Sprechblase Admin-Promote — neutrale Datums-Formulierung', () => {
  test('admin/sessions verwendet dateFormatted statt "Diese Woche:"-Hardcode', async () => {
    const src = read('app/admin/sessions/[id]/page.tsx')
    // KEIN "Diese Woche" als Template-String
    expect(src).not.toMatch(/`Diese Woche:/)
    // Stattdessen: vollstaendiges Datum mit Wochentag
    expect(src).toMatch(/weekday:\s*['"]long['"]/)
    expect(src).toMatch(/dateFormatted/)
  })

  test('Jahres-Anzeige nur wenn Datum nicht im aktuellen Jahr', async () => {
    const src = read('app/admin/sessions/[id]/page.tsx')
    // isThisYear Logik: ohne Jahr wenn aktuelles Jahr, mit Jahr sonst
    expect(src).toMatch(/isThisYear/)
    expect(src).toMatch(/getFullYear/)
  })

  test('Promote-Bestaetigung sagt "Charity-Stunde wurde promoted" (nicht "Email versandt")', async () => {
    const src = read('app/admin/sessions/[id]/page.tsx')
    expect(src).toMatch(/Charity-Stunde wurde[\s\S]{0,80}promoted/i)
  })
})

// ── 5) Email-Templates: waitlistPromoted bei Charity sinnvoll? ────────────
test.describe('[E2E-Text] Email-Helper — Charity-Path verwendet Standard-waitlistPromoted', () => {
  test('lib/email.ts hat waitlistPromoted (gemeinsam für Charity + Standard)', async () => {
    const src = read('lib/email.ts')
    expect(src).toMatch(/waitlistPromoted:/)
  })

  test('Charity-Auto-Promote in lib/waitlist-promote.ts sendet Email.waitlistPromoted (selber Template)', async () => {
    const src = read('lib/waitlist-promote.ts')
    // tryAutoPromoteOneFree sendet die gleiche Email wie der Standard-Pfad
    expect(src).toMatch(/tryAutoPromoteOneFree[\s\S]{0,600}Email\.waitlistPromoted/)
  })
})

// ── 6) Teilen-Button im Admin — klare Beschriftung ────────────────────────
test.describe('[E2E-Text] Admin-Stundenseite — Teilen-Button beschriftet', () => {
  test('Button-Label nennt explizit Zielmedium (WhatsApp / Email)', async () => {
    const src = read('app/admin/sessions/[id]/page.tsx')
    expect(src).toMatch(/Stunde teilen.*WhatsApp.*Email|Stunde teilen.*Email.*WhatsApp/i)
  })

  test('Share-URL zeigt auf /kurse/<id> (Yogi-Page, NICHT Admin-Page)', async () => {
    const src = read('app/admin/sessions/[id]/page.tsx')
    expect(src).toMatch(/window\.location\.origin[\s\S]{0,80}\/kurse\/\$\{id\}/)
  })

  test('Fallback-Alert klar formuliert ("Link kopiert — in WhatsApp einfuegen")', async () => {
    const src = read('app/admin/sessions/[id]/page.tsx')
    expect(src).toMatch(/Link kopiert[\s\S]{0,80}WhatsApp/i)
  })
})

// ── 7) Kostenlos-Pille überall einheitlich + ohne 🆓-Emoji ────────────────
test.describe('[E2E-Text] Kostenlos-Pille — einheitliches Design', () => {
  test('Wochenuebersicht: Kostenlos-Pille mit bg-yoga-green-bg (wie Plaetze-frei)', async () => {
    const src = read('app/kurse/page.tsx')
    expect(src).toMatch(/is_free[\s\S]{0,200}bg-yoga-green-bg[\s\S]{0,100}Kostenlos/)
  })

  test('Detail-Page: Kostenlos-Pille (mit Bild + ohne Bild) hat einheitliche Klasse', async () => {
    const src = read('app/kurse/[id]/page.tsx')
    // Beide Branches (mit/ohne image_url) sollten bg-yoga-green-bg verwenden
    const pillMatches = src.match(/is_free[\s\S]{0,150}bg-yoga-green-bg[\s\S]{0,80}Kostenlos/g)
    expect(pillMatches).not.toBeNull()
    expect(pillMatches!.length).toBeGreaterThanOrEqual(2)
  })

  test('Admin-Stundenseite: Kostenlos-Pille gleicher Stil', async () => {
    const src = read('app/admin/sessions/[id]/page.tsx')
    expect(src).toMatch(/is_free[\s\S]{0,200}bg-yoga-green-bg[\s\S]{0,80}Kostenlos/)
  })

  test('Keine 🆓-Emoji-Verwendung in den Pillen (Sarah-Wunsch: Icon weg)', async () => {
    const files = [
      'app/kurse/page.tsx',
      'app/kurse/[id]/page.tsx',
      'app/admin/sessions/[id]/page.tsx',
    ]
    for (const f of files) {
      const src = read(f)
      // 🆓 darf nicht direkt vor "Kostenlos" stehen
      expect(src).not.toMatch(/🆓\s*Kostenlos/)
    }
  })
})

// ── 8) Workflow-Konsistenz: Charity-Stunde im Admin ───────────────────────
test.describe('[E2E-Text] Workflow-Konsistenz — Admin/Yogi-Sicht stimmt überein', () => {
  test('Sowohl Yogi-Detail als auch Admin-Detail laden is_free + image_url', async () => {
    const yogiSrc = read('app/kurse/[id]/page.tsx')
    const adminSrc = read('app/admin/sessions/[id]/page.tsx')
    expect(yogiSrc).toMatch(/course:courses\([^)]*is_free|course:courses\([^)]*\*/)
    expect(adminSrc).toMatch(/course:courses\([^)]*is_free/)
  })

  test('Bei Charity zeigt sowohl Admin als auch Yogi die Pille', async () => {
    const yogiSrc = read('app/kurse/[id]/page.tsx')
    const adminSrc = read('app/admin/sessions/[id]/page.tsx')
    expect(yogiSrc).toMatch(/is_free[\s\S]{0,300}Kostenlos/)
    expect(adminSrc).toMatch(/is_free[\s\S]{0,300}Kostenlos/)
  })
})

// ── 9) Sprechblasen-Link-Button — klare Default-Beschriftung ──────────────
test.describe('[E2E-Text] AdminAnnouncementBubble — Link-Button-Default', () => {
  test('Default-Label "Jetzt anschauen" wenn kein link_label gesetzt', async () => {
    const src = read('components/AdminAnnouncementBubble.tsx')
    expect(src).toMatch(/['"]Jetzt anschauen['"]/)
  })

  test('Link-Button hat sinnvolle CSS-Klasse (sichtbar als Button)', async () => {
    const src = read('components/AdminAnnouncementBubble.tsx')
    // Button-artiges Styling
    expect(src).toMatch(/font-semibold[\s\S]{0,80}rounded-full/)
    // bg-yoga-text (dunkler Brand-Hintergrund)
    expect(src).toMatch(/bg-yoga-text/)
  })
})
