# V2 — Events (geplant nach Go-Live V1)

**Status:** Konzept genehmigt 2026-05-23. Nicht in V1. Wird nach Stabilisierung gebaut.

**Wichtigste Regel:** Credit-System wird zu **100% nicht berührt**. Events sind komplett eigene Domain.

---

## 1. Was Events sind (vs. heute)

Heute hat die App zwei Buchungs-Modelle: **Kursstunden** (über Course-Credits) und **Einzelstunden** (über Tenpack/Single/Quartal-Credits).

Events sind etwas Drittes:
- Einmalige Termine mit eigenem Preis (z.B. „Yoga-Retreat 35 €")
- Bezahlung läuft **direkt an Sarah** (PayPal, Bar, Überweisung) — kein Credit
- Anmeldung in zwei Schritten: **Vormerken** → Sarah bestätigt **Bezahlung** → eingebucht
- Eigenes Titelbild
- Eigene Stornofrist

---

## 2. DB-Schema (3 neue Tabellen)

```sql
-- Events: Stammdaten
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  beschreibung text,
  datum_uhrzeit timestamptz NOT NULL,
  dauer_min integer NOT NULL,
  ort text,
  preis_cents integer NOT NULL,            -- in Cent! 3500 = 35,00 €
  max_plaetze integer NOT NULL,
  bild_url text,                            -- Supabase Storage URL
  anmeldung_bis timestamptz,                -- optional, sonst bis Event-Start
  zahlfrist_tage integer DEFAULT 7,
  storno_frist_h integer DEFAULT 168,       -- 7 Tage
  storniert boolean DEFAULT false,
  storno_grund text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Anmeldungen: pending/paid/cancelled/waitlist_promoted
CREATE TABLE event_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending_payment','paid','cancelled','waitlist_promoted')),
  marked_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  zahl_methode text,                        -- 'paypal' | 'bar' | 'ueberweisung'
  notiz text,
  UNIQUE (event_id, user_id)
);

-- Warteliste + Notify
CREATE TABLE event_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('waitlist','notify')),
  position integer,
  created_at timestamptz DEFAULT now(),
  UNIQUE (event_id, user_id)
);

-- Cross-Storage: Supabase Storage Bucket "event-images" mit public-read.
-- Admin lädt Bild hoch, URL kommt in events.bild_url.
```

---

## 3. Anwendungsfälle (User-Flows)

### A) Admin legt Event an
Pfad: `/admin/events/neu` → Formular mit allen Feldern + Bild-Upload → Klick „Speichern".

### B) Yogi sieht Event in Übersicht
- Eigener Tab **„Events"** in Bottom-Nav (entschieden)
- Liste sortiert nach Datum, Mini-Bild + Name + Datum + Preis + Plätze
- Klick → `/events/[id]` mit grossem Header-Bild

### C) Yogi merkt sich vor
1. Klick „Vormerken"
2. Dialog: „35 € bis 11.6. an Sarah zahlen. Stornofrist: 7 Tage vor Event."
3. Bestätigen → DB-Insert `event_bookings` mit `status='pending_payment'`
4. Email an Yogi: Vormerkung bestätigt + Zahl-Info
5. Email an Sarah: „Anna will an Event X"

### D) Sarah bestätigt Zahlung
- `/admin/events/[id]` zeigt Liste „Vorgemerkt" mit Yogi-Namen
- Pro Eintrag Dropdown „Bezahlmethode" + Notiz-Feld + Button **„Als bezahlt markieren"**
- Klick → `status='paid'`, `paid_at=NOW`, `zahl_methode='paypal'`
- Email an Yogi: „Du bist eingebucht!"

### E) Yogi storniert vor Frist
- Klick „Abmelden" → Dialog „Geld wird erstattet (Sarah meldet sich)"
- `status='cancelled'`, Email an Sarah „bitte 35€ zurückzahlen an Anna"
- Falls noch nicht bezahlt: stille Stornierung, nur Notification an Admin

### F) Yogi storniert NACH Frist
- Dialog warnt: „Stornofrist abgelaufen — Geld bleibt bei Sarah"
- Bestätigt → `status='cancelled'`, KEINE Erstattungs-Email (Sarah verdient)
- Platz wird trotzdem frei für Warteliste

### G) Warteliste-Promote bei Storno
**Sarah's Entscheidung 2026-05-23: analog zur 90-Min-Cutoff-Logic.**
- Ersten Waitlist-Yogi findet App → Email „Platz frei! Du bist als Erste/r dran. [Ja, ich nehme]"
- Klick → wird als `pending_payment` eingetragen (NICHT direkt paid — er muss erst zahlen)
- Email an Sarah „Anna ist nachgerückt, wartet auf Zahlung"
- Wenn Yogi nicht klickt: nach X Stunden Email an Yogi #2 etc.

### H) Notify-Subscribers
- Wie heute bei Stunden: „Informier mich wenn frei" → Mail bei Storno

### I) Event-Absage durch Admin
- Admin in `/admin/events/[id]` klickt „Event absagen"
- Optional: Grund
- DB: `events.storniert=true`
- Alle bezahlten Yogis: Email „Event abgesagt, Sarah erstattet dir 35€"
- Alle vorgemerkten: Email „Event abgesagt, Vormerkung erlischt"
- Admin: CSV-Export der zu erstattenden Beträge

### J) Zahlungsfrist überschritten
**Sarah's Entscheidung: manuelle Behandlung (nicht Auto-Löschen).**
- Sarah sieht im Admin-Detail Marker „Pending seit 8 Tagen"
- Kann manuell anschreiben oder löschen
- Optional Phase 3: Cron der Sarah per Email erinnert „2 Yogis pending > 5 Tage"

### K) Reminder vor Event
- Cron analog zu `session_reminder`: 24h vor Event-Start → Email „Morgen 10:00, vergiss nicht!"
- Nur an `status='paid'` Yogis

---

## 4. Email-Templates (8 neue)

| Key | Empfänger | Trigger |
|---|---|---|
| `event_marked_pending` | Yogi | Nach Vormerkung |
| `event_admin_new_marking` | Sarah | Nach Vormerkung |
| `event_paid_confirmed` | Yogi | Sarah klickt „bezahlt" |
| `event_cancelled_by_yogi` | Sarah | Yogi storniert (mit bezahlt/nicht-Info) |
| `event_cancelled_by_admin` | Yogi | Sarah sagt Event ab |
| `event_payment_reminder` | Yogi | 2 Tage vor Ablauf Zahlfrist (Phase 3) |
| `event_waitlist_offered` | Yogi | Warteliste, Platz frei (analog 90-Min-Cutoff) |
| `event_reminder` | Yogi | 24h vor Event |

---

## 5. UI-Routen (neu)

| Pfad | Wer | Inhalt |
|---|---|---|
| `/events` | Yogi | Übersicht aller zukünftigen Events |
| `/events/[id]` | Yogi | Detail mit grossem Bild, Beschreibung, Vormerken-Button |
| `/event-angebot/[token]` | Yogi | Waitlist-Annahme-Page (analog 90-Min-Cutoff) |
| `/admin/events` | Admin | Liste aller Events mit Status |
| `/admin/events/neu` | Admin | Event anlegen Formular |
| `/admin/events/[id]` | Admin | Detail mit 3 Sektionen: Bezahlt / Vorgemerkt / Warteliste |

## UI-Erweiterungen bestehend

- **Bottom-Nav Yogi**: neuer Tab „Events" zwischen „Kurse" und „Wartelisten"
- **Admin-Sidebar**: neuer Eintrag „Events"
- **`/meine`**: neuer Block „Meine Events" unter den bestehenden Sektionen, mit Status-Badge (`Vorgemerkt` 🟡 / `Eingebucht` ✅ / `Warteliste` 👥)
- **`/admin/yogis/[id]`**: optional neuer Block „Eingebuchte Events" für Übersicht pro Yogi

---

## 6. Bild-Upload (technisch)

- **Supabase Storage Bucket „event-images"** mit public-read RLS
- Admin-Form: Upload via `supabase.storage.from('event-images').upload(...)`
- Bild wird normalisiert (Crop 16:9, max 1200x675, JPEG-Komprimierung auf ~150 KB)
- URL kommt in `events.bild_url`
- Fallback: wenn `bild_url=NULL` → Default-Placeholder (z.B. einheitliches Yoga-Symbol)
- Im Header-Bild Email-Template: NICHT als Background nutzen (Dark-Mode-Problem aus V1), sondern als `<img>` mit fixer Höhe

---

## 7. Edge-Cases (Sarah entschieden 2026-05-23)

| # | Edge-Case | Entscheidung |
|---|---|---|
| 1 | Auto-Löschen pending bei Frist-Ablauf | Nein — manuell durch Admin |
| 2 | Warteliste-Promote bei Storno | Analog zu 90-Min-Cutoff (Auswahl-Mail) |
| 3 | Yogi zahlt erst beim Event vor Ort | Erlaubt — Admin markiert ad-hoc als bezahlt |
| 4 | Doppel-Vormerkung | UNIQUE-Constraint `(event_id, user_id)` |
| 5 | Wo Events anzeigen | Eigener Tab in Bottom-Nav |
| 6 | Anmeldung-Schluss-Datum | Optionales Feld, nicht verpflichtend |
| 7 | Notify-Subscribe für Events | Ja, gleiche Mechanik wie Stunden |
| 8 | Buchhaltungs-CSV-Export | **Pflicht** — pro Event Liste „Name, Email, Bezahlt-am, Methode, Betrag" |

---

## 8. Aufwand & Phasen

### Phase 1 — MVP (~4-5h)
- DB-Migration
- Event anlegen Formular (Admin)
- Yogi-Übersicht + Event-Detail
- Vormerken-Flow (Yogi + Email)
- „Als bezahlt markieren"-Flow (Admin + Email)
- 3 Email-Templates: `event_marked_pending`, `event_admin_new_marking`, `event_paid_confirmed`
- `/meine` zeigt eingebuchte Events
- **ohne** Bild-Upload (Placeholder), **ohne** Warteliste, **ohne** Stornierung

### Phase 2 — Stornierung + Warteliste + Bild (~3h)
- Bild-Upload (Supabase Storage)
- Yogi-Stornierung (vor/nach Frist)
- Event-Absage durch Admin
- Waitlist-Logic (Auswahl-Mail analog 90-Min)
- Notify-Subscribers
- 4 weitere Email-Templates

### Phase 3 — Polish + Cron (~2h)
- Buchhaltungs-CSV-Export
- Cron: Reminder vor Event (24h)
- Cron: Zahlungsfrist-Warnung an Admin
- Admin-UI Notiz-Feld, Bezahlmethode-Dropdown
- E2E-Tests + Notion-Sync

**Gesamt-Aufwand:** ~10-11h für komplettes Feature.

---

## 9. Risiken & wichtige Hinweise

1. **Admin-Disziplin**: System hängt von regelmässigen „Bezahlt"-Klicks ab. Tägliche Erinnerungs-Email kann helfen.
2. **Steuerlich**: CSV-Export ist Pflicht für Buchhaltung — nicht erst in Phase 3 wenn möglich.
3. **Auto-Refund**: Die App kann **kein** PayPal-Geld zurücküberweisen. Sarah macht das manuell, App schickt nur die Erinnerung.
4. **Credits getrennt**: Course-Credits/Tenpack/Guthaben sind **NIE** für Events nutzbar. Komplette Trennung.
5. **Bilder**: bei Email-Templates KEINE Background-Bilder verwenden (V1-Dark-Mode-Erfahrung). Nur als `<img>` mit fester Höhe.

---

## 10. Was vor Implementation noch zu klären ist

- **Storno-Erstattung**: macht Sarah über PayPal? Wenn ja, hilft die App mit einem deeplink (z.B. „PayPal-Adresse von Anna für Erstattung")?
- **Mehrteilige Events** (Wochenende mit 2 Tagen): in V2 nicht? In V3 als „Event-Serie"?
- **Externe Teilnehmer ohne App-Account**: vorerst nein — alle Yogis brauchen ein App-Konto. (Künftig denkbar: Public-Anmeldung über Link ohne Login.)
- **DSGVO**: bei Events ist eine Yogi-Liste mit Zahlungsdaten sensibler. CSV-Export sollte Admin-only sein.
