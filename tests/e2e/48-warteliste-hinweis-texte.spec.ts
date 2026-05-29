/**
 * SCHUTZ-TEST (Sarah 2026-05-29): Die Wartelisten-Hinweistexte auf der
 * Stundenseite (app/kurse/[id]/page.tsx) sind mit Sarah final abgestimmt und
 * dürfen NUR auf ihren ausdrücklichen Auftrag geändert werden.
 *
 * Dieser Test friert die EXAKTEN Sätze ein (4 Session-Typ-Varianten × 90-Min-
 * Fenster). Schlägt er fehl, wurde ein Text unbeauftragt verändert — dann mit
 * Sarah abstimmen, bevor irgendetwas committed wird.
 *
 * Hintergrund-Logik (Frist):
 *   > 90 Min vor Beginn → Auto-Promote (+ 60-Min-Gnadenfrist bei Kurs/Single)
 *   ≤ 90 Min vor Beginn → kein Auto-Promote, Spätangebot per Mail an alle
 */
import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const SRC = () => fs.readFileSync(path.join(process.cwd(), 'app/kurse/[id]/page.tsx'), 'utf8')
const SRC_UEBERSICHT = () => fs.readFileSync(path.join(process.cwd(), 'app/warteliste/page.tsx'), 'utf8')

// Übersichts-Box auf /warteliste (Sarah 2026-05-29): Sammel-Hinweis unter der
// Wartelisten-Sektion. Auf Sarahs Wunsch um die 90-Min- und Event-Regeln
// erweitert (vorher nur generischer Happy-Path-Satz).
const UEBERSICHT_TEXTS = {
  autoNachruecken:
    'Sobald ein Platz frei wird, rückst Du bis 90 Minuten vor Beginn automatisch nach – und hast dann auch innerhalb der 3-Stunden-Frist noch eine Stunde Zeit, Dich kostenlos wieder abzumelden.',
  spaetangebot:
    'Ab 90 Minuten vor Beginn rückst Du nicht mehr automatisch nach: Alle Wartenden bekommen gleichzeitig ein Spätangebot – wer zuerst zusagt, bekommt den Platz.',
  event:
    'Bei Events ist die Teilnahme mit dem Nachrücken verbindlich – es gilt die 7-Tage-Stornofrist.',
}

// Die 6 exakten Strings (Kurs/Single >90, Kurs/Single ≤90, Event-frei >90,
// Event-frei ≤90, Event-bezahlt >90, Event-bezahlt ≤90).
const TEXTS = {
  // Vorab-Hinweis-Box bei Kurs/Einzelstunde (Sarah-Spec 2026-05-29): trägt die
  // Detail-Erklärung VOR dem Eintragen, daher Status-Box (over90) gekürzt.
  courseSinglePreJoin:
    'Wenn du dich auf die Warteliste setzt, rückst du <strong>bis 90 Minuten vor Beginn</strong> automatisch nach, sobald ein Platz frei wird (du brauchst dafür einen freien Credit). Du hast dann <strong>60 Minuten</strong> Zeit, dich — auch innerhalb der 3-Stunden-Abmeldefrist — kostenlos wieder abzumelden, dein Credit kommt zurück. <strong>Ab 90 Minuten vor Beginn</strong> bekommen alle Wartenden gleichzeitig ein <strong>Spätangebot</strong> — wer zuerst zusagt, bekommt den Platz.',
  courseSingleOver90:
    'Du rückst bis 90 Minuten vor Beginn automatisch nach. Du hast dann 60 Minuten Zeit, dich kostenlos abzumelden (Credit zurück). Ab 90 Minuten vorher: Spätangebot an alle — wer zuerst zusagt, bekommt den Platz.',
  courseSingleUnder90:
    'So kurz vor Beginn rückst du nicht mehr automatisch nach, das könnte für einige zu kurzfristig sein. Wird jetzt noch ein Platz frei, bekommen alle Wartenden gleichzeitig ein Spätangebot — wer zuerst zusagt, bekommt den Platz.',
  eventFreeOver90:
    'Du rückst bis 90 Minuten vor Beginn automatisch nach. Abmelden ist jederzeit kostenlos. Ab 90 Minuten vorher: Spätangebot an alle — wer zuerst zusagt, bekommt den Platz.',
  eventFreeUnder90:
    'So kurz vor Beginn rückst du nicht mehr automatisch nach. Wird jetzt noch ein Platz frei, bekommen alle Wartenden gleichzeitig ein Spätangebot — wer zuerst zusagt, bekommt den Platz.',
  eventPaidOver90:
    'Du rückst automatisch nach, sobald ein Platz frei wird. Achtung: Mit dem Nachrücken ist deine Teilnahme verbindlich gebucht. Es gilt die 7-Tage-Stornofrist — danach fällt die volle Gebühr an; du kannst aber einen Ersatzkandidaten benennen.',
  eventPaidUnder90:
    'So kurz vor Beginn rückst du nicht mehr automatisch nach. Wird jetzt noch ein Platz frei, bekommen alle Wartenden ein Spätangebot; wer zuerst zusagt, bucht verbindlich — 7-Tage-Stornofrist beachten.',
}

test.describe('[E2E-Text] Wartelisten-Hinweise — eingefrorenes Wording (Sarah-Spec)', () => {
  test('Kurs/Einzelstunde: Vorab-Hinweis-Box (vor dem Eintragen) vorhanden', () => {
    const src = SRC()
    expect(src).toContain(TEXTS.courseSinglePreJoin)
    // Box wird NUR bei Nicht-Events gezeigt
    expect(src).toMatch(/!isEvent\s*&&/)
  })

  test('Kurs/Einzelstunde > 90 Min: exakter Text vorhanden', () => {
    expect(SRC()).toContain(TEXTS.courseSingleOver90)
  })

  test('Kurs/Einzelstunde ≤ 90 Min (Spätangebot): exakter Text vorhanden', () => {
    expect(SRC()).toContain(TEXTS.courseSingleUnder90)
  })

  test('Kostenloses Event > 90 Min: exakter Text vorhanden', () => {
    expect(SRC()).toContain(TEXTS.eventFreeOver90)
  })

  test('Kostenloses Event ≤ 90 Min (Spätangebot): exakter Text vorhanden', () => {
    expect(SRC()).toContain(TEXTS.eventFreeUnder90)
  })

  test('Bezahltes Event > 90 Min: exakter Text inkl. 7-Tage-Storno vorhanden', () => {
    const src = SRC()
    expect(src).toContain(TEXTS.eventPaidOver90)
    // Sicherheits-Anker: Verbindlichkeit + Stornofrist müssen drinstehen
    expect(TEXTS.eventPaidOver90).toMatch(/verbindlich gebucht/)
    expect(TEXTS.eventPaidOver90).toMatch(/7-Tage-Stornofrist/)
  })

  test('Bezahltes Event ≤ 90 Min (Spätangebot): exakter Text vorhanden', () => {
    expect(SRC()).toContain(TEXTS.eventPaidUnder90)
  })

  test('90-Min-Fenster-Logik + Typ-Verzweigung sind verdrahtet', () => {
    const src = SRC()
    // within90min wird berechnet und steuert den Hinweistext
    expect(src).toMatch(/within90min/)
    expect(src).toMatch(/90 \* 60 \* 1000/)
    // waitlistHintText wird in der Status-Box gerendert
    expect(src).toMatch(/waitlistHintText/)
    // Verzweigung nach Session-Typ
    expect(src).toMatch(/isEventPaid\s*\n?\s*\?/)
    expect(src).toMatch(/isEventFree\s*\n?\s*\?/)
  })

  test('Alter generischer Satz ist ENTFERNT (kein Rückfall)', () => {
    // Der frühere undifferenzierte Satz darf nicht mehr existieren.
    expect(SRC()).not.toContain('Du rückst automatisch nach wenn ein Platz frei wird. Du hast dann 1 Stunde Zeit dich kostenlos abzumelden.')
  })
})

test.describe('[E2E-Text] Warteliste-Übersicht (/warteliste): Sammel-Hinweis-Box (Sarah-Spec)', () => {
  test('Box erklärt Auto-Nachrücken + 3h/60-Min-Frist', () => {
    expect(SRC_UEBERSICHT()).toContain(UEBERSICHT_TEXTS.autoNachruecken)
  })

  test('Box erklärt die 90-Min-Regel (Spätangebot)', () => {
    expect(SRC_UEBERSICHT()).toContain(UEBERSICHT_TEXTS.spaetangebot)
  })

  test('Box erklärt Event-Verbindlichkeit + 7-Tage-Storno', () => {
    const src = SRC_UEBERSICHT()
    expect(src).toContain(UEBERSICHT_TEXTS.event)
    expect(UEBERSICHT_TEXTS.event).toMatch(/verbindlich/)
    expect(UEBERSICHT_TEXTS.event).toMatch(/7-Tage-Stornofrist/)
  })

  test('Box steht weiterhin NUR unter der echten Warteliste (nicht bei Benachrichtigungen)', () => {
    const src = SRC_UEBERSICHT()
    // Hinweis ist innerhalb des waitlist.length-Blocks, der Notify-Block hat keinen solchen Text.
    expect(src).toMatch(/waitlist\.length > 0/)
  })

  test('Alter generischer Einzeiler ist ENTFERNT (kein Rückfall)', () => {
    expect(SRC_UEBERSICHT()).not.toContain('Wenn ein Platz frei wird, rückst Du automatisch nach und hast auch innerhalb der 3 Stunden Frist noch eine Stunde Zeit dich kostenlos wieder abzumelden.')
  })
})
