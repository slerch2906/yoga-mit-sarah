/**
 * DEEP AUDIT: Email-Plausibilität
 *
 * Sarah-Anforderung 2026-05-23:
 * Prüfe dass conditional Sätze in Emails NUR dann erscheinen wenn sie sollen.
 * Historischer Bug: "verrechnetes Guthaben" in Mail obwohl Yogi nie Guthaben hatte.
 *
 * Strategie: Wir holen den send-email Edge-Function-Source und prüfen
 * (a) dass die conditional-logic-Branches im Source vorhanden sind
 * (b) dass keine "leeren" Conditional-Render-Stellen mehr existieren
 *
 * Echte End-to-End-Email-Tests gehen nicht: App schickt via Brevo direkt an
 * echte Adressen (slerch2906@gmail.com), nicht an Mailtrap.
 */
import { test, expect } from '@playwright/test'

let edgeFunctionSource: string = ''

test.beforeAll(async () => {
  // Source-Snapshot der deployten Edge Function (v46) — siehe tests/fixtures/README.md
  const fs = require('fs')
  const path = require('path')
  // __dirname ist tests/e2e/ → fixture liegt eine Ebene höher in fixtures/
  const snapshot = path.join(__dirname, '..', 'fixtures', 'send-email-snapshot.txt')
  if (fs.existsSync(snapshot)) {
    edgeFunctionSource = fs.readFileSync(snapshot, 'utf-8')
  }
  if (!edgeFunctionSource) {
    console.warn(`[27-email-plausibilitaet] Snapshot nicht gefunden unter ${snapshot}`)
  }
})

test.describe('[AUDIT] Email Template — yogi_course_cancel_choice', () => {
  test.skip(() => !edgeFunctionSource, 'Edge Function Source nicht lokal verfügbar (siehe beforeAll)')

  test('Erstattung: "verrechnetes Guthaben"-Satz nur bei verrechnet>0', async () => {
    // Source sollte Branch enthalten: verrechnet > 0 ? `... Dein verrechnetes Guthaben (${verrechnet} Credits) ...` : ''
    // Pattern via RegExp-Konstruktor weil backtick in regex literal mit TypeScript-Parser Probleme macht
    const re = new RegExp('verrechnet > 0 \\? `[^`]*verrechnetes? Guthaben', 'i')
    expect(re.test(edgeFunctionSource)).toBe(true)
  })

  test('Guthaben: 2 Branches für newPaid>0 und verrechnet>0', async () => {
    // v61: 'guthaben' wurde in 'newPaid' umbenannt (newPaidCredits ?? guthabenCredits)
    expect(edgeFunctionSource).toMatch(/newPaid > 0 \?/i)
    expect(edgeFunctionSource).toMatch(/verrechnet > 0 \?/i)
  })
})

test.describe('[AUDIT] Email Template — course_cancelled', () => {
  test.skip(() => !edgeFunctionSource, 'Edge Function Source nicht lokal verfügbar')

  test('reason wird mit 💬 Sprechblase angezeigt — und nur wenn vorhanden', async () => {
    // Erwartung: data.reason ? `<p>💬 ${data.reason}</p>` : ''
    expect(edgeFunctionSource).toMatch(/data\.reason\s*\?\s*`[^`]*💬/u)
  })

  test('isAllR=true zeigt KEINE Tip-Box (Provisorisches Guthaben)', async () => {
    // Im Source: ${isAllR?`Erstattung-Text`:`Wahl-Text${hl(`💡 Du siehst die...`)}`}
    // Der "Du siehst die ${data.remainingSessions} Credits" steht IM else-Branch (yogi_choice).
    // Erwartet: irgendwo nach isAllR? Konstrukt steht der "Du siehst die" Satz.
    const re = new RegExp('isAllR\\?[\\s\\S]{1,2000}Du siehst die', 'i')
    expect(re.test(edgeFunctionSource)).toBe(true)
  })

  test('💡 vor "X Stunden entfallen"', async () => {
    expect(edgeFunctionSource).toMatch(/💡\s*\$\{[^}]*remainingSessions\}\s*Stunden entfallen/u)
  })
})

test.describe('[AUDIT] Email Template — session_cancelled', () => {
  test.skip(() => !edgeFunctionSource, 'Edge Function Source nicht lokal verfügbar')

  test('Ersatztermin-Box nur wenn replacement vorhanden', async () => {
    expect(edgeFunctionSource).toMatch(/hasRep\s*\?[^:]+:/i)
  })

  test('reason mit Sprechblase nur wenn vorhanden', async () => {
    expect(edgeFunctionSource).toMatch(/session_cancelled[\s\S]*?data\.reason\s*\?\s*`[^`]*💬/i)
  })
})

test.describe('[AUDIT] Email Template — session_added (Ersatztermin)', () => {
  test.skip(() => !edgeFunctionSource, 'Edge Function Source nicht lokal verfügbar')

  test('"Ursprüngliche Stunde (abgesagt)" Box nur wenn originalDate vorhanden', async () => {
    expect(edgeFunctionSource).toMatch(/hasOrig\s*\?[^:]+:/i)
  })

  test('Subject enthält Origin-Datum wenn vorhanden', async () => {
    expect(edgeFunctionSource).toMatch(/hasOrig\s*\?\s*`Ersatztermin für deine abgesagte Stunde am/i)
  })
})

test.describe('[AUDIT] Email Template — yogi_enrolled_by_admin', () => {
  test.skip(() => !edgeFunctionSource, 'Edge Function Source nicht lokal verfügbar')

  test('Mid-Course-Hinweis nur wenn remaining < total', async () => {
    expect(edgeFunctionSource).toMatch(/midCourse\s*=[^;]*remaining\s*&&[^;]*remaining\s*<\s*total/i)
  })

  test('Mid-Course-Box-Branch existiert', async () => {
    expect(edgeFunctionSource).toMatch(/midCourse\s*\?[^:]+:/i)
  })
})

test.describe('[AUDIT] Email Template — booking_cancelled', () => {
  test.skip(() => !edgeFunctionSource, 'Edge Function Source nicht lokal verfügbar')

  test('Unterscheidung creditReturned true/false', async () => {
    expect(edgeFunctionSource).toMatch(/data\.creditReturned\s*\?[\s\S]*Credit gutgeschrieben[\s\S]*:[\s\S]*nicht zurückgebucht/i)
  })
})

test.describe('[AUDIT] Email Template — admin_guthaben_verrechnet', () => {
  test.skip(() => !edgeFunctionSource, 'Edge Function Source nicht lokal verfügbar')

  test('Verbleibendes Guthaben Anzeige: remaining>0 vs aufgebraucht', async () => {
    expect(edgeFunctionSource).toMatch(/remaining\s*>\s*0\s*\?[\s\S]*Verbleibendes Guthaben[\s\S]*:[\s\S]*aufgebraucht/i)
  })
})

test.describe('[AUDIT] Email Template — waitlist_joined', () => {
  test.skip(() => !edgeFunctionSource, 'Edge Function Source nicht lokal verfügbar')

  test('unsubscribeUrl-Token-Fallback bei fehlendem Token', async () => {
    expect(edgeFunctionSource).toMatch(/unsubscribeToken\s*\?[\s\S]*warteliste\/austragen[\s\S]*:[\s\S]*meine/i)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Sarah-Welle 2026-05-25: Templates v55 / v58 / v59 / v61
// ───────────────────────────────────────────────────────────────────────────

test.describe('[AUDIT] Email Template — illness_credit (Welle G, v55)', () => {
  test.skip(() => !edgeFunctionSource, 'Edge Function Source nicht lokal verfügbar')

  test('Case-Block "illness_credit" existiert', async () => {
    expect(edgeFunctionSource).toMatch(/case ['"]illness_credit['"]/)
  })

  test('Subject enthaelt "Krankheits-Austragung" + Kursname', async () => {
    expect(edgeFunctionSource).toMatch(/subject\s*=\s*`Krankheits-Austragung:\s*\$\{data\.courseName\}/)
  })

  test('Body zeigt hoursCredited + expiresAt + 10-Mon-Frist-Hinweis', async () => {
    expect(edgeFunctionSource).toMatch(/\$\{data\.hoursCredited\}\s*Stunden Guthaben/)
    expect(edgeFunctionSource).toMatch(/\$\{expiryStr\}/)
    expect(edgeFunctionSource).toMatch(/Vorhol-\s*und Nachholbuchungen ersatzlos beendet/i)
    expect(edgeFunctionSource).toMatch(/Auszahlung in Geld ist ausgeschlossen/i)
  })
})

test.describe('[AUDIT] Email Template — course_cancelled "Geldbetrag erstattet" (v58)', () => {
  test.skip(() => !edgeFunctionSource, 'Edge Function Source nicht lokal verfügbar')

  test('Hinweis "Geldbetrag automatisch ausgezahlt" wenn 2J verstreichen', async () => {
    expect(edgeFunctionSource).toMatch(/Geldbetrag automatisch ausgezahlt/i)
    expect(edgeFunctionSource).toMatch(/2 Jahre gültig/)
  })

  test('Ohne Rueckmeldung: Default = Geldbetrag erstattet (Sarah-Welle 2026-05-25)', async () => {
    expect(edgeFunctionSource).toMatch(/Ohne Rückmeldung wird dir automatisch der Geldbetrag erstattet/)
  })
})

test.describe('[AUDIT] Email Template — admin_guthaben_2y_expiry (v59)', () => {
  test.skip(() => !edgeFunctionSource, 'Edge Function Source nicht lokal verfügbar')

  test('Case-Block + Admin-Empfaenger', async () => {
    expect(edgeFunctionSource).toMatch(/case ['"]admin_guthaben_2y_expiry['"]/)
    // im Block wird to = ADMIN_EMAIL gesetzt
    const re = /admin_guthaben_2y_expiry[\s\S]{0,200}to\s*=\s*ADMIN_EMAIL/
    expect(re.test(edgeFunctionSource)).toBe(true)
  })

  test('Subject mit yogiName + Hinweis "bitte erstatten"', async () => {
    expect(edgeFunctionSource).toMatch(/Guthaben nach 2 Jahren abgelaufen:\s*\$\{data\.yogiName\}/)
    expect(edgeFunctionSource).toMatch(/bitte erstatten/i)
  })

  test('Body verweist auf AGB § 1.2 + unusedCredits + Admin-Dashboard-Link', async () => {
    expect(edgeFunctionSource).toMatch(/AGB\s*§\s*1\.2/)
    expect(edgeFunctionSource).toMatch(/\$\{data\.unusedCredits\}\s*ungenutzte Credits/)
    expect(edgeFunctionSource).toMatch(/Zum Admin-Dashboard/)
  })
})

test.describe('[AUDIT] Email Template — account_deleted_yogi (v61)', () => {
  test.skip(() => !edgeFunctionSource, 'Edge Function Source nicht lokal verfügbar')

  test('Case-Block + Yogi-Empfaenger', async () => {
    expect(edgeFunctionSource).toMatch(/case ['"]account_deleted_yogi['"]/)
    // to = data.email (an Yogi)
    const re = /account_deleted_yogi[\s\S]{0,200}to\s*=\s*data\.email/
    expect(re.test(edgeFunctionSource)).toBe(true)
  })

  test('Subject: "Dein Account ... geloescht"', async () => {
    expect(edgeFunctionSource).toMatch(/Dein Account bei Yoga mit Sarah wurde geloescht/i)
  })

  test('Body listet 5 ✅-Punkte (Stammdaten + Buchungen + Historie + Audit + Email-Loesch)', async () => {
    // Mindestens 5 ✅-Bullets im Block
    const re = /account_deleted_yogi[\s\S]+?(✅[\s\S]+?){5}/
    expect(re.test(edgeFunctionSource), 'Mindestens 5 ✅-Bullets erwartet').toBe(true)
    // Inhalts-Spot-Checks
    expect(edgeFunctionSource).toMatch(/Stammdaten.*entfernt/i)
    expect(edgeFunctionSource).toMatch(/zukuenftigen Buchungen.*storniert/i)
    expect(edgeFunctionSource).toMatch(/Buchungshistorie.*geloescht/i)
    expect(edgeFunctionSource).toMatch(/anonymisiert/i)
  })

  test('Hinweis "letzte Nachricht" (DSGVO Art. 12 — Empfangsbestaetigung)', async () => {
    expect(edgeFunctionSource).toMatch(/letzte Nachricht, die du von mir erhaeltst/i)
  })

  test('Credit/Guthaben-Verfall-Hinweis (AGB § 1.0)', async () => {
    expect(edgeFunctionSource).toMatch(/AGB\s*§\s*1\.0/)
    expect(edgeFunctionSource).toMatch(/Rueckerstattung erfolgt nicht/i)
  })
})

test.describe('[AUDIT] Globale Regeln (Email-Templates v46)', () => {
  test.skip(() => !edgeFunctionSource, 'Edge Function Source nicht lokal verfügbar')

  test('"Kurs:" Präfix konsistent vor Kursnamen (Hauptboxen)', async () => {
    // Mindestens 5 Stellen mit "Kurs: ${data.courseName}" oder "Kurs: ${...}"
    const matches = edgeFunctionSource.match(/Kurs:\s*\$\{/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(5)
  })

  test('Font-Size 15px konsistent für Fließtext', async () => {
    // Stichprobe: <p style="font-size:15px"> sollte mehrfach vorkommen
    const matches = edgeFunctionSource.match(/font-size:\s*15px/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(20)
  })

  test('Welcome-Email enthält Herz 💛 und "in den Kurs"', async () => {
    expect(edgeFunctionSource).toMatch(/Schön, dass du dabei bist!\s*💛/u)
    expect(edgeFunctionSource).toMatch(/in den Kurs\s*<strong>\$\{data\.courseName\}/i)
    expect(edgeFunctionSource).toMatch(/Ich freue mich, dich bald auf der Matte zu sehen/i)
  })
})
