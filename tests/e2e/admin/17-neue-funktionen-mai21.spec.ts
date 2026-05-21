/**
 * Neue Funktionen / Bug-Fixes vom 21. Mai 2026
 *
 * Alle Tests sind als test.fixme markiert — sie werden NICHT ausgeführt.
 * Implementierungs-Details später ausfüllen; die Beschreibung dokumentiert
 * das erwartete End-to-End-Verhalten.
 *
 * Quelle: Sarah-Feedback nach Sl296-Bug + Logik-Cleanup.
 */
import { test, expect } from '@playwright/test'

// ── 1) Guthaben wird automatisch verrechnet (kein Confirm-Dialog mehr) ───────
test.describe('[E2E] Neu: Guthaben auto-verrechnen beim Admin-Einbuchen', () => {
  test.fixme('admin/yogis/[id] → Guthaben deckt Kurs: keine neuen Course-Credits, Bookings active', async () => {
    // Setup: Yogi mit Guthaben (7), Kurs Body & Mind (6 zukünftige Sessions).
    // Aktion: Admin öffnet admin/yogis/[id], klickt "In Kurs einbuchen", wählt Body & Mind, klickt "Einbuchen & Credits vergeben".
    // Erwartung:
    //   - KEIN confirm()-Dialog (auto-Verrechnung)
    //   - alert("X Stunde(n) mit Guthaben verrechnet") erscheint
    //   - Guthaben.used = 6 (nach Trigger-Recalc)
    //   - KEIN neuer Course-Credit angelegt (Guthaben deckt alles)
    //   - 6 bookings: status='active', credit_id=Guthaben-ID, type='course'
    //   - Audit-Log: action='yogi_enrolled_by_admin', details.guthaben_verrechnet=6, details.neue_credits=0
    //   - Email "Guthaben verrechnet" an Admin gesendet
    //   - Email "yogi_enrolled_by_admin" an Yogi gesendet
  })

  test.fixme('admin/yogis/[id] → Guthaben < Kurs-Stunden: Mix aus Guthaben + neuem Course-Credit', async () => {
    // Setup: Yogi mit Guthaben (3), Kurs mit 6 Sessions.
    // Erwartung:
    //   - Guthaben.used = 3 (komplett verrechnet)
    //   - Neuer Course-Credit angelegt mit total=3, used=3 (Trigger setzt auf 3 aktive)
    //   - 6 bookings: 3 mit credit_id=Guthaben, 3 mit credit_id=Course-Credit
    //   - alert: "3 Stunden mit Guthaben verrechnet. 3 neue Credits angelegt."
  })

  test.fixme('admin/kurse Teilnehmer-Liste → Yogi mit Guthaben hinzufügen: gleiche Logik', async () => {
    // Setup: Yogi mit Guthaben (5), Kurs mit 4 Sessions.
    // Aktion: Admin öffnet admin/kurse → Teilnehmer-Panel → Yogi hinzufügen.
    // Erwartung:
    //   - Guthaben.used = 4 (komplett verbraucht, 1 frei bleibt)
    //   - KEIN neuer Course-Credit
    //   - 4 bookings active mit credit_id=Guthaben
    //   - "Guthaben verrechnet"-Email an Admin
    //   - WICHTIG: Guthaben wird NICHT mehr komplett gelöscht (vorher DELETE), sondern nur die genutzten verrechnet
  })
})

// ── 2) Bestehende cancelled Bookings werden bei Re-Einbuchung reaktiviert ────
test.describe('[E2E] Neu: Bookings reaktivieren statt überspringen', () => {
  test.fixme('Yogi war im Kurs eingebucht → ausgetragen → wieder eingebucht: bookings = active', async () => {
    // Setup: Yogi einmal in Body & Mind eingebucht (6 bookings active), dann komplett ausgetragen (6 bookings cancelled).
    // Aktion: Admin bucht Yogi erneut ein.
    // Erwartung:
    //   - Die 6 existing bookings werden UPDATEd (nicht übersprungen): status='active', credit_id=neu, cancelled_at=null, type='course'
    //   - KEIN unique-constraint Fehler (bookings_user_id_session_id_key)
    //   - /meine zeigt alle Stunden als "Angemeldet", NICHT als "Abgemeldet"
    //   - Vorher-Bug: Code hatte `if (!ex) INSERT` → cancelled bookings blieben unverändert.
  })
})

// ── 3) Range-Input-Felder lassen sich leeren (Bug "1 hängt fest") ───────────
test.describe('[E2E] Neu: Range-Input "Ausnahme Teilbuchung"', () => {
  test.fixme('Input-Felder können mit Backspace komplett geleert werden', async () => {
    // Setup: admin/yogis/[id], "In Kurs einbuchen", Kurs gewählt, "+ Ausnahme: nur bestimmte Stunden" geklickt.
    // Aktion:
    //   - Cursor in "Von Einheit" Feld
    //   - Alles markieren + Entf
    //   - Feld muss LEER bleiben (vorher: sofort wieder "1")
    //   - "4" eintippen → Feld zeigt "4"
    // Erwartung:
    //   - String-State erlaubt leeren Inhalt während Bearbeitung
    //   - Validierung beim Submit greift ein wenn ungültig
  })

  test.fixme('Submit mit ungültigem Range → Fehler-Alert', async () => {
    // Aktion: Von="3", Bis="2" → "Einbuchen" Button
    // Erwartung: alert("Ungültiger Bereich. Möglich: 1 bis N.")
    // KEINE Datenänderung in der DB
  })
})

// ── 4) "Teilgenommen" ab Stundenstart (date+time < now) ─────────────────────
test.describe('[E2E] Neu: Teilgenommen-Definition = Stundenstart', () => {
  test.fixme('Stunde heute Abend 18:30, jetzt mittags → "Angemeldet", nicht "Teilgenommen"', async () => {
    // Setup: Yogi in Kurs mit Session heute 18:30 eingebucht. Test läuft mittags.
    // Aktion: /meine öffnen, abgesagte Stunde NICHT, die heute-Abend-Stunde.
    // Erwartung:
    //   - Badge zeigt "Angemeldet" (badge-enrolled)
    //   - "Absolvierte Stunden"-Kachel auf admin/yogis/[id] = 0
    //   - Course-Credit-Anzeige in /meine: free = upcoming bookings (z.B. 6/6 statt 0/6)
  })

  test.fixme('Stunde ist ANGEFANGEN (jetzt > Stundenstart) → "Teilgenommen"', async () => {
    // Setup: Yogi war in Session heute 12:00 (Stunde ist jetzt schon angelaufen).
    // Erwartung:
    //   - Badge zeigt "Teilgenommen" SOFORT nach Stundenstart, nicht erst nach Stundenende
    //   - Auf /meine + admin/yogis/[id]
  })

  test.fixme('Einzelstunden-Card auf /meine zeigt korrekten Badge ab Stundenstart', async () => {
    // Setup: Yogi hat Einzelstundenbuchung für heute 19:00 (jetzt 19:30).
    // Erwartung: Badge "Teilgenommen"
  })
})

// ── 5) Ersatztermin-Link auf abgesagter Stunde ─────────────────────────────
test.describe('[E2E] Neu: Abgesagte Stunde verlinkt Ersatztermin', () => {
  test.fixme('admin/sessions/[id] Cancel mit Ersatztermin → sessions.replacement_session_id wird gesetzt', async () => {
    // Aktion: Admin sagt Session ab + hakt "Ersatztermin anbieten" mit Datum/Uhrzeit an
    // Erwartung:
    //   - sessions.replacement_session_id der Original-Session = newSession.id
    //   - newSession ist eigene Session-Zeile (gleicher course_id, is_cancelled=false)
  })

  test.fixme('admin/sessions/[id] Cancel ohne Ersatz → nachträglich Ersatztermin anlegen setzt replacement_session_id', async () => {
    // Setup: Session zuerst abgesagt OHNE Ersatztermin.
    // Aktion: Admin öffnet abgesagte Session, klickt "Ersatztermin nachträglich anlegen", Datum+Uhrzeit, "Ersatztermin anlegen".
    // Erwartung:
    //   - sessions.replacement_session_id der Original-Session wird jetzt gesetzt (vorher Bug: NULL geblieben)
    //   - Alle stornierten Yogis bekommen "Ersatztermin"-Email
  })

  test.fixme('Yogi öffnet abgesagte Stunde mit Ersatz → "Zur Ersatzstunde am DATUM" Button sichtbar', async () => {
    // Setup: Session abgesagt, replacement_session_id verlinkt zu zukünftiger Session.
    // Aktion: Yogi geht auf /kurse/[id] der abgesagten Stunde.
    // Erwartung:
    //   - "Diese Stunde wurde abgesagt" Block sichtbar
    //   - Button "Zur Ersatzstunde am [Datum] · [Uhrzeit]" sichtbar
    //   - Klick → navigiert zu /kurse/[replacement-id]
  })

  test.fixme('Admin öffnet abgesagte Stunde mit Ersatz → Link statt "nachträglich anlegen"', async () => {
    // Erwartung:
    //   - "Zur Ersatzstunde: [Datum] · [Uhrzeit]" Button sichtbar (btn-primary)
    //   - "Ersatztermin nachträglich anlegen" Button NICHT mehr sichtbar (verbergt, wenn replacement schon vorhanden)
  })

  test.fixme('Replacement-Session selbst auch abgesagt → KEIN Link mehr angezeigt', async () => {
    // Edge-Case: Original abgesagt, Ersatz abgesagt.
    // Erwartung: Yogi/Admin sehen nur "Stunde abgesagt", kein "Zur Ersatzstunde"-Link
  })
})

// ── 6) Ersatztermin-Email kennzeichnen ─────────────────────────────────────
test.describe('[E2E] Neu: Ersatztermin-Email subject + body', () => {
  test.fixme('Email-Subject enthält Original-Datum + Kursname', async () => {
    // Aktion: Admin legt Ersatztermin nachträglich für eine abgesagte Stunde an, originalDate=2026-06-08.
    // Erwartung: Subject = "Ersatztermin für deine abgesagte Stunde am 8. Juni – KURSNAME"
    // (vorher: nur "Neuer Ersatztermin: KURSNAME")
  })

  test.fixme('Email-Body zeigt Original-Stunde (rot) + neue Stunde (grün)', async () => {
    // Erwartung im HTML:
    //   - Highlight-Block rot mit "Ursprüngliche Stunde (abgesagt):" + Original-Datum/Zeit
    //   - Highlight-Block grün mit "Neuer Ersatztermin:" + neues Datum/Zeit
    //   - Text "✅ Du wurdest automatisch eingetragen..."
  })
})

// ── 7) Guthaben-Card UI auf /meine ─────────────────────────────────────────
test.describe('[E2E] Neu: Guthaben-Card Styling', () => {
  test.fixme('Hinweistext "Nicht für Einzelstunden..." ist NICHT kursiv', async () => {
    // Setup: Yogi hat Guthaben mit free > 0.
    // Aktion: /meine öffnen.
    // Erwartung:
    //   - Text "Nicht für Einzelstunden, nur verrechenbar mit neuem Kurs" sichtbar
    //   - CSS: Element hat KEINE 'italic' Klasse (font-style: normal)
  })

  test.fixme('Bei Guthaben-Credits keine "x/X genutzt"-Anzeige + Balken rechts', async () => {
    // Setup: Yogi hat Guthaben.
    // Erwartung:
    //   - Rechte Spalte mit "{used}/{total} genutzt" Text NICHT vorhanden bei Guthaben-Cards
    //   - Progress-Bar rechts NICHT vorhanden
    //   - Bei NON-Guthaben (course/tenpack/single) IST die Anzeige vorhanden
  })
})

// ── 10) WIEDERKEHRENDER BUG: Edit-Modus setzt cancel_reason='excluded' ──────
test.describe('[E2E] admin/kurse Edit-Modus speichert excluded Sessions korrekt', () => {
  test.fixme('Kurs anlegen, dann bearbeiten + neues exclude-Date hinzufügen → cancel_reason="excluded" gesetzt', async () => {
    // 1) Neuer Kurs angelegt
    // 2) Edit → eine Stunde excluded
    // 3) DB-Check: sessions.is_cancelled=true UND cancel_reason='excluded' (NICHT NULL)
    // Vorher-Bug: Z.252-258 setzte nur is_cancelled, cancel_reason blieb NULL
    //             → /meine zeigte Session als "Abgesagt" statt sie auszublenden
  })

  test.fixme('Yogi-Übersicht /meine: excluded Sessions tauchen NIE auf', async () => {
    // Setup: Yogi in Kurs mit 1 excluded session
    // Erwartung: visibleSessions-Filter (isExcluded) blendet sie aus
    // KEIN "Abgesagt"-Badge für die ausgeschlossene Stunde
  })

  test.fixme('Excluded Session: 0 bookings, kein Yogi je drauf', async () => {
    // Verhindert dass excluded sessions als "Abgesagt" angelegt werden
    // mit ausstehenden Bookings die später Probleme machen
  })
})

// ── 9) Überbuchung sichtbar in admin/kurse Teilnehmer-Counter ──────────────
test.describe('[E2E] Neu: admin/kurse Teilnehmer-Counter zeigt Überbuchung', () => {
  test.fixme('Kurs max_spots=1, 2 Yogis eingebucht → Anzeige "2/1 · überbucht" (rot)', async () => {
    // Setup: Kurs mit max_spots=1, 1 Yogi via enrollment, 2. Yogi via admin/sessions/[id] (Drop-in)
    // Erwartung in /admin/kurse:
    //   - Teilnehmer-Zeile zeigt "2/1"
    //   - "2" ist rot (text-yoga-red-text)
    //   - Suffix "· überbucht"
  })

  test.fixme('Normalfall ohne Überbuchung: keine rote Markierung', async () => {
    // max_spots=5, 3 Yogis → "3/5", schwarz, kein überbucht-Label
  })

  test.fixme('Counter nutzt max-Belegung über Sessions, nicht enrollment-count', async () => {
    // 1 enrollment + 1 Drop-in via session = 2 Buchungen → Counter zeigt 2
    // Vorher-Bug: enrollments.length zählte Drop-in NICHT
  })
})

// ── 8) Course-Credit "frei" zeigt upcoming statt total-used ────────────────
test.describe('[E2E] Neu: Course-Credit free = upcoming aktive Buchungen', () => {
  test.fixme('Direkt nach Einbuchung in 6-Stunden-Kurs: free = 6 (nicht 0)', async () => {
    // Setup: Yogi frisch in Kurs eingebucht (6 active future bookings, alle linked).
    // Erwartung auf admin/yogis/[id]:
    //   - "Freie Credits" Tile = 6 (nicht 0)
    //   - Credit-Detail: "6 von 6 Credits frei" (nicht "0 von 6")
    //   - Auf /meine: große Zahl = 6, "0 / 6 genutzt"
  })

  test.fixme('Nach 1 absolvierter Stunde: free = 5, used-display = 1', async () => {
    // Setup: 6 bookings linked, 1 Session vergangen+aktiv.
    // Erwartung: free=5, attended=1, "1 / 6 genutzt" in /meine
  })

  test.fixme('Tenpack-Credits behalten DB-Semantik (used = allokiert)', async () => {
    // Setup: Yogi mit Tenpack(10), 5 future bookings, 0 attended.
    // Erwartung:
    //   - tenpack.used = 5 (DB-Trigger zählt active bookings)
    //   - Display: "5" free (10-5), "5/10 genutzt"
    //   - Buchungs-Constraint c.total > c.used funktioniert weiter (Tenpack-Limit greift)
  })
})
