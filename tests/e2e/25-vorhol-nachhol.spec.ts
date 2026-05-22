/**
 * Workflow: Vorhol-/Nachhol-Buchungen (Sarah-Regel 2026-05-22)
 *
 * NEUE BUSINESS-LOGIK:
 * - Course-Credits werden vor Single/Tenpack/Quartal aufgebraucht
 * - Origin-Verknüpfung: jede Vorhol/Nachhol-Buchung wird via
 *   bookings.origin_session_id an die abgesagte Stunde gebunden
 * - 10-Tage-Pre-Window für Vorholen, 8-Tage-Post-Kursende für Nachholen
 * - Minutengenau (nicht tagebasiert)
 * - Bei Kursabbruch: Cascade-Stornierung zukünftiger Ersatz-Buchungen
 *
 * Alle Tests sind aktuell test.fixme — werden beim nächsten Test-Run aktiviert.
 */
import { test, expect } from '@playwright/test'

test.describe('Vorhol-/Nachhol-Logik', () => {
  test.fixme('[E2E] Yogi sagt Stunde in 14 Tagen ab, will Stunde morgen buchen → blockiert', async () => {
    // Setup: Yogi enrolled, alle Range-Stunden gebucht, sagt Stunde in 14 Tagen ab
    // Action: versucht Stunde morgen zu buchen
    // Erwartet: Alert "Vorholen ist frühestens 10 Tage vor dem Termin möglich.
    //           Du kannst diese Buchung ab [Datum +4 Tagen] mit deinem Kurs-Credit machen."
    // DB-Check: keine neue Booking entstanden
  })

  test.fixme('[E2E] Yogi sagt Stunde in 8 Tagen ab, will Stunde morgen buchen → erlaubt mit Origin', async () => {
    // Setup wie oben aber Origin in 8 Tagen
    // Action: bucht Stunde morgen
    // Erwartet: Booking entsteht mit origin_session_id = Origin-Session
    // UI: "Vorhol/Nachhol — Ersatz für [Datum]" Marker in /meine
  })

  test.fixme('[E2E] Course-Credit wird VOR Punktekarte aufgebraucht', async () => {
    // Setup: Yogi hat Course-Credit (1 frei nach Cancel) + Tenpack-Credit (5 frei)
    // Action: bucht eine Stunde im 10d-Fenster
    // Erwartet: Course-Credit wird verwendet (origin gesetzt), Tenpack unangetastet
  })

  test.fixme('[E2E] Course-Credit-Fenster verletzt → Fallback auf Punktekarte', async () => {
    // Setup: Yogi hat Course-Credit (Origin in 14 Tagen) + Tenpack-Credit (5 frei)
    // Action: bucht eine Stunde morgen
    // Erwartet: Tenpack wird verwendet (Course-Credit-Fenster passt nicht)
    // Origin bleibt NULL bei dieser Booking, kein Hinweis
  })

  test.fixme('[E2E] Kein Course-Credit + keine Punktekarte → klare Fehlermeldung', async () => {
    // Setup: Yogi hat nur Guthaben-Credit (kein course/single/tenpack)
    // Action: versucht Drop-In zu buchen
    // Erwartet: "Du hast keinen freien Credit für diese Buchung."
  })

  test.fixme('[E2E] Minutengenauer Window-Check', async () => {
    // Setup: Origin am Tag X um 20:30, Yogi versucht (X - 10d) um 20:29 zu buchen → blockiert
    // Setup: Yogi versucht (X - 10d) um 20:30 zu buchen → erlaubt
    // Setup: Yogi versucht (X - 10d) um 20:31 zu buchen → erlaubt
  })

  test.fixme('[E2E] Nachholen: Stunde nach Kursende+8 → blockiert', async () => {
    // Setup: Kurs date_end = X, Origin in der Vergangenheit
    // Action: versucht Stunde am X+9 zu buchen
    // Erwartet: "Nachholen ist max. 8 Tage nach Kursende möglich"
  })

  test.fixme('[E2E] FIFO: ältere abgesagte Stunde ist Anker, nicht spätere', async () => {
    // Setup: Yogi hat 2 cancelled bookings (in 8 + 20 Tagen)
    // Action: bucht eine Stunde in 7 Tagen
    // Erwartet: Origin = die 8-Tage-Stunde (früher), nicht die 20-Tage-Stunde
    // Plus: zweite Buchung mit gleichem Credit → Anspruch der 8-Tage-Stunde ist verbraucht,
    //       Anspruch der 20-Tage-Stunde wird angeboten (aber muss in 10d-Window passen)
  })

  test.fixme('[E2E] Kursabbruch storniert zukünftige Vorhol-Buchungen kaskadiert', async () => {
    // Setup:
    //   Yogi enrolled in Kurs A, sagt Stunde Woche 6 ab
    //   Bucht Vorhol-Stunde in Woche 5 (origin_session_id = Woche 6)
    // Action: Admin bricht Kurs A in Woche 4 komplett ab
    // Erwartet:
    //   Booking Woche 5 wird automatisch storniert
    //   Yogi bekommt Email "Diese Stunde war Ersatz für eine abgesagte..."
    //   audit_log Eintrag "cascade_replacement_cancelled"
  })

  test.fixme('[E2E] Kursabbruch: bereits besuchte Vorhol-Stunde bleibt bestehen', async () => {
    // Setup: Yogi hat Vorhol-Stunde besucht (date < heute, status=active)
    // Action: Origin-Kurs wird abgebrochen
    // Erwartet: Vorhol-Booking bleibt unverändert (date < heute → kein Storno)
  })
})

test.describe('Smart Credit-Picker im Admin-Pfad', () => {
  test.fixme('[E2E] Admin bucht Yogi 11 Tage vorher in eine Stunde → Confirm-Dialog Quick-Credit', async () => {
    // Setup: Yogi mit Course-Credit (Origin 11 Tage entfernt), keine Punktekarte
    // Action: Admin klickt im Dashboard Modal "Yogi hinzufügen"
    // Erwartet: confirm-Dialog "Vorholen ist frühestens... Quick-Credit anlegen?"
    // Admin OK → neue single-Credit + Booking
    // Admin Abbruch → kein Eintrag
  })

  test.fixme('[E2E] Admin-Pfad: gleicher Helper wie Yogi-Selbstbuchung', async () => {
    // Stellen wir sicher dass admin/dashboard addYogi UND admin/sessions/[id] handleAddYogi
    // beide selectCreditForBooking nutzen
  })
})

test.describe('Einladung-Sperre nach Löschen', () => {
  test.fixme('[E2E] Admin löscht Einladung → Link führt zu "Einladung abgelaufen"', async () => {
    // Setup: Admin schickt Einladung an wrong@email.com
    // Action: Admin klickt in /admin/einladungen "Löschen"
    // Action: wrong@-User klickt den Link
    // Erwartet: /register zeigt "Einladung ist abgelaufen. Bitte wende dich an Sarah."
    // DB-Check: invitation.expires_at < now (soft-delete)
    // UI-Check: Einladung erscheint nicht mehr in Admin-Liste (ausgeblendet)
  })

  test.fixme('[E2E] Gelöschte Einladung blockiert Account-Erstellung', async () => {
    // Plus: stellt sicher dass auch der signUp-Aufruf failt wenn der Link nicht mehr gilt
  })
})

test.describe('Tagesänderungen: weitere E2E', () => {
  test.fixme('[E2E] Reminder-Cron berücksichtigt Berlin-Zeitzone (DST + STD)', async () => {
    // Setup: Stunde um 15:30 lokal, Reminder=4h, jetzt 11:30 lokal
    // Erwartet: nächster Cron-Run versendet Email (Berlin-Time-aware)
  })

  test.fixme('[E2E] Passwort-Reset Link funktioniert (PKCE-Flow)', async () => {
    // Setup: User klickt Reset-Link in Email
    // Erwartet: /profil/passwort empfängt ?code=..., tauscht via exchangeCodeForSession
    // Action: gibt neues Passwort ein → updateUser ok, kein "Session abgelaufen"
  })

  test.fixme('[E2E] Doppel-Anzeige in /meine — enrolled Drop-In nicht doppelt', async () => {
    // Setup: Yogi enrolled in Kurs A, bucht type=single in Session des Kurses A
    // Erwartet: Booking erscheint NUR im Kurs-Block, NICHT auch in "Einzelstunden"
  })

  test.fixme('[E2E] Kursabbruch + Erstattung: verrechnetes Guthaben verschwindet', async () => {
    // Setup: Yogi hat Altguthaben 2/0, Admin addet zu Kurs → 1 verrechnet
    // Action: Kurs absagen → Yogi wählt Erstattung
    // Erwartet: guthaben.total reduziert um 1 (verrechnetes weg, da Geld kommt)
    //           Provisional-Credit (für neu bezahlte Anteile) gelöscht
  })

  test.fixme('[E2E] Kursabbruch + Guthaben behalten: kein Doppel-Count', async () => {
    // Yogi behält exakt soviel Credits wie vor dem Kursabbruch
    // (kein zusätzlicher Bonus durch Trigger-Refund + neuer Insert)
  })

  test.fixme('[E2E] Provisorisches Guthaben sofort sichtbar nach Kursabbruch', async () => {
    // Setup: Admin sagt Kurs ab mit refund_mode='yogi_choice'
    // Erwartet: Yogi sieht in /meine bereits "X Credits Guthaben" während Wahlfrist
    //           (provisional_credit_id wird beim Cancel angelegt)
  })

  test.fixme('[E2E] Replacement-Konvention: replacement_session_id zeigt von ABGESAGT auf ERSATZ', async () => {
    // Setup: Admin sagt Stunde X ab, legt Ersatzstunde Y an
    // DB-Check: Session X hat replacement_session_id = Y.id
    // UI-Check: in /admin/kurse Termine erscheint Y als "Ersatzstunde (für X)"
    //           und Yogi-Detail zeigt für Y "Vorhol/Nachhol — Ersatz für X"
  })

  test.fixme('[E2E] Course-Credit Filter: nur eigener Kurs in Admin-Aggregation', async () => {
    // Setup: Yogi hat Booking mit credit_id=X aber session.course_id != credit.course_id
    // Erwartet: Admin-Aggregation zählt diese Booking nicht (verhindert "3/7"-Bug)
  })

  test.fixme('[E2E] Mid-Course-Hinweis im Admin-Yogi-Detail', async () => {
    // Setup: Yogi enrolled mid-course (erste Session > Kursstart)
    // Erwartet: Card zeigt "Eingestiegen ab DD.MM.YYYY · X Credits"
  })
})
