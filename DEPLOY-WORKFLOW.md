# Sicherer Änderungs- & Deploy-Workflow (ab Go-Live)

> Ziel: Nach dem Live-Gang gibt es **keine Tests** und **keine Experimente** mehr direkt
> auf Produktion. Jede Änderung wird erst auf **Staging** gebaut & getestet und erst nach
> grünem Test + OK von Sarah auf **Produktion** ausgerollt.

---

## Die zwei Welten

| | **STAGING** (Test/Probieren) | **PRODUKTION** (Live) |
|---|---|---|
| Supabase-Projekt | `yoga-staging` (`bbzfcidmyyiodirtbowq`) | `yoga_booking_application` (`jcczvyablgdijeiyymhc`) |
| App-URL | Vercel-Preview (pro Branch eine eigene URL) | `kurse.yogamitsarah.me` |
| Daten | Wegwerf-Testdaten, Test-Yogis | Echte Yogis, echte Buchungen |
| Tests | **Hier laufen ALLE E2E-Tests** | **NIE Tests, nie Experimente** |
| Migrationen | Erst hier ausprobieren | Erst nach grünem Test |

---

## Der Ablauf für JEDE Änderung

1. **Branch anlegen** (nie direkt auf `main`):
   `git checkout -b aenderung-xyz`
   → Vercel erzeugt automatisch eine **Preview-URL** für diesen Branch.

2. **Änderung bauen** (Code und/oder DB-Migration als Datei unter `supabase/migrations/`).

3. **Auf Staging testen:**
   - DB-Migration zuerst **auf Staging** anwenden (nicht Prod).
   - E2E-Suite gegen Staging laufen lassen (`.env.test` zeigt auf Staging).
   - Preview-URL im Browser durchklicken.

4. **Grün + OK von Sarah** → **Merge nach `main`**:
   `git checkout main && git merge aenderung-xyz && git push`
   → Vercel deployt Produktion automatisch.

5. **Dieselbe Migration auf Produktion** anwenden (über das geprüfte Migrations-File).

6. Fertig. Prod wurde nur mit **bereits getestetem** Code/Schema verändert.

---

## Die 5 eisernen Regeln

1. **Keine E2E-Tests gegen Prod.** Abgesichert durch die harte Sperre in
   `tests/fixtures/global-setup.ts` (`assertNotProduction`) — ein Testlauf gegen Prod
   bricht sofort ab, **bevor** etwas angelegt/gelöscht wird.
2. **Jede Schema-Änderung = ein Migrations-File** unter `supabase/migrations/` —
   nie „mal eben" direkt in der DB klicken. So ist jede Änderung nachvollziehbar und
   auf Staging UND Prod identisch anwendbar.
3. **Reihenfolge immer Staging → Prod**, nie umgekehrt.
4. **Edge Functions** (E-Mail-Versand) werden ebenfalls erst auf einem Test-Projekt
   geprüft, dann auf Prod deployt. `verify_jwt` bleibt **immer** `true`.
5. **Secrets** (Keys, Passwörter) niemals committen. Echte `.env`-Dateien bleiben lokal.

---

## Setup-Status (Stand: 31.05.2026 — ABGESCHLOSSEN ✅)

- [x] **Prod-Schutzsperre** für E2E-Tests (live, verifiziert).
- [x] **Staging-Supabase-Projekt** `yoga-staging` angelegt (Free-Tier, 0 €).
- [x] **Staging-Schema** = Prod-Schema — verifiziert identisch:
      17 Tabellen · 49 Funktionen · 14 Trigger · 43 RLS-Policies · 25 FKs.
- [x] **`.env.test`** zeigt auf Staging (alte Prod-Version → `.env.test.prod-backup`).
- [x] **Smoke-Test grün**: `01-auth.spec.ts` 6/6 gegen Staging bestanden (31.05.).
- [ ] **Vercel Preview-Env-Variablen** — OPTIONAL (nur fürs manuelle Durchklicken
      einer Preview-URL; für automatische E2E NICHT nötig, siehe unten).

### So testest du eine Änderung auf Staging (der normale Ablauf)

```bash
# Terminal 1 — App gegen Staging starten (erzwingt Staging, sperrt Prod):
npm run dev:staging

# Terminal 2 — sobald "Ready" steht: E2E-Suite gegen Staging:
npx playwright test                         # alles
npx playwright test tests/e2e/02-booking.spec.ts   # einzelne Datei
```

`npm run dev:staging` liest die Staging-Verbindung aus `.env.test` und startet den
Server damit (statt der Prod-Werte aus `.env.local`). Die Tests selbst nutzen
ebenfalls `.env.test` (Staging) — beide Seiten zeigen also auf die Test-DB.

### Wie das Staging-Schema befüllt wurde (einmalig, erledigt)

Das vollständige Prod-Schema liegt als `supabase/baseline-schema.sql` im Repo
(per `pg_dump`/Extraktion erzeugt, 17 Tabellen + alle Funktionen/Trigger/RLS).
Eingespielt wurde es **byte-genau über den Supabase-SQL-Editor** des Staging-Projekts
(Datei-Inhalt einfügen → Run). Bei einem **Reset** von Staging einfach erneut so
einspielen. Alternativ per CLI: `npx supabase db push` (braucht Access-Token + DB-Passwort).

### Vercel Preview-Variablen (OPTIONAL — nur falls Preview-URLs gegen Staging laufen sollen)

Project → Settings → Environment Variables → für **Preview** (nicht Production!):
- `NEXT_PUBLIC_SUPABASE_URL` = Staging-URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = Staging-anon-key
- `SUPABASE_SERVICE_ROLE_KEY` = Staging-service-role-key

(Production-Variablen bleiben unverändert auf Prod.)

---

## Notnagel (nur in echten Notfällen)

Wenn ein Test bewusst gegen Prod laufen MUSS (extrem selten, nur lesend):
`ALLOW_PROD_E2E=JA-ICH-WEISS-WAS-ICH-TUE` setzen. Standardmäßig blockiert die Sperre alles.
