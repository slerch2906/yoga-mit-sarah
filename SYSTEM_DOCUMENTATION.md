# Yoga mit Sarah — System-Dokumentation

> **Single Source of Truth** für Entwickler, UX-Designer und Product Owner.
> Diese Datei beschreibt die reale, im Code implementierte Logik der Anwendung — mit echten
> Datei-, Funktions- und Variablennamen. Sie wurde durch systematisches Scannen der Codebase
> erstellt (nicht aus Annahmen).
>
> **Stand:** 2026-06-02 · **Projekt-Verzeichnis:** `C:\Users\Sarah\Desktop\yoga-app`
>
> _Letzte Aktualisierung 2026-06-02 (Live-Bugfixes, zentrale Hinweis-Persistenz, PWA-Update-Stabilität, Prozess: Staging-first) — siehe [Änderungshistorie](#änderungshistorie) am Ende._

---

## Inhaltsverzeichnis

1. [Tech-Stack & Architektur](#1-tech-stack--architektur)
2. [Rollen- & Rechtemodell](#2-rollen---rechtemodell)
3. [Kern-Geschäftslogiken & Fristen-Matrix](#3-kern-geschäftslogiken--fristen-matrix)
4. [End-to-End User Stories](#4-end-to-end-user-stories)
5. [DSGVO, Daten-Lebensdauer & Sicherheit](#5-dsgvo-daten-lebensdauer--sicherheit)
6. [Audit-Logging & Protokollierungs-Standard](#6-audit-logging--protokollierungs-standard)
7. [Konzept-Vorschlag: Automatische Löschung inaktiver Konten (24 Monate)](#7-konzept-vorschlag-automatische-löschung-inaktiver-konten-24-monate)

---

## 1. Tech-Stack & Architektur

### 1.1 Frontend

| Komponente | Technologie | Version |
|---|---|---|
| Framework | **Next.js** (App Router, PWA) | 15.5.18 |
| UI-Bibliothek | **React** | 19 |
| Sprache | **TypeScript** | — |
| Styling | **Tailwind CSS** (Custom-Theme `yoga-*`) | 3.4 |
| Icons | Tabler Icons (`ti ti-*`) | — |

Die App ist eine **Progressive Web App (PWA)** — sie ist mobil-first gebaut (durchgängig `max-w-md`/`max-w-sm` zentrierte Layouts) und über „Zum Startbildschirm hinzufügen" installierbar. Navigation erfolgt über eine `BottomNav` (Yogi) bzw. eine Sidebar (`app/admin/layout.tsx`, Admin).

### 1.2 Backend

Es gibt **kein separates Backend-Projekt**. Die Server-Logik verteilt sich auf drei Ebenen:

1. **Next.js API-Routes** (`app/api/**/route.ts`) — serverseitige Endpunkte, u. a.
   - `/api/email` — Proxy, der das Edge-Function-Geheimnis vor dem Client verbirgt
   - `/api/delete-account` — DSGVO-Löschung des Auth-Users (Admin-API)
   - `/api/kursabbruch/[token]` — speichert die Yogi-Wahl (Guthaben/Erstattung)
   - `/api/admin/bulk-mail` — Sammel-Mail an Yogis
2. **Supabase Postgres** mit **Row Level Security (RLS)** und **`SECURITY DEFINER`-RPC-Funktionen** für die sensible Geschäftslogik (Stornierung, Warteliste, Fristen-Trigger).
3. **Supabase Edge Functions** (Deno) — insbesondere `send-email` (Versand über Brevo).

### 1.3 Datenbank: Supabase Postgres

- **Projekt-ID:** `jcczvyablgdijeiyymhc` · **Region:** `eu-central-1` · **Engine:** PostgreSQL 17

#### Kern-Datenmodelle

| Tabelle | Rolle im System | Wichtige Spalten |
|---|---|---|
| **`profiles`** | Yogi **und** Admin (eine Tabelle, Unterscheidung per Flag) | `is_admin`, `first_name`, `last_name`, `email`, `birthdate`, `emergency_name`/`emergency_phone`, `notify_*` (Benachrichtigungs-Präferenzen), `agb_version`, `onboarding_completed`, `is_dummy` |
| **`courses`** | Kurs / Einzelstunde / Event / System-Container | `is_single`, `is_free`, `is_system_container`, `is_open`, `total_units`, `date_start`, `date_end` |
| **`sessions`** | Einzelne Termine (Stunden) | `session_type` (`course_session` / `single` / `event_free` / `event_paid`), `price_eur`, `external_participants_count`, `is_open`, `replacement_session_id`, `date`, `time_start` |
| **`bookings`** | Buchung eines Yogis auf eine Session | `status`, `origin_session_id`, `promoted_at`, `cancelled_by` (`self`/`admin`), `cancel_late`, `cancel_reason`, `cancelled_at` |
| **`credits`** | Guthaben-/Credit-Konten | `model` (`course`/`single`/`tenpack`/`quartal`/`guthaben`), `total`, `used`, `valid_from`, `expires_at`, `source` (z. B. `illness`, `cancellation_choice`), `source_course_name` |
| **`waitlist`** | Wartelisten-Einträge | `user_id`, `session_id` |
| **`waitlist_offers`** | Spät-Angebote (Token, „first-click wins") | `token`, `resolved_winner_user_id` |
| **`enrollments`** | Kurseinschreibungen (Yogi ↔ Kurs) | `user_id`, `course_id` |
| **`audit_log`** | Zentrales Protokoll | `action`, `details` (jsonb), `user_id`, `created_at` |
| **`course_cancellation_responses`** | Yogi-Wahl bei Kursabbruch | `token`, `choice`, `remaining_sessions`, `expires_at` |
| **`yogi_notifications` / `admin_notifications` / `notification_log`** | In-App-Benachrichtigungen + Versand-Log | `type`, `message`, `details` |
| **`agb_versions` / `legal_acceptances`** | AGB-Versionierung + Zustimmungs-Nachweise | `sort_order`, `full_name`, `ip_address`, `user_agent` |
| **`admin_announcement`** | Singleton-Ankündigungsbanner (id = 1) | `update_banner_version`, `link_url`, `link_label` |

### 1.4 Externe Integrationen

| Dienst | Zweck | Anbindung |
|---|---|---|
| **Brevo** | E-Mail-Versand | Edge Function `send-email` → `https://api.brevo.com/v3/smtp/email` (`BREVO_API_KEY`, Absender `FROM_NAME`/`FROM_EMAIL`) |
| **Vercel** | Hosting & Deployment | Auto-Deploy bei `git push`; DB-Migrationen werden separat/manuell eingespielt |
| **Supabase Auth** | Authentifizierung | `@supabase/ssr` + `@supabase/supabase-js` |

#### E-Mail-Architektur (Sicherheits-relevant)

```
Client  ──>  /api/email (Proxy)  ──>  Edge Function send-email  ──>  Brevo
Server  ─────────────────────────>  Edge Function send-email  ──>  Brevo
            (x-function-secret: EDGE_FUNCTION_SECRET)
```

- Der **Client** ruft nie die Edge Function direkt — er geht über den Proxy `/api/email`, damit das Geheimnis `EDGE_FUNCTION_SECRET` nicht im Browser landet.
- **Server-Code** ruft die Edge Function direkt mit dem Header `x-function-secret`.
- Die Edge Function `send-email` läuft mit **`verify_jwt: true`** (darf nicht geändert werden).
- Versand mit 15-Sekunden-Timeout (`AbortController`).

---

## 2. Rollen- & Rechtemodell

Es gibt genau **zwei Rollen**, unterschieden allein durch das Flag `profiles.is_admin`. Es gibt keine
weiteren Rollenstufen.

### 2.1 Yogi — Sicht & Rechte

**Navigation** (`components/layout/BottomNav.tsx`, `yogiNav`): **Kalender · Warteliste · Meine · Profil**

| Seite | Datei | Inhalt |
|---|---|---|
| `/kurse` | `app/kurse/page.tsx` | Wochen-Kalender (wischbar); Header „Yoga mit Sarah". Zeigt `AdminAnnouncementBubble`, `YogiCreditExpiryBanner` (warnt vor ablaufenden Credits), `YogiCancelNotifications`, Onboarding-Tour, „Neuer-Yogi"-Banner. |
| `/kurse/[id]` | `app/kurse/[id]/page.tsx` | Session-Detail: buchen / abmelden |
| `/kurse/[id]/bestaetigung` | `app/kurse/[id]/bestaetigung/page.tsx` | Buchungsbestätigung |
| `/meine` | `app/meine/page.tsx` | „Deine freien Credits", „Guthaben", „Dein Kurs/Deine Kurse" (Fortschritt „X von Y Stunden absolviert", ICS-Export „Alle Termine exportieren"), „Einzelstunden/Events", „Beendete Kurse" (zeigt Rest-Credits bis 8 Tage nach Kursende) |
| `/profil` | `app/profil/page.tsx` | „Meine Daten", „Notfallkontakt", „Benachrichtigungen", „Rechtliches", PWA-Installation, Logout, DSGVO-„Account löschen" |
| `/profil/passwort` | `app/profil/passwort/page.tsx` | Passwort ändern |
| `/warteliste` | `app/warteliste/page.tsx` | Eigene Wartelisten-Einträge |

**Credits-/Guthaben-Anzeige (Yogi):** Jede Credit-Karte zeigt `free` (große Zahl), ein Label
(„aus Kurs: X" / „Quartals-Credits · Q[n]" / „Einzelstunden-Credits" / „Krankheits-Guthaben" /
„Kurs-Guthaben"), das Ablaufdatum und „{used} / {total} genutzt" mit Fortschrittsbalken.
Die freie Menge berechnet sich als `free = Math.max(0, c.total - c.used)`.

### 2.2 Admin — erweiterte Sicht & Rechte

**Sidebar** (`app/admin/layout.tsx`): Dashboard · Yogis · Kurse · Einladen · Kursabbrüche · Protokoll · AGB-Nachweise · Mehr

| Bereich | Datei | Zusätzliche Rechte |
|---|---|---|
| **Dashboard** | `app/admin/dashboard/page.tsx` | Wochen-Session-Grid; pro Session: Yogi hinzufügen, Session absagen + Ersatztermin anlegen, Yogi-Buchung stornieren (mit 3-Std-Fenster-Wahl), Statistik-Kacheln (Buchungen / Abmeldungen / Warteliste — **Roll-up über die Stunden DIESER Woche**, nicht nach `created_at`), offene Storno-Aufgaben, `admin_notifications`-Feed, `AdminBirthdayBanner` |
| **Yogis** | `app/admin/yogis/page.tsx` (Liste), `app/admin/yogis/[id]/page.tsx` (Detail) | Kacheln „Freie Credits / Absolvierte Stunden / Guthaben"; Aktionen: „In Kurs einbuchen" (`handleEnroll`, mit Range-Modus + automatischer Guthaben-Verrechnung), „Credits vergeben", Credits bearbeiten/löschen (`handleEditCredit`/`handleDeleteCredit`), aus Kurs austragen (`removeFromCourse`), Krankheits-Austragung mit Guthaben (`cancelEnrollmentDueToIllness`), DSGVO-Löschung (`handleDeleteYogi`), pro-Yogi-Protokoll (`formatAuditEntry`) |
| **Kurse** | `app/admin/kurse/page.tsx` | Kurs/Einzelstunde/Event anlegen, bearbeiten, Sessions absagen, `archiveCourse` (`is_active=false`, 9-Tage-nach-Ende-Schutz), `deleteCourse`, Buchung freigeben/sperren |
| **Sessions** | `app/admin/sessions/[id]/page.tsx` | Session absagen (+Ersatz), Yogi manuell hinzufügen, Schnell-Credit, Einzelstunde/Event bearbeiten/löschen |
| **Anwesenheit** | `app/admin/anwesenheit/page.tsx` | Teilnehmerliste pro Session mit Credit-Info |
| **Protokoll** | `app/admin/protokoll/page.tsx` | Zentrales Audit-Log (siehe Sektion 6) |
| Weitere | `admin/credits`, `admin/einladen` + `admin/einladungen`, `admin/kursabbruch`, `admin/nachweise`, `admin/stats/[type]` | Credits vergeben, einladen, Kursabbrüche, AGB-Nachweise, Statistik-Detail-Listen (Buchungen/Abmeldungen/Warteliste der Woche; echter Event-/Einzelstunden-Titel via `sessionDisplayName`, **kein SYS-Container-Name**) |

> **Hinweis:** Kurse mit `is_system_container = true` (interne SYS-Container) dürfen niemals in
> der UI, in E-Mails oder in Hinweisen auftauchen und werden aus allen Listen herausgefiltert.

### 2.3 Rollen-Durchsetzung (Enforcement)

| Mechanismus | Datei | Verhalten |
|---|---|---|
| **Middleware** | `middleware.ts` | Bewusst **Pass-Through** (`matcher: []`). Gesamte Auth läuft in den Seiten — die Middleware-Variante hatte eine Login-Schleife verursacht. |
| **`getCurrentUser()`** | `lib/auth.ts` | Client-seitig; `supabase.auth.getUser()` (server-validiert), lädt Profil, **erzwingt Logout** bei fehlendem Profil oder anonymisiertem Profil (`first_name === 'Gelöschter'`). Prüft **nicht** `is_admin` — nur Authentifizierung. |
| **Admin-Guard** | `app/admin/layout.tsx` | **Client-seitiger** `useEffect`: keine Session → `/login`; Profil mit `!is_admin` → Redirect `/kurse`. Das ist nur der **UI-Gate** — die Daten sind unabhängig davon server-seitig per RLS + Spalten-Grants + Triggern geschützt (siehe § 5.0). |
| **RLS / RPCs** | `supabase/migrations/*.sql` | Tabellen haben RLS aktiv. Sensible RPCs lesen `COALESCE(is_admin,false)` aus `profiles WHERE id = auth.uid()` und folgen dem Muster: **Admin umgeht die Pro-Yogi-Beschränkung; ein Yogi darf nur auf seine eigene Buchung wirken.** `GRANT EXECUTE ... TO authenticated, service_role` (Service-Role umgeht RLS vollständig). |

### 2.4 Daten-Spiegelung (Yogi-Sicht ⇄ Admin-Sicht)

Die Garantie, dass Yogi und Admin **dieselben Zahlen und Status** sehen, beruht nicht auf
dupliziertem Code, sondern auf **gemeinsamen DB-Spalten + gemeinsamen Hilfsfunktionen**:

- **Credits:** Beide Seiten lesen `credits.total` und `credits.used` direkt aus der DB. Diese
  werden durch einen DB-Trigger (`trg_sync_credit_used` / `recalc_credit_used`) korrekt gehalten,
  der aktive Buchungen neu zählt. Die freie Menge nutzt **dieselbe Formel** auf beiden Seiten:
  - Yogi (`app/meine/page.tsx`): `computeFreeMeine(c) = Math.max(0, c.total - c.used)`
  - Admin (`app/admin/yogis/[id]/page.tsx`): `computeFree(c) = Math.max(0, c.total - c.used)`
- **Gemeinsam genutzte Module** (von Yogi- **und** Admin-Seiten importiert):
  - `lib/session-status.ts` — `isActive`, `isExcluded`, `isCancelled`, `isStarted`,
    `countActiveUnits`, `countActiveFutureUnits`, `isCourseEnded`, der kanonische Badge-Resolver
    `bookingStatusLabel` + `cancelledActorLabel`.
  - `lib/session-display.ts` — `sessionDisplayName` / `isSingleOrEvent`.
  - `lib/credit-selector.ts` — `selectCreditForBooking` (der einzige Credit-Picker zum Buchungszeitpunkt).

**Netto-Effekt:** Eine Buchung/Stornierung aktualisiert `bookings.status` → der DB-Trigger
berechnet `credits.used` neu → beide Seiten lesen dasselbe `total`/`used` und rechnen mit derselben
Formel und denselben `lib/session-status`-Zählern. Die Zahlen stimmen **per Konstruktion** überein.

---

## 3. Kern-Geschäftslogiken & Fristen-Matrix

### 3.1 Fristen-Matrix (zentrale Übersicht)

| Frist | Konstante / Ort | Gilt für | Verhalten an der Grenze |
|---|---|---|---|
| **90 Minuten** | `v_within90 := (v_start - v_now) <= interval '90 minutes'` (`process_cancellation_full`) | Warteliste bei Absage | **> 90 Min:** automatisches Nachrücken (Auto-Promote) des ersten passenden Wartelisten-Yogis. **≤ 90 Min:** Spät-Angebot (Late-Offer) an **alle** Wartelisten-Yogis gleichzeitig (Magic-Token, „first-click wins"). |
| **60 Minuten** | `bookings.promoted_at`; Prüfung `now() - NEW.promoted_at < interval '60 minutes'` | **Nur AUTO-nachgerückte** Yogis (> 90 Min, `auto-promoted`) | „Promote-Gnadenfrist": Ein **automatisch** nachgerückter Yogi darf sich innerhalb von 60 Min nach dem Nachrücken **kostenlos** wieder abmelden — auch innerhalb des sonst gesperrten Fensters. **Hard Cut-Off:** Diese Gnadenfrist endet spätestens zum **Stundenanfang** — ab Kursbeginn ist keine kostenlose Stornierung mehr möglich (UI-Gate `!past` blendet die Abmelde-Sektion aus). App + Mail zeigen „Kostenlose Stornierung nur bis zum Stundenanfang möglich!". **AUSSCHLUSS:** Gilt **NICHT** für Late-Offer-Annahmen (< 90 Min). Die Annahme-Route setzt `promoted_at = null` → keine Gnadenfrist; die Buchung ist **ab Sekunde 1 verbindlich** (Storno < 3h = `cancel_late = true`). |
| **3 Stunden** | `isPastDeadline(...)` mit `hoursBeforeAllowed = 3` (`lib/server-time.ts`) | Normale Selbst-Abmeldung (Kursstunden & Einzelstunden) | Bis 3 Std vor Beginn frei abmeldbar (Credit kommt zurück). Danach „spät storniert" (`cancel_late = true`, kein Credit zurück). |
| **7 Tage** | `enforce_event_paid_7d_cancel_block()` (DB-Trigger) | Bezahlte Events (`event_paid`) | Innerhalb von 7 Tagen vor Beginn ist die **Selbst-Abmeldung gesperrt** (harter DB-Block). **Ausnahmen:** Admin; sowie Yogis innerhalb der 60-Min-Promote-Gnadenfrist. |
| **8 Tage** | `EIGHT_DAYS_MS = 8*24*60*60*1000` (`lib/credit-selector.ts`); `expiresAt.setDate(getDate()+8)` | Kurs-Credits nach Kursende | Kurs-Credits bleiben bis 8 Tage **nach** `date_end` nutzbar (Nachhol-Fenster). Danach 8d-Cleanup. |
| **10 Tage** | `TEN_DAYS_MS = 10*24*60*60*1000` (`lib/credit-selector.ts`) | „Vorhol"-Fenster | Origin-Fenster eines Kurs-Credits: `[originDt - 10d, courseEnd + 8d]`. Innerhalb dieses Fensters ist eine Buchung mit dem gebundenen Kurs-Credit erlaubt. |
| **2 Jahre** | `expiry2y.setFullYear(getFullYear()+2)`, `source: 'cancellation_choice'` (`app/admin/kurse/page.tsx`); Ablauf-Cron `fn_check_guthaben_2y_expiry()` | Guthaben aus **Kursabbruch** | Wählt der Yogi bei einem Kursabbruch „Guthaben behalten", entsteht ein Guthaben, das **2 Jahre** gültig ist und nur für ganze Kurse (nicht Einzelstunden) verwendbar ist. **Bei Ablauf wird das Guthaben NICHT gelöscht**, sondern als verbraucht markiert (`used = total`) und eine **Auszahlung** angestoßen: Admin-Notification `refund_pending_auto_2y` (dedupliziert pro `credit_id`) + Brevo-Mail `admin_guthaben_2y_expiry` an Sarah + Audit `guthaben_2y_auto_refund`. |
| **10 Monate** | Krankheits-Credit `source: 'illness'` (`cancelEnrollmentDueToIllness`); Lösch-Cron `fn_check_illness_credit_expiry(p_dry_run)` (täglich 05:00) | Krankheits-Guthaben | Bei krankheitsbedingter Austragung gutgeschriebener Credit mit **10-Monats**-Gültigkeit. **Strikt getrennt vom Kursabbruch-Guthaben.** Bei Ablauf wird der Credit **hart & ersatzlos GELÖSCHT** (`DELETE FROM credits`) + Audit `illness_credit_expired`. **4 Wochen (28 Tage) vorher** warnt der Kalender-Banner den Yogi („Dein Krankheits-Guthaben läuft in … ab und wird danach gelöscht.", `components/YogiCreditExpiryBanner.tsx`). Der Cron läuft standardmäßig als **Trockenlauf** (`p_dry_run = true` → nur Zähl-Notification); echte Löschung erst bei `fn_check_illness_credit_expiry(false)`. |
| **14 Tage** | Einladungs-Ablauf (`Email.invitationReminder`/`invitationSent`) | Einladungen | Einladungslink läuft nach 14 Tagen ab. |

### 3.2 Credit-Modelle & Auswahl-Priorität

**Modelle** (`credits.model`): `course` · `single` · `tenpack` · `quartal` · `guthaben`

**Auswahl beim Buchen** — `selectCreditForBooking(supabase, userId, sessionId, sessionDate, sessionTimeStart)` in `lib/credit-selector.ts`:

- Rückgabe bei Erfolg: `{ ok: true, creditId, originSessionId, usedModel }`
- Rückgabe bei Misserfolg: `{ ok: false, reason: 'no_credit' | 'window_blocked', message }`
- **Gültigkeits-Bedingungen** je Credit:
  - `expires_at > sessionDt` (gültig bis zum Session-Zeitpunkt)
  - `model !== 'guthaben'` (**Guthaben ist nie für Einzelstunden verwendbar**)
  - `valid_from <= sessionDate`
- **Priorität:** Kurs-Credits zuerst (sortiert: eigener Kurs zuerst, dann `expires_at` aufsteigend).
- `tryCourseCredit` prüft das Origin-Fenster `[originDt - 10d, courseEnd + 8d]`; bei der **exakt
  stornierten Session** erfolgt eine Reaktivierung ohne erneute Fensterprüfung.
- Liegt eine Buchung außerhalb des Fensters, liefert die Funktion deutsche Block-Meldungen
  (8d-/10d-Fenster).
- **Fehler-Protokollierung:** Schlägt eine Buchung an einer Frist / einem Fenster fehl
  (`ok:false`), schreibt `handleBook` (`app/kurse/[id]/page.tsx`) zusätzlich einen Audit-Eintrag
  `booking_failed_deadline` (mit `reason` = `window_blocked`/`no_credit` + `error_message`) —
  auf der Admin-Protokollseite sichtbar (siehe Sektion 6).

> **⚠️ Maßgeblich ist die STUNDE, nicht der Buchungszeitpunkt.**
> Eine Stunde (auch beim Vorholen/Nachholen) ist **nur** buchbar, wenn die **Stunde selbst**
> innerhalb des erlaubten Zeitfensters liegt (z. B. bis 8 Tage nach Kursende). Der reine
> Buchungs-Zeitpunkt ist **nicht** entscheidend. Technisch ist die Gültigkeit an den
> **Session-Zeitpunkt** gebunden:
> - Der Credit-Filter prüft `.gt('expires_at', sessionIso)` — der Credit muss bis zur
>   **Session-Zeit** gültig sein (nicht nur „bis jetzt").
> - Das Origin-Fenster in `tryCourseCredit` vergleicht `sessionDt` gegen
>   `[originDt - 10d, courseEnd + 8d]`.
>
> **Beispiel:** Ein Yogi mit einem Kurs-Credit, der noch 7 Tage gültig ist, könnte *heute*
> problemlos buchen — eine Stunde **in 2 Wochen** (also nach Ablauf des 8-Tage-Fensters)
> wird aber **blockiert**, weil die Stunde außerhalb liegt. Verifiziert durch den dedizierten
> E2E-Test `tests/e2e/53-vorholfrist-stunde-im-fenster.spec.ts` (Block-Fall + Kontroll-Fall
> „im Fenster → erlaubt" + modellübergreifender Fall + **origin-bezogene Grenzfälle**:
> VORHOLEN genau `origin − 10 Tage` → erlaubt / `> 10 Tage` davor → blockiert; NACHHOLEN
> `≤ Kursende + 8 Tage` → erlaubt / `> 8 Tage` → blockiert).
>
> **Wichtig — VORHOLEN ist origin-bezogen, nicht buchungstag-bezogen:** Das 10-Tage-Fenster
> wird ab dem **Termin der abgesagten (Origin-)Stunde** gerechnet (`sessionDt ≥ originDt − 10d`),
> nicht ab dem Tag der Buchung.

### 3.2a Guthaben → Kurs-Credit-Umwandlung beim Admin-Einbuchen

> **Stand 2026-06-01.** Trägt der Admin einen Yogi **mit vorhandenem Guthaben** in einen
> neuen Kurs ein (`handleEnroll`, `app/admin/yogis/[id]/page.tsx`, Normal-Pfad), wird das
> **Guthaben 1:1 in Kurs-Credits umgewandelt** — nicht separat verbucht.

**Regel:**

1. Es wird **EIN** Kurs-Credit (`model: 'course'`, `course_id` gesetzt) mit
   **`total = Anzahl der (zukünftigen, nicht abgesagten) Kursstunden`** angelegt — er deckt
   **alle** Stunden ab, egal ob durch Guthaben gedeckt oder neu bezahlt.
2. **Alle** Buchungen des Yogis im Kurs hängen an diesem Kurs-Credit (`recalc_credit_used`
   setzt `used` = aktive Buchungen).
3. Der verbrauchte Guthaben-Anteil wird vom Guthaben-Konto **abgezogen**; ein **vollständig**
   umgewandeltes Guthaben wird **gelöscht** (`DELETE FROM credits`) → es **verschwindet
   spurlos**. Teil-Umwandlung: nur der verbrauchte Teil verschwindet, der Rest bleibt als
   Guthaben.
4. **Reihenfolge:** erst Buchungen an den Kurs-Credit hängen, **dann** Guthaben reduzieren/
   löschen (sonst FK-Konflikt).

**Folge:** Die umgewandelten Credits sind **vollwertige Kurs-Credits** — ab dann gelten
**ausschließlich** die Kurs-Credit-Regeln (Ablauf 8 Tage nach Kursende, Rückbuchung bei
Stunden-Absage als Kurs-Credit, Anzeige als Kurs-Credit in `/meine`). Das ursprüngliche
Guthaben-Konto und seine 10-Monats-/2-Jahres-Frist sind danach **gegenstandslos**.

**Gilt für BEIDE Guthaben-Arten** — Krankheit (`source: 'illness'`) **und** Admin-Kursabbruch
(`source: 'cancellation_choice'`): der Einbuch-Code filtert ausschließlich nach
`model = 'guthaben'`, nicht nach `source`.

**Buchhaltung:** Wird Guthaben verrechnet, gehen eine Admin-Mail `Email.adminGuthabenVerrechnet`
(„X aus Guthaben verrechnet, Y muss neu bezahlt werden") **und** eine abhakbare
`admin_notifications`-Aufgabe (`type: 'guthaben_verrechnet'`) raus. Audit:
`yogi_enrolled_by_admin` mit `guthaben_verrechnet` / `neue_credits`.

> Verifiziert: `tests/e2e/admin/08-admin-guthaben-kurs.spec.ts` (3 Guthaben + 4-Stunden-Kurs →
> Guthaben gelöscht, Kurs-Credit `total=4/used=4`).

### 3.3 Status-Modell

**Session-Status** (`lib/session-status.ts`):

| Status | Bedingung |
|---|---|
| **Aktiv** | normale, zukünftige Buchung |
| **Vergangen / Teilnahme** | `isStarted` = `date + time_start < now` → Label „Teilgenommen" |
| **Ausgeschlossen** | `isExcluded` = `is_cancelled && cancel_reason === 'excluded'` |
| **Abgesagt** | `isCancelled` = `is_cancelled && cancel_reason !== 'excluded'` |

**Buchungs-Labels** (`bookingStatusLabel`, Präzedenz von oben nach unten):
`Ausgeschlossen` > `Abgesagt` > `Ausgetragen`/`Abgemeldet` > `Teilgenommen` > (kein Label)

- `cancelledActorLabel(booking)`: `cancelled_by === 'admin'` → „Ausgetragen", sonst „Abgemeldet".

### 3.4 Wartelisten-/Nachrück-State-Machine

Zentrale RPC: **`process_cancellation_full(p_session_id uuid)`** (`SECURITY DEFINER`, Berlin-Wandzeit).
Aufgerufen über `promoteWaitlistOrOfferLate(supabase, sessionId)` (`lib/waitlist-promote.ts`).

```
Session-Start (Berlin):  v_start = (date + time_start) AT TIME ZONE 'Europe/Berlin'
Innerhalb 90 Min?        v_within90 := (v_start - v_now) <= interval '90 minutes'
Ohne Credit nachrücken?  v_promote_without_credit = is_event OR is_free   (z. B. Charity)
```

| Modus | Auslöser | Aktion + E-Mails |
|---|---|---|
| **`auto-promoted`** | Platz frei, **> 90 Min** vor Beginn | Ersten passenden Wartelisten-Yogi automatisch nachrücken (eigener Kurs-Credit bevorzugt), **`promoted_at = now()`** wird gesetzt → **60-Min-Gnadenfrist** greift (s. 3.1). Mails: `Email.waitlistPromoted` + ggf. `Email.waitlistRemovedCreditUsedElsewhere`. Audit: `waitlist_promoted`, evtl. `waitlist_auto_removed`. |
| **`late-offer`** | Platz frei, **≤ 90 Min** vor Beginn | Spät-Angebot an **alle** Wartelisten-Yogis (Token in `waitlist_offers`, „first-click wins"). **Überbuchungsschutz:** atomarer Guard `UPDATE … WHERE resolved_winner_user_id IS NULL` (`app/api/waitlist-offer/[token]/route.ts`) → **nur ein** Gewinner, kein DB-Fehler; zweiter Klicker bekommt `409 too_late` + „Schade, ein anderer Yogi war schneller!". Mail je Angebot: `Email.waitlistOfferLate`. **KEINE 60-Min-Gnadenfrist:** die Annahme-Route setzt `promoted_at` **explizit auf `null`** → die Buchung ist **ab Sekunde 1 verbindlich**; ein Storno < 3h vor Start gilt sofort als „spät storniert" (`cancel_late = true`, Credit verfällt). |
| **`notify-only`** | Platz bleibt frei (kein passender Yogi) | Mail `Email.notifyPlaceFree` an Abonnenten, danach `delete_notify_subscribers`-RPC (nur bei Erfolg). |
| **`noop`** | nichts zu tun | keine Aktion |

> **⚠️ Gnadenfrist nur bei Auto-Promote, NICHT bei Late-Offer.** Der `auto-promoted`-Pfad
> (> 90 Min) setzt `promoted_at = now()` → 60-Min-Gnadenfrist (unfreiwilliges Nachrücken).
> Der `late-offer`-Pfad (≤ 90 Min) ist eine **aktive, bewusste** Annahme per Link-Klick →
> `app/api/waitlist-offer/[token]/route.ts` setzt `promoted_at = null`. Dadurch ist die Buchung
> **ab Sekunde 1 verbindlich**; ein Storno < 3h vor Start zählt sofort als „spät storniert"
> (`cancel_late = true`, Credit verfällt). Offer-Seite + Mail (`Email.waitlistOfferLate`) zeigen:
> „Verbindliche Sofort-Buchung – kostenfreie Stornierung so kurzfristig nicht mehr möglich."
> Abgesichert durch `tests/e2e/55-fristen-audit.spec.ts` (inkl. Stale-`promoted_at`-Härtetest).

---

## 4. End-to-End User Stories

### Story 1 — Buchungs- & Stornierungs-Lifecycle (Fristwahrung & Verfall)

1. **Buchen:** Yogi öffnet `/kurse/[id]` und bucht. `selectCreditForBooking` (siehe 3.2) wählt
   den passenden Credit (Kurs-Credit zuerst, Fenster-/Gültigkeitsprüfung). Es entsteht ein
   `bookings`-Eintrag (`status = 'active'`), und der DB-Trigger erhöht `credits.used`.
   Bestätigung: `Email.bookingConfirmed`, Anzeige `/kurse/[id]/bestaetigung`.
2. **Rechtzeitig abmelden (> 3 Std vorher):** Buchung → `status = 'cancelled'`, `cancel_late = false`,
   `cancelled_by = 'self'`. Der Credit-Rückgabe-Trigger schreibt den Credit zurück
   (`credits.used` sinkt). Mail `Email.bookingCancelled`.
3. **Spät abmelden (≤ 3 Std vorher):** `cancel_late = true` — **kein Credit zurück** (verfällt).
4. **Bezahltes Event (`event_paid`):** Innerhalb von **7 Tagen** vor Beginn blockt der DB-Trigger
   `enforce_event_paid_7d_cancel_block()` die Selbst-Abmeldung komplett (Ausnahmen: Admin,
   60-Min-Promote-Gnadenfrist).
5. **Verfall der Credits:** Kurs-Credits sind bis **8 Tage nach Kursende** nutzbar; das
   „Vorhol"-Fenster reicht **10 Tage** vor den Origin-Termin. Danach 8d-Cleanup
   (Audit: `course_credits_auto_expired`).

### Story 2 — Wartelisten-Szenario bei kurzfristiger Absage

1. Ein Kurs ist voll → Yogi B trägt sich in die `waitlist` ein (Mail `Email.waitlistJoined`).
2. Yogi A meldet sich ab → `promoteWaitlistOrOfferLate` ruft `process_cancellation_full`.
3. **Fall „> 90 Min vorher" (`auto-promoted`):** Yogi B rückt automatisch nach, bevorzugt mit dem
   Kurs-Credit des eigenen Kurses. Mail `Email.waitlistPromoted`. Wird dadurch Yogi Bs letzter
   freier Credit verbraucht, wird er automatisch von **anderen** Wartelisten entfernt
   (Mail `Email.waitlistRemovedCreditUsedElsewhere`, Audit `waitlist_auto_removed`).
   → **60-Min-Gnadenfrist (mit Hard Cut-Off):** Yogi B kann sich innerhalb 60 Min nach dem
   Nachrücken kostenlos wieder abmelden (`bookings.promoted_at`) — **längstens jedoch bis zum
   Stundenanfang**. App + Mail zeigen „Kostenlose Stornierung nur bis zum Stundenanfang möglich!".
4. **Fall „≤ 90 Min vorher" (`late-offer`):** **Alle** Wartelisten-Yogis erhalten gleichzeitig ein
   Spät-Angebot per Magic-Link (`Email.waitlistOfferLate`, Seite `/warteliste/angebot/[token]`).
   Der **erste Klick gewinnt** über einen **atomaren Guard**
   (`UPDATE waitlist_offers … WHERE resolved_winner_user_id IS NULL`): es kann **nur genau einen
   Gewinner** geben → keine Überbuchung, kein DB-Fehler. Der zweite Klicker erhält `409 too_late`
   und sieht „**Schade, ein anderer Yogi war schneller!**". Schlägt ein Folgeschritt fehl, rollt
   `rollbackOffer` den Platz zurück (Audit `waitlist_offer_rollback`). Audit bei Erfolg:
   `waitlist_offer_late_accepted`.
   → **Verbindlich ab Sekunde 1 — KEINE 60-Min-Gnadenfrist:** Die Annahme-Route bucht mit
   `promoted_at = null` (anders als der Auto-Promote-Pfad). Ein Storno < 3h vor Start zählt daher
   **sofort** als „spät storniert" (`cancel_late = true`, Credit verfällt). Offer-Seite **und**
   Mail zeigen: „**Verbindliche Sofort-Buchung – kostenfreie Stornierung so kurzfristig nicht mehr
   möglich.**"
5. **Fall „Platz bleibt frei" (`notify-only`):** Interessenten werden via `Email.notifyPlaceFree`
   informiert, danach werden die Notify-Abonnenten gelöscht.

### Story 3 — Admin sagt Kurs ab → 2-Jahre-Guthaben

1. Admin bricht in `app/admin/kurse/page.tsx` einen Kurs ab. Für jeden betroffenen Yogi entsteht
   ein `course_cancellation_responses`-Eintrag mit **Token** und Frist `expires_at`
   (7-Tage-Wahlfrist). Mail `Email.courseCancelled` (+ Admin-Zusammenfassung
   `Email.adminCourseCancelledSummary`).
2. Der Yogi öffnet `/kursabbruch/[token]` (`app/kursabbruch/[token]/page.tsx`). Der Lesezugriff
   läuft über die `SECURITY DEFINER`-RPC `read_cancellation_response_by_token` (damit die RLS auf
   Service-Role verschärft werden kann). Er sieht: „Es wurden **X Stunden** abgesagt. Was möchtest du?"
   und zwei Optionen:
   - **„Guthaben behalten":** `X` Credits, **2 Jahre gültig**, nur für ganze Kurse (nicht
     Einzelstunden). Technisch: `expiry2y.setFullYear(getFullYear()+2)`, `source: 'cancellation_choice'`.
   - **„Geld zurück":** Die vorläufig gutgeschriebenen Credits werden wieder entfernt; Sarah meldet
     sich wegen anteiliger Erstattung.
3. Die Wahl wird per `POST /api/kursabbruch/[token]` gespeichert (`choice`). Bei gleichzeitigem
   Doppelklick gilt `alreadyChosen` (erste Wahl gewinnt). Mail `Email.yogiCourseCancelChoice`
   (Betreff „Guthaben gutgeschrieben:" bzw. „Erstattungsanfrage bestätigt:").
   Audit: `yogi_course_cancellation_choice`.
4. **Frist abgelaufen:** Reagiert der Yogi nicht innerhalb der Frist, wird **automatisch Geld
   erstattet** (Audit `token_expired_auto_refund`).
5. **2-Jahre-Guthaben läuft ungenutzt ab (`fn_check_guthaben_2y_expiry`):** Das Guthaben wird
   **NICHT gelöscht**, sondern als verbraucht markiert (`used = total`) und eine **Auszahlung**
   angestoßen — Admin-Notification `refund_pending_auto_2y` (dedupliziert pro `credit_id`),
   Brevo-Mail `admin_guthaben_2y_expiry` an Sarah, Audit `guthaben_2y_auto_refund`. (Bewusste
   Trennung: Geld-Anspruch des Yogi bleibt erhalten, daher kein ersatzloses Löschen.)

### Story 3b — Krankheits-Guthaben (10 Monate, strikt getrennt vom Kursabbruch)

Bei krankheitsbedingter Austragung (`cancelEnrollmentDueToIllness`) entsteht ein Guthaben mit
`source: 'illness'` und **10-Monats**-Gültigkeit (Mail `Email.illnessCredit`). Dieses ist **strikt
getrennt** vom Kursabbruch-Guthaben (`cancellation_choice`, 2 Jahre):

1. **4 Wochen (28 Tage) vor Ablauf** warnt der Yogi-Kalender (`YogiCreditExpiryBanner`):
   „Dein Krankheits-Guthaben läuft in … ab (gültig bis …) und wird danach gelöscht."; am Verfallstag
   „Dein Krankheits-Guthaben verfällt heute und wird gelöscht.".
2. **Bei Ablauf** löscht der Lösch-Cron `fn_check_illness_credit_expiry` den Credit **hart &
   ersatzlos** (`DELETE FROM credits`) + Audit `illness_credit_expired` (Yogi-Protokoll:
   „Krankheits-Guthaben nach 10 Monaten abgelaufen und gelöscht"). Der Cron läuft täglich um 05:00
   standardmäßig als **Trockenlauf** (`p_dry_run = true` → Zähl-Notification
   `illness_cleanup_dryrun`); die echte Löschung erfolgt erst mit `p_dry_run = false`.
   **Seit 2026-05-31 (Migration `20260531_quiet_dryrun_notifications.sql`):** Die Dashboard-Meldung
   wird **nur noch bei Treffer** geschrieben (`candidates > 0`) — bei 0 läuft der Trockenlauf still
   durch, damit Sarah nicht täglich „0 abgelaufene Guthaben" sieht.

> **Warum unterschiedlich?** Krankheits-Guthaben ist eine **Kulanz** (kein Geld-Anspruch) → es
> verfällt ersatzlos. Kursabbruch-Guthaben repräsentiert **bezahlte, nicht erbrachte Leistung** →
> bei Ablauf wird ausgezahlt, nicht gelöscht.

### Story 4 — Benachrichtigungs-Flow (In-App + Mail, Einzelstunde vs. Kurs)

Benachrichtigungen laufen **zweigleisig**: In-App (`yogi_notifications` / Banner-Komponenten wie
`YogiCancelNotifications`, `AdminAnnouncementBubble`) **und** E-Mail (`lib/email.ts` → `/api/email`
bzw. direkter Edge-Aufruf serverseitig → Brevo).

**E-Mail-Auslöser (Auszug der 26 `Email.*`-Methoden in `lib/email.ts`):**

| Ereignis | Methode | Brevo-Betreff (Beispiel) |
|---|---|---|
| Registrierung | `Email.welcome` | „Willkommen bei Yoga mit Sarah!" |
| Buchung bestätigt | `Email.bookingConfirmed` | „Buchung bestätigt:" / „Anmeldung bestätigt:" (paid/free) |
| Abmeldung | `Email.bookingCancelled` | „Abmeldung bestätigt:" |
| Warteliste eingetragen | `Email.waitlistJoined` | „Warteliste:" |
| Nachgerückt | `Email.waitlistPromoted` | „Du bist dabei:" |
| Spät-Angebot | `Email.waitlistOfferLate` | „Letzte Chance: … in Kürze" |
| Platz frei (Notify) | `Email.notifyPlaceFree` | „Platz frei:" |
| Erinnerung | `Email.sessionReminder` | „Erinnerung: … in N Std." |
| Session abgesagt | `Email.sessionCancelled` | „{Substantiv} abgesagt:" |
| Ersatztermin | `Email.sessionAdded` | „Ersatztermin für deine abgesagte Stunde am …" |
| Uhrzeit geändert | `Email.courseTimeChanged` | „Uhrzeitänderung:" |
| Kurs abgesagt | `Email.courseCancelled` | „Kurs abgesagt:" |
| Krankheits-Guthaben | `Email.illnessCredit` | „Krankheits-Austragung:" |
| Konto gelöscht (Yogi) | `Email.accountDeletedYogi` | „Dein Account bei Yoga mit Sarah wurde gelöscht" |
| DSGVO-Hinweis (Admin) | `Email.adminDsgvoDeletion` | „DSGVO: Account gelöscht – PDF bitte manuell löschen" |

**Einzelstunde vs. Kurs (Abgrenzung):** Viele E-Mail-Methoden nehmen `isSingle?` / `sessionType?`
entgegen und formulieren das Substantiv passend („Stunde" / „Event" / „Kurs"). Die Edge Function
`send-email` mappt darauf die Betreffzeilen (z. B. „Buchung bestätigt:" bei Kurs vs.
„Anmeldung bestätigt:" bei Event). **Guthaben** ist ausdrücklich nur für ganze Kurse, nie für
Einzelstunden (siehe `selectCreditForBooking`, 3.2).

### Story 5 — Einladung & Registrierung (Auto-Einbuchung in den Kurs)

1. **Admin lädt ein:** `app/admin/einladen` erstellt eine `invitations`-Zeile mit `token`, optional
   `course_id` + `credits_to_assign` (Kurs-Einladung). Mail `Email.invitationSent`; der Link läuft
   nach **14 Tagen** ab (`Email.invitationReminder`).
2. **Yogi registriert sich:** `app/register/page.tsx?token=…` liest die Einladung über die
   `SECURITY DEFINER`-RPC **`read_invitation_by_token`** (anon-fähig, vor dem Login). Pflichtfelder:
   Passwort + Geburtsdatum; E-Mail/Name sind vorausgefüllt.
3. **Auto-Einbuchung (Kern der Kurs-Einladung):** Sind `course_id` **und** `credits_to_assign`
   gesetzt, legt die Register-Seite nach `signUp` automatisch an: `enrollments` (Yogi ↔ Kurs), einen
   `credits`-Eintrag (`model = 'course'`, `total = credits_to_assign`, Ablauf **8 Tage nach letzter
   Stunde**) **und** für **jede** aktive zukünftige Session eine aktive Buchung (`type = 'course'`).
   > ⚠️ **Voraussetzung:** `read_invitation_by_token` muss `credits_to_assign` (+ `course_total_units`)
   > **mitliefern** — fehlt das Feld, überspringt die Register-Seite die Einbuchung stillschweigend
   > (Live-Bug 30.05.2026, behoben; abgesichert per E2E `58-coverage-gaps-browser`).
4. **Nach Registrierung:** Redirect auf `/rechtliches` (AGB-Clickwrap). Welcome-Mail `Email.welcome`,
   Admin-Info `Email.adminNewYogi`.

---

## 5. DSGVO, Daten-Lebensdauer & Sicherheit

### 5.0 Server-seitige Rechte-Härtung (Pre-Go-Live-Audit, 2026-05-30)

Der clientseitige Admin-Guard (`app/admin/layout.tsx`, § 2.3) schützt nur die **UI-Navigation**.
Die **Daten** sind unabhängig davon server-seitig abgesichert (RLS-Policies + Spalten-Grants +
Trigger). Drei im Audit gefundene Lücken wurden geschlossen:

| Lücke | Fix (live) | Test |
|---|---|---|
| **Privilege-Escalation:** Yogi konnte sich selbst `is_admin = true` setzen (RLS ist nur zeilen-, nicht spaltenbasiert). | `REVOKE UPDATE` + per-Spalten-`GRANT` ohne `is_admin` **und** Trigger `prevent_self_admin_escalation`. | `59-security-rls-guards` |
| **Credit-Selbstgutschrift:** Yogi konnte sich selbst Credits anlegen (Policy „Credits bearbeiten", ALL). | Auto-Einbuchung über `SECURITY DEFINER`-RPC `consume_invitation_enrollment` (server-bestimmte Menge); Yogi-Schreibrecht auf `credits`/`enrollments` entzogen (nur noch SELECT + DELETE-eigene). | `59-security-rls-guards` |
| **3-Std-Frist umgehbar:** Yogi konnte `cancel_late=false` per Direktaufruf erzwingen. | Trigger `enforce_self_cancel_late_flag` berechnet `cancel_late` bei Nicht-Admin-Selbst-Abmeldung autoritativ aus der Stundenzeit (Berlin). | `59-security-rls-guards` |

**Geprüft & unauffällig:** alle API-Routes (`delete-account`, `admin/bulk-mail`, `agb-drive-upload`,
`email`-Proxy) mit serverseitigem Bearer-Token-/`is_admin`-Check; RLS aktiv auf allen 17 Tabellen;
`courses`/`sessions`/`agb_versions`/`admin_announcement`/`invitations` nur Admin-schreibbar.

### 5.1 Konto-Selbstlöschung (technisch & logisch)

**UI:** `app/profil/page.tsx`, Button „Account löschen" (nur für Nicht-Admins, Zeilen ~1146–1181).
Erfordert Bestätigungs-Checkbox (`deleteConfirmed`). Hinweistext: Name und E-Mail werden entfernt,
die **anonymisierte Buchungshistorie bleibt aus rechtlichen Gründen erhalten**.

**Ablauf `handleDeleteAccount` (Zeilen ~346–465):**

1. **`profiles` — anonymisiert (nicht gelöscht):** `first_name` → `'Gelöschter'`,
   `last_name` → `'Nutzer'`, `email` → `null`, `emergency_name`/`emergency_phone` → `null`,
   `legal_accepted_at` → `null`.
2. **`legal_acceptances` — anonymisiert:** `full_name` → `'Gelöschter Nutzer'`,
   `ip_address`/`user_agent`/`emergency_contact`/`phone` → `null`.
3. **`waitlist` — hart gelöscht.**
4. **Zukünftige Buchungen storniert + Warteliste benachrichtigt:** Alle `active` Buchungen werden
   client-seitig auf zukünftige Sessions gefiltert (`session.date >= today`) und auf
   `status:'cancelled', cancelled_at, cancel_late:false, cancelled_by:'self'` gesetzt. Für jede frei
   gewordene Session wird `promoteWaitlistOrOfferLate(supabase, sId)` ausgelöst (fire-and-forget) —
   **frei werdende Plätze rücken also auch bei Konto-Löschung nach.** Der Trigger
   `trg_sync_credit_used` schreibt Credits zurück.
5. **`enrollments` — hart gelöscht.**
6. **Explizite Hard-Deletes** (Sarah-Fix 2026-05-29, „voll absichern"): `bookings`, `credits`,
   `notification_log`, `waitlist_offers`, `course_cancellation_responses` — je `.eq('user_id', …)`.
   (Der `course_cancellation_responses`-Delete ist nötig, weil dessen FK `NO ACTION` ist und sonst
   die `profiles`-Kaskade blockieren würde.)
7. **Audit-Log-PII-Scrub:** `supabase.rpc('anonymize_user_audit_logs', { target_user_id })`
   (in try/catch).
8. **Admin-Benachrichtigung:** `admin_notifications`-Eintrag `type:'account_deleted_dsgvo'` mit
   Hinweis, die Google-Drive-PDF manuell zu löschen.
9. **E-Mails:** `Email.accountDeletedYogi` (an Yogi — **vor** der Auth-Löschung, da die E-Mail
   danach weg ist) und `Email.adminDsgvoDeletion` (an Admin).
10. **Auth-Löschung + Logout:** Access-Token holen → `signOut({scope:'global'})` → Local-/Session-
    Storage leeren → fire-and-forget `POST /api/delete-account` (Bearer-Token) → Redirect `/login`.

**`/api/delete-account`** (`app/api/delete-account/route.ts`): verlangt Bearer-Token; ein Aufrufer
darf nur sich selbst löschen (außer `is_admin`). Löscht den Supabase-Auth-User via Admin-API. Bei
Fehler **502** (kein vorgetäuschter Erfolg) + `admin_notifications`-Eintrag `type:'auth_delete_failed'`.

> **Bugfix 2026-05-31 (Sarah):** Beide Aufrufer — Self-Service (`app/profil/page.tsx`) **und**
> Admin-Löschung (`app/admin/yogis/[id]/page.tsx`) — müssen den **`Authorization: Bearer`-Token**
> mitsenden. Der Admin-Pfad tat das nach dem Security-Umbau (Welle S1/H1) **nicht** → Route antwortete
> **401**, der Auth-User blieb bestehen, die E-Mail blieb belegt und ließ sich **nie wieder
> registrieren** (Profil war anonymisiert, Login aber aktiv). Zusätzlich wertet der Admin-Pfad das
> Ergebnis jetzt aus (`authDeleted`) und **warnt** den Admin bei Fehlschlag statt „erfolgreich" zu melden.

> **Wichtig — keine Wiederherstellung:** Es gibt **keinen** Recovery-/Backup-Mechanismus
> (kein `recovery_backup`, kein 30-Tage-Grace, keine „Reaktivieren"-Funktion). Dieses Feature wurde
> bewusst zurückgebaut (v5). Die Löschung ist **sofort und unumkehrbar**. Die einzige „Recovery"-
> Hilfe ist ein Login-Hinweis: „Email vergessen? Wende dich an Sarah". (Zwei E2E-Tests prüfen
> aktiv die Abwesenheit eines Recovery-Pfads.)

### 5.2 Anonymisierung vs. Audit-Trail (Recht auf Vergessenwerden)

Der Audit-Trail wird **erhalten, aber anonymisiert** — nicht gelöscht. Wichtige Mechanik:

- Der Name wird in alten Audit-Einträgen **nicht live gejoint** (die `profiles`-Zeile ist mit
  „Gelöschter Nutzer" überschrieben). Stattdessen speichert jeder Audit-Eintrag einen
  **Namens-/E-Mail-Snapshot in `details` (jsonb)** zum Schreibzeitpunkt (z. B. `details.email`,
  `details.full_name`).
- Bei der Löschung scrubbt `anonymize_user_audit_logs(target_user_id)` die PII aus diesen
  `details`-Blobs.
- Wird der Auth-User gelöscht, setzt der FK `audit_log.user_id` auf `NULL` — die **Zeile überlebt**.
- Die Compliance-Zeile `yogi_anonymized_dsgvo` wird gesetzt („Yogi-Account DSGVO-konform gelöscht —
  alle Stammdaten anonymisiert, Buchungshistorie entfernt").

So bleibt Sarahs Admin-Protokoll nutzbar (Aktion + Kurs-/Session-Kontext bleiben erhalten), während
alle personenbezogenen Identifikatoren entfernt werden.

> **Hinweis für Entwickler:** Die RPC `anonymize_user_audit_logs` existiert nur in der Live-Supabase-
> Instanz; sie ist **nicht** in den vier Migrationsdateien unter `supabase/migrations/` versioniert.

### 5.3 Sicherheits-Leitplanken (verbindlich)

- Geheimnisse (`EDGE_FUNCTION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `BREVO_API_KEY`) niemals im
  Client/Chat/Repo offenlegen. Client → immer über `/api/email`-Proxy.
- Edge Function `send-email` bleibt `verify_jwt: true`.
- SYS-Container-Kursnamen (`is_system_container`) tauchen nie in E-Mails/UI auf.
- Keine privaten Echt-E-Mails fest in committetem Code.
- AGB-Versionierung: `agb_versions` (`sort_order`); erneute Zustimmung nötig, wenn
  `profiles.agb_version < aktuelle sort_order` (`lib/agb-version.ts`).

### 5.4 Automatische Daten-Lebensdauer (Aufbewahrung & Verfall)

Die Lebensdauer zeitgebundener Datensätze wird durch geplante Jobs (`pg_cron` / RPC) gesteuert.
Übersicht der **automatischen Verfalls-/Löschpfade**:

| Datensatz | Frist | Job / Ort | Verhalten bei Ablauf | Audit / Notification |
|---|---|---|---|---|
| **Krankheits-Guthaben** (`source='illness'`) | **10 Monate** | `fn_check_illness_credit_expiry(p_dry_run)` — täglich 05:00, default Trockenlauf | **Hart & ersatzlos gelöscht** (`DELETE FROM credits`); Yogi 4 Wochen vorher im Kalender gewarnt | Audit `illness_credit_expired`; Trockenlauf-Notification `illness_cleanup_dryrun` **nur bei Treffer (>0)** |
| **Kursabbruch-Guthaben** (`source='cancellation_choice'`) | **2 Jahre** | `fn_check_guthaben_2y_expiry()` | **Nicht gelöscht** → `used = total` + **Auszahlung** angestoßen | Audit `guthaben_2y_auto_refund`; Notification `refund_pending_auto_2y` (dedup) + Mail `admin_guthaben_2y_expiry` |
| **Kurs-Credits** | **8 Tage** nach Kursende | `lib/credit-selector.ts` (Gültigkeits-Filter) | Nicht mehr buchbar (Nachhol-Fenster zu) | — |
| **Kursabbruch-Wahl-Token** | **7 Tage** | `course_cancellation_responses.expires_at` | Auto-Erstattung des vorläufigen Guthabens | Audit `token_expired_auto_refund` |
| **Wartelisten-Spätangebot-Token** | bis Stundenbeginn | `waitlist_offers.expires_at` | Angebot verfällt; „first-click wins". **Annahme ist ab Sekunde 1 verbindlich** (`promoted_at = null`, keine 60-Min-Gnadenfrist) | Audit `waitlist_offer_late_accepted` |
| **Audit-Trail (PII)** | bei Konto-Löschung | `anonymize_user_audit_logs(user_id)` | PII aus `details` gescrubbt, **Zeile bleibt** | `yogi_anonymized_dsgvo` |
| **Inaktive Konten** (Konzept) | **24 Monate** | siehe Abschnitt 7 (Trockenlauf-Cron) | geplant: Anonymisierung/Löschung nach Vorwarnung | — |

**Strikte Trennung Krankheit ↔ Kursabbruch** (über `credits.source`): Krankheits-Guthaben ist
Kulanz und verfällt ersatzlos; Kursabbruch-Guthaben repräsentiert bezahlte, nicht erbrachte
Leistung und wird bei Ablauf ausgezahlt (nicht gelöscht). Beide Pfade sind durch
`tests/e2e/55-fristen-audit.spec.ts` E2E-abgesichert.

---

## 6. Audit-Logging & Protokollierungs-Standard

### 6.1 Protokoll-Standard

Zentrale Tabelle **`audit_log`** mit den Spalten `action` (Schlüssel), `details` (jsonb),
`user_id` (Akteur, FK → `SET NULL` bei Löschung), `created_at`.

**Pflicht-/Standardfelder pro Eintrag:**

| Anforderung | Umsetzung im Code |
|---|---|
| **[Name vor Anonymisierung]** | Snapshot in `details.full_name` / `details.email` zum Schreibzeitpunkt (überlebt die Anonymisierung der Live-`profiles`-Zeile, bis `anonymize_user_audit_logs` scrubt) |
| **[Titel]** | `details.course_name` (Kurs) bzw. `details.name` (Einzelstunde/Event) + `details.session_type` |
| **[Aktion]** | `action`-Schlüssel → lesbares Label über `ACTION_LABELS` (53 Schlüssel) |
| **[Datum/Uhrzeit]** | `created_at` (Zeitstempel des Logs) + `details.session_date` / `details.session_time` (betroffener Termin) |

Häufige `details`-Schlüssel: `target_user_id`, `user_id`, `course_id`, `course_name`, `session_id`,
`original_session_id`, `replacement_session_id`, `session_date`, `session_time`, `name`,
`session_type`, `payment_type`/`price_eur`, `max_spots`, `amount`/`model`/`expires_at`/`valid_from`,
`credit_used`/`credit_returned`/`late`/`within_3h`/`within_7d`, `email`/`full_name`, `reason`,
`choice`/`remaining_sessions`/`refund_mode`, `old_count`/`new_count`, `is_open`.

### 6.2 Zwei (bzw. drei) Protokoll-Oberflächen

| Oberfläche | Datei | Umfang |
|---|---|---|
| **(a) Zentrales Admin-Protokoll** | `app/admin/protokoll/page.tsx` | `audit_log.select('*').order(created_at desc).limit(200)` — **global, ohne User-Filter**. Lädt zu allen `user_id` die Live-`profiles` (Akteurs-Name). Rendering über `ACTION_LABELS[log.action]` (Label + Farbe) und `formatDetails(action, details)`. Suche über Akteur, Label, `JSON.stringify(details)`. Akteur klickbar → `/admin/yogis/{user_id}`. |
| **(b) Pro-Yogi-Historie** | `app/admin/yogis/[id]/page.tsx` | `audit_log` gefiltert `.or(user_id.eq.{id}, details->>target_user_id.eq.{id}, details->>user_id.eq.{id})`, `created_at >=` **24 Monate** (DSGVO-Aufbewahrung), `limit 200`. Lesbare Aufbereitung via `formatAuditEntry` (`switch(entry.action)` → `{ text, subject }`, Zeilen ~862–1126). |
| **(c) Leichtgewichtige Admin-„Mehr"-Ansicht** | `app/profil/page.tsx` (~862–906) | Letzte 50 Roh-Einträge (Roh-Action + gekürztes details-JSON) + Link auf `/admin/protokoll`. |

> Es gibt **keine** Yogi-seitige (Nicht-Admin) Protokoll-Ansicht — alle drei Leser sind Admin-gated.

### 6.3 Aktions-Katalog (`ACTION_LABELS`, 52 Schlüssel)

Quelle: `app/admin/protokoll/page.tsx`, Zeilen 13–69. Jeder Schlüssel hat Label **und** Farbe
(grün = positiv, amber = Änderung/Warnung, rot = Löschung/Fehler).

**Buchungen & Credits:** `booking_created` „Stunde gebucht" · `booking_cancelled` „Stunde storniert" ·
`booking_cancelled_by_admin` „Yogi-Buchung storniert (Admin)" · `credit_assigned` „Credits vergeben" ·
`credit_adjusted` „Credit angepasst" · `credit_deleted` „Credit gelöscht" · `booking_failed_deadline`
„Buchung blockiert (Frist)" — fehlgeschlagene Buchung (Silent-Failure-Logging)

**Kurs-Teilnahme:** `yogi_enrolled_by_admin` „In Kurs eingetragen" · `yogi_removed_from_course`
„Aus Kurs ausgetragen" · `session_cancelled` „Stunde abgesagt (Admin)"

**Warteliste:** `waitlist_joined` „Warteliste eingetragen" · `waitlist_promoted`
„Warteliste nachgerückt" · `waitlist_offer_late_accepted` „Warteliste — Spät-Angebot angenommen" ·
`waitlist_auto_removed` „Von Warteliste entfernt (letzter Credit verbraucht)" ·
`admin_promoted_waitlist_yogi` „Waitlist-Yogi nachgerückt (Admin)" · `waitlist_offer_rollback`
„Warteliste-Angebot zurückgerollt"

**Events / Einzelstunden / Sessions:** `single_session_created` „Einzelstunde angelegt" ·
`single_session_updated` „Einzelstunde bearbeitet" · `event_created` „Event angelegt" ·
`event_updated` „Event bearbeitet" · `single_or_event_deleted` „Einzelstunde / Event gelöscht" ·
`single_or_event_updated` „Einzelstunde / Event geändert" · `external_participants_changed`
„Externe Teilnehmer geändert" · `admin_added_yogi_to_event` „Yogi zu Event hinzugefügt" ·
`admin_added_yogi_to_session` „Yogi zu Stunde hinzugefügt" · `session_open_toggled`
„Stunde/Event freigegeben/gesperrt"

**Kurs-Lebenszyklus:** `course_created` „Kurs angelegt" · `course_updated` „Kurs bearbeitet" ·
`course_archived` „Kurs archiviert" · `course_deleted` „Kurs gelöscht" · `course_open_toggled`
„Kurs freigegeben/gesperrt" · `course_cancelled` „Kurs abgebrochen" · `course_rollover`
„Folgekurs angelegt (Rollover)" · `replacement_session_added` „Ersatzstunde angelegt" ·
`cascade_replacement_cancelled` „Ersatzstunde (Cascade) abgesagt" · `course_credits_auto_expired`
„8d-Cleanup: Kurs + Credits gelöscht"

**Kursabbruch / Erstattung:** `yogi_course_cancellation_choice` „Yogi-Wahl bei Kursabbruch" ·
`token_expired_auto_refund` „Token abgelaufen — Auto-Refund" · `guthaben_2y_auto_refund`
„Guthaben 2J abgelaufen — Refund" · `replacement_credit_invalid`
„Ersatztermin — Credit ungültig (nicht umgebucht)" · `kursabbruch_token_reclicked`
„Kursabbruch-Token erneut geklickt" · `apply_cancellation_refund_failed`
„Erstattungs-RPC fehlgeschlagen"

**Admin / DSGVO / Recht:** `admin_illness_credit` „Krankheits-Guthaben vergeben" · `admin_bulk_mail`
„Bulk-Mail versendet" · `admin_dsgvo_deletion` „DSGVO-Löschung durch Admin" · `yogi_deleted`
„User gelöscht" · `yogi_anonymized_dsgvo` „Yogi anonymisiert (DSGVO)" · `legal_accepted`
„AGB bestätigt" · `profile_email_update_failed` „Profil-Email-Update fehlgeschlagen"

**System / Inaktivität (24-Monats-Cron):** `inactivity_cleanup_dryrun` „Inaktivitäts-Check (Trockenlauf)" ·
`inactivity_cleanup` „Inaktive Konten gelöscht" · `yogi_auto_deleted_inactive`
„Konto autom. gelöscht (24 Mon. inaktiv)" · `inactivity_cleanup_error` „Inaktivitäts-Löschung: Fehler"

> Detail-Hinweis: `course_credits_auto_expired` hat ein `ACTION_LABELS`-Label, aber **keinen**
> eigenen `formatAuditEntry`-Fall (fällt auf die Default-Beschreibung zurück).

---

## 7. Konzept-Vorschlag: Automatische Löschung inaktiver Konten (24 Monate)

> **Status: IMPLEMENTIERT (2026-05-30) — läuft im sicheren TROCKENLAUF.** Das Feature ist live:
> die RPCs `find_inactive_accounts()` + `cleanup_inactive_accounts()` und ein wöchentlicher
> `pg_cron`-Job (`cleanup-inactive-accounts`, Mo 03:00 UTC) sind angelegt
> (Migration `supabase/migrations/20260530_cleanup_inactive_accounts.sql`). Der Cron ruft
> `cleanup_inactive_accounts(true, …)` — also **Trockenlauf**: es wird **nichts gelöscht**.
> **Seit 2026-05-31 (Migration `20260531_quiet_dryrun_notifications.sql`):** Die Dashboard-Meldung
> („… N Konto(en) wären löschbar …") wird **nur bei Treffer** (`candidates > 0`) geschrieben; bei 0
> bleibt das Dashboard still. Ein **audit_log-Eintrag** `inactivity_cleanup_dryrun` wird weiterhin
> **bei jedem Lauf** geschrieben (stiller „Cron lief"-Nachweis im Protokoll). **Scharfschalten** = den
> Cron-Aufruf auf `cleanup_inactive_accounts(false, 50, 24)` ändern, sobald Sarah eine
> Trockenlauf-Meldung gesichtet hat. Aktuell qualifizieren sich **0 Konten** (App zu jung).
> Die folgende Beschreibung entspricht der umgesetzten Logik.

### 7.1 Ziel & Regel

Yogis, die seit **24 Monaten inaktiv** sind, sollen **zusammen mit ihren Protokollen**
automatisch gelöscht/anonymisiert werden. Eine Löschung darf **nur** erfolgen, wenn der Yogi:

1. seit ≥ 24 Monaten inaktiv ist — gemessen am **robusten Aktivitätssignal**
   `GREATEST(auth.users.last_sign_in_at, letzte audit_log-Aktion des Yogis)` (nicht nur am
   `last_sign_in_at`: ein aktiver PWA-Dauer-Login hätte sonst ein veraltetes Login-Datum),
2. **keine offenen Credits** mehr hat (kein `credits`-Eintrag mit `total > used` und `expires_at > now()`),
3. **keine zukünftigen Buchungen** hat (keine `bookings` mit `status = 'active'` auf eine Session `>= heute`),
4. **kein Admin** ist (`profiles.is_admin = false`).

### 7.2 Warum das elegant ins bestehende Setup passt

Es gibt bereits **genau dieses Muster** für die Stunden-Erinnerungen:

```
pg_cron  ──(Zeitplan)──►  Edge Function  ──►  SECURITY DEFINER RPC  ──►  Aktion
(send-session-reminders alle 15 Min  →  find_pending_session_reminders  →  Mail)
```

Das neue Feature kann **1:1 demselben Muster** folgen — nichts Neues an der Architektur:

```
pg_cron (1× pro Woche)
   └─► Edge Function  cleanup-inactive-accounts
          ├─ 1) RPC  find_inactive_accounts()        → Liste löschbarer user_ids (read-only)
          ├─ 2) optional: Warn-Mail an Grenzfälle (z. B. 11 Monate) — „dein Konto wird bald gelöscht"
          └─ 3) RPC  anonymize_and_delete_user(uuid)  → pro user_id anonymisieren + löschen
```

### 7.3 Bausteine im Detail

**(a) Zeitplan via pg_cron** — wie beim Reminder-Cron, nur wöchentlich (z. B. Montag 03:00 Berlin):

```sql
-- KONZEPT (nicht anwenden):
select cron.schedule(
  'cleanup-inactive-accounts',
  '0 3 * * 1',                    -- jeden Montag 03:00
  $$ select net.http_post(
       url    := '<SUPABASE_URL>/functions/v1/cleanup-inactive-accounts',
       headers:= jsonb_build_object('x-function-secret', '<EDGE_FUNCTION_SECRET>')
     ) $$
);
```

**(b) Lese-RPC `find_inactive_accounts()`** — `SECURITY DEFINER` (muss `auth.users` lesen,
das liegt im `auth`-Schema, nicht in `public.profiles`!). Liefert nur die wirklich löschbaren
Konten, prüft alle 4 Bedingungen aus 7.1:

```sql
-- KONZEPT (nicht anwenden):
create or replace function public.find_inactive_accounts()
returns table (user_id uuid) language sql security definer set search_path = public as $$
  select u.id
  from auth.users u
  join public.profiles p on p.id = u.id
  where coalesce(p.is_admin, false) = false
    and u.last_sign_in_at < now() - interval '24 months'
    -- keine offenen Credits
    and not exists (
      select 1 from public.credits c
      where c.user_id = u.id and c.total > c.used and c.expires_at > now()
    )
    -- keine zukünftigen aktiven Buchungen
    and not exists (
      select 1 from public.bookings b
      join public.sessions s on s.id = b.session_id
      where b.user_id = u.id and b.status = 'active' and s.date >= current_date
    );
$$;
```

**(c) Lösch-RPC `anonymize_and_delete_user(target uuid)`** — bündelt **dieselben Schritte**
wie die bestehende DSGVO-Selbstlöschung (siehe Abschnitt 5.1), damit es genau eine „Wahrheit"
für das Löschen gibt:

1. `profiles` anonymisieren (`first_name='Gelöschter'`, `last_name='Nutzer'`, `email=null`, Notfallkontakt `null`),
2. `legal_acceptances` anonymisieren,
3. `waitlist`, `enrollments`, `bookings`, `credits`, `notification_log`, `waitlist_offers`,
   `course_cancellation_responses` hart löschen,
4. **`audit_log` anonymisieren über die bestehende RPC** `anonymize_user_audit_logs(target)`
   (siehe `supabase/migrations/20260530_anonymize_user_audit_logs.sql`) — der strukturelle
   Audit-Trail bleibt erhalten, nur die PII verschwindet,
5. `audit_log`-Eintrag `action = 'yogi_auto_deleted_inactive'` schreiben (Begründung + Snapshot),
6. den Auth-User löschen (`auth.admin.deleteUser` aus der Edge Function, da Service-Role nötig).

> **Wichtig:** Schritt 6 (Auth-User löschen) gehört in die **Edge Function** (Service-Role-Kontext),
> nicht in die SQL-RPC — analog zur bestehenden `/api/delete-account`-Logik. Die RPC erledigt
> nur die Datenbank-Schritte 1–5.

### 7.4 Sicherheits- & Qualitäts-Leitplanken (vor Umsetzung)

- **Trockenlauf zuerst:** In Phase 1 nur `find_inactive_accounts()` laufen lassen und das
  Ergebnis als `admin_notifications` melden („N Konten wären löschbar") — **ohne** zu löschen.
  So sieht Sarah erst, **wen** es treffen würde, bevor scharf geschaltet wird.
- **Vorwarnung per E-Mail** (z. B. 30 Tage vor der 24-Monats-Grenze) mit Reaktivierungs-Hinweis
  („melde dich einmal an, dann bleibt dein Konto erhalten").
- **Admins & echter Account** sind hart ausgeschlossen (`is_admin = false` + ggf. Allowlist).
- **Idempotenz & Logging:** jede Löschung erzeugt einen Audit-Eintrag; bereits anonymisierte
  Profile (`first_name = 'Gelöschter'`) werden übersprungen.
- **Keine harte Frist im Cron:** Batch-Größe pro Lauf begrenzen (z. B. max. 50), damit ein
  Fehler nie viele Konten auf einmal betrifft.
- **DSGVO-konform & konsistent:** Da exakt die bestehenden Lösch-/Anonymisierungs-Schritte
  wiederverwendet werden, bleibt das Verhalten identisch zur manuellen Löschung (kein zweiter,
  abweichender Code-Pfad).

---

## Änderungshistorie

### 2026-06-02 (Nachmittag) — Live-Bugfixes + zentrale Hinweis-Persistenz + Update-Stabilität

Wave direkt vor Go-Live. Reihenfolge spiegelt die Commits.

**1) KRITISCH — Kurs-Anlegen crasht (`berlinDateStr is not defined`).** Regression aus
Zeitzonen-Welle 2: `app/admin/kurse/page.tsx` nutzte `berlinDateStr()` in
`getDatesForCourse()`, ohne es zu importieren → weiße Seite beim Anlegen/Bearbeiten
eines Kurses mit Zukunfts-Enddatum. **Nicht vom Build gefangen**, weil
`next.config.js` `typescript.ignoreBuildErrors:true` setzt. Fix: Import ergänzt.
Verifikation neu: `tsc --noEmit` gefiltert auf TS2304/TS2552 (Cannot-find-name) in
app/lib/components + Import/Aufruf-Guard in `62-zeitzonen-berlin.spec.ts`. Commits
`c301aca`, `5f66108`.

**2) Einbuchen über „Yogi zu bestehendem Kurs hinzufügen" buchte begonnene Stunde mit.**
`addYogiToCourse` (admin/kurse) filterte Sessions nur per `.gte('date', berlinTodayStr())`
— **ohne** den minutengenauen Berlin-Filter (in Welle 2 übersehen). Eine heute bereits
gestartete Stunde wurde gebucht (zählte als „Teilgenommen" + in den Credit). Fix:
gleicher `parseSessionDateTimeBerlin(...).getTime() > now`-Filter wie die Yogi-Detail-
Pfade. Prod-Altdaten bereinigt. Test in `62-zeitzonen-berlin.spec.ts`. Commit `0abed02`.

**3) Wegklickbare Hinweise verschwanden nicht dauerhaft → EIN zentraler Mechanismus.**
Mehrere Banner merkten sich das Wegklicken nur in `localStorage` → beim Logout
(`localStorage.clear()`) oder auf anderem Gerät/Browser kamen sie wieder. Lösung:
- **Tabelle `user_dismissals(user_id, key)`** (RLS: nur eigene Zeilen) + Hook
  `lib/hint-dismissals.ts` (`useHintDismissals` → `isDismissed/dismiss`), DB-persistent,
  localStorage nur Cache. Umgestellt: **Geburtstags-Banner** (`birthday:<Woche>`),
  **„Sarah trägt dich ein"** (`new_yogi`), **Credit-Ablauf-Warnung** (`credit_expiry:<id>`).
  UpdateBanner bleibt gerätelokal; Onboarding ist bereits DB-gestützt. Backfill in der
  Migration. Commit `cea9f5d`, Test `63-hint-dismissals.spec.ts`.
- **ROOT-CAUSE-FIX:** `user_dismissals` (und die zuvor angelegte `admin_banner_dismissals`)
  hatten **kein `GRANT SELECT, INSERT` für die `authenticated`-Rolle** → Postgres blockte
  jeden Client-Zugriff **vor** der RLS-Policy → Wegklicken wurde nie gespeichert/gelesen.
  Lesson learned: Tabellen via `apply_migration` (MCP) bekommen **nicht** automatisch
  anon/authenticated-Grants — künftig explizit setzen. Migration
  `20260602_user_dismissals_grants.sql` (Staging + Prod), als eingeloggter Nutzer
  verifiziert. Commit `8e0653c`.

**4) PWA-Update-Stabilität (Fixes erreichten Geräte nicht).**
- **Automatischer Update-Hinweis**: `UpdateBanner` vergleicht jetzt die eingebaute
  `NEXT_PUBLIC_BUILD_SHA` mit der live deployten (`/api/version`). Bei Abweichung
  erscheint „Neue Version verfügbar" **automatisch** (zusätzlich zum manuellen Toggle),
  self-resolving nach Reload. Commit `4f0f2aa`.
- **Service Worker v9**: Navigationen (HTML) werden mit `cache:'no-store'` geladen →
  iOS/WebKit kann kein altes Dokument mehr liefern; jeder Start referenziert das
  aktuelle Bundle. `CACHE_VERSION` bump erzwingt SW-Update. Commit `521f34b`.

**Bestätigt (alle Hinweis-/Benachrichtigungs-Wege geprüft, Grants + RLS):**
`user_dismissals` (behoben), `yogi_notifications` (Kurs-/Event-Abbruch, `dismissed_at`),
`admin_notifications` (Admin-Feed inkl. Kursabbruch/Auszahlen, `read=true`),
`course_cancellation_responses` (Auszahl-Aufgaben, datengetrieben). Kein Hinweis offen.

**Prozess ab hier:** keine direkten Prod-Änderungen mehr — Build + Test auf **Staging**,
erst nach erfolgreichem Test Migration/Deploy auf **Prod**. Staging und Prod sind nach
den heutigen Migrationen schema-gleich.

### 2026-06-02 — Zeitzonen-Welle 2: durchgängig Europe/Berlin (DST-sicher)

**Grund-Bug:** `new Date().toISOString().split('T')[0]` liefert das **UTC**-Datum.
Kurz nach Mitternacht Berlin (UTC noch Vortag) wurde dadurch z. B. beim Einbuchen
eine bereits vergangene Stunde noch als „heute/Zukunft" gewertet → Yogi bekam eine
Buchung für eine schon gelaufene Stunde („Teilgenommen" statt „—").

**Zentrale Helfer** (`lib/session-time.ts`): `berlinTodayStr()` / `berlinDateStr(d)`
→ Berlin-Kalenderdatum `YYYY-MM-DD` über `toLocaleDateString('en-CA', { timeZone:
'Europe/Berlin' })` (Sommer-/Winterzeit automatisch korrekt). Für Stunden-Zeitpunkte
weiterhin `parseSessionDateTimeBerlin(date,time)`.

**Umgestellt (alle Audit-Fundstellen):**
- **Einbuchen** (`admin/yogis`): Berlin-Datum **+ minutengenauer** Zukunfts-Filter
  (`parseSessionDateTimeBerlin(...).getTime() > now`) → heute bereits begonnene
  Stunden werden **nicht mehr** mitgebucht.
- **Fristen/Status:** `session-status` (isStarted/isCourseEnded/isPastDay/
  countActiveFutureUnits), `credit-selector` (Vorhol-/Nachhol-Fenster),
  `waitlist-offer` 90-Min-Frist (serverseitig) — alle Berlin-verankert, null-sicher.
- **„heute"-Datumsgrenzen + Wochenfenster + Defaults** in kurse/anwesenheit/meine/
  einladen/profil/dashboard/credits/sessions/register/rechtliches/nachweise →
  `berlinTodayStr()`/`berlinDateStr()`.
- **DB:** `fn_check_yogi_birthdays` + `fn_check_courses_ending_soon`: `CURRENT_DATE`
  → `(now() AT TIME ZONE 'Europe/Berlin')::date` (Migration `20260602`, Staging + Prod).
- **Unverändert (korrekt):** alle `expires_at`/`created_at`-Instant-Vergleiche
  (`> new Date().toISOString()`) — die vergleichen absolute Zeitpunkte, kein Datum.

**Verifiziert:** DST-Beweis (node) — 00:38 Sommer → 2.6., 00:30 Winter → 2.12.;
alter UTC-Code lag je einen Tag daneben. Build grün. Regressions-Test
`tests/e2e/62-zeitzonen-berlin.spec.ts`. Commit `94f2f67`.

### 2026-06-01

**Geschäftslogik (Credits & Guthaben):**

- **Guthaben → Kurs-Credit-Umwandlung beim Einbuchen (NEU, maßgeblich):** Trägt der Admin
  einen Yogi mit Guthaben in einen Kurs ein, wird das Guthaben **1:1 in einen Kurs-Credit
  umgewandelt** (`total` = alle Kursstunden), alle Buchungen hängen am Kurs-Credit, und das
  vollständig umgewandelte Guthaben wird **gelöscht (verschwindet spurlos)**. Ab dann gelten
  reine Kurs-Credit-Regeln. Gilt für **beide** Guthaben-Arten (`illness` + `cancellation_choice`).
  Details: Abschnitt **3.2a**. Datei `app/admin/yogis/[id]/page.tsx` (`handleEnroll`).
  Vorher (Bug): Kurs-Credit wurde nur mit dem bezahlten Rest angelegt → Kurs zeigte zu wenige
  Credits (z. B. 2 statt 5). Daten-Reparatur für betroffenen Yogi (Mindful & Slow) durchgeführt.
  Test: `tests/e2e/admin/08-admin-guthaben-kurs.spec.ts` (aktualisiert).
- **Fristen-Klarstellung (unverändert in der Logik, jetzt auch in der Mail sichtbar):**
  Krankheits-Guthaben **10 Monate**, Kursabbruch-Guthaben **2 Jahre** (siehe Fristen-Matrix 3.1
  / Sektion 5).

**E-Mail:**

- **Fix „Gültig bis Invalid Date"** in der Krankheits-Austragungs-Mail (`illness_credit`):
  `fmtDate`/`fmtDateShort` in der Edge Function `send-email` (v85) schneiden den Datums-String
  jetzt auf `YYYY-MM-DD` (tolerant gegen volle ISO-Timestamps). Die Mail zeigt zusätzlich
  **„(10 Monate)"** hinter dem Datum. Test `27-email-plausibilitaet` erweitert.

**Admin-UI (reine Anzeige, keine Logik):**

- **Yogi-Detail — zeitlich begrenzte Teilnahme (Range-Einbuchung):** Pille zeigt
  „Teilnahme nur vom X bis Y", Stunden außerhalb des Zeitraums zeigen „—" statt „Ausgetragen"
  (Teilnahme-Zeitraum aus credit-verknüpften/aktiven Buchungen). Test `admin/46-…`.
- **Yogi-Liste — kompakte Karten** im Stil der Yogi-Dashboard-Kacheln (Name fett, Rest klein
  darunter, `p-3`). Test `admin/47-…`.
- **Yogi-Detail — Bereich „Letzte Buchungen" entfernt** (redundant: Status steht unter
  „Eingebuchte Kurse", Historie im aufklappbaren Protokoll). Helfer `getStatusBadge` +
  `bookingStatusLabel`-Import entfernt; Status-Label-Tests (52-spec) auf das Stunden-Grid umgestellt.
- **Admin-Kurse — die drei Buttons „Neuer Kurs / Neue Stunde / Neues Event"** stehen jetzt
  **auch in der Handy-Ansicht nebeneinander** (immer `grid-cols-3`).

> Commits 2026-06-01: `002f388` (Range-Anzeige), `eef1270` (kompakte Karten),
> `e8dac7f` („Letzte Buchungen" entfernt), `3ce1a15` + `41e9f5f` (Guthaben-Umwandlung),
> `c3b6156` (Email-Datum-Fix), `d93e80e` (Buttons nebeneinander). Edge `send-email` v85.

---

*Ende der System-Dokumentation. Diese Datei sollte bei jeder relevanten Code-Änderung
mitgepflegt werden (Test-Sync-Regel + Code-Änderungs-Prozess).*
