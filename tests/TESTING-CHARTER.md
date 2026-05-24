# Test-Strategie: Systemische End-to-End-Konsistenz

**Sarah-Direktive 2026-05-24** — verbindlich für alle neuen und überarbeiteten Tests.

## Kernverschiebung

| Vorher | Jetzt |
|---|---|
| „Funktioniert dieser Step?" | „Ist der komplette Systemzustand nach diesem Workflow logisch korrekt?" |
| „Button funktioniert" | „Alle abhängigen Konsequenzen sind eingetreten und konsistent" |
| „Buchung wurde erstellt" | „Buchung + Credit + Email + Counter + Yogi-Sicht + Admin-Sicht stimmen überein" |
| Isolierte Workflow-Tests | Cross-System Konsistenz-Tests |

## Vor jedem neuen Test: 5 Fragen

1. **Welche Tabellen** ändert der Workflow direkt?
2. **Welche Folge-Tabellen** sind via Trigger / FK-Cascade / App-Logik betroffen?
3. **Welche UI-Sichten** zeigen den Zustand (Yogi + Admin getrennt)?
4. **Wird eine Email** gesendet? (Welcher Template-Branch?)
5. **Welche Folgeaktionen** sollten danach möglich / unmöglich werden?

Jeder neue Test deckt mindestens **3 dieser 5 Dimensionen** ab.

## Checkliste pro Workflow

```
[ ] DB-Zustände aller berührten Tabellen geprüft
[ ] credit.used (via trg_sync_credit_used) konsistent zu bookings
[ ] Yogi-Sicht-Konsistenz (/meine, /kurse, /profil)
[ ] Admin-Sicht-Konsistenz (/admin/yogis/[id], /admin/sessions/[id], /admin/protokoll)
[ ] Email-Versand verifiziert (Helper-Aufruf oder Mailtrap)
[ ] audit_log-Eintrag geprüft (wenn relevant)
[ ] Folgeaktion getestet (Re-Buchung, Re-Cancel, Reaktivierung etc.)
[ ] Negative Assertion (keine Ghost-Credits, keine doppelten Rows, keine verwaisten FK)
[ ] Cross-View: Yogi-Sicht == Admin-Sicht == DB-Wahrheit
```

## Typische Fehlerklassen die wir explizit verhindern

| Fehlerklasse | Wo es früher passiert ist |
|---|---|
| **Ghost-Credit** | Booking gelöscht aber credit.used nicht reduziert |
| **Doppel-Booking** | Race auf UNIQUE-Constraint user_id+session_id+active |
| **Doppel-Refund** | Yogi cancelt + Admin cancelt parallel → credit -2 |
| **Counter-Drift** | Admin sieht 4/7, Yogi sieht 4/6 |
| **Stale Enrollment** | Yogi gelöscht aber enrollment row bleibt |
| **TZ-Bug** | UTC-Vergleich auf time_start statt Europe/Berlin |
| **Stale Email-State** | Email sagt "abgemeldet" aber DB hat status='active' |
| **Verwaiste Plätze** | Yogi gelöscht aber bookings.status='active' bleibt → Platz besetzt |

## Bestehende systemische Specs

| Spec | Was es deckt |
|---|---|
| **26-credit-konsistenz** | DB-Trigger `trg_sync_credit_used` + Yogi/Admin/DB-Konsistenz |
| **33-system-konsistenz** | Komplette Workflow-Lifecycles (Buchung→Cancel→Re-Buchung etc.) |
| 18-kursabbruch-token | Kurs-Abbruch Yogi-Wahl-Flow |
| 19-notify-email-flow | Notify-Place-Free Email-Workflow |
| 25-vorhol-nachhol | Vorhol-/Nachhol mit origin_session_id |

## Wann „shallow" akzeptabel ist

Source-Smokes (Code-Inhalt-Checks) sind OK für:
- Label/Text-Drift-Detection (kürzere Tests, schnell)
- API-Existenz (Helper-Funktionen exportiert)
- Konfigurations-Werte (Versions-Strings, Cache-Keys)

**NICHT** akzeptabel für Workflows die DB-State ändern — dort muss DB-Verifikation laufen.

## Wann „UI-E2E" akzeptabel ist

- Login/AGB/Onboarding-Flows (auth-state-abhängig)
- Confirm-Dialoge / Modal-Interaktionen
- Visuelle Drift-Detection auf kritischen Pages

**NICHT** als primärer Beweis für State-Konsistenz — dafür immer DB-Verifikation zusätzlich.

## Verbindlich ab jetzt

Jeder neue Feature-Test der eine Daten-Mutation auslöst, muss:
1. Die DB-Tabellen direkt prüfen (Service-Client)
2. Mindestens eine zweite Dimension validieren (Email-Helper-Call, Audit-Log, oder Counter)
3. Negative Assertion enthalten (es sollte X NICHT mehr/doppelt geben)

Bei Reviews fragen wir: *„Würde dieser Test einen Ghost-Credit fangen?"*
