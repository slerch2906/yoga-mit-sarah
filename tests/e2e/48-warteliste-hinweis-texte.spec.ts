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

// Die 6 exakten Strings (Kurs/Single >90, Kurs/Single ≤90, Event-frei >90,
// Event-frei ≤90, Event-bezahlt >90, Event-bezahlt ≤90).
const TEXTS = {
  courseSingleOver90:
    'Du rückst bis 90 Minuten vor Stundenbeginn automatisch nach, sobald ein Platz frei wird. Du hast dann, auch innerhalb der 3 Stunden Abmeldefrist, 60 Minuten Zeit, dich noch kostenlos abzumelden — dein Credit kommt dann zurück. Ab 90 Minuten vor Stundenbeginn bekommen alle wartenden Yogis gleichzeitig eine Mail — wer zuerst zusagt, bekommt den Platz.',
  courseSingleUnder90:
    'So kurz vor Beginn rückst du nicht mehr automatisch nach, das könnte für einige zu kurzfristig sein. Wird jetzt noch ein Platz frei, bekommen alle Wartenden gleichzeitig ein Spätangebot — wer zuerst zusagt, bekommt den Platz.',
  eventFreeOver90:
    'Du rückst automatisch nach, sobald ein Platz frei wird. Abmelden ist jederzeit kostenlos möglich.',
  eventFreeUnder90:
    'So kurz vor Beginn rückst du nicht mehr automatisch nach. Wird jetzt noch ein Platz frei, bekommen alle Wartenden gleichzeitig ein Spätangebot — wer zuerst zusagt, bekommt den Platz.',
  eventPaidOver90:
    'Du rückst automatisch nach, sobald ein Platz frei wird. Achtung: Mit dem Nachrücken ist deine Teilnahme verbindlich gebucht. Es gilt die 7-Tage-Stornofrist — danach fällt die volle Gebühr an; du kannst aber einen Ersatzkandidaten benennen.',
  eventPaidUnder90:
    'So kurz vor Beginn rückst du nicht mehr automatisch nach. Wird jetzt noch ein Platz frei, bekommen alle Wartenden ein Spätangebot; wer zuerst zusagt, bucht verbindlich — 7-Tage-Stornofrist beachten.',
}

test.describe('[E2E-Text] Wartelisten-Hinweise — eingefrorenes Wording (Sarah-Spec)', () => {
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
