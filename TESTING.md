# End-to-End Tests – Setup-Anleitung

Diese Anleitung erklärt Schritt für Schritt, wie du das automatische Testsystem einrichtest und ausführst.

---

## Was testen die Tests?

Die Tests prüfen automatisch, ob alle wichtigen Funktionen deiner App funktionieren:

| Test-Datei | Was wird getestet |
|---|---|
| `01-auth.spec.ts` | Login, falsches Passwort, Logout, geschützte Seiten |
| `02-booking.spec.ts` | Stunde buchen, Stornierung mit Credit-Rückgabe |
| `03-waitlist.spec.ts` | Warteliste, Nachrücken, Benachrichtigung |
| `04-admin-kurse.spec.ts` | Admin: Kurs anlegen, Stunde absagen, Archivieren, Rollover |
| `05-admin-yogis.spec.ts` | Admin: Yogi einladen, E-Mail-Versand |
| `06-meine.spec.ts` | "Meine Stunden": Credits, Kursnamen, Ausschlüsse |

---

## Einmalige Einrichtung

### Schritt 1: Zweites Supabase-Projekt erstellen (Test-Datenbank)

> **Wichtig:** Tests dürfen NICHT auf deiner Live-Datenbank laufen, da sie Testdaten anlegen und wieder löschen.

1. Gehe zu [supabase.com](https://supabase.com) und logge dich ein
2. Klicke auf **"New project"**
3. Name: z.B. `yoga-mit-sarah-test`
4. Passwort: beliebig (merken oder notieren)
5. Region: Europe (Frankfurt)
6. Warte bis das Projekt bereit ist
7. Gehe zu **Settings → API**
8. Notiere dir:
   - **Project URL** (z.B. `https://xxxxx.supabase.co`)
   - **service_role key** (unter "Project API keys" → der lange Schlüssel mit "service_role")
9. Führe das gleiche Datenbankschema aus wie im Live-Projekt (alle Migrationen aus `supabase/migrations/`)

### Schritt 2: Mailtrap-Konto erstellen (für E-Mail-Tests)

> Mailtrap ist kostenlos und fängt Test-E-Mails ab, ohne sie wirklich zu verschicken.

1. Gehe zu [mailtrap.io](https://mailtrap.io) und erstelle ein kostenloses Konto
2. Klicke auf **"Email Testing" → "Inboxes"**
3. Öffne deine Standard-Inbox
4. Gehe zu **"SMTP/API Settings"** und wähle **"API"**
5. Notiere dir den **API Token**
6. Notiere die **Inbox ID** (steht in der URL: `/inboxes/12345/...`)

### Schritt 3: `.env.test` Datei anlegen

1. Kopiere die Beispieldatei:
   ```
   copy .env.test.example .env.test
   ```
2. Öffne `.env.test` in einem Texteditor und fülle alle Felder aus:

```
# URL deiner Live-App
BASE_URL=https://kurse.yogamitsarah.me

# TEST-Supabase-Projekt (NICHT das Live-Projekt!)
SUPABASE_URL=https://dein-test-projekt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...dein-service-role-key...

# Test-Benutzer (werden automatisch angelegt)
TEST_ADMIN_EMAIL=test.admin@yogamitsarah.me
TEST_ADMIN_PASSWORD=TestAdmin2024!
TEST_YOGI1_EMAIL=test.yogi1@yogamitsarah.me
TEST_YOGI1_PASSWORD=TestYogi2024!
TEST_YOGI2_EMAIL=test.yogi2@yogamitsarah.me
TEST_YOGI2_PASSWORD=TestYogi2024!

# Mailtrap (optional – nur für E-Mail-Tests)
MAILTRAP_API_TOKEN=dein-mailtrap-token
MAILTRAP_INBOX_ID=12345
```

### Schritt 4: Playwright und Abhängigkeiten installieren

Öffne ein Terminal im Projektordner und führe aus:

```bash
npm install
npx playwright install chromium
```

### Schritt 5: Test-Nutzer anlegen (einmalig)

```bash
npm run test:setup
```

Das legt automatisch 3 Test-Benutzer in deiner Test-Datenbank an:
- `test.admin@yogamitsarah.me` (Admin)
- `test.yogi1@yogamitsarah.me` (normaler Yogi)
- `test.yogi2@yogamitsarah.me` (normaler Yogi)

---

## Tests ausführen

### Alle Tests auf einmal

```bash
npm run test:e2e
```

### Mit visueller Oberfläche (empfohlen zum ersten Mal)

```bash
npm run test:e2e:ui
```

Das öffnet ein Fenster, in dem du siehst, welche Tests laufen und was sie tun.

### Nur bestimmte Tests

```bash
npm run test:e2e:auth      # Nur Login-Tests
npm run test:e2e:booking   # Nur Buchungs-Tests
npm run test:e2e:admin     # Nur Admin-Tests
npm run test:e2e:meine     # Nur "Meine Stunden"-Tests
```

### Tests im Browser beobachten (zum Debuggen)

```bash
npm run test:e2e:headed
```

---

## Testergebnisse lesen

Nach dem Testlauf erscheint im Terminal eine Zusammenfassung:

```
✓ 01-auth.spec.ts › Login mit richtigen Daten funktioniert
✓ 02-booking.spec.ts › Stunde buchen → Buchung in DB
✗ 03-waitlist.spec.ts › Yogi1 meldet sich ab → Yogi2 rückt nach
```

Ein HTML-Bericht wird automatisch unter `playwright-report/index.html` gespeichert.  
Öffne diese Datei im Browser für eine detaillierte Übersicht mit Screenshots.

---

## Testdaten aufräumen

Falls du die Testdaten in der Test-Datenbank löschen möchtest:

```bash
npm run test:cleanup
```

Das löscht alle Kurse, Sessions, Buchungen etc., die während der Tests angelegt wurden (erkennbar am `[E2E]`-Präfix).

---

## Häufige Probleme

| Problem | Lösung |
|---|---|
| `❌ Fehlende Umgebungsvariablen` | `.env.test` prüfen – alle Felder ausgefüllt? |
| `Error: connect ECONNREFUSED` | Supabase-URL in `.env.test` prüfen |
| `Test timeout` | Internetverbindung prüfen; Live-URL erreichbar? |
| `Authentication failed` | `npm run test:setup` erneut ausführen |
| E-Mail-Tests werden übersprungen | `MAILTRAP_API_TOKEN` in `.env.test` eintragen |

---

## Wichtige Hinweise

- Die Datei `.env.test` enthält geheime Schlüssel und wird **nicht** in Git gespeichert
- Tests laufen immer gegen die **Live-URL** deiner App, aber mit einer **separaten Test-Datenbank**
- Testdaten sind am Präfix `[E2E]` erkennbar und werden nach dem Testlauf automatisch gelöscht
- Führe `npm run test:setup` nur einmal aus – danach werden die Test-Nutzer beim nächsten Mal erkannt
