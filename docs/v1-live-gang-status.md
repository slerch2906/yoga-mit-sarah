# V1 Live-Gang — Status & Checkliste

**Stand:** 2026-05-23

---

## Was alles in V1 enthalten ist (Auszug der wichtigen Features)

### Kerne Buchungslogik
- ✅ Course-Credits, Tenpack, Single, Quartal, Guthaben
- ✅ Vorhol-/Nachhol-Buchungen (10d-Window + 8d-Nachholfenster)
- ✅ Smart Credit-Picker (Course vor Tenpack vor Quartal vor Single)
- ✅ Credit-Ablauf minutengenau bis Session-Zeitpunkt
- ✅ Einzelstunden vs Kurs-Block Klassifizierung (Kurs-Membership-basiert)
- ✅ Cascade-Stornierung bei Kursabbruch
- ✅ Refund/Guthaben/Erstattungs-Workflow bei Kursabbruch (yogi_choice)

### Admin-Funktionen
- ✅ Kurse erstellen, bearbeiten, archivieren, absagen
- ✅ Yogis verwalten + Detailansicht mit Stunden-Aufstellung
- ✅ Einladungen erstellen, Soft-Delete, Reminder (alles in /admin/einladen integriert)
- ✅ Ersatzstunden anlegen + Cascade-Buchung der Yogis
- ✅ Manuelles Yogi-Hinzufügen zu Stunden (auch Überbuchung)
- ✅ Warteliste-Yogi manuell zur Stunde hinzufügen
- ✅ Notfallkontakt klickbar (tel + WhatsApp)
- ✅ AGB-Push-Workflow (Versionsname + Changelog)
- ✅ Admin-Yogi-Detail: Stunden-Aufstellung pro Kurs mit Status + Ersatzstunden-Marker

### Yogi-Funktionen
- ✅ Buchen + Abmelden + Reaktivieren
- ✅ Warteliste eintragen + austragen
- ✅ Notify-Subscribe
- ✅ Profil + Notfallkontakt
- ✅ AGB-Re-Acceptance bei neuer Version

### Wartelisten-Auto-Promote
- ✅ > 90 Min vor Stunde: erster Yogi auto-promoted
- ✅ ≤ 90 Min: alle Waitlist-Yogis gleichzeitig „Sei-schnell"-Mail
- ✅ Race-safe: wer zuerst klickt, gewinnt
- ✅ In ALLEN 4 Abmelde-Stellen integriert (Yogi-Self, Admin-Stunde, Admin-Yogi-Profil, Admin-Dashboard)

### Emails (Brevo)
- ✅ 16+ Template-Typen (Welcome, Booking-Confirmed, Cancellation, Reminder, Course-Cancelled, Waitlist, etc.)
- ✅ Password-Reset cross-device-safe (verifyOtp)
- ✅ Konditionale Texte (verrechnetes Guthaben, Mid-Course, Ersatz-Stunde, etc.)
- ✅ Header: solider grauer Block, Logo zentriert, Titel — funktioniert im Dark-Mode

### Sicherheit
- ✅ RLS auf 9+ Tabellen
- ✅ DSGVO-Anonymisierung
- ✅ AGB-Akzeptanz mit Drive-Backup-PDF
- ✅ prevent_booking_cancelled_session Trigger (auch für Admin)

### Tests
- ✅ Playwright-Suite mit 138+ aktiven Tests (alle grün)
- ✅ Test-Specs für 90-Min-Cutoff + AGB-Workflow als fixme-Stubs angelegt (warten auf GO)
- ✅ Notion Workflow-DB synchron

---

## Was vor Live-Gang noch verifizieren

### Visuell prüfen
- [ ] Dark-Mode Test-Email (v51) ist Logo+Titel jetzt richtig sichtbar?
- [ ] Admin-Profil: AGB-Label zeigt „Dezember 2025" (nicht „lädt…")
- [ ] Ersatzstunden-Marker beim Klick auf eine Ersatzstunde in /admin/sessions
- [ ] Excluded-Stunden NICHT mehr als „Abgesagt" in Admin-Yogi-Detail

### Funktional prüfen
- [ ] Test-Yogi anlegen → 1 Kurs zuweisen → Stunde abmelden → Mail kommt?
- [ ] Test-Yogi auf Warteliste setzen → Platz frei machen → Mail kommt?
- [ ] Test-Stunde absagen mit Ersatztermin → Yogi automatisch umgebucht?
- [ ] Passwort-Reset auf einem Gerät anfordern, Link am anderen Gerät klicken → funktioniert?

### Optional vor Go-Live
- [ ] 90-Min-Cutoff Test-Spec ausführen (30-90min-cutoff-und-agb.spec.ts)
- [ ] AGB-Workflow live testen: neue Version pushen, Yogi-Login → Re-Acceptance-Banner
- [ ] Volle Test-Suite nochmal grün: `npm run test:e2e`

---

## Bewusst NICHT in V1

- **Events** (s. `v2-events-konzept.md`) — separate Domain, nach Stabilisierung
- **Mehrtages-Veranstaltungen / Retreats** — kommt mit Events V2
- **Externe Anmeldung ohne App-Konto** — möglich V3
- **PayPal-Integration für Auto-Erstattung** — nicht geplant
- **Mobile Push-Notifications** — aktuell nur Email
- **Mehrsprachigkeit** — aktuell nur Deutsch

---

## Bekannte kleine Schwächen V1 (akzeptiert)

1. **Browser-Cache**: nach Updates muss man manchmal Strg+Shift+R drücken
2. **Email-Background-Bilder**: in V1 bewusst kein Header-Bild — Dark-Mode-Problem
3. **Admin-Disziplin nötig**: AGB-Updates müssen aktiv über das Formular gepusht werden

---

## Roadmap V2+ (nach Live-Gang in Reihenfolge)

1. **Events** (s. `v2-events-konzept.md`) — ~10h, eigenes Feature-Paket
2. **Mehrtages-Veranstaltungen** (mit Events kombiniert)
3. **Buchhaltungs-Export** (Events-CSV, evtl auch für Kurse)
4. **Statistics-Page** (Belegung pro Kurs, Yogi-Aktivität)
5. **Mobile Push-Notifications** (eventuell)
