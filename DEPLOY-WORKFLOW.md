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

## Setup-Status (Stand: 31.05.2026)

- [x] **Prod-Schutzsperre** für E2E-Tests (live, verifiziert).
- [x] **Staging-Supabase-Projekt** `yoga-staging` angelegt (Free-Tier, 0 €).
- [ ] **Staging-Schema** = Prod-Schema (per `supabase db dump`, siehe unten).
- [ ] **`.env.staging`** + `.env.test` auf Staging zeigen lassen.
- [ ] **Vercel Preview-Env-Variablen** auf Staging zeigen lassen (macht Sarah, 1×).

### Staging-Schema sauber befüllen (einmalig)

Das vollständige Prod-Schema (Tabellen, Funktionen, Trigger, RLS) wird am
zuverlässigsten per Supabase-CLI übertragen:

```bash
# 1) CLI + Login (einmalig) — Access-Token aus supabase.com/dashboard/account/tokens
npx supabase login

# 2) Schema von Prod ziehen
npx supabase link --project-ref jcczvyablgdijeiyymhc
npx supabase db dump --schema public -f supabase/baseline-schema.sql

# 3) Schema auf Staging einspielen
npx supabase link --project-ref bbzfcidmyyiodirtbowq
npx supabase db push   # bzw. baseline-schema.sql + alle migrations anwenden
```

### Vercel Preview-Variablen (macht Sarah im Vercel-Dashboard)

Project → Settings → Environment Variables → für **Preview** (nicht Production!):
- `NEXT_PUBLIC_SUPABASE_URL` = Staging-URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = Staging-anon-key
- `SUPABASE_SERVICE_ROLE_KEY` = Staging-service-role-key

(Production-Variablen bleiben unverändert auf Prod.)

---

## Notnagel (nur in echten Notfällen)

Wenn ein Test bewusst gegen Prod laufen MUSS (extrem selten, nur lesend):
`ALLOW_PROD_E2E=JA-ICH-WEISS-WAS-ICH-TUE` setzen. Standardmäßig blockiert die Sperre alles.
