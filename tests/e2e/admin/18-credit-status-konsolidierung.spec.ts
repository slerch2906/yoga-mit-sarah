/**
 * Credit/Status-Workflow Konsolidierung (Commit bdf8edc, 21. Mai 2026)
 *
 * Alle Tests test.fixme — registriert aber nicht ausgeführt.
 * Hintergrund: "Guthaben Kurs"-Bug (Dropdown zeigt 13 statt 12 Credits)
 * → Komplette Konsolidierung des Session-Status-Modells in
 *   lib/session-status.ts (Single Source of Truth).
 *
 * Status-Modell:
 *   Aktiv:          is_cancelled=false                            → zählt, Credit
 *   Vergangen:      aktiv + date+time < now                       → zählt, Credit verbraucht
 *   Ausgeschlossen: is_cancelled=true, cancel_reason='excluded'   → zählt NICHT
 *   Abgesagt:       is_cancelled=true, cancel_reason!='excluded'  → zählt NICHT (Refund/Ersatz)
 */
import { test, expect } from '@playwright/test'

// ── 1) Unit-Helper: lib/session-status.ts ───────────────────────────────────
test.describe('[E2E] lib/session-status Helper', () => {
  test.fixme('isExcluded(): is_cancelled=true UND cancel_reason="excluded" → true', async () => {
    // Unit-Test ähnlich, eventuell in Playwright als Smoke.
    // {is_cancelled:true, cancel_reason:'excluded'} → true
    // {is_cancelled:true, cancel_reason:'Krankheit'} → false
    // {is_cancelled:false} → false
  })

  test.fixme('isCancelled(): is_cancelled=true UND cancel_reason!="excluded" → true', async () => {
    // {is_cancelled:true, cancel_reason:'Krankheit'} → true
    // {is_cancelled:true, cancel_reason:null} → true (legacy/historical data)
    // {is_cancelled:true, cancel_reason:'excluded'} → false
  })

  test.fixme('countActiveFutureUnits ignoriert excluded + cancelled + vergangene', async () => {
    // 13 Sessions: 1 excluded, 1 cancelled, 1 vergangen, 10 aktiv-future
    // → countActiveFutureUnits = 10
  })

  test.fixme('sessionStatusLabel liefert "Ausgeschlossen"/"Abgesagt"/"Vergangen"/"Aktiv"', async () => {
    // Deckt alle 4 Branches ab.
  })
})

// ── 2) Dropdown-Count (Ursprungs-Bug) ───────────────────────────────────────
test.describe('[E2E] admin/yogis/[id] Dropdown zeigt korrekte Credits', () => {
  test.fixme('Kurs mit 12 aktiv + 1 excluded → Dropdown "12 Credits", nicht 13', async () => {
    // Setup: createTestCourse mit 13 Sessions, 1 davon excluded
    // Aktion: admin/yogis/[id] öffnen, "In Kurs einbuchen", Dropdown öffnen
    // Erwartung: Option-Text enthält "→ 12 Credits", nicht "13"
  })

  test.fixme('Kurs mit 0 aktiv + 1 excluded → Dropdown "0 Credits"', async () => {
    // Edge case: Kurs hat nur einen excluded-Termin in der Zukunft
  })

  test.fixme('Vergangene aktive Stunden zählen NICHT im Dropdown', async () => {
    // Sessions: 3 vergangen-active, 5 future-active, 1 excluded
    // → Dropdown: "5 Credits" (nur future-active)
  })
})

// ── 3) admin/credits getRemainingUnits ──────────────────────────────────────
test.describe('[E2E] admin/credits Page filtert excluded raus', () => {
  test.fixme('Auto-Berechnung "course"-Credits ignoriert excluded Sessions', async () => {
    // /admin/credits?user=X, Modell "Kurs" wählen, Kurs mit 12+1 excluded
    // → amount = 12, nicht 13
  })

  test.fixme('getAutoExpiry nutzt letzte AKTIVE Session, nicht letzte überhaupt', async () => {
    // Wenn die letzte excluded-Session weiter in der Zukunft liegt als die
    // letzte aktive, soll expires_at die letzte aktive + 8 Tage sein.
  })
})

// ── 4) admin/kurse Termine-Liste: "Ausgeschlossen" vs "Abgesagt" ───────────
test.describe('[E2E] admin/kurse Termine-Anzeige', () => {
  test.fixme('Excluded-Session wird als "· Ausgeschlossen" angezeigt', async () => {
    // Setup: Kurs anlegen mit excludedDates Array.
    // Aktion: admin/kurse öffnen, Kurs-Karte "Termine" ausklappen.
    // Erwartung:
    //   - excluded Session zeigt suffix " · Ausgeschlossen"
    //   - Anzeige opacity-40 (ausgegraut)
  })

  test.fixme('Cancelled-Session (live abgesagt) wird als "· Abgesagt" angezeigt', async () => {
    // Setup: Session live cancellen via admin/sessions/[id] (cancel_reason!='excluded')
    // Erwartung: Suffix " · Abgesagt"
  })

  test.fixme('loadSessions lädt cancel_reason mit', async () => {
    // Regression: vorher fehlte cancel_reason im select, Anzeige war immer "Abgesagt".
    // Hier: prüfen dass DB-Query cancel_reason zurückliefert.
  })

  test.fixme('loadSessions ist nicht mehr doppelt definiert (TS-Error gefixt)', async () => {
    // Smoke: TypeScript-Build geht durch ohne TS2393 "Duplicate function implementation".
    // Optional: Playwright kann das testen indem das File-Build erfolgreich ist.
  })
})

// ── 5) replacement_session_id beim direkten Cancel ─────────────────────────
test.describe('[E2E] admin/sessions/[id] Cancel + Ersatz setzt replacement_session_id', () => {
  test.fixme('Direkter Cancel mit Ersatztermin verlinkt original.replacement_session_id', async () => {
    // Vorher-Bug: handleCancelSession setzte das Feld nicht (nur handleAddLateReplacement).
    // Aktion: admin/sessions/[id], "Stunde absagen" + "Ersatztermin anbieten" + Datum/Zeit
    // Erwartung:
    //   - sessions.is_cancelled = true
    //   - sessions.cancel_reason = reason || 'Abgesagt' (NICHT null)
    //   - sessions.replacement_session_id = newSession.id
    //   - newSession existiert mit gleichem course_id
    //   - Yogi-Detail-Seite zeigt "Zur Ersatzstunde" Button
  })

  test.fixme('Cancel ohne Ersatz setzt cancel_reason aber replacement_session_id=null', async () => {
    // sessions.is_cancelled=true, cancel_reason='Abgesagt' (oder eingegebener Grund)
    // sessions.replacement_session_id = null
    // → /kurse/[id] Yogi-Seite zeigt KEIN "Zur Ersatzstunde"-Button
  })

  test.fixme('Status-Label nutzt isExcluded(), nicht direkten String-Vergleich', async () => {
    // admin/sessions/[id] zeigt: "Diese Stunde ist ausgeschlossen" (grau) vs
    // "Diese Stunde ist bereits abgesagt" (rot) basierend auf isExcluded().
  })
})

// ── 6) /meine Status-Badge: Ausgeschlossen wird nicht durchgereicht ────────
test.describe('[E2E] /meine getStatusBadge unterscheidet alle 4 Status', () => {
  test.fixme('Excluded Sessions kommen gar nicht in die Anzeige (vorher gefiltert)', async () => {
    // Setup: Yogi in Kurs mit 1 excluded Session. Login als Yogi → /meine
    // Erwartung: excluded Datum ist NICHT in der Stunden-Liste
  })

  test.fixme('Cancelled Session zeigt Badge "Abgesagt" (rot)', async () => {
    // Aktion: Admin sagt Session live ab. Yogi auf /meine.
    // Erwartung: Badge "Abgesagt" mit rotem Style
  })

  test.fixme('Active future Session zeigt "Angemeldet", started Session "Teilgenommen"', async () => {
    // Combo-Test: zwei Sessions im gleichen Kurs.
    // - heute 18:30 (future, aktiv) → "Angemeldet"
    // - vor 30 Min gestartet → "Teilgenommen"
  })
})

// ── 7) /kurse/[id] Yogi-Detail: Excluded vs Cancelled Text ─────────────────
test.describe('[E2E] /kurse/[id] Excluded-Detail-Seite', () => {
  test.fixme('Direkter Aufruf einer excluded Session zeigt "ausgeschlossen", keinen Ersatz-Button', async () => {
    // Yogi navigiert per URL auf /kurse/[excluded-session-id]
    // Erwartung:
    //   - Headline "Diese Stunde ist ausgeschlossen"
    //   - Text "Die Stunde gehört nicht zum Kurs."
    //   - KEIN "Zur Ersatzstunde"-Button (auch wenn replacement_session_id gesetzt wäre)
  })

  test.fixme('Cancelled-Session ohne Ersatz: "abgesagt" + nur "Zurück"', async () => {
    // is_cancelled=true, cancel_reason='Krankheit', replacement_session_id=null
    // → "Diese Stunde wurde abgesagt", "Buchungen und Warteliste sind nicht möglich.", Zurück-Button
  })

  test.fixme('Cancelled mit Ersatz: "Zur Ersatzstunde am ..." Button sichtbar', async () => {
    // → Button mit Datum/Uhrzeit, Klick navigiert zu /kurse/[replacement-id]
  })
})

// ── 8) register/page: Filter is_cancelled=false beim Self-Enrollment ──────
test.describe('[E2E] /register filtert excluded/cancelled Sessions', () => {
  test.fixme('Yogi registriert sich via Invitation → keine Bookings für excluded Sessions', async () => {
    // Setup: Invitation für Kurs mit 6 aktiven + 1 excluded Sessions.
    // Aktion: Yogi öffnet Invite-Link, registriert sich.
    // Erwartung:
    //   - 6 bookings angelegt (NICHT 7)
    //   - KEIN bookings-Insert auf die excluded Session (Trigger prevent_booking_cancelled_session würde sonst feuern)
    //   - Credits.total = invitation.credits_to_assign (vom Admin festgelegt)
  })

  test.fixme('Expires_at basiert auf letzter aktiver Session, nicht letzter überhaupt', async () => {
    // Wenn letzte Session excluded ist, soll expires_at die vorletzte (aktive) + 8 Tage sein
    // → keine "verlängerte" Gültigkeit durch excluded
  })
})
