/* eslint-disable */
/**
 * Generiert "Yoga-mit-Sarah-Anwendungsfaelle.docx" als vollständiges
 * Prüfdokument für Sarah. Strukturiert nach 17 Bereichen, mit Inhalts-
 * verzeichnis, Prüfboxen und exakten UI-/Email-Texten.
 *
 * Aufruf: node scripts/generate-anwendungsfaelle.js
 */

const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, PageBreak,
  TableOfContents, StyleLevel, LevelFormat, convertInchesToTwip,
  ShadingType, CheckBox,
} = require('docx')

// ────────────── Hilfsfunktionen ──────────────
const FONT = 'Arial'

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 80, ...(opts.spacing || {}) },
    alignment: opts.alignment,
    children: [new TextRun({ text, font: FONT, size: opts.size || 22, bold: opts.bold, italics: opts.italic, color: opts.color })],
  })
}
function pRich(runs, opts = {}) {
  return new Paragraph({
    spacing: { after: 80, ...(opts.spacing || {}) },
    alignment: opts.alignment,
    children: runs.map(r => new TextRun({ font: FONT, size: r.size || 22, ...r })),
  })
}
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    children: [new TextRun({ text, font: FONT, size: 32, bold: true, color: '3d3a39' })],
  })
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 100 },
    children: [new TextRun({ text, font: FONT, size: 26, bold: true, color: '8a6020' })],
  })
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text, font: FONT, size: 22, bold: true })],
  })
}
function label(labelText, body) {
  return pRich([
    { text: labelText + ' ', bold: true },
    { text: body },
  ])
}
function quote(text) {
  return new Paragraph({
    spacing: { after: 60 },
    indent: { left: convertInchesToTwip(0.2) },
    children: [new TextRun({ text: '„' + text + '"', font: FONT, size: 22, italics: true, color: '555555' })],
  })
}
function bullet(text) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 40 },
    children: [new TextRun({ text, font: FONT, size: 22 })],
  })
}
function checkbox() {
  // Echte Word-Content-Control-Checkboxen: per Klick in Word toggle-bar.
  return new Paragraph({
    spacing: { before: 120, after: 240 },
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'cccccc' } },
    children: [
      new CheckBox({ checked: false, alias: 'Verhalten OK' }),
      new TextRun({ text: ' Verhalten entspricht meiner Vorstellung     ', font: FONT, size: 22 }),
      new CheckBox({ checked: false, alias: 'Anpassung' }),
      new TextRun({ text: ' Anpassung nötig: ___________________________', font: FONT, size: 22 }),
    ],
  })
}
function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] })
}
function klaren(text) {
  return pRich([
    { text: '⚠️ KLÄREN: ', bold: true, color: 'b8860b' },
    { text, color: 'b8860b' },
  ])
}
function infoTable(rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([key, value]) => new TableRow({
      children: [
        new TableCell({
          width: { size: 28, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.SOLID, color: 'f5f2f0', fill: 'f5f2f0' },
          children: [new Paragraph({ children: [new TextRun({ text: key, font: FONT, size: 22, bold: true })] })],
        }),
        new TableCell({
          width: { size: 72, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: value, font: FONT, size: 22 })] })],
        }),
      ],
    })),
  })
}

// ────────────── Anwendungsfall-Helfer ──────────────
// Schema: { titel, was, wer, ablauf:[Schritte], regeln:[...], texte:[...],
//           emails:[{betreff, kern}], sonder:[...], klaren?: [...] }
function ucase(uc) {
  const out = []
  out.push(h2(uc.titel))
  out.push(infoTable([
    ['Was', uc.was],
    ['Wer', uc.wer],
  ]))
  out.push(label('Ablauf:', ''))
  uc.ablauf.forEach(s => out.push(bullet(s)))
  if (uc.regeln && uc.regeln.length) {
    out.push(label('Regeln & Grenzen:', ''))
    uc.regeln.forEach(r => out.push(bullet(r)))
  }
  if (uc.texte && uc.texte.length) {
    out.push(label('Angezeigte Texte:', ''))
    uc.texte.forEach(t => out.push(quote(t)))
  }
  if (uc.emails && uc.emails.length) {
    out.push(label('E-Mails:', ''))
    uc.emails.forEach(e => {
      out.push(pRich([
        { text: 'Betreff: ', bold: true },
        { text: '„' + e.betreff + '"', italics: true },
      ]))
      out.push(pRich([
        { text: 'Empfänger: ', bold: true },
        { text: e.an || 'Yogi' },
      ]))
      out.push(pRich([
        { text: 'Kernaussage: ', bold: true },
        { text: '„' + e.kern + '"', italics: true },
      ]))
    })
  }
  if (uc.sonder && uc.sonder.length) {
    out.push(label('Sonderfälle & Ausnahmen:', ''))
    uc.sonder.forEach(s => out.push(bullet(s)))
  }
  if (uc.klaren && uc.klaren.length) {
    uc.klaren.forEach(k => out.push(klaren(k)))
  }
  out.push(checkbox())
  return out
}

// ════════════════════════════════════════════════════════════════════════════
// INHALT – 17 Bereiche
// ════════════════════════════════════════════════════════════════════════════

const TODAY = new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })

const content = []

// Titelseite
content.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 2400, after: 240 },
  children: [new TextRun({ text: 'Yoga mit Sarah', font: FONT, size: 56, bold: true, color: '3d3a39' })],
}))
content.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 120 },
  children: [new TextRun({ text: 'Anwendungsfall-Katalog', font: FONT, size: 40, color: '8a6020' })],
}))
content.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 720, after: 80 },
  children: [new TextRun({ text: 'Prüfdokument zur Verifizierung des Soll-Verhaltens', font: FONT, size: 22, italics: true })],
}))
content.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 80 },
  children: [new TextRun({ text: 'Stand: ' + TODAY, font: FONT, size: 22 })],
}))
content.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 80 },
  children: [new TextRun({ text: 'Version 2.3 — Stand der App nach Welle A bis I (UI-Refresh, Credit-Banner, 3h-Modal, Quick-Credit-Form, Krankheits-Austragung, Click-Wrap, 2J-Auto-Refund, DSGVO-Confirm-Mail, Audit-Fixes 29.05.2026)', font: FONT, size: 22 })],
}))
content.push(pageBreak())

// Nutzungs-Hinweis
content.push(h1('Wie nutze ich dieses Dokument?'))
content.push(p('Dieses Dokument beschreibt jeden Anwendungsfall der App aus Nutzersicht. Lies jeden Fall durch und markiere am Ende:'))
content.push(bullet('Häkchen links → das beschriebene Verhalten entspricht meiner Vorstellung.'))
content.push(bullet('Häkchen rechts + Notiz → ich möchte eine Anpassung.'))
content.push(p(''))
content.push(pRich([
  { text: 'Markierungen mit „⚠️ KLÄREN" ', bold: true, color: 'b8860b' },
  { text: 'sind Stellen, an denen das Verhalten im Code mehrdeutig oder unvollständig dokumentiert ist — bitte hier explizit entscheiden.' },
]))
content.push(p(''))
content.push(p('Texte in Anführungszeichen sind die EXAKTEN Wortlaute aus der App bzw. E-Mails. Dynamische Teile sind mit [Platzhalter] gekennzeichnet.'))
content.push(pageBreak())

// Inhaltsverzeichnis
content.push(h1('Inhaltsverzeichnis'))
content.push(new TableOfContents('Inhaltsverzeichnis', {
  hyperlink: true,
  headingStyleRange: '1-2',
}))
content.push(p(''))
content.push(p('Hinweis: Inhaltsverzeichnis aktualisierst du in Word über Rechtsklick → „Felder aktualisieren".', { italic: true, size: 18 }))
content.push(pageBreak())

// ════════════════════════════════════════════════════════════════════════════
// 1. REGISTRIERUNG & EINLADUNG
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('1. Registrierung & Einladung'))
content.push(p('Yogis können sich nur über einen Einladungslink registrieren. Sarah verschickt die Einladung manuell oder die App schickt automatisch eine Erinnerung.'))

content.push(...ucase({
  titel: 'Einladung erhalten',
  was: 'Sarah verschickt einen persönlichen Einladungslink per E-Mail an einen neuen Yogi.',
  wer: 'Admin (Sarah) initiiert, neuer Yogi (nicht eingeloggt) empfängt.',
  ablauf: [
    'Sarah erstellt im Admin-Bereich „Einladungen" eine neue Einladung mit Vorname, Nachname und E-Mail.',
    'Optional kann Sarah einen Kurs auswählen, in den der Yogi direkt nach Registrierung eingebucht wird.',
    'Die App generiert einen persönlichen Einladungslink (14 Tage gültig) und schickt eine E-Mail an die angegebene Adresse.',
  ],
  regeln: [
    'Der Einladungslink ist 14 Tage gültig.',
    'Jeder Link kann nur einmal verwendet werden.',
    'Wird die Einladung gelöscht, wird der Link sofort gesperrt.',
  ],
  emails: [
    {
      betreff: 'Einladung zur Yoga-App – Yoga mit Sarah',
      an: 'Eingeladener Yogi',
      kern: 'Hallo [Vorname], ich lade dich herzlich ein, meiner Yoga-App beizutreten! Die Stundenverwaltung läuft ausschließlich über die App – bitte registriere dich, um deine Stunden planen und buchen zu können. [optional: Du wirst direkt in den Kurs [Name] eingebucht.] Der Link ist 14 Tage gültig.',
    },
  ],
  sonder: [
    'Wurde der Kurs in der Einladung gewählt, wird der Yogi direkt nach Registrierung mit allen vorgesehenen Credits in den Kurs eingebucht.',
    'Sarah erhält automatisch eine Benachrichtigung, sobald sich der eingeladene Yogi registriert (siehe E-Mail-Bereich „Neuer Yogi").',
  ],
}))

content.push(...ucase({
  titel: 'Einladungs-Erinnerung versenden',
  was: 'Wenn ein eingeladener Yogi sich nicht innerhalb einer angemessenen Zeit registriert, kann Sarah eine Erinnerungs-E-Mail auslösen.',
  wer: 'Admin (manuell aus dem Bereich „Einladungen")',
  ablauf: [
    'Sarah öffnet die Liste der offenen Einladungen.',
    'Bei einer noch nicht eingelösten Einladung wählt sie „Erinnerung senden".',
    'Eine erneute E-Mail mit demselben (noch gültigen) Link wird verschickt.',
  ],
  emails: [
    {
      betreff: 'Erinnerung: Deine Einladung zur Yoga-App',
      an: 'Eingeladener Yogi',
      kern: 'Hallo [Vorname], ich wollte kurz an deine Einladung erinnern. Die Stundenverwaltung läuft ausschließlich über die App – bitte registriere dich, um deine Stunden planen und buchen zu können. Der Einladungslink ist noch gültig.',
    },
  ],
}))

content.push(...ucase({
  titel: 'Registrierung über Einladungslink',
  was: 'Ein eingeladener Yogi klickt auf den Link und legt sein Konto an.',
  wer: 'Eingeladener Yogi (nicht eingeloggt)',
  ablauf: [
    'Yogi klickt im E-Mail-Programm auf den Einladungs-Button.',
    'Die App öffnet die Registrierungsseite, Vorname/Nachname/E-Mail sind vorausgefüllt.',
    'Yogi vergibt ein Passwort und akzeptiert die AGB sowie den Haftungsausschluss.',
    'Konto wird erstellt, AGB-Bestätigung wird als PDF im Google Drive von Sarah abgelegt.',
    'Yogi ist eingeloggt und landet auf der Wochenübersicht.',
  ],
  regeln: [
    'Ohne Klick auf den persönlichen Einladungslink ist keine Registrierung möglich.',
    'AGB-Akzeptanz ist verpflichtend. Ohne Häkchen ist die Registrierung blockiert.',
    'Abgelaufene oder gelöschte Einladungslinks zeigen eine Fehlermeldung.',
  ],
  texte: [
    'Link abgelaufen oder ungültig',
  ],
  emails: [
    {
      betreff: 'Willkommen bei Yoga mit Sarah!',
      an: 'Yogi (frisch registriert)',
      kern: 'Hallo [Vorname]! Schön, dass du dabei bist! 💛 [optional: Du bist direkt in den Kurs [Name] eingebucht.] Ich freue mich, dich bald auf der Matte zu sehen!',
    },
    {
      betreff: 'Neuer Yogi: [Voller Name]',
      an: 'Admin (Sarah)',
      kern: 'Ein neuer Yogi hat sich registriert: [Name], [E-Mail], [ggf. Kurs].',
    },
  ],
  sonder: [
    'Falls in der Einladung ein Kurs angegeben war: Yogi wird automatisch eingebucht mit der dafür nötigen Anzahl Credits.',
    'Die AGB-Versionierung sorgt dafür, dass Yogis bei einer neuen Version beim nächsten Login zur Re-Bestätigung aufgefordert werden.',
  ],
}))

content.push(...ucase({
  titel: 'AGB & Haftung re-akzeptieren bei neuer Version',
  was: 'Wenn Sarah eine neue AGB-Version veröffentlicht, muss jeder Yogi sie beim nächsten Login bestätigen, bevor er weiter buchen kann.',
  wer: 'Yogi (eingeloggt)',
  ablauf: [
    'Yogi öffnet die App.',
    'Wenn die im Profil gespeicherte AGB-Version älter ist als die aktuelle, wird ein Bestätigungsdialog vor jeder anderen Aktion angezeigt.',
    'Yogi liest die neuen AGB-Punkte (Link zu vollständigen AGB), bestätigt mit Häkchen und Klick.',
    'Eine neue AGB-Bestätigung wird als PDF im Drive abgelegt.',
  ],
  regeln: [
    'Ohne Re-Bestätigung kann der Yogi keine weiteren Aktionen in der App durchführen.',
  ],
  klaren: [
    'Genauer Wortlaut des AGB-Update-Dialogs ist im Code an mehreren Stellen unterschiedlich formuliert. Bitte einmal final festlegen.',
  ],
}))

content.push(...ucase({
  titel: 'Onboarding-Tour (erste Anmeldung)',
  was: 'Nach Registrierung und AGB-Akzeptanz erscheint beim ersten Aufruf der Wochenübersicht eine 5-stufige Tour, die dem neuen Yogi die App-Struktur erklärt. Wird einmalig gezeigt — danach nie wieder.',
  wer: 'Yogi (frisch registriert, kein Admin)',
  ablauf: [
    'Yogi loggt sich nach Einladung/Registrierung das erste Mal ein und landet auf der Wochenübersicht (/kurse).',
    'Wenn im Profil onboarding_completed = false (Default fuer neue Yogis) und Yogi kein Admin ist: Overlay mit 5 Slides erscheint.',
    'Oben: Schritt-Indikator (z.B. „Schritt 1 von 5") + „Überspringen"-Link rechts. Darunter Fortschritts-Punkte.',
    'Mitte: Icon, Titel, kleine gelbe Tab-Hinweis-Pille, Beschreibungstext.',
    'Unten: ab Slide 2 Zurück- und Weiter-Button (gleich breit, nebeneinander). Auf Slide 5 statt Weiter der grüne „Los geht’s!"-Button.',
    'Klick auf „Los geht’s!" oder „Überspringen": profiles.onboarding_completed wird auf true gesetzt, Overlay schließt.',
  ],
  regeln: [
    'Tour erscheint NUR fuer Yogis (nicht fuer Admin/Sarah).',
    'Tour erscheint genau einmal — nach „Los geht’s!" oder „Überspringen" nie wieder automatisch.',
    'Wenn der Yogi mitten in der Tour die Seite verlaesst (Reload, Tab schliesst): beim naechsten /kurse-Aufruf erscheint sie wieder — solange onboarding_completed = false.',
    'Tour kann beliebig per „Zurück" / „Weiter" durchlaufen werden, ohne dass etwas gespeichert wird, bis am Ende ein Klick erfolgt.',
  ],
  texte: [
    'Schritt 1 von 5',
    'Überspringen',
    'Zurück',
    'Weiter',
    'Los geht’s!',
  ],
  sonder: [
    'Slide 1 — Titel: „Wochenübersicht". Tab-Hinweis: „Tab „Kurse“ — unten links". Text: „Hier siehst du alle Stunden in einer Wochenübersicht. Mit den Pfeilen oder dem Datum oben wechselst du die Woche. Stunden in denen du angemeldet bist haben einen grünen Rahmen."',
    'Slide 2 — Titel: „Deine Buchungen — und wie Credits entstehen". Tab-Hinweis: „Tab „Meine“ — dritter Tab unten". Text: „Unter „Meine“ findest du alle deine Kurse auf die Sarah dich eingetragen hat und deine Einzelstunden die du gebucht hast. Wenn du eine rechtzeitig (bis 3h vorher) absagst, bekommst du einen Credit zum Nachholen — den kannst du dann für eine andere Stunde nutzen."',
    'Slide 3 — Titel: „Stunde buchen". Tab-Hinweis: „In „Kurse“ auf eine freie Stunde tippen". Text: „Klick einfach auf eine freie Stunde und wähle „Buchen“. Ein Credit wird automatisch verrechnet — du musst nichts weiter tun."',
    'Slide 4 — Titel: „Volle Stunde? Kein Problem". Tab-Hinweis: „Tab „Warteliste“ — zweiter Tab unten". Text: „Trag dich auf die Warteliste ein — du wirst automatisch nachgerückt sobald ein Platz frei wird. Oder lass dich einfach nur benachrichtigen und entscheide dann ob du kommen willst."',
    'Slide 5 — Titel: „App auf den Startbildschirm". Tab-Hinweis: „Profil → „Anleitung anzeigen“". Text: „Damit du die App wie eine echte App auf dem Handy hast: Wenn unten ein kleines „Installieren“-Fenster aufpoppt, einfach drauftippen. Falls nicht: geh in dein Profil und klick auf „Anleitung anzeigen“ — da steht für iPhone und Android wie es geht."',
    'DB-Effekt: profiles.onboarding_completed wird auf true gesetzt sobald „Los geht’s!" oder „Überspringen" geklickt wird. Danach kein Re-Trigger mehr.',
    'Re-Trigger fuer Tests: Admin kann das Flag manuell in der DB auf false setzen — beim naechsten /kurse-Aufruf erscheint die Tour wieder.',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 2. LOGIN, LOGOUT & PASSWORT
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('2. Login, Logout & Passwort'))

content.push(...ucase({
  titel: 'Login mit E-Mail und Passwort',
  was: 'Yogi loggt sich mit seinen Zugangsdaten ein.',
  wer: 'Yogi oder Admin',
  ablauf: [
    'Aufruf der Login-Seite.',
    'E-Mail und Passwort eingeben (Augen-Icon zum Sichtbarmachen des Passworts vorhanden).',
    'Klick auf „Anmelden" → Weiterleitung zur Wochenübersicht.',
  ],
  regeln: [
    'Bei falschen Zugangsdaten: Fehlermeldung mit Hinweis auf Passwort-Reset.',
    'Eingeloggte Sessions bleiben standardmäßig bestehen (PWA-fähig).',
  ],
  texte: [
    'Anmelden',
    'Passwort vergessen?',
    'Email vergessen? Wende dich an Sarah.',
  ],
  sonder: [
    'Welle A: Unterhalb des „Passwort vergessen?"-Links steht der Hinweis „Email vergessen? Wende dich an Sarah." — falls Yogi auch nicht mehr weiss, mit welcher Adresse er registriert ist.',
  ],
}))

content.push(...ucase({
  titel: 'Passwort vergessen / zurücksetzen',
  was: 'Yogi kann ein neues Passwort anfordern, wenn er sein aktuelles nicht mehr weiß.',
  wer: 'Yogi (nicht eingeloggt)',
  ablauf: [
    'Auf der Login-Seite klickt Yogi auf „Passwort vergessen".',
    'E-Mail-Adresse eingeben und absenden.',
    'App schickt eine E-Mail mit einem persönlichen Reset-Link (1 Stunde gültig).',
    'Klick auf den Link → Yogi landet auf einer Seite zur Eingabe des neuen Passworts.',
    'Nach erfolgreicher Änderung: automatische Weiterleitung in den eingeloggten Zustand.',
  ],
  regeln: [
    'Der Reset-Link ist 1 Stunde gültig.',
    'Aus Datenschutzgründen wird IMMER eine Erfolgsmeldung gezeigt, auch wenn die E-Mail nicht existiert (kein Konto-Spy).',
  ],
  emails: [
    {
      betreff: 'Passwort zurücksetzen – Yoga mit Sarah',
      an: 'Yogi (Reset-Anforderer)',
      kern: 'Hallo, du hast eine Passwort-Zurücksetzung angefordert. Klicke auf den Button. Der Link ist 1 Stunde gültig. Wenn du diese Anfrage nicht gestellt hast, ignoriere die E-Mail.',
    },
  ],
}))

content.push(...ucase({
  titel: 'Passwort ändern (eingeloggt)',
  was: 'Yogi ändert sein bestehendes Passwort im Profil-Bereich.',
  wer: 'Yogi (eingeloggt)',
  ablauf: [
    'Yogi öffnet Profil → „Passwort ändern".',
    'Altes Passwort und zweimal neues Passwort eingeben.',
    'Bestätigung → neues Passwort ist aktiv, Yogi bleibt eingeloggt.',
  ],
  klaren: [
    'Genauer Wortlaut der Bestätigungs- und Fehlermeldungen bitte vor Live-Gang prüfen.',
  ],
}))

content.push(...ucase({
  titel: 'Logout',
  was: 'Yogi meldet sich aktiv aus der App ab.',
  wer: 'Yogi oder Admin',
  ablauf: [
    'Yogi öffnet Profil → „Abmelden".',
    'Session wird lokal beendet, Yogi landet auf der Login-Seite.',
  ],
  regeln: [
    'Der Logout entfernt nur die lokale Session – andere Geräte des Yogis bleiben eingeloggt.',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 3. STUNDEN ANSEHEN & BUCHEN
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('3. Stunden ansehen & buchen'))

content.push(...ucase({
  titel: 'Wochenübersicht öffnen',
  was: 'Yogi sieht alle für ihn relevanten Stunden der laufenden Woche.',
  wer: 'Yogi (eingeloggt)',
  ablauf: [
    'Yogi öffnet die App → landet auf der Wochenübersicht.',
    'Pro Tag werden die Stunden in chronologischer Reihenfolge angezeigt.',
    'Per Wischen oder Klick auf die Pfeile kann zwischen Wochen navigiert werden.',
    'Der Tag „HEUTE" ist markiert.',
  ],
  regeln: [
    'Angezeigt werden: eigene Kurs-Stunden, freie Einzelstunden-Slots (wenn Kurs für Drop-In freigegeben), und alle Charity-Stunden.',
    'Bereits stattgefundene Stunden werden durchgestrichen.',
    'Ist eine Stunde abgesagt, wird der entsprechende Status angezeigt.',
  ],
  texte: [
    'HEUTE',
    'Ausgebucht',
    '[X] Plätze frei',
    'Angemeldet',
    'Ersatzstunde für [Datum] · [Uhrzeit] Uhr',
    'Kostenlos',
  ],
  sonder: [
    'Bei Charity-Stunden wird zusätzlich ein optionales Foto links neben dem Titel angezeigt.',
    'Wenn der Yogi nur in einem Teil-Zeitraum am Kurs teilnimmt, sieht er nur „seine" Stunden in diesem Zeitraum.',
    'Eine Sprechblase mit Sarah-Avatar erscheint optional ganz oben, wenn Sarah eine Ankündigung gesetzt hat.',
  ],
}))

content.push(...ucase({
  titel: 'Einzelstunde buchen (Drop-In oder Kostenlos)',
  was: 'Yogi bucht eine einzelne Stunde, in der er nicht als Kursteilnehmer eingebucht ist.',
  wer: 'Yogi (eingeloggt)',
  ablauf: [
    'Yogi tippt in der Wochenübersicht auf die gewünschte Stunde.',
    'Detail-Ansicht zeigt: Kursname, Datum, Uhrzeit, Dauer, Ort, ggf. Beschreibung.',
    'Wenn Plätze frei sind und Yogi einen passenden Credit hat (bzw. die Stunde kostenlos ist): Button „Für diese Stunde eintragen".',
    'Bei knapper Frist (weniger als 3 Stunden): Zusatz-Häkchen „Ich verstehe, dass mein Credit verfällt und ich mich nicht mehr abmelden kann." muss aktiv gesetzt werden.',
    'Nach erfolgreicher Buchung: Bestätigungsseite „Du bist dabei!" mit Kalenderbutton und „Zu Meine".',
  ],
  regeln: [
    'Ohne passenden Credit (und keine Charity-Stunde) ist die Buchung nicht möglich.',
    'Bei Charity-Stunden (Häkchen „Kostenlos" gesetzt) entfällt der Credit-Check komplett.',
    'Stundenstart in der Vergangenheit → Buchung nicht möglich.',
    'Abgesagte Stunden → Buchung nicht möglich.',
  ],
  texte: [
    'Für diese Stunde eintragen',
    'Trotzdem eintragen',
    'Ich verstehe, dass mein Credit verfällt und ich mich nicht mehr abmelden kann.',
    'Abmeldung kostenlos bis [Uhrzeit] – Credit kommt zurück.',
    'Innerhalb der 3-Stunden-Frist – Kurs beginnt in weniger als 3 Stunden. Abmeldung danach nicht möglich – Credit verfällt auch bei Nichterscheinen.',
    'Du hast keine freien Credits. Bitte wende dich an Sarah.',
    'Kostenlose Stunde — kein Credit nötig. Einfach anmelden und teilnehmen.',
    'Du bist dabei!',
    'Zum Kalender hinzufügen',
    'Buchung rückgängig machen',
    'Zu Meine',
  ],
  emails: [
    {
      betreff: 'Buchung bestätigt: [Kursname]',
      an: 'Yogi',
      kern: 'Hallo [Vorname], deine Buchung ist bestätigt! [Datum, Uhrzeit, Dauer]. Abmeldefrist: [Uhrzeit] Uhr.',
    },
  ],
  sonder: [
    'Bei Charity-Stunden (kostenlos) entfallen Abmeldefrist-Kachel, Credit-Kachel und der Storno-Hinweis. Stattdessen steht „Abmeldung jederzeit möglich".',
    'Hat der Yogi mehrere Wartelisten und nur einen Credit: vor der Buchung erscheint eine Modal-Warnung „Wartelisten-Konflikt", die er bestätigen muss, bevor die anderen Wartelisten automatisch verlassen werden.',
    'Bei Buchung eines Drop-Ins in einem fremden Kurs zählt es als Einzelstunde, nicht als Kursstunde.',
  ],
}))

content.push(...ucase({
  titel: 'Vorhol-/Nachholstunde buchen',
  was: 'Ein Kurs-Yogi bucht eine andere Stunde des Kurses, um eine abgesagte Stunde vor- oder nachzuholen.',
  wer: 'Yogi (eingeloggt, im Kurs eingebucht)',
  ablauf: [
    'Yogi sagt eine seiner Kurs-Stunden ab (außerhalb der 3-Stunden-Frist).',
    'Yogi öffnet eine andere Stunde im selben Kurs und bucht sie.',
    'Die Buchung wird an die abgesagte Stunde gebunden (Vorhol- oder Nachholstunde).',
  ],
  regeln: [
    'Vorholen: maximal 10 Tage VOR der ursprünglich abgesagten Stunde.',
    'Nachholen: bis 8 Tage NACH dem Kursende möglich (so lange ist der Credit gültig).',
    'Die Vorhol-/Nachholbuchung verbraucht denselben Credit wie ursprünglich.',
    'Auf der Detail-Seite steht ein Hinweis: „Diese Stunde wird auf deine abgesagte Stunde am [Datum] gebucht – kein Anspruch auf Vorhol-/Nachholtermine."',
  ],
  texte: [
    'Diese Stunde wird auf deine abgesagte Stunde am [Datum] gebucht – kein Anspruch auf Vorhol-/Nachholtermine.',
  ],
  sonder: [
    'Wenn der Kurs vorzeitig abgebrochen wird, werden bereits gebuchte Vorhol-Stunden automatisch storniert.',
    'Course-Credits werden VOR Punktekarten-Credits aufgebraucht.',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 4. STUNDEN ABSAGEN
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('4. Stunden absagen'))

content.push(...ucase({
  titel: 'Von einer Stunde abmelden – rechtzeitig (mehr als 3 Stunden vorher)',
  was: 'Yogi meldet sich kostenlos von einer Stunde ab, der Credit kommt zurück.',
  wer: 'Yogi',
  ablauf: [
    'Yogi öffnet die gebuchte Stunde in der Wochenübersicht oder unter „Meine".',
    'Klick auf „Von dieser Stunde abmelden".',
    'Bestätigungs-Card erscheint mit „Rechtzeitige Abmeldung – Dein Credit wird zurückgebucht."',
    'Klick auf „Ja, abmelden" → Buchung storniert, Credit verfügbar.',
  ],
  regeln: [
    'Frist: bis 3 Stunden vor Stundenbeginn.',
    'Nach Abmeldung wird der Platz automatisch der Warteliste angeboten.',
  ],
  texte: [
    'Von dieser Stunde abmelden',
    'Rechtzeitige Abmeldung',
    'Dein Credit wird zurückgebucht.',
    'Ja, abmelden',
    'Abbrechen',
  ],
  emails: [
    {
      betreff: 'Abmeldung bestätigt: [Kursname]',
      an: 'Yogi',
      kern: 'Hallo [Vorname], deine Abmeldung wurde bestätigt. [Datum, Uhrzeit]. ✅ Du bekommst einen Credit gutgeschrieben.',
    },
  ],
}))

content.push(...ucase({
  titel: 'Von einer Stunde abmelden – innerhalb der 3-Stunden-Frist',
  was: 'Yogi meldet sich kurzfristig ab. Der Credit verfällt.',
  wer: 'Yogi',
  ablauf: [
    'Yogi öffnet die gebuchte Stunde.',
    'Klick auf „Von dieser Stunde abmelden".',
    'Rote Warn-Card: „Zu spät für kostenlose Abmeldung – Credit wird nicht zurückgebucht."',
    'Yogi muss bewusst bestätigen, dass der Credit verfällt.',
  ],
  regeln: [
    'Innerhalb 3 Stunden vor Stundenbeginn ist die Abmeldung nur mit explizitem Hinweis möglich.',
    'Der Credit wird NICHT zurückgebucht – auch nicht bei Nichterscheinen.',
  ],
  texte: [
    'Zu spät für kostenlose Abmeldung',
    'Credit wird nicht zurückgebucht.',
    'Du bist innerhalb der 3-Stunden-Frist. Wenn du dich jetzt abmeldest, verfällt dein Credit — du kannst diese Stunde nicht mehr nachholen.',
  ],
  emails: [
    {
      betreff: 'Abmeldung bestätigt: [Kursname]',
      an: 'Yogi',
      kern: 'Hallo [Vorname], deine Abmeldung wurde bestätigt. ❌ Credit nicht zurückgebucht (unter 3h).',
    },
  ],
}))

content.push(...ucase({
  titel: 'Charity-Stunde absagen',
  was: 'Yogi meldet sich von einer kostenlosen Charity-Stunde ab.',
  wer: 'Yogi',
  ablauf: [
    'Yogi öffnet die Charity-Stunde.',
    'Klick auf „Von dieser Stunde abmelden".',
    'Grüne Card: „Abmeldung jederzeit möglich – Möchtest du dich wirklich abmelden?"',
    'Klick auf „Ja, abmelden" → Platz frei.',
  ],
  regeln: [
    'Bei Charity-Stunden gibt es KEINE 3-Stunden-Frist und keinen Credit-Verlust.',
  ],
  texte: [
    'Abmeldung jederzeit möglich',
    'Möchtest du dich wirklich abmelden?',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 5. WARTELISTE & BENACHRICHTIGUNG
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('5. Warteliste & Benachrichtigung bei freiem Platz'))

content.push(...ucase({
  titel: 'Auf Warteliste setzen',
  was: 'Yogi trägt sich in die Warteliste einer ausgebuchten Stunde ein.',
  wer: 'Yogi mit mindestens einem freien Credit',
  ablauf: [
    'Yogi öffnet eine volle Stunde.',
    'Klick auf „Auf die Warteliste setzen".',
    'Position in der Warteliste wird angezeigt.',
    'Bestätigungs-E-Mail mit Position und Austragungs-Link wird verschickt.',
  ],
  regeln: [
    'Benötigt einen freien Credit. Ohne Credit erscheint nur die Option „Benachrichtige mich wenn ein Platz frei wird".',
    'Sortierung der Warteliste: FIFO (Reihenfolge der Eintragung).',
  ],
  texte: [
    'Auf die Warteliste setzen',
    'Diese Stunde ist ausgebucht. Du kannst dich auf die Warteliste setzen oder benachrichtigt werden wenn ein Platz frei wird.',
  ],
  emails: [
    {
      betreff: 'Warteliste: [Kursname]',
      an: 'Yogi',
      kern: 'Hallo [Vorname], du stehst auf der Warteliste. [Datum, Uhrzeit]. Position: [X]. Du wirst automatisch eingebucht, sobald ein Platz frei wird. Du hast dann 1 Stunde Zeit, dich kostenlos abzumelden. Wird ein Platz weniger als 90 Minuten vor Stundenbeginn frei, bekommen alle Wartelisten-Yogis eine Auswahl-Mail — wer zuerst klickt, kriegt den Platz.',
    },
  ],
  sonder: [
    'Bei Charity-Stunden (kostenlos) entfällt der Credit-Check für die Warteliste komplett.',
    'Bei mehreren Wartelisten + nur einem Credit: nach Auto-Promote in einer Stunde werden die anderen Wartelisten automatisch entfernt, mit E-Mail-Hinweis.',
  ],
}))

content.push(...ucase({
  titel: 'Nur benachrichtigen lassen (ohne Warteliste)',
  was: 'Yogi möchte informiert werden, wenn in einer ausgebuchten Stunde ein Platz frei wird – ohne Wartelisten-Anspruch.',
  wer: 'Jeder Yogi (auch ohne Credit)',
  ablauf: [
    'Yogi öffnet eine volle Stunde.',
    'Klick auf „Benachrichtige mich wenn ein Platz frei wird".',
    'Eintrag wird gespeichert (Typ „Nur Benachrichtigung").',
  ],
  regeln: [
    'Diese Eintragung gibt KEINEN Anspruch auf den Platz – sie informiert nur.',
    'Reihenfolge: Erst rückt die Warteliste nach, dann werden die Benachrichtigungs-Yogis informiert (nicht gleichzeitig).',
  ],
  texte: [
    'Benachrichtige mich wenn ein Platz frei wird',
    'Warteliste nicht möglich – Du hast keine freien Credits. Wenn du nachrückst würdest du keinen Platz belegen können. Du kannst dich aber benachrichtigen lassen – vielleicht hast du dann einen Credit.',
  ],
  emails: [
    {
      betreff: 'Platz frei: [Kursname]',
      an: 'Yogi (Benachrichtigungs-Liste)',
      kern: 'Hallo [Vorname], 🎉 Ein Platz ist frei geworden! [Datum, Uhrzeit]. Jetzt buchen.',
    },
  ],
}))

content.push(...ucase({
  titel: 'Auto-Promote von Warteliste bei freiem Platz (mehr als 90 Min. vor Start)',
  was: 'Wird ein Platz frei und sind noch mehr als 90 Minuten bis Stundenbeginn, wird der erste Wartelisten-Yogi mit Credit automatisch eingebucht.',
  wer: 'Automatisch durch System',
  ablauf: [
    'Eine Stunde wird frei (durch Abmeldung oder Admin-Austrag).',
    'System lädt die Warteliste (FIFO).',
    'Erster Yogi mit gültigem Credit wird sofort eingebucht.',
    'Wartelisten-Eintrag wird gelöscht.',
    'Yogi bekommt E-Mail „Du bist dabei".',
  ],
  regeln: [
    'Bei Charity-Stunden wird der erste Yogi IMMER eingebucht (kein Credit-Check).',
    'Verbraucht der Yogi durch das Promote seinen letzten Credit, werden alle anderen Wartelisten-Einträge dieses Yogis ebenfalls entfernt (mit E-Mail).',
    'Yogi hat 1 Stunde Zeit, sich kostenlos abzumelden.',
  ],
  emails: [
    {
      betreff: 'Du bist dabei: [Kursname]',
      an: 'Yogi (nachgerückt)',
      kern: 'Hallo [Vorname], 🎉 Ein Platz ist frei – du bist automatisch eingebucht! [Datum, Uhrzeit]. Du hast 1 Stunde Zeit, dich kostenlos abzumelden.',
    },
    {
      betreff: 'Warteliste entfernt: [Kursname]',
      an: 'Yogi (mit verbrauchtem Credit)',
      kern: 'Hallo [Vorname], deine Wartelisten-Position wurde entfernt, weil dein Credit anderweitig verwendet wurde. Falls du nochmal versuchen willst auf die Warteliste zu kommen – du brauchst dafür einen freien Credit.',
    },
  ],
}))

content.push(...ucase({
  titel: 'Late-Offer-Workflow (unter 90 Min. vor Start)',
  was: 'Wird ein Platz weniger als 90 Minuten vor Stundenbeginn frei, bekommen ALLE Wartelisten-Yogis gleichzeitig eine „Letzte Chance"-E-Mail mit Magic-Link.',
  wer: 'Automatisch durch System',
  ablauf: [
    'Stunde wird frei, weniger als 90 Min. bis Start.',
    'System schickt allen Wartelisten-Yogis (mit oder ohne Credit) eine E-Mail mit individuellem Token-Link.',
    'Wer zuerst klickt + Credit hat, bekommt den Platz.',
    'Andere bekommen beim Klick die Meldung „Leider zu spät – jemand anderes war schneller".',
  ],
  regeln: [
    'Nur Yogis auf der Warteliste (nicht „Nur benachrichtigen") bekommen die Late-Offer-Mail.',
    'Ohne freien Credit: Klick endet mit Hinweis „Kein freier Credit".',
    'Klick nach Stundenbeginn: „Link abgelaufen".',
  ],
  texte: [
    'Du bist dabei',
    'Leider zu spät – Jemand anderes war schneller',
    'Kein freier Credit',
    'Link abgelaufen',
  ],
  emails: [
    {
      betreff: 'Letzte Chance: [Kursname] in Kürze',
      an: 'Alle Wartelisten-Yogis dieser Stunde',
      kern: 'Hallo [Vorname], ein Platz wurde gerade frei — aber es ist weniger als 90 Minuten vor Stundenbeginn. [Datum, Uhrzeit]. Alle Wartelisten-Yogis bekommen diese Mail — wer zuerst klickt, bekommt den Platz. Wenn du nicht reagierst, passiert nichts — dein Wartelisten-Platz bleibt aber auch nicht erhalten für diese Stunde.',
    },
  ],
}))

content.push(...ucase({
  titel: 'Aus Warteliste austragen (via E-Mail-Link)',
  was: 'Yogi möchte sich aus der Warteliste einer Stunde austragen, klickt auf den „Wieder austragen"-Link in der Bestätigungs-E-Mail.',
  wer: 'Yogi (auch ohne Login möglich, da Token-basiert)',
  ablauf: [
    'Yogi klickt im E-Mail-Programm auf „Wieder austragen".',
    'App öffnet Bestätigungsseite mit Kursname, Datum, Uhrzeit.',
    'Wartelisten-Eintrag wird gelöscht.',
  ],
  regeln: [
    'Token ist solange gültig wie die Stunde in der Zukunft liegt.',
    'Idempotent: Zweiter Klick → „Bereits ausgetragen".',
    'Ungültiger oder zufälliger Token → „Link ungültig".',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 6. CREDITS & GUTHABEN
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('6. Credits & Guthaben'))

content.push(...ucase({
  titel: 'Übersicht: Welche Arten von Credits gibt es?',
  was: 'Es gibt verschiedene Credit-Arten mit unterschiedlichen Regeln.',
  wer: 'Info-Beschreibung – betrifft alle Yogis',
  ablauf: [
    'Kurs-Credits (course): werden beim Einbuchen in einen Kurs erzeugt, gültig bis 8 Tage nach Kursende, nur für Stunden des betreffenden Kurses einsetzbar.',
    'Punktekarte / Einzelstunden-Credits (single bzw. tenpack): Yogi kauft sie, für beliebige Einzelstunden einsetzbar, eigenes Ablaufdatum.',
    'Guthaben (guthaben): entsteht durch Kursabbruch („Guthaben behalten"-Option), 2 Jahre gültig, für jede beliebige Stunde einsetzbar. Wird zuletzt verwendet.',
  ],
  regeln: [
    'Reihenfolge beim Buchen: Kurs-Credit (wenn passend) → Punktekarte → Guthaben.',
    'Kurs-Credit gilt bis 8 Tage nach dem letzten Kurstermin.',
    'Vorhol-Fenster: maximal 10 Tage VOR der abgesagten Stunde.',
    'Charity-Stunden brauchen KEINEN Credit.',
  ],
  klaren: [
    'Sollen Guthaben-Credits sichtbar separat von normalen Credits angezeigt werden? Aktuell stehen sie in derselben Liste mit Label „aus Guthaben".',
  ],
}))

content.push(...ucase({
  titel: 'Credit-Anzeige auf „Meine"-Seite — Welle D: getrennte Sektionen',
  was: 'Yogi sieht eine Übersicht seiner verfügbaren Credits. Freie Credits (Kurs / Punktekarte / Quartal) und „Guthaben" stehen seit Welle D in zwei getrennten Sektionen.',
  wer: 'Yogi (eingeloggt)',
  ablauf: [
    'Yogi öffnet „Meine".',
    'Sektion 1 „Deine freien Credits": alle Credits außer „guthaben" — Kurs-Credits, Punktekarten, Quartals-Credits.',
    'Sektion 2 „Guthaben" (nur sichtbar wenn vorhanden): Credits aus abgesagten Kursen, NICHT für Einzelstunden verwendbar.',
    'Pro Credit: Anzahl frei, Label je nach Typ, Verfallsdatum, Genutzt-Fortschrittsbalken (X / Y genutzt).',
    'Quartal-Credits: Label „Quartals-Credits · Q[Nummer] [Jahr]" mit Zusatz „Gültig vom [Start] bis [Ende]".',
    'Kurs-Credits: Label „aus Kurs: [Name]".',
    'Punktekarten: Label „Einzelstunden-Credit" / „Einzelstunden-Credits".',
    'Wenn ein Credit valid_from in der Zukunft hat: amber Hinweis „Nutzbar ab [Datum]" (z.B. bei Quartal-Abo für nächstes Quartal).',
  ],
  regeln: [
    'Abgelaufene Credits (expires_at < heute) werden NICHT angezeigt.',
    'Voll verbrauchte Credits (0 frei) werden NICHT angezeigt.',
    'Guthaben-Hinweistexte erklären den Yogi: „Aus abgesagtem Kurs · Nicht für Einzelstunden, nur verrechenbar mit neuem Kurs".',
    'Wenn der Yogi GAR keine Credits hat: leere Card mit „Keine Credits".',
  ],
  texte: [
    'Deine freien Credits',
    'Guthaben',
    'aus Kurs: [Name]',
    'Quartals-Credits · Q[X] [Jahr]',
    'Einzelstunden-Credits',
    'Gültig vom [Start] bis [Ende]',
    'Verfallen am [Datum]',
    'Nutzbar ab [Datum]',
    'Aus abgesagtem Kurs',
    'Nicht für Einzelstunden, nur verrechenbar mit neuem Kurs',
    'Gültig bis [Datum]',
    '[X] / [Y] genutzt',
    'Keine Credits',
  ],
}))

content.push(...ucase({
  titel: 'Credit-Verfall nach Kursende',
  was: 'Kurs-Credits sind bis 8 Tage nach dem letzten Kurstermin gültig. Danach verfallen sie automatisch.',
  wer: 'System-Regel',
  ablauf: [
    'Letzter Kurstermin ist z.B. 15. Mai.',
    'Bis einschließlich 23. Mai können Credits für Nachhol-Stunden verwendet werden.',
    'Ab 24. Mai werden Credits nicht mehr als verfügbar angezeigt.',
  ],
  regeln: [
    'Verfall passiert über das Feld „Ablaufdatum" des Credits.',
    'Guthaben (Kursabbruch-Wahl) ist 2 Jahre gültig.',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 7. MEINE BUCHUNGEN
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('7. Meine Buchungen'))

content.push(...ucase({
  titel: 'Übersicht der gebuchten Stunden',
  was: 'Yogi sieht alle seine zukünftigen Buchungen, gruppiert nach Kurs.',
  wer: 'Yogi',
  ablauf: [
    'Yogi öffnet „Meine".',
    'Oben Credit-Card, darunter Buchungen nach Kurs gruppiert.',
    'Pro Buchung: Datum, Uhrzeit, Status (Angemeldet / Vergangen / Abgesagt).',
    'Klick auf eine Buchung führt zur Detail-Ansicht der Stunde.',
  ],
  regeln: [
    'Vergangene Stunden werden mit der Markierung „Vergangen" (durchgestrichen) angezeigt.',
    'Ausgeschlossene Stunden des Kurses (Sarah hat sie als „nicht Teil des Kurses" markiert) werden NICHT angezeigt.',
    'Einzelstunden-Buchungen (Drop-Ins) erscheinen in einer eigenen Sektion unten.',
  ],
  texte: [
    'Angemeldet',
    'Vergangen',
    'Abgesagt',
    'Ersatzstunde für [Datum] · [Uhrzeit]',
    'Du nimmst teil vom [Datum] bis [Datum]',
    'Keine Buchungen',
  ],
  sonder: [
    'Wenn der Yogi erst mitten im Kurs eingestiegen ist, steht ein Hinweis „Du nimmst teil vom ... bis ...".',
    'Ersatzstunden (Sarah hat eine Stunde abgesagt und einen Ersatz angelegt) sind speziell markiert.',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 8. PROFIL & NOTFALLKONTAKT
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('8. Profil & Notfallkontakt'))

content.push(...ucase({
  titel: 'Profil ansehen und bearbeiten',
  was: 'Yogi sieht seine Stammdaten und kann sie bearbeiten.',
  wer: 'Yogi',
  ablauf: [
    'Yogi öffnet „Profil".',
    'Angezeigt: Vorname, Nachname, E-Mail (nicht änderbar), Geburtsdatum (Welle A), Telefon, Notfallkontakt.',
    'Felder können direkt bearbeitet werden, „Speichern" sichert die Änderung.',
    'Nach erfolgreichem Speichern: kleiner grüner Toast „Profil gespeichert" unten in der Mitte für ca. 3 Sekunden (Welle A).',
  ],
  regeln: [
    'E-Mail-Adresse kann der Yogi NICHT selbst ändern (Sicherheit + Brevo-Versand).',
    'Notfallkontakt ist optional, aber empfohlen.',
    'Geburtsdatum: Pflichtprüfung — nicht in der Zukunft, keine unsinnigen Werte (über 120 Jahre).',
  ],
  texte: [
    'Profil gespeichert',
    'Geburtsdatum ist ungültig.',
    'Geburtsdatum darf nicht in der Zukunft liegen.',
    'Geburtsdatum scheint nicht zu stimmen.',
  ],
}))

content.push(...ucase({
  titel: 'Notfallkontakt klickbar (Anruf / WhatsApp)',
  was: 'Sarah kann im Admin-Bereich den hinterlegten Notfallkontakt eines Yogis direkt anrufen oder per WhatsApp anschreiben.',
  wer: 'Admin',
  ablauf: [
    'Sarah öffnet Yogi-Detail.',
    'Beim Notfallkontakt: Tap auf Telefonnummer öffnet Telefon-App, Tap auf WhatsApp-Icon öffnet WhatsApp-Chat.',
  ],
}))

content.push(...ucase({
  titel: 'Benachrichtigungs-Einstellungen',
  was: 'Yogi kann steuern, welche E-Mails er erhalten möchte.',
  wer: 'Yogi',
  ablauf: [
    'Profil öffnen → Bereich „Benachrichtigungen".',
    'Schalter: Buchungsbestätigungen, Wartelisten-Beitritt, Erinnerung an Stunden.',
    'Zusätzlich: Vorlauf für Erinnerung (z.B. 2h, 24h vorher).',
  ],
  regeln: [
    'Pflicht-E-Mails (Abmeldung, Stunden-Absage, Kursabbruch) können NICHT deaktiviert werden – sie sind vertraglich nötig.',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 9. KONTOLÖSCHUNG & DATENSCHUTZ
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('9. Kontolöschung & Datenschutz (DSGVO)'))

content.push(...ucase({
  titel: 'Account löschen (DSGVO-konform) — Welle B: Plätze sofort freigeben',
  was: 'Yogi löscht sein Konto endgültig. Persönliche Daten werden anonymisiert, alle zukünftigen Plätze werden sofort für Wartelisten-Yogis freigegeben, Buchungs-Historie bleibt anonym erhalten.',
  wer: 'Yogi (eingeloggt)',
  ablauf: [
    'Profil → ganz unten: roter Button „Account löschen".',
    'Roter Bestätigungs-Block erscheint mit Überschrift „Account endgültig löschen?".',
    'Erklärtext: „Alle deine Buchungen werden storniert und deine Plätze freigegeben. Diese Aktion ist nicht rückgängig zu machen."',
    'Zusatz-Hinweis (klein): „Dein Konto wird DSGVO-konform anonymisiert: Name und E-Mail werden entfernt, die anonymisierte Buchungshistorie bleibt aus rechtlichen Gründen erhalten."',
    'Pflicht-Häkchen: „Ich verstehe, dass ich danach nicht mehr in meine Kurse zurückkehren kann."',
    'Erst dann ist der rote Button „Ja, Account löschen" aktiv. Zweiter Button: „Abbrechen".',
    'Nach Bestätigung läuft folgende Cascade automatisch durch: Vor-/Nachname auf „Gelöschter Nutzer", E-Mail entfernt, Notfallkontakt entfernt. Warteliste-Einträge entfernt. Alle zukünftigen aktiven Buchungen werden storniert. Enrollments (Kurs-Teilnahmen) werden gelöscht — auch für ganze Kurse. Audit-Log-Einträge anonymisiert.',
    'Für jede so freigewordene Stunde wird automatisch der nächste Wartelisten-Yogi nachgerückt (Auto-Promote bzw. Late-Offer je nach Zeit bis Start).',
    'Sarah bekommt eine Dashboard-Benachrichtigung „Account DSGVO-gelöscht" und eine E-Mail mit Hinweis auf die manuelle PDF-Löschung im Drive.',
    'Yogi wird sofort ausgeloggt und kann sich nicht mehr einloggen.',
  ],
  regeln: [
    'Plätze werden sofort frei — nicht erst bei tatsächlicher Auth-User-Löschung. Falls die API-Löschung fehlschlägt, sind die Daten trotzdem schon anonymisiert und die Plätze frei.',
    'Admin (Sarah) kann diesen Button NICHT sehen — er erscheint nur für nicht-Admin-Konten.',
    'Credits werden bei Yogi-Selbstlöschung NICHT explizit gelöscht — sie verlieren beim Anonymisieren ihren Bezug.',
  ],
  texte: [
    'Account löschen',
    'Account endgültig löschen?',
    'Alle deine Buchungen werden storniert und deine Plätze freigegeben. Diese Aktion ist nicht rückgängig zu machen.',
    'Dein Konto wird DSGVO-konform anonymisiert: Name und E-Mail werden entfernt, die anonymisierte Buchungshistorie bleibt aus rechtlichen Gründen erhalten.',
    'Ich verstehe, dass ich danach nicht mehr in meine Kurse zurückkehren kann.',
    'Ja, Account löschen',
    'Abbrechen',
  ],
  emails: [
    {
      betreff: 'DSGVO: Account gelöscht – PDF bitte manuell löschen',
      an: 'Admin',
      kern: 'Hallo Sarah, folgender Account wurde DSGVO-konform gelöscht: [Name], [E-Mail]. Bitte lösche die AGB-PDF im Google Drive manuell.',
    },
  ],
  sonder: [
    'Wartelisten-Promote der freigewordenen Plätze läuft im Hintergrund parallel — die Anonymisierung wartet nicht darauf.',
    'Die Buchungs-Datenbank-Abfrage nutzt den Foreign-Key-Hint sessions!bookings_session_id_fkey, damit das Session-Datum eindeutig geladen werden kann.',
  ],
}))

content.push(...ucase({
  titel: 'Admin löscht einen Yogi-Account — Welle B',
  was: 'Sarah löscht einen Yogi-Account aus dem Admin-Bereich. Plätze werden sofort frei, alle Daten anonymisiert.',
  wer: 'Admin (Sarah)',
  ablauf: [
    'Admin → Yogis → einzelnen Yogi öffnen.',
    'Ganz unten: roter Button „Yogi-Account löschen (DSGVO-konform)".',
    'Erster Bestätigungs-Dialog mit Aufzählung: Plätze werden frei, aktive Buchungen + Guthaben werden gelöscht, persönliche Daten werden anonymisiert, Buchungshistorie bleibt anonym im Protokoll.',
    'Zweiter Sicherheits-Dialog: „Bist du sicher? Diese Aktion kann nicht rückgängig gemacht werden!"',
    'Nach Bestätigung läuft die gleiche Cascade wie bei Yogi-Selbstlöschung: zukünftige Plätze frei, Enrollments weg, Wartelisten der freigewordenen Stunden nachrücken, PII anonymisiert, Email an Sarah.',
    'Im Unterschied zur Selbst-Löschung werden hier auch Credits explizit gelöscht (Admin-Pfad ist robuster, falls Auth-Delete später fehlschlägt).',
    'Nach Erfolg landet Sarah zurück in der Yogi-Übersicht.',
  ],
  texte: [
    'Yogi-Account löschen (DSGVO-konform)',
    'Account von [Vorname Nachname] DSGVO-konform löschen?',
    '• Plätze in allen Kursen + Stunden werden sofort frei',
    '• Aktive Buchungen + Guthaben werden gelöscht',
    '• Persönliche Daten werden anonymisiert',
    '• Buchungshistorie bleibt anonym im Protokoll',
    'Bist du sicher? Diese Aktion kann nicht rückgängig gemacht werden!',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 10. ADMIN: KURSE ANLEGEN
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('10. Admin: Kurse anlegen, bearbeiten, Termine verwalten'))

content.push(...ucase({
  titel: 'Neuen Kurs anlegen',
  was: 'Sarah legt einen neuen Kurs mit allen Stammdaten an.',
  wer: 'Admin',
  ablauf: [
    'Bereich „Kurse" → Button „Neuer Kurs".',
    'Eingabefelder: Kursname (Pflicht), Wochentag, Uhrzeit, Dauer in Minuten, Anzahl Einheiten (wird automatisch berechnet), Maximale Teilnehmer, Ort, Beschreibung, Was mitbringen, Schwierigkeitsgrad.',
    'Häkchen „Einzelne Stunde" → Datum statt Start-/Enddatum.',
    'Häkchen „Kostenlos (kein Credit nötig — z.B. Charity Yoga)" → wird als Charity-Stunde markiert.',
    'Bild-Upload (optional, JPG/PNG/WebP, max 5 MB).',
    'Datum-Bereich (Start/Ende) bei Mehr-Termin-Kursen → Termine werden automatisch berechnet.',
    'Einzelne Termine können vor dem Speichern ein-/ausgeschlossen werden (z.B. Feiertage).',
  ],
  regeln: [
    'Standard-Schwierigkeitsgrade: „Alle Level", „Beginner", „Geübte".',
    'Standard-Dauer: 75 Minuten.',
    'Maximale Teilnehmer: 1–50.',
    'Aus den Datums-Eingaben werden automatisch die Wochen-Termine generiert (Ausnahmen werden als „ausgeschlossen" markiert).',
  ],
  texte: [
    'Neuer Kurs',
    'Einzelne Stunde',
    'Kostenlos (kein Credit nötig — z.B. Charity Yoga)',
    'Anzahl Einheiten (wird automatisch berechnet)',
    'Max. Teilnehmer',
    'Was mitbringen?',
    'Schwierigkeitsgrad',
    'JPG/PNG/WebP · max 5 MB · wird als kleines Foto neben der Stunde angezeigt',
  ],
}))

content.push(...ucase({
  titel: 'Bestehenden Kurs bearbeiten',
  was: 'Sarah ändert Stammdaten oder einzelne Termine eines laufenden Kurses.',
  wer: 'Admin',
  ablauf: [
    'Kurs in der Liste auswählen → „Bearbeiten".',
    'Stammdaten ändern (Name, Ort, Beschreibung, Dauer, Uhrzeit, max. Teilnehmer).',
    'Bei Uhrzeit-Änderung: alle zukünftigen Termine werden angepasst UND alle Teilnehmer bekommen eine E-Mail „Uhrzeitänderung".',
    'Speichern → kurze Erfolgsanzeige, Modal schließt nach ca. 1.5 Sek.',
  ],
  regeln: [
    'Sind bereits Yogis im Kurs eingebucht, dürfen Datum/Wochentag/Termine-Berechnung NICHT mehr geändert werden (Sicherheits-Sperre).',
    'Ohne Teilnehmer: vollständige Neuberechnung der Termine möglich.',
  ],
  emails: [
    {
      betreff: 'Uhrzeitänderung: [Kursname]',
      an: 'Alle Kurs-Teilnehmer',
      kern: 'Hallo [Vorname], die Uhrzeit für deine Stunden hat sich geändert: Kurs: [Name]. Bisher: [alt]. Neu: [neu].',
    },
  ],
}))

content.push(...ucase({
  titel: 'Einzelne Stunde absagen (Ersatztermin optional)',
  was: 'Sarah sagt eine einzelne Kurs-Stunde ab und kann einen Ersatztermin anlegen.',
  wer: 'Admin',
  ablauf: [
    'In der Kurs-Übersicht: Stunde wählen → „Stunde absagen".',
    'Grund eingeben (wird in der E-Mail verwendet).',
    'Optional: Datum/Uhrzeit für Ersatztermin angeben.',
    'Alle gebuchten Yogis bekommen die E-Mail „Kursstunde abgesagt".',
    'Wenn Ersatztermin: Yogis werden automatisch dort eingebucht.',
  ],
  emails: [
    {
      betreff: 'Kursstunde abgesagt: [Kursname]',
      an: 'Alle Yogis dieser Stunde',
      kern: 'Hallo [Vorname], leider muss ich diese Stunde absagen: [Datum, Uhrzeit, Grund]. [Mit Ersatz: Ersatztermin: [Datum, Uhrzeit]. Dein Credit wird automatisch auf den Ersatztermin eingebucht.] [Ohne Ersatz: ✅ Dein Credit wird dir automatisch gutgeschrieben. Sobald eine Ersatzstunde eingetragen wird, wirst du automatisch eingebucht – außer du hast den gutgeschriebenen Credit bereits in einer anderen Stunde verwendet.]',
    },
    {
      betreff: 'Ersatztermin für deine abgesagte Stunde am [Datum] – [Kursname]',
      an: 'Yogi (wenn Ersatztermin)',
      kern: 'Hallo [Vorname], für deine abgesagte Stunde gibt es einen Ersatztermin. ✅ Du wurdest automatisch eingetragen und dein Credit der ursprünglichen Stunde wurde dafür verwendet.',
    },
  ],
}))

content.push(...ucase({
  titel: 'Stunde aus dem Kurs ausschließen',
  was: 'Sarah markiert eine Stunde dauerhaft als „nicht Teil des Kurses" (z.B. Feiertag, Sarah krank, Kurs entfällt einmal).',
  wer: 'Admin',
  ablauf: [
    'Kurs öffnen → Termin auswählen → Auswahl „Ausschließen".',
    'Stunde wird NICHT mehr als Kursstunde angezeigt.',
    'Anzahl Einheiten des Kurses wird automatisch um 1 reduziert.',
    'Bereits eingebuchte Yogis werden ausgetragen, Credits laufen normal weiter.',
  ],
  regeln: [
    'Ausgeschlossene Stunden tauchen NICHT in der Yogi-Wochenübersicht auf (im Gegensatz zu „abgesagten" Stunden).',
    'Im Admin-Bereich werden sie weiterhin angezeigt, aber als „ausgeschlossen" markiert.',
  ],
}))

content.push(...ucase({
  titel: 'Kurs archivieren',
  was: 'Beendeter Kurs wird in den Bereich „Archiv" verschoben (nicht mehr im aktiven Dashboard).',
  wer: 'Admin',
  ablauf: [
    'Beendeter Kurs → Button „Archivieren".',
    'Nach Bestätigung verschwindet der Kurs aus den aktiven Bereichen.',
  ],
  regeln: [
    'Kurs kann erst ab dem 9. Tag nach Kursende archiviert werden — Schutz für noch laufende Credit-Gültigkeit (8 Tage).',
    'Vor diesem Datum erscheint ein Alert, der das genaue Datum nennt, ab dem es möglich ist.',
  ],
  texte: [
    'Kurs kann erst ab dem 9. Tag nach Kursende archiviert werden.',
  ],
}))

content.push(...ucase({
  titel: 'Kurs löschen',
  was: 'Kurs wird vollständig aus der Datenbank entfernt.',
  wer: 'Admin',
  ablauf: [
    'Kurs → „Löschen" (mit Bestätigung).',
  ],
  regeln: [
    'Kurs kann erst ab dem 9. Tag nach Kursende gelöscht werden — gleicher Schutz wie beim Archivieren.',
    'Zusätzliche Safety-Net-Prüfung: Falls noch Yogi-Credits dieses Kurses mit Restwert vorhanden sind → Löschen wird blockiert, mit klarem Hinweis.',
  ],
  texte: [
    'Kurs kann erst ab dem 9. Tag nach Kursende gelöscht werden.',
  ],
}))

content.push(...ucase({
  titel: 'Kurs für Drop-Ins freigeben (Einzelstunden-Buchung)',
  was: 'Sarah erlaubt, dass externe Yogis (nicht Kurs-Teilnehmer) einzelne Stunden des Kurses buchen können.',
  wer: 'Admin',
  ablauf: [
    'Kurs-Übersicht: Toggle „Kurs freigeben" pro Kurs.',
    'Aktiv: alle Yogis sehen die Stunden in ihrer Wochenübersicht und können sie buchen, wenn sie einen passenden Credit haben.',
  ],
  regeln: [
    'Ohne Freigabe sind die Stunden nur für die Kurs-Teilnehmer sichtbar.',
    'Charity-Stunden müssen ebenfalls freigegeben sein, damit Yogis sie sehen.',
  ],
  klaren: [
    'Sollten Charity-Stunden automatisch freigegeben sein, ohne dass Sarah manuell toggelt?',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 11. ADMIN: FOLGEKURS
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('11. Admin: Folgekurs anlegen'))

content.push(...ucase({
  titel: 'Folgekurs aus laufendem Kurs erzeugen',
  was: 'Sarah erzeugt aus einem bestehenden Kurs einen Folgekurs und übernimmt die Teilnehmer.',
  wer: 'Admin',
  ablauf: [
    'Beim Kurs: Button „Folgekurs anlegen".',
    'Schritt 1: Start- und Enddatum für den Folgekurs eingeben → Termine werden generiert, einzelne Termine können ausgeschlossen werden.',
    'Schritt 2: Liste aller bisherigen Teilnehmer; Sarah wählt aus, wen sie übernehmen möchte.',
    'Speichern: neuer Kurs wird erzeugt, ausgewählte Yogis werden eingebucht und bekommen E-Mail.',
  ],
  regeln: [
    'Neue Credits werden in der Anzahl der nicht-ausgeschlossenen Termine angelegt.',
    'Übernommene Yogis haben sofort einen Kurs-Credit-Topf für den Folgekurs.',
  ],
  emails: [
    {
      betreff: 'Du wurdest in den Kurs [Kursname] eingetragen',
      an: 'Jeder übernommene Yogi',
      kern: 'Hallo [Vorname], ich habe dich in einen Kurs eingetragen. Kurs: [Name]. 📅 [Wochentag] um [Uhrzeit]. [Dauer] Minuten pro Einheit. ✅ Du nimmst an allen [X] Stunden teil — du hast dafür [X] Credits in deinem Profil. Wichtige Regeln: Abmeldung kostenlos bis 3 Stunden vorher, Nachholen bis 8 Tage nach Kursende, Vorholen max. 10 Tage im Voraus, Rücktritt vom gesamten Kurs kostenlos bis 14 Tage vor Kursbeginn — danach Gebühr (30 € bis 7 Tage vorher, ab 6 Tagen volle Gebühr); Ersatzteilnehmer jederzeit möglich.',
    },
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 12. ADMIN: KURSABBRUCH
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('12. Admin: Kursabbruch'))

content.push(...ucase({
  titel: 'Gesamten Kurs abbrechen — Option „Alle Erstattung"',
  was: 'Sarah bricht einen Kurs vorzeitig ab und entscheidet sich, ALLEN Yogis automatisch eine anteilige Erstattung des Kurspreises auszuzahlen.',
  wer: 'Admin',
  ablauf: [
    'Kurs in Admin-Übersicht → „Kurs abbrechen".',
    'Grund eingeben (wird in Yogi-E-Mail verwendet).',
    'Auswahl „Alle Yogis erhalten eine anteilige Erstattung".',
    'Bestätigen → alle zukünftigen Stunden werden storniert, alle Yogis bekommen die „Kurs abgesagt"-E-Mail mit dem Hinweis auf die anstehende Erstattung.',
    'Sarah erhält eine Zusammenfassungs-E-Mail mit allen betroffenen Yogis.',
  ],
  emails: [
    {
      betreff: 'Kurs abgesagt: [Kursname]',
      an: 'Alle Kurs-Teilnehmer',
      kern: 'Hallo [Vorname], leider muss ich den folgenden Kurs absagen: Kurs: [Name], [Grund]. 💡 [X] Stunden entfallen. Für die [X] noch nicht stattgefundenen Kurseinheiten erhältst du eine anteilige Erstattung des gezahlten Kurspreises. Ich melde mich bei dir.',
    },
    {
      betreff: 'Kurs abgebrochen: [Kursname]',
      an: 'Admin',
      kern: 'Hallo Sarah, du hast folgenden Kurs abgebrochen: [Name], [Grund]. [X] Stunden entfallen. Betroffene Yogis: [Liste].',
    },
  ],
}))

content.push(...ucase({
  titel: 'Gesamten Kurs abbrechen — Option „Yogi-Wahl"',
  was: 'Yogis bekommen die Wahl: anteilige Erstattung oder Guthaben für 2 Jahre.',
  wer: 'Admin',
  ablauf: [
    'Kurs → „Kurs abbrechen".',
    'Grund eingeben.',
    'Auswahl „Yogi-Wahl (Erstattung ODER Guthaben behalten)".',
    'System legt für jeden Yogi einen Wahl-Token an (7 Tage gültig).',
    'Yogi bekommt E-Mail mit zwei Buttons: „Guthaben behalten" oder „Anteilige Erstattung".',
    'Wählt der Yogi „Guthaben": Credits bleiben als Guthaben in seinem Profil, 2 Jahre gültig (siehe auch Cron-Auto-Refund nach 2 Jahren weiter unten).',
    'Wählt er „Erstattung" (Default gemäß § 326 BGB): Guthaben-Credit wird gelöscht, Sarah muss Geld manuell auszahlen.',
    'Antwortet der Yogi nicht innerhalb 7 Tagen → automatisch Erstattung (Geldbetrag), nicht Guthaben.',
  ],
  regeln: [
    'Default ist seit Mai 2026 die Geld-Erstattung (§ 326 BGB) — das bisherige Verhalten „Default Guthaben" wurde umgestellt.',
    'Provisorisches Guthaben wird sofort beim Abbrechen sichtbar in der App, mit Hinweis „bei Wahl Erstattung wieder entfernt".',
  ],
  emails: [
    {
      betreff: 'Kurs abgesagt: [Kursname]',
      an: 'Alle Kurs-Teilnehmer',
      kern: 'Hallo [Vorname], leider muss ich den folgenden Kurs absagen. Für die [X] noch nicht stattgefundenen Kurseinheiten hast du die Wahl zwischen einer anteiligen Erstattung (Default — gemäß § 326 BGB) oder Kurs-Guthaben (2 Jahre gültig). 💡 Ich freue mich besonders, wenn du das Guthaben wählst — dann sehen wir uns hoffentlich im nächsten Kurs wieder. Du hast 7 Tage Zeit für deine Wahl. Ohne Rückmeldung wird dir automatisch der anteilige Geldbetrag erstattet — ich melde mich dann persönlich bei dir wegen der Überweisung.',
    },
    {
      betreff: 'Guthaben gutgeschrieben: [Kursname]',
      an: 'Yogi (Wahl Guthaben)',
      kern: 'Hallo [Vorname], danke für deine Rückmeldung — ich habe dein Guthaben gespeichert. Guthaben behalten. ✅ [X] Credits als Guthaben gutgeschrieben.',
    },
    {
      betreff: 'Erstattungsanfrage bestätigt: [Kursname]',
      an: 'Yogi (Wahl Erstattung)',
      kern: 'Hallo [Vorname], deine Wahl ist gespeichert — anteilige Erstattung. ✅ [X] Stunden werden anteilig erstattet. Ich melde mich persönlich bei dir wegen der Auszahlung.',
    },
    {
      betreff: 'Kursabbruch-Entscheidung: [Yogi-Name]',
      an: 'Admin',
      kern: 'Hallo Sarah, ein Yogi hat seine Entscheidung zum Kursabbruch getroffen: [Guthaben behalten / Geld zurück]. [Name], [E-Mail], Kurs: [Name], [X] Einheiten. [Bei Guthaben: ✅ Credits wurden automatisch gutgeschrieben.] [Bei Erstattung: Bitte kläre die Erstattung direkt mit dem Yogi.]',
    },
  ],
  sonder: [
    'Sobald ALLE Yogis geantwortet haben, erhält Sarah eine separate Dashboard-Benachrichtigung „Kursabbruch — alle Yogis haben geantwortet" mit Statistik (X Erstattung, X Guthaben).',
  ],
}))

content.push(...ucase({
  titel: 'Guthaben verrechnen bei Wiedereintritt in einen Kurs',
  was: 'Hat ein Yogi noch Guthaben aus einem früheren Kursabbruch, wird es beim Einbuchen in einen neuen Kurs automatisch verrechnet.',
  wer: 'Automatisch durch System, Sarah erhält E-Mail',
  ablauf: [
    'Sarah fügt einen Yogi mit bestehendem Guthaben zu einem neuen Kurs hinzu.',
    'System reduziert das Guthaben um die Anzahl der nötigen Credits.',
    'Falls Guthaben nicht reicht: differenz wird als „muss neu bezahlt werden" gekennzeichnet.',
    'Sarah bekommt eine E-Mail mit Buchhaltungs-Übersicht.',
  ],
  emails: [
    {
      betreff: 'Guthaben verrechnet: [Yogi-Name] ([X]/[Y] Credits)',
      an: 'Admin',
      kern: 'Hallo Sarah, beim Hinzufügen zu einem Kurs wurde Guthaben verrechnet: [X] Credits aus Guthaben verrechnet. [Yogi-Name], [E-Mail], Kurs: [Name]. Buchhaltung: Kurs insgesamt: [Y] Credits. Aus Guthaben verrechnet: [X] Credits. Yogi muss neu bezahlen: [Z] Credits. Verbleibendes Guthaben: [Rest] Credits.',
    },
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 13. ADMIN: YOGIS VERWALTEN
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('13. Admin: Yogis verwalten & einbuchen'))

content.push(...ucase({
  titel: 'Yogi-Übersicht',
  was: 'Sarah sieht alle registrierten Yogis mit Status (aktiv, gelöscht, etc.).',
  wer: 'Admin',
  ablauf: [
    'Bereich „Yogis".',
    'Liste mit Name, E-Mail, Suche.',
    'Klick → Yogi-Detail (Kurse, Credits, Buchungen, Profil).',
  ],
}))

content.push(...ucase({
  titel: 'Yogi manuell in Kurs einbuchen',
  was: 'Sarah trägt einen Yogi nachträglich in einen Kurs ein.',
  wer: 'Admin',
  ablauf: [
    'Yogi-Detail → „In Kurs einbuchen".',
    'Kurs auswählen, ggf. Range (von Stunde X bis Stunde Y, falls Mid-Course-Einstieg).',
    'System erzeugt benötigte Credits und bucht Yogi in alle Stunden des Bereichs.',
    'Yogi bekommt E-Mail „Du wurdest in den Kurs eingetragen".',
  ],
  regeln: [
    'Bei Mid-Course-Einstieg wird die Credit-Anzahl an die verbleibenden Stunden angepasst.',
    'Hat der Yogi noch Guthaben, wird es zuerst verwendet (siehe Anwendungsfall „Guthaben verrechnen").',
  ],
}))

content.push(...ucase({
  titel: 'Quick-Credit-Form (Punktekarte / Quartal-Abo) — Welle C',
  was: 'Sarah vergibt einem Yogi schnell freie Credits. Die Form ist auf zwei Modelle reduziert: Punktekarte oder Quartal-Abo. Kurs-Credits und „Guthaben" werden NICHT mehr hier vergeben — sie entstehen nur noch automatisch durch Kursbuchung bzw. Kursabbruch.',
  wer: 'Admin (Bereich /admin/credits)',
  ablauf: [
    'Sarah öffnet die Seite „Credits vergeben".',
    'Hinweis-Text: „Tipp: Wenn du einen Yogi in einen Kurs einbuchen willst, nutze stattdessen den Button „In Kurs einbuchen" auf dem Yogi-Profil. Diese Seite ist für freie Credits (Punktekarte oder Quartal-Abo)."',
    'Schritt 1 — Credit-Modell: zwei Radio-Buttons. „Punktekarte" (flexibel, kursübergreifend) oder „Quartal-Abo" (gültig im gewählten Quartal).',
    'Schritt 2 — Anzahl Credits: Zahleneingabe 1 bis 50.',
    'Schritt 3a — bei Punktekarte: Verfallsdatum-Auswahl mit 3 Optionen: „90 Tage ab heute (Standard)", „Individuelles Datum wählen" (öffnet Datumsfeld), „Kein Ablaufdatum" (= 2099-12-31).',
    'Schritt 3b — bei Quartal-Abo: Quartals-Auswahl. „Aktuelles Quartal" (Sofort nutzbar · gültig bis [letzter Tag Quartal]) oder „Nächstes Quartal" (Nutzbar ab [erster Tag] · gültig bis [letzter Tag]).',
    'Bei „Nächstes Quartal" erscheint ein amber-Hinweis: „Der Yogi sieht die Credits in seiner Übersicht, kann sie aber erst ab [Datum] einsetzen."',
    'Grüne Preview-Box zeigt Zusammenfassung: „[X] Credits für [Quartal-Label] · Verfall: [Datum]".',
    'Klick auf „[X] Credits vergeben" → Credit wird angelegt. Bei Quartal-Wahl „Nächstes Quartal" wird die DB-Spalte credits.valid_from auf den ersten Tag des Quartals gesetzt.',
  ],
  regeln: [
    'Punktekarte-Default: 90 Tage. „Kein Ablaufdatum" speichert intern den 31.12.2099.',
    'Quartal-Abo: Verfall = letzter Tag des gewählten Quartals (23:59:59). valid_from = NULL bei aktuellem Quartal, = erster Tag des Quartals bei nächstem.',
    'Die Modelle „guthaben" und „course" wurden bewusst aus dieser Form entfernt — sie entstehen nur über Kursabbruch (Yogi-Wahl) bzw. automatische Kurs-Einbuchung.',
    'Credit-Selector (lib/credit-selector.ts) filtert beim Buchen alle Credits heraus, deren valid_from in der Zukunft liegt — der Yogi sieht sie zwar, kann sie aber erst ab valid_from einsetzen.',
  ],
  texte: [
    'Credit-Modell',
    'Punktekarte',
    'Flexibel, kursübergreifend',
    'Quartal-Abo',
    'Gültig im gewählten Quartal',
    'Anzahl Credits',
    'Verfallsdatum',
    '90 Tage ab heute (Standard)',
    'Individuelles Datum wählen',
    'Kein Ablaufdatum',
    'Quartal',
    'Aktuelles Quartal ([Quartal-Label])',
    'Nächstes Quartal ([Quartal-Label])',
    'Sofort nutzbar · gültig bis [Datum]',
    'Nutzbar ab [Datum] · gültig bis [Datum]',
    'Der Yogi sieht die Credits in seiner Übersicht, kann sie aber erst ab [Datum] einsetzen.',
    '[X] Credits vergeben',
  ],
}))

content.push(...ucase({
  titel: 'Dummy-Yogi anlegen (offline Teilnehmer)',
  was: 'Sarah legt einen Yogi an, der die App NICHT selbst nutzt (z.B. ältere Teilnehmerin), um seine Buchungen manuell zu verwalten.',
  wer: 'Admin',
  ablauf: [
    'Bereich „Yogis" → „Dummy anlegen".',
    'Name + ggf. Kurs.',
    'System legt einen Yogi mit „is_dummy"-Flag an.',
    'Dummy bekommt KEINE E-Mails.',
  ],
  regeln: [
    'Dummy-Yogis können sich nicht selbst einloggen und keine Buchungen vornehmen.',
    'Alle E-Mail-Versände prüfen vorher „is_dummy" und überspringen.',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 14. ADMIN: EINZELSTUNDEN VERWALTEN
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('14. Admin: Einzelstunden verwalten'))

content.push(...ucase({
  titel: 'Stunden-Detail im Admin-Bereich',
  was: 'Sarah sieht für jede Stunde die eingebuchten Yogis und die Warteliste.',
  wer: 'Admin',
  ablauf: [
    'Wochenübersicht im Admin → Klick auf Stunde → „Stunde verwalten".',
    'Angezeigt: Kursname, Datum, Uhrzeit, Dauer, ggf. Charity-Pille „Kostenlos".',
    'Liste der Buchungen: pro Yogi „Austragen"-Button.',
    'Liste der Warteliste: pro Yogi „Zur Stunde hinzufügen"-Button (auch bei voller Stunde = Überbuchung möglich).',
  ],
  texte: [
    'Stunde verwalten',
    'Eingebuchte Yogis ([X])',
    'Warteliste ([X])',
    'Austragen',
    'Zur Stunde hinzufügen',
    'Kostenlos',
    'Stunde teilen (WhatsApp / Email)',
    'In Sprechblase posten (für alle Yogis)',
  ],
  sonder: [
    'Bei Charity-Stunden zusätzlich: Button „In Sprechblase posten" und „Stunde teilen (WhatsApp/Email)".',
    'Beim „In Sprechblase posten"-Klick wird die Ankündigung mit Link automatisch gesetzt (Format: „[Kursname] am [Wochentag, Datum] um [Uhrzeit] Uhr — kostenlos!" + Button „Zur Stunde").',
  ],
}))

content.push(...ucase({
  titel: 'Yogi aus Stunde austragen — Welle C/F: 3h-Frist-Modal mit Credit-Wahl',
  was: 'Sarah meldet einen Yogi nachträglich von einer Stunde ab. Je nachdem, wie nah der Stundenbeginn ist, hat Sarah eine Wahl, was mit dem Credit passiert.',
  wer: 'Admin',
  ablauf: [
    'Stunde verwalten (im Bereich /admin/sessions oder im Admin-Dashboard-Session-Detail-Modal) → bei Yogi „Austragen".',
    'System lädt das Session-Datum + die Uhrzeit FRISCH aus der DB und rechnet aus, ob es ≤ 3 Stunden bis Stundenbeginn sind.',
    'FALL A — mehr als 3 Stunden bis Start: einfaches Modal erscheint mit Überschrift „Yogi austragen?" und Text „Der Credit wird zurückgebucht. Platz wird der Warteliste angeboten." Buttons: „Abbrechen" / „Austragen".',
    'FALL B — weniger als 3 Stunden bis Start: spezielles 3-Knopf-Modal erscheint mit Überschrift „Stunde beginnt in weniger als 3 Stunden". Text: „Der Platz wird in beiden Fällen freigegeben und der Warteliste angeboten. Wähle, was mit dem Credit passieren soll:" Drei Buttons: „Credit zurückbuchen" (primary, weiß-auf-braun), „Credit verfällt (z.B. WhatsApp-Abmeldung)" (gelb-amber), „Abbrechen" (grau).',
    'Sarah klickt eine Option. Buchung wird storniert. Bei „Credit verfällt" wird cancel_late=true gesetzt — der Trigger trg_sync_credit_used wird dadurch unterdrückt und der Credit kommt NICHT zurück.',
    'Audit-Log wird geschrieben (mit Flag credit_returned + within_3h).',
    'Yogi bekommt E-Mail „Abmeldung bestätigt" — abhängig vom Credit-Status.',
    'Automatischer Auto-Promote der Warteliste.',
  ],
  regeln: [
    'Das 3h-Modal ist ein echtes React-Modal (kein confirm() mehr) — sowohl in /admin/sessions/[id] als auch im Admin-Dashboard-Session-Detail-Modal identisch (Welle F, gleicher Tag).',
    'Die Frist wird IMMER frisch aus der DB ermittelt, nicht aus dem Client-State (verhindert veraltete Anzeigen nach Refresh).',
    'cancel_late=true verhindert das automatische Credit-Zurückbuchen über den DB-Trigger.',
  ],
  texte: [
    'Stunde beginnt in weniger als 3 Stunden',
    'Der Platz wird in beiden Fällen freigegeben und der Warteliste angeboten. Wähle, was mit dem Credit passieren soll:',
    'Credit zurückbuchen',
    'Credit verfällt (z.B. WhatsApp-Abmeldung)',
    'Abbrechen',
    'Yogi austragen?',
    'Der Credit wird zurückgebucht. Platz wird der Warteliste angeboten.',
    'Austragen',
  ],
  sonder: [
    'Use-Case „WhatsApp-Abmeldung": Yogi hat sich kurzfristig per WhatsApp abgemeldet — Sarah soll keinen Credit zurückgeben müssen, weil die App-Frist ohnehin abgelaufen wäre.',
  ],
}))

content.push(...ucase({
  titel: 'Warteliste-Yogi manuell zur Stunde hinzufügen (auch bei voller Stunde)',
  was: 'Sarah kann einen Yogi von der Warteliste auch dann zur Stunde hinzufügen, wenn die Stunde voll ist.',
  wer: 'Admin',
  ablauf: [
    'Stunde verwalten → bei Warteliste-Yogi „Zur Stunde hinzufügen".',
    'Auch wenn die Plätze schon voll sind, wird der Yogi hinzugefügt (= Überbuchung).',
    'Yogi bekommt Email „Du bist dabei".',
  ],
  regeln: [
    'Maximale Teilnehmer-Zahl wird dabei bewusst überschritten — Sarah-Entscheidung.',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 15. ADMIN: EINLADUNGEN
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('15. Admin: Einladungen & Erinnerungen'))

content.push(...ucase({
  titel: 'Einladung anlegen',
  was: 'Sarah lädt einen neuen Yogi per E-Mail ein.',
  wer: 'Admin',
  ablauf: [
    'Bereich „Einladungen" → „Neue Einladung".',
    'Vorname, Nachname, E-Mail, optional Kurs.',
    'Klick auf „Einladung versenden" → E-Mail wird verschickt.',
  ],
  regeln: [
    'Pro E-Mail-Adresse darf nur EINE offene Einladung gleichzeitig existieren.',
  ],
}))

content.push(...ucase({
  titel: 'Einladung löschen',
  was: 'Sarah widerruft eine ausgesprochene, noch nicht eingelöste Einladung.',
  wer: 'Admin',
  ablauf: [
    'Liste der Einladungen → „Löschen" bei der entsprechenden.',
    'Bestätigen → Eintrag entfernt, Link sofort gesperrt.',
  ],
  regeln: [
    'Selbst wenn der Yogi den Link in seiner E-Mail noch hat — beim Anklicken erscheint „Link abgelaufen oder ungültig".',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 16. ADMIN: DASHBOARD & PROTOKOLL
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('16. Admin: Dashboard & Protokoll'))

content.push(...ucase({
  titel: 'Admin-Dashboard öffnen',
  was: 'Sarah sieht eine kompakte Übersicht der wichtigsten aktuellen Aufgaben und Ereignisse.',
  wer: 'Admin',
  ablauf: [
    'Login als Admin → landet auf Dashboard.',
    'Angezeigt: Heutige Stunden, diese Woche, offene Aufgaben (Kursabbrüche, Erstattungen), Benachrichtigungen.',
  ],
  regeln: [
    'Stunden der aktuellen Woche werden in einer Karten-Übersicht angezeigt, „HEUTE" ist markiert.',
    'Wochen-Navigation per Wischen oder Pfeil.',
  ],
}))

content.push(...ucase({
  titel: 'Benachrichtigungs-Kachel „Kursabbrüche — offene Aufgaben"',
  was: 'Kachel zeigt offene Aufgaben aus Kursabbruch-Workflows: ausstehende Yogi-Wahl + ausstehende Auszahlungen.',
  wer: 'Admin',
  ablauf: [
    'Sarah sieht die Kachel mit Anzahl offener Aufgaben.',
    'Klick öffnet den Bereich „Kursabbrüche", wo Sarah die Erstattungen abhaken kann.',
  ],
  regeln: [
    'Kachel verschwindet, sobald alle Aufgaben erledigt sind.',
    'Sobald der letzte Yogi geantwortet hat, erscheint zusätzlich die Benachrichtigung „Kursabbruch — alle Yogis haben geantwortet" mit Statistik.',
  ],
}))

content.push(...ucase({
  titel: 'Benachrichtigungs-Typen im Dashboard',
  was: 'Dashboard zeigt verschiedene Arten von Benachrichtigungen mit Icon, Farbe und Aktion.',
  wer: 'Admin (Info-Beschreibung)',
  ablauf: [
    'Pro Benachrichtigung: Icon (z.B. Briefkasten, Häkchen), Label, Kurztext, Datum/Uhrzeit, optionaler Direktlink „Jetzt erledigen".',
    'Klick auf „X" markiert sie als gelesen → verschwindet.',
  ],
  texte: [
    'Erstattung überweisen',
    'Reminder-Cron seit 24h still',
    'Brevo-Kontingent fast aufgebraucht',
    'E-Mail konnte nicht zugestellt werden',
    'Kurs fast voll',
    'Neuer Yogi registriert',
    'Account gelöscht',
    'Account DSGVO-gelöscht (PDF im Drive löschen!)',
    'Kurs endet in 2 Wochen — Folgekurs?',
    'Yogi hat Geburtstag 🎂',
    'System-Warnung',
    'Kursabbruch — alle Yogis haben geantwortet',
  ],
  klaren: [
    'Bei den Benachrichtigungstypen „Reminder-Cron seit 24h still" und „Brevo-Kontingent fast aufgebraucht": möchte Sarah hier zusätzlich eine eigene E-Mail-Benachrichtigung haben, oder reicht das Dashboard?',
  ],
}))

content.push(...ucase({
  titel: 'Sprechblase auf der Yogi-Wochenübersicht',
  was: 'Sarah kann eine kurze Nachricht (mit optionalem Button-Link) hinterlegen, die als Sprechblase auf der Yogi-Wochenübersicht erscheint.',
  wer: 'Admin (Profil → Mehr-Menü → „Nachricht für Yogis")',
  ablauf: [
    'Profil-Bereich „Nachricht für Yogis".',
    'Text eingeben, Häkchen „Nachricht aktiv anzeigen".',
    'Optional: Link-URL + Link-Label (Button).',
    'Speichern.',
    'Yogis sehen die Sprechblase mit Sarah-Avatar und ggf. Button.',
  ],
  regeln: [
    'App-interne Links (mit Slash beginnend) öffnen im selben Tab.',
    'Externe Links (http/https) öffnen in einem neuen Tab.',
    'Wenn die URL ohne http/https eingegeben wird (z.B. www.beispiel.de), wird automatisch https:// vorangestellt.',
  ],
  texte: [
    'Nachricht für Yogis',
    'Nachricht aktiv anzeigen',
    'Optional: Button mit Link (z.B. zur Charity-Stunde)',
    'Jetzt anschauen',
  ],
}))

content.push(...ucase({
  titel: 'Protokoll / Audit-Log',
  was: 'Sarah kann nachvollziehen, welche Aktionen wann in der App stattgefunden haben.',
  wer: 'Admin',
  ablauf: [
    'Bereich „Protokoll".',
    'Liste aller Audit-Einträge (Buchung erstellt, Stunde abgesagt, Kursabbruch-Wahl, etc.).',
    'Filter nach Datum/Typ.',
  ],
}))

content.push(...ucase({
  titel: 'System-Health-Status',
  was: 'Sarah sieht im Profil-Bereich den Status wichtiger Hintergrund-Systeme.',
  wer: 'Admin',
  ablauf: [
    'Profil → „Mehr" → System-Status.',
    'Angezeigt: Reminder-Cron-Status, Brevo-E-Mail-Quota, fehlgeschlagene E-Mails.',
    'Fehlgeschlagene E-Mails sind klickbar mit Detail-Modal („Als erledigt markieren" verfügbar).',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// 17. AUTOMATISCHE E-MAILS (Gesamtübersicht)
// ════════════════════════════════════════════════════════════════════════════
content.push(h1('17. Automatische E-Mails — Gesamtübersicht'))
content.push(p('Diese Tabelle listet alle E-Mail-Typen, die die App automatisch verschickt, mit Auslöser, Empfänger, Betreff und Kernaussage. Detail-Beschreibungen stehen in den jeweiligen Bereichen oben.'))

const mailRows = [
  ['welcome', 'Yogi registriert sich erfolgreich', 'Yogi', 'Willkommen bei Yoga mit Sarah!', 'Hallo [Vorname]! Schön, dass du dabei bist! 💛'],
  ['invitation_sent', 'Sarah erstellt eine neue Einladung', 'Eingeladener Yogi', 'Einladung zur Yoga-App – Yoga mit Sarah', 'Ich lade dich herzlich ein, meiner Yoga-App beizutreten! Der Link ist 14 Tage gültig.'],
  ['invitation_reminder', 'Sarah klickt manuell „Erinnerung senden"', 'Eingeladener Yogi', 'Erinnerung: Deine Einladung zur Yoga-App', 'Ich wollte kurz an deine Einladung erinnern.'],
  ['booking_confirmed', 'Yogi bucht erfolgreich eine Stunde', 'Yogi', 'Buchung bestätigt: [Kursname]', 'Deine Buchung ist bestätigt! Abmeldefrist: [Uhrzeit] Uhr.'],
  ['booking_cancelled', 'Yogi sagt eine Stunde ab', 'Yogi', 'Abmeldung bestätigt: [Kursname]', 'Deine Abmeldung wurde bestätigt. [Credit zurück / nicht zurück].'],
  ['waitlist_joined', 'Yogi setzt sich auf die Warteliste', 'Yogi', 'Warteliste: [Kursname]', 'Du stehst auf der Warteliste. Position: [X]. Du wirst automatisch eingebucht.'],
  ['waitlist_promoted', 'Auto-Promote von Warteliste (über 90 Min vor Start)', 'Yogi (nachgerückt)', 'Du bist dabei: [Kursname]', '🎉 Ein Platz ist frei – du bist automatisch eingebucht! 1 Stunde Zeit zur Abmeldung.'],
  ['waitlist_offer_late', 'Auto-Promote-Workflow unter 90 Min vor Start', 'Alle Wartelisten-Yogis', 'Letzte Chance: [Kursname] in Kürze', 'Wer zuerst klickt, bekommt den Platz.'],
  ['waitlist_removed_credit_used_elsewhere', 'Yogi verbraucht durch andere Buchung seinen letzten Credit', 'Yogi', 'Warteliste entfernt: [Kursname]', 'Deine Wartelisten-Position wurde entfernt, weil dein Credit anderweitig verwendet wurde.'],
  ['notify_place_free', 'Stunde frei + Yogi steht auf Benachrichtigungs-Liste', 'Yogi', 'Platz frei: [Kursname]', '🎉 Ein Platz ist frei geworden!'],
  ['session_reminder', 'Cron-Job vor Stundenbeginn (Yogi hat Reminder aktiviert)', 'Yogi', 'Erinnerung: [Kursname] in [X] Std.', 'Kleine Erinnerung an deine Yogastunde.'],
  ['session_cancelled', 'Sarah sagt eine einzelne Stunde ab', 'Eingebuchte Yogis', 'Kursstunde abgesagt: [Kursname]', 'Leider muss ich diese Stunde absagen. [Mit/ohne Ersatztermin.]'],
  ['session_added', 'Ersatztermin wird angelegt + bestehende Yogis werden umgebucht', 'Yogi (war eingebucht)', 'Ersatztermin für deine abgesagte Stunde am [Datum] – [Kursname]', 'Du wurdest automatisch eingetragen und dein Credit der ursprünglichen Stunde wurde dafür verwendet.'],
  ['course_time_changed', 'Sarah ändert die Uhrzeit eines Kurses', 'Alle Teilnehmer', 'Uhrzeitänderung: [Kursname]', 'Die Uhrzeit für deine Stunden hat sich geändert: Bisher [alt] Uhr. Neu [neu] Uhr.'],
  ['course_cancelled', 'Sarah bricht einen Kurs ab', 'Alle Teilnehmer', 'Kurs abgesagt: [Kursname]', 'Leider muss ich den folgenden Kurs absagen. [Alle-Erstattung ODER Yogi-Wahl.]'],
  ['admin_course_cancelled_summary', 'Kursabbruch wird durchgeführt', 'Admin', 'Kurs abgebrochen: [Kursname]', 'Zusammenfassung mit allen betroffenen Yogis.'],
  ['yogi_course_cancel_choice', 'Yogi trifft Wahl Guthaben/Erstattung im Token-Link', 'Yogi', 'Guthaben gutgeschrieben / Erstattungsanfrage bestätigt: [Kursname]', 'Bestätigung der Wahl + Folge-Aktion.'],
  ['admin_yogi_choice', 'Yogi trifft Wahl Guthaben/Erstattung', 'Admin', 'Kursabbruch-Entscheidung: [Yogi-Name]', 'Yogi hat Wahl getroffen + nächster Schritt für Sarah.'],
  ['admin_guthaben_verrechnet', 'Yogi mit Guthaben wird in neuen Kurs eingebucht', 'Admin', 'Guthaben verrechnet: [Yogi-Name] ([X]/[Y] Credits)', 'Buchhaltungs-Übersicht (Kurs gesamt, aus Guthaben verrechnet, muss neu bezahlen, Restguthaben).'],
  ['yogi_enrolled_by_admin', 'Sarah bucht einen Yogi manuell in einen Kurs ein', 'Yogi', 'Du wurdest in den Kurs [Kursname] eingetragen', 'Kurs-Info + Anzahl Stunden + Regeln (Abmeldung, Nachholen, Vorholen, Kursrücktritt).'],
  ['admin_new_yogi', 'Neuer Yogi registriert sich erfolgreich', 'Admin', 'Neuer Yogi: [Voller Name]', 'Yogi-Daten + ggf. Kurs.'],
  ['admin_dsgvo_deletion', 'Yogi löscht seinen Account DSGVO-konform', 'Admin', 'DSGVO: Account gelöscht – PDF bitte manuell löschen', 'Hinweis zur manuellen Löschung der AGB-PDF im Drive.'],
  ['account_deleted_yogi', 'VOR dem finalen Auth-Delete (Welle DSGVO-Bestätigung)', 'Yogi (letzte Mail an alte Adresse)', 'Dein Account bei Yoga mit Sarah wurde gelöscht', 'Hallo [Vorname], dein Account wurde gelöscht. Alle deine Daten wurden entfernt, offene Buchungen storniert, Credits/Guthaben verfallen. Mit dieser E-Mail wird auch deine E-Mail-Adresse aus unserem System entfernt — du erhältst keine weiteren Nachrichten mehr.'],
  ['illness_credit', 'Sarah trägt Yogi krankheitsbedingt aus Kurs aus (Welle G, 25.05.2026)', 'Yogi (keine Dummies)', 'Krankheits-Austragung: [Kursname]', 'Hallo [Vorname], gemäß deinem Attest habe ich dich aus dem Kurs ausgetragen. Du erhältst ein Krankheits-Guthaben über [N] Stunden, gültig bis [Attest+10 Monate]. Vorhol-/Nachholbuchungen wurden ersatzlos beendet. Das Guthaben kann nur mit einem neuen Kurs verrechnet werden — keine Auszahlung.'],
  ['admin_guthaben_2y_expiry', 'Cron-Job (täglich 04:00 Uhr) erkennt 2-Jahre-Guthaben abgelaufen', 'Admin', 'Guthaben nach 2 Jahren abgelaufen: [Yogi-Name] — bitte erstatten', 'Hallo Sarah, das Kursabbruch-Guthaben von [Yogi-Name] ([X] Credits, ursprünglich vergeben am [Datum]) ist heute nach 2 Jahren abgelaufen. Bitte den entsprechenden Geldbetrag manuell überweisen. Link zur Yogi-Detail-Seite anbei.'],
  ['password_reset_request', 'Yogi fordert Passwort-Reset an', 'Yogi', 'Passwort zurücksetzen – Yoga mit Sarah', 'Link zur Passwort-Zurücksetzung (1 Stunde gültig).'],
  ['admin_bulk_announcement', 'Sarah verschickt Bulk-Mail an alle Yogis', 'Alle Yogis', '[frei wählbar von Sarah]', 'Frei wählbarer Body + rechtssicherer Opt-Out-Hinweis am Ende.'],
]

const headerRow = new TableRow({
  tableHeader: true,
  children: ['Typ', 'Auslöser', 'Empfänger', 'Betreff', 'Kernaussage'].map(text =>
    new TableCell({
      shading: { type: ShadingType.SOLID, color: '8a6020', fill: '8a6020' },
      children: [new Paragraph({ children: [new TextRun({ text, font: FONT, size: 20, bold: true, color: 'FFFFFF' })] })],
    })
  ),
})

const dataRows = mailRows.map(row =>
  new TableRow({
    children: row.map(cellText =>
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: cellText, font: FONT, size: 18 })] })],
      })
    ),
  })
)

content.push(new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [headerRow, ...dataRows],
}))

content.push(p(''))
content.push(p('Hinweis: Alle E-Mails haben einen einheitlichen Header (Logo + „Yoga mit Sarah") und Footer (Sarah Lerch · Fuldaer Str. 7 · 63628 Bad Soden-Salmünster + AGB- und Datenschutz-Link).', { italic: true, size: 20 }))

// ════════════════════════════════════════════════════════════════════════════
// 18. NEUERUNGEN WELLE A–F (Mai 2026) — Detail-Ergänzungen
// ════════════════════════════════════════════════════════════════════════════
content.push(pageBreak())
content.push(h1('18. Neuerungen Welle A–F (Mai 2026)'))
content.push(p('Diese Sektion bündelt alle Änderungen aus den Entwicklungs-Wellen Anfang Mai 2026. Sie ergänzt die bereits oben aktualisierten Workflows um Themen, die quer durch die App neue Logiken oder Texte einführen.'))

// ── Welle A: Quick-Wins ─────────────────────────────────────────────
content.push(h2('Welle A — Quick-Wins (kleine Verbesserungen)'))
content.push(p('Welle A bringt mehrere kleine Änderungen, die einzeln klein wirken, in Summe aber die App freundlicher und alltagstauglicher machen.'))

content.push(...ucase({
  titel: 'AGB-Re-Akzeptanz-Banner — neue freundliche Variante',
  was: 'Wenn die AGB-Version aktualisiert wurde, sieht der Yogi beim nächsten Login einen kompakten, freundlichen Hinweisbanner statt einer harten Sperre.',
  wer: 'Yogi (eingeloggt, AGB-Version veraltet)',
  ablauf: [
    'Yogi öffnet die App.',
    'Auf der Rechtliches-Seite erscheint oben ein gelber Banner (Header der Seite zeigt „AGB wurden aktualisiert").',
    'Banner-Text: freundliche, persönliche Ansprache mit Link zur vollen AGB und einer Auflistung dessen, was sich geändert hat.',
    'Yogi liest, scrollt durch und bestätigt mit Häkchen + Klick.',
  ],
  texte: [
    'AGB wurden aktualisiert',
    'Hallo! Es gibt eine aktualisierte AGB-Version „[Label]". Bitte lies dir die Änderungen kurz durch und bestätige sie, damit du weiter buchen kannst.',
    'Was hat sich geändert:',
    'Vollständige AGB: yogamitsarah.me/agb',
  ],
}))

content.push(...ucase({
  titel: 'Geburtsdatum im Profil',
  was: 'Yogi kann sein Geburtsdatum im Profil hinterlegen. DB-Spalte profiles.birthdate ist neu.',
  wer: 'Yogi',
  ablauf: [
    'Profil öffnen → bei „Geburtsdatum" auf „Hinzufügen" oder „Ändern" tippen.',
    'Datumsfeld erscheint (max = heute), Yogi wählt sein Geburtsdatum.',
    'Validierung: nicht in Zukunft, nicht älter als 120 Jahre, gültiges Datum.',
    'Speichern → grüner Toast „Profil gespeichert".',
    'Anzeige im Profil: deutsches Datumsformat (z.B. „14. März 1985"). Wenn leer: Strichplatzhalter.',
  ],
  regeln: [
    'Geburtsdatum ist optional, aber sobald gesetzt: nicht löschbar mehr (nur änderbar).',
    'Wird vom Dashboard für die Benachrichtigung „Yogi hat Geburtstag" verwendet.',
  ],
}))

content.push(...ucase({
  titel: 'Profil-Toast „Profil gespeichert"',
  was: 'Bei jedem erfolgreichen Speichern im Profil-Bereich erscheint kurz ein grüner Toast als Bestätigung.',
  wer: 'Yogi / Admin',
  ablauf: [
    'Yogi/Admin ändert ein Feld im Profil und speichert.',
    'Unten in der Mitte erscheint für ca. 3 Sekunden ein grüner Toast mit Häkchen-Icon: „Profil gespeichert".',
    'Toast verschwindet automatisch nach 3 Sekunden.',
  ],
  texte: [
    'Profil gespeichert',
  ],
}))

content.push(...ucase({
  titel: 'Login: Email-vergessen-Hinweis',
  was: 'Auf der Login-Seite steht unter „Passwort vergessen?" jetzt ein freundlicher Hinweis, was zu tun ist, wenn der Yogi auch seine E-Mail-Adresse vergessen hat.',
  wer: 'Yogi (nicht eingeloggt)',
  ablauf: [
    'Yogi auf der Login-Seite.',
    'Unterhalb des Anmelden-Buttons stehen zwei Hinweise: „Passwort vergessen?" (klickbar) und darunter klein „Email vergessen? Wende dich an Sarah.".',
  ],
  texte: [
    'Passwort vergessen?',
    'Email vergessen? Wende dich an Sarah.',
  ],
}))

content.push(...ucase({
  titel: 'E-Mail-Templates: „Einzelstunde" statt „Kurs"',
  was: 'In allen System-E-Mails wird bei Einzelstunden-Buchungen (Drop-In, Charity) jetzt der Begriff „Einzelstunde" statt „Kurs" verwendet — passt zur Situation und ist freundlicher.',
  wer: 'System (alle E-Mail-Templates)',
  ablauf: [
    'Beim Triggern einer Buchungs-/Abmelde-/Warteliste-E-Mail wird der Flag isSingle ermittelt.',
    'Helper kursLabel(data) entscheidet basierend auf isSingle, ob „Einzelstunde:" oder „Kurs:" in der E-Mail steht.',
    'Edge Function send-email v54 nutzt diesen Helper überall.',
  ],
  regeln: [
    'Betroffene Templates: bookingConfirmed, bookingCancelled, waitlistJoined, waitlistPromoted, waitlistOfferLate, waitlistRemovedCreditUsedElsewhere, notifyPlaceFree, sessionCancelled, sessionAdded, sessionReminder.',
    'Drop-In-Buchung oder Charity-Stunde → „Einzelstunde:". Kurs-Stunde aus eigener Kurs-Buchung → „Kurs:".',
  ],
}))

// ── Welle B: Account-Lösch-Cascade ────────────────────────────────
content.push(h2('Welle B — Account-Lösch-Cascade'))
content.push(p('Welle B führt eine vollständige Cascade ein, wenn ein Yogi gelöscht wird — egal ob durch sich selbst oder durch Sarah. Die wichtigste Neuerung: Plätze in Stunden werden SOFORT für andere Yogis frei, und die Warteliste rückt automatisch nach.'))
content.push(bullet('Details siehe Bereich „9. Kontolöschung & Datenschutz" (oben) — Workflow „Account löschen (DSGVO-konform) — Welle B" und „Admin löscht einen Yogi-Account — Welle B".'))
content.push(bullet('Technisch wichtig (Sarah muss das nicht im Detail kennen, aber zur Kontrolle): Datenbank-Abfrage nutzt FK-Hint sessions!bookings_session_id_fkey, damit eindeutig ist, welcher Session-Fremdschlüssel gemeint ist.'))

// ── Welle C: 3h-Modal + Quick-Credit-Form ──────────────────────────
content.push(h2('Welle C — 3h-Frist-Modal + Quick-Credit-Form'))
content.push(p('Welle C bringt zwei zusammenhängende Änderungen rund um „Was passiert mit Credits in Grenzfällen?".'))
content.push(bullet('Details „3h-Frist-Modal" siehe Bereich „14. Admin: Einzelstunden verwalten" → „Yogi aus Stunde austragen — Welle C/F".'))
content.push(bullet('Details „Quick-Credit-Form" siehe Bereich „13. Admin: Yogis verwalten" → „Quick-Credit-Form (Punktekarte / Quartal-Abo) — Welle C".'))
content.push(bullet('Datenbank-Änderung: credits-Tabelle hat eine neue Spalte „valid_from" (DATE, optional). Sie ist gesetzt, wenn der Credit erst ab einem späteren Datum nutzbar werden soll (z.B. Quartal-Abo für das nächste Quartal). Vom credit-selector werden Credits mit valid_from > Session-Datum automatisch übersprungen.'))

// ── Welle D: Dedup + max_spots-Promote + Guthaben-Split ──────────
content.push(h2('Welle D — Notification-Dedup, max_spots-Promote, Guthaben getrennt'))

content.push(...ucase({
  titel: 'Notification-Dedup-Fix (fn_notify_refund_pending)',
  was: 'Bei Kursabbrüchen wird die Dashboard-Benachrichtigung „Erstattung steht aus" jetzt zuverlässig nur EINMAL pro Yogi erzeugt — kein Doppel-Eintrag mehr, auch wenn Sarah eine Notification bereits gelesen hatte.',
  wer: 'System / Trigger',
  ablauf: [
    'Beim Kursabbruch (Yogi-Wahl: Erstattung) wird die DB-Funktion fn_notify_refund_pending aufgerufen.',
    'Die Funktion prüft jetzt ALLE bestehenden admin_notifications für diesen Yogi+Kurs — egal ob read=true oder read=false.',
    'Wenn schon ein Eintrag existiert (auch ein gelesener): wird KEIN neuer angelegt.',
    'Vorher wurde nur auf read=false geprüft, sodass nach Lesen + erneutem Trigger ein zweiter Eintrag entstand.',
  ],
  regeln: [
    'Sarah sieht jede Aufgabe nur einmal — auch nach Re-Trigger eines Workflows.',
  ],
}))

content.push(...ucase({
  titel: 'Max-Spots eines Kurses erhöhen → Wartelisten-Auto-Promote',
  was: 'Wenn Sarah die Maximal-Teilnehmerzahl eines laufenden Kurses erhöht, rückt die Warteliste in allen zukünftigen Sessions automatisch nach — ohne dass Sarah manuell etwas anstoßen muss.',
  wer: 'Admin',
  ablauf: [
    'Sarah öffnet die Kurs-Bearbeitung und erhöht „Max. Teilnehmer" z.B. von 12 auf 15.',
    'Beim Speichern erkennt das System: max_spots > vorheriger Wert.',
    'Für jede zukünftige Session des Kurses wird promoteWaitlistOrOfferLate aufgerufen — in einer Loop, sodass auch mehrere Plätze pro Session füllbar sind.',
    'Wartelisten-Yogis werden automatisch eingebucht und bekommen die normale „Du bist dabei"-E-Mail.',
  ],
  regeln: [
    'Nur Sessions in der Zukunft werden berücksichtigt (vergangene werden ignoriert).',
    'Loop läuft pro Session, bis kein Promote mehr möglich ist (Liste leer ODER kein Credit-Yogi mehr).',
  ],
}))

content.push(...ucase({
  titel: 'Guthaben-Sektion auf /meine getrennt',
  was: 'Auf der „Meine"-Seite werden „Guthaben" (aus Kursabbruch) und „freie Credits" (Punktekarte, Quartal, Kurs) seit Welle D in zwei separaten Sektionen angezeigt.',
  wer: 'Yogi',
  ablauf: [
    'Yogi öffnet „Meine".',
    'Sektion 1: „Deine freien Credits".',
    'Sektion 2: „Guthaben" (nur falls vorhanden). Mit Erklärung „Aus abgesagtem Kurs · Nicht für Einzelstunden, nur verrechenbar mit neuem Kurs".',
  ],
  regeln: [
    'Quartal-Credits in Sektion 1 haben jetzt das Label „Quartals-Credits · Q[Nummer] [Jahr]" (statt „Einzelstunden-Credits") inkl. Gültigkeits-Zeitraum.',
    'Wenn ein Credit valid_from in der Zukunft hat: amber-Hinweis „Nutzbar ab [Datum]".',
  ],
  texte: [
    'Deine freien Credits',
    'Guthaben',
    'Quartals-Credits · Q[X] [Jahr]',
    'Gültig vom [Start] bis [Ende]',
    'Nutzbar ab [Datum]',
    'Aus abgesagtem Kurs',
    'Nicht für Einzelstunden, nur verrechenbar mit neuem Kurs',
  ],
}))

// ── Welle E: Credit-Ablauf-Banner + Dashboard-Aufgabe ──────────
content.push(h2('Welle E — Credit-Ablauf-Banner & Dashboard-Aufgabe'))

content.push(...ucase({
  titel: 'Credit-Ablauf-Banner auf der Yogi-Wochenübersicht',
  was: 'Yogi sieht oben auf der „Kurse"-Seite (Wochenübersicht) Hinweisboxen, wenn Credits bald verfallen. Banner sind wegklickbar.',
  wer: 'Yogi (NICHT für Admin — wenn is_admin, wird das Banner nicht gerendert)',
  ablauf: [
    'Yogi öffnet die Wochenübersicht /kurse.',
    'Component YogiCreditExpiryBanner lädt alle aktiven Credits + zugehörige Kurse.',
    'Pro Credit wird geprüft: liegt der Verfall innerhalb der Vorwarn-Frist?',
    'Wenn ja: Banner-Card erscheint oben (zwischen Sprechblase und Wochen-Inhalt). Pro Banner ein kleines X oben rechts zum Schließen.',
    'Status pro Reminder-ID wird in localStorage gespeichert — einmal weggeklickt, bleibt es weg (auch nach Reload).',
  ],
  regeln: [
    'Vorwarn-Fristen je Credit-Modell: Kurs-Credit (course) = 7 Tage. Punktekarte (single/tenpack) = 7 Tage. Quartal-Abo (quarterly) = 14 Tage.',
    'Tag-0-Alert (am Verfalls-Tag selbst): rote Card mit Überschrift „Achtung — heute".',
    'Vor-Warnung: gelbe (amber) Card mit Überschrift „Hinweis".',
    'Credits mit valid_from in der Zukunft werden übersprungen — der Verfall ist noch nicht relevant.',
    'Voll verbrauchte Credits (0 frei) werden NICHT angezeigt.',
    'Welle F: Admin sieht das Banner explizit NICHT (Component prüft profile.is_admin).',
  ],
  texte: [
    'Achtung — heute',
    'Hinweis',
    'Dein Kurs „[Name]" endet am [Datum]. Deine freien Credits sind noch bis zum [Datum] gültig (8 Tage nach Kursende).',
    'Deine Credits aus Kurs „[Name]" verfallen heute.',
    'Deine Punktekarte läuft in 1 Woche ab (gültig bis [Datum]).',
    'Deine Punktekarte läuft in [N] Tagen ab (gültig bis [Datum]).',
    'Deine Punktekarte verfällt heute.',
    'Deine Quartals-Credits laufen in [N] Tagen ab (gültig bis [Datum]).',
    'Deine Quartals-Credits verfallen heute.',
  ],
  sonder: [
    'Welle F: Banner-Design vereinfacht — kein linker farbiger Streifen, kein Icon mehr, nur sauberer Text. X-Button rechts oben zum Schließen.',
  ],
}))

content.push(...ucase({
  titel: 'Dashboard-Aufgabe „Guthaben verrechnet"',
  was: 'Neue Aufgaben-Kachel im Admin-Dashboard zeigt Sarah, wenn ein Yogi mit Guthaben in einen neuen Kurs eingebucht wurde — sie weiss damit sofort, dass die Buchhaltung aktualisiert werden muss.',
  wer: 'Admin',
  ablauf: [
    'Beim Einbuchen eines Yogis mit Restguthaben in einen neuen Kurs wird automatisch eine admin_notifications-Zeile mit type=guthaben_verrechnet angelegt.',
    'Auf dem Dashboard erscheint die Kachel mit den nötigen Details (Yogi, Kurs, Anzahl Credits, Differenz die neu bezahlt werden muss, Restguthaben).',
    'Sarah haakt sie ab, sobald die Buchhaltung aktualisiert ist.',
    'Parallel geht die E-Mail „Guthaben verrechnet: [Yogi] ([X]/[Y] Credits)" an Sarah.',
  ],
}))

// ── Welle F: heutige UI-Fixes ─────────────────────────────────
content.push(h2('Welle F — UI/UX-Fixes (heutiger Tag, 25.05.2026)'))

content.push(...ucase({
  titel: '3h-Frist-Modal als echtes React-Modal',
  was: 'Das 3h-Frist-Modal beim „Yogi austragen" ist jetzt überall ein vollwertiges React-Modal mit 3 sauber gestylten Buttons — sowohl in /admin/sessions/[id] als auch im Admin-Dashboard-Session-Detail-Modal.',
  wer: 'Admin',
  ablauf: [
    'Sarah klickt „Austragen" beim Yogi.',
    'Vorher gab es teilweise nur ein Browser-confirm() (iOS-untauglich, kein Custom-Design).',
    'Jetzt: einheitliches Bottom-Sheet-Modal mit den 3 Optionen oder den 2 Optionen (je nach Frist), an beiden Stellen identisch.',
  ],
  regeln: [
    'Workflow + Texte siehe oben „Yogi aus Stunde austragen — Welle C/F".',
  ],
}))

content.push(...ucase({
  titel: 'Banner-Design auf der Wochenübersicht vereinfacht',
  was: 'Das Credit-Ablauf-Banner (YogiCreditExpiryBanner) zeigt jetzt nur noch sauberen Text + X-Button — ohne linken farbigen Streifen und ohne Icon.',
  wer: 'Yogi (UI-Detail)',
  ablauf: [
    'Yogi sieht den Banner.',
    'Aufbau: Überschrift („Achtung — heute" oder „Hinweis") in der Akzent-Farbe (rot / amber), darunter der Erklärtext.',
    'Oben rechts ein kleines X-Icon — Klick blendet diesen einen Hinweis dauerhaft aus.',
  ],
}))

content.push(...ucase({
  titel: 'Dummy-Pille — einheitliches Design',
  was: 'Die Kennzeichnung „Dummy" (für offline-Teilnehmer ohne Login) wird in der ganzen App jetzt einheitlich als kleine dunkelbraune Pille mit weißer Schrift dargestellt.',
  wer: 'Admin (UI-Detail)',
  ablauf: [
    'Überall, wo ein Dummy-User in der Liste auftaucht, erscheint neben dem Namen eine kleine abgerundete Pille mit dem Text „Dummy".',
    'Design: bg-yoga-text (dunkelbraun) + text-white. Klein, dezent, sofort erkennbar.',
    'Stellen: /admin/yogis (Liste), /admin/yogis/[id] (Detail-Header), /admin/kurse (zwei Stellen: Teilnehmerliste + Folgekurs-Übernahme), /admin/sessions/[id] (Buchungs-Liste).',
  ],
  texte: [
    'Dummy',
    'Dummy-User (kein Login)',
  ],
}))

content.push(...ucase({
  titel: 'Sarah-Sprechblase: Avatar auf 73×73 px',
  was: 'Der Avatar in der Sprechblase auf der Yogi-Wochenübersicht ist jetzt exakt 73×73 Pixel — identisch zum Logo im Header. Wirkt visuell ruhiger.',
  wer: 'Yogi / Admin (UI-Detail)',
  ablauf: [
    'Wenn Sarah eine Ankündigung gesetzt hat: Yogi sieht oben auf /kurse eine Sprechblase mit Sarahs Foto.',
    'Foto-Größe: 73×73 px, rund, mit Border-2 in der Hintergrundfarbe und einem leichten Schatten.',
  ],
}))

content.push(...ucase({
  titel: 'Banner & Sprechblase: nur für Yogis, nicht für Admin',
  was: 'Sowohl die Sarah-Sprechblase als auch der Credit-Ablauf-Banner werden für Admin-Nutzer NICHT gerendert — Sarah sieht nicht sich selbst und auch keine Ablauf-Warnungen für ihre eigenen, theoretisch existierenden Credits.',
  wer: 'Admin (Sarah)',
  ablauf: [
    'Component-Render prüft profile.is_admin.',
    'Wenn true → Banner-Component gibt null zurück.',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// Welle G (2026-05-25): Krankheits-Austragung mit Guthaben
// ════════════════════════════════════════════════════════════════════════════
content.push(pageBreak())
content.push(h1('Welle G: Krankheits-Austragung mit Guthaben'))

content.push(...ucase({
  titel: 'Krankheits-Austragung: Yogi mit Attest aus Kurs nehmen',
  was: 'Sarah trägt einen Yogi krankheitsbedingt aus einem laufenden Kurs aus und vergibt ihm Guthaben über die noch ausstehenden Stunden ab dem Attest-Datum. Beispiel: Anna im Kurs „Body & Mind" (10 Stunden), bringt Attest am 25.05. — ab dann werden ihr 5 Reststunden gutgeschrieben.',
  wer: 'Admin (Sarah)',
  ablauf: [
    'Sarah öffnet /admin/yogis/[id] und sieht im Block „Eingebuchte Kurse" pro aktivem Enrollment den Button „Wegen Krankheit austragen" (amber/medizinisches Kreuz-Icon).',
    'Klick öffnet ein Modal mit Datum-Picker („Ab welchem Datum gilt das Attest?", Default: heute).',
    'Sobald das Datum gewählt ist, wird live berechnet: „Es werden N Reststunden gutgeschrieben (Termine: …). Plus M offene Vorhol-/Nachholbuchungen werden storniert und verfallen ersatzlos."',
    'Wenn Reststunden < 4: weicher Warnhinweis „Achtung: weniger als 4 Stunden — AGB sieht 4-Stunden-Mindestgrenze vor. Trotzdem ausführen?" (lässt aber durch).',
    'Pflicht-Checkbox: „Yogi hat Attest vorgelegt (ich habe es gesehen)" — sonst ist der Submit-Button deaktiviert.',
    'Klick auf „Austragen + Guthaben vergeben" → System storniert alle zukünftigen Kurs-Bookings ab Attest-Datum (cancel_late=false), storniert alle offenen Vorhol-/Nachhol-Buchungen (cancel_late=true, ersatzlos), promotet Wartelisten für freigewordene Sessions, setzt enrollments.end_date + end_reason=„illness", legt neuen Credit an (model=„guthaben", source=„illness", total=N Reststunden, expires_at=Attest-Datum+10 Monate).',
    'Audit-Log mit action=„admin_illness_credit" wird angelegt.',
    'Email an Yogi (Template „illness_credit") wird versandt — keine separate Admin-Notification (nur Audit-Log).',
  ],
  regeln: [
    'Krankheits-Guthaben (source=„illness") ist 10 Monate ab Vergabe gültig.',
    'Kursabbruch-Guthaben (source=„cancellation_choice" oder NULL) bleibt bei 2 Jahren — unverändert.',
    'Bestehende Guthaben in der DB werden NICHT angefasst (Bestandsschutz).',
    'Das Guthaben kann NUR mit der Buchung eines neuen Kurses verrechnet werden — keine Auszahlung in Geld, keine Verwendung für Einzelstunden.',
    'Vorhol-/Nachholbuchungen werden ersatzlos beendet (cancel_late=true → kein Credit-Rückfluss).',
    'AGB sieht eine 4-Stunden-Mindestgrenze vor. Der Workflow warnt darunter, blockiert aber nicht (Sarah entscheidet im Einzelfall).',
  ],
  emails: [
    {
      betreff: 'Krankheits-Austragung: [Kursname]',
      an: 'Yogi (echte Email, keine Dummy-User)',
      kern: 'Gemäß deinem Attest habe ich dich aus dem Kurs ausgetragen. Du erhältst ein Guthaben über N Stunden (gültig bis [Datum + 10 Monate]). Vorhol-/Nachholbuchungen sind ersatzlos beendet. Guthaben nur für neuen Kurs einlösbar — keine Auszahlung.',
    },
  ],
  sonder: [
    'Wenn keine Reststunden ab Attest-Datum existieren (z.B. Yogi hat alles schon abgesagt oder Kurs ist bereits zu Ende), wird kein Guthaben angelegt — die Operation läuft trotzdem durch (enrollment wird beendet, Audit-Log geschrieben). Modal-Submit erfordert aber illnessPreview vorhanden.',
    'Dummy-Yogis bekommen keine Email (wie überall sonst auch).',
    'Wenn nur Vorhol/Nachhol storniert werden (keine Kurs-Reststunden), gibt es trotzdem kein Guthaben — nur die Stornierungen + Audit-Log.',
  ],
  klaren: [
    'Folge-TODO (Sarah): AGB-Versionierung muss separat aktualisiert werden — Krankheits-Klausel mit 10-Monats-Frist und „nur für neuen Kurs verrechenbar, keine Geld-Auszahlung" sollte explizit dokumentiert sein.',
  ],
}))

content.push(...ucase({
  titel: 'Anzeige in /meine: Krankheits-Guthaben vs. Kurs-Guthaben',
  was: 'In der Yogi-Übersicht /meine werden Guthaben jetzt nach Herkunft unterschiedlich beschriftet — Krankheits-Guthaben mit eigenem Label und der korrekten 10-Monats-Frist, Kursabbruch-Guthaben weiterhin mit 2-Jahres-Frist.',
  wer: 'Yogi',
  ablauf: [
    'Yogi öffnet /meine — sieht im Block „Guthaben" pro Credit eine Karte.',
    'Wenn credits.source=„illness": Label „Krankheits-Guthaben — gültig bis [Datum]".',
    'Wenn credits.source=„cancellation_choice" oder NULL: Label „Kurs-Guthaben — gültig bis [Datum]".',
    'Zusätzlich wird immer die Restzeit in Tagen angezeigt („Noch X Tage gültig").',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// Welle H (2026-05-25): Click-Wrap, Kursabbruch-Default, 2J-Auto-Refund, DSGVO-Confirm-Mail
// ════════════════════════════════════════════════════════════════════════════
content.push(pageBreak())
content.push(h1('Welle H: Click-Wrap, Auto-Refund & DSGVO-Confirm (25.05.2026)'))
content.push(p('Welle H bündelt vier rechtlich relevante Änderungen, die alle am selben Tag entstanden sind:'))
content.push(bullet('Click-Wrap „Allgemeine Regeln" auf der Rechtliches-Seite — Yogi muss die Verhaltensregeln zusätzlich zur AGB aktiv bestätigen.'))
content.push(bullet('Stornofrist auf 14 Tage erhöht + 30 € Bearbeitungsgebühr im Fenster 13–7 Tage.'))
content.push(bullet('Kursabbruch-Default umgestellt: ohne Yogi-Wahl gibt es jetzt Geldbetrag (war: Guthaben).'))
content.push(bullet('Cron-Job „2-Jahre-Guthaben-Auto-Refund" — abgelaufene Kursabbruch-Guthaben lösen Admin-Notification + Email an Sarah aus.'))
content.push(bullet('Account-Lösch-Workflow: Yogi bekommt VOR dem finalen Auth-Delete eine Bestätigungs-Mail (DSGVO Art. 12 Transparenz).'))

content.push(...ucase({
  titel: 'Click-Wrap „Allgemeine Regeln" auf der Rechtliches-Seite',
  was: 'Auf /rechtliches sieht der Yogi neben den AGB-Punkten auch einen separaten Block „Allgemeine Regeln". Er enthält die drei Verhaltensregeln (Pünktlichkeit, Handy stumm, Krankheit/Erkältung) und muss aktiv per Häkchen bestätigt werden.',
  wer: 'Yogi (eingeloggt, beim ersten Login bzw. nach Update)',
  ablauf: [
    'Yogi öffnet /rechtliches (entweder beim Onboarding-Flow oder über Profil → Rechtliches).',
    'Im Block „Allgemeine Regeln" stehen drei Bullet-Punkte:',
    '• „Bitte sei pünktlich auf der Matte. Bei Verspätung — kein Eintritt während der Anfangsentspannung."',
    '• „Schalte dein Handy immer stumm oder aus."',
    '• „Aus Rücksicht auf die Gruppe bitte bei ansteckenden Erkrankungen / Erkältungssymptomen nicht am Unterricht teilnehmen."',
    'Yogi setzt das Häkchen „Ich habe die AGB sowie die allgemeinen Regeln gelesen und akzeptiere sie" und bestätigt.',
    'Zustimmung wird mit Versionsnummer + Zeitstempel im Profil gespeichert.',
  ],
  regeln: [
    'Diese Regeln sind zusätzlich Bestandteil der AGB (§ 1.4). Click-Wrap dient der rechtssicheren Nachweisbarkeit.',
    'Bei Versions-Update der AGB oder Allgemeinen Regeln erscheint die Seite erneut zur Re-Bestätigung (Welle A — AGB-Re-Akzeptanz-Banner).',
  ],
  texte: [
    'Allgemeine Regeln',
    'Bitte sei pünktlich auf der Matte. Bei Verspätung — kein Eintritt während der Anfangsentspannung.',
    'Schalte dein Handy immer stumm oder aus.',
    'Aus Rücksicht auf die Gruppe bitte bei ansteckenden Erkrankungen / Erkältungssymptomen nicht am Unterricht teilnehmen.',
  ],
}))

content.push(...ucase({
  titel: 'Stornofrist neu: 14 Tage + 30 € Bearbeitungsgebühr (13–7 Tage)',
  was: 'Die Stornofrist für komplette Kurse wurde von 7 auf 14 Tage erhöht; im Fenster 13–7 Tage vorher fällt eine Bearbeitungsgebühr von 30 € an. Unter 7 Tagen ist die volle Kursgebühr fällig. Ersatzteilnehmer sind jederzeit möglich.',
  wer: 'Yogi / Admin (rechtlicher Workflow)',
  ablauf: [
    '> 14 Tage vor Kursbeginn: kostenfreie Stornierung.',
    '13 bis 7 Tage vor Kursbeginn: 30 € Bearbeitungsgebühr, da der Platz kurzfristig neu vergeben werden muss.',
    '< 7 Tage vor Kursbeginn: volle Kursgebühr ist fällig — auch bei Nichterscheinen.',
    'Jederzeit möglich: Yogi benennt einen passenden Ersatzteilnehmer.',
  ],
  regeln: [
    'Die neue Frist gilt sowohl in der App-Bestätigungs-E-Mail (Email-Template yogi_enrolled_by_admin) als auch auf /rechtliches und im AGB-Dokument.',
    'Für Veranstaltungen (Workshops, Specials) gilt die 7-Tage-Frist gemäß AGB § 1.2. Neu: Rückt ein Yogi automatisch von der Warteliste nach, hat er noch 60 Minuten Zeit, sich kostenlos wieder abzumelden — auch bei bezahlten Events innerhalb der 7-Tage-Sperre. Danach gilt die 7-Tage-Frist wieder.',
  ],
  texte: [
    'Kostenfreie Stornierung bis 14 Tage vor Kursbeginn',
    '30 € Bearbeitungsgebühr (13 bis 7 Tage vorher)',
    'Volle Kursgebühr ab 6 Tagen vorher',
    'Ersatzteilnehmer jederzeit möglich',
  ],
}))

content.push(...ucase({
  titel: 'Cron-Job: 2-Jahre-Guthaben-Auto-Refund (täglich 04:00 Uhr)',
  was: 'Ein täglicher Cron-Job (fn_check_guthaben_2y_expiry) prüft, ob Kursabbruch-Guthaben (credits.source=„cancellation_choice" bzw. NULL) ihre 2-Jahres-Gültigkeit erreicht haben. Bei Ablauf wird das Guthaben automatisch als verbraucht markiert, eine Admin-Notification angelegt und eine E-Mail an Sarah versandt — sie überweist den Geldbetrag manuell.',
  wer: 'System (DB-Function + pg_cron, 04:00 Uhr täglich)',
  ablauf: [
    'pg_cron ruft täglich um 04:00 Uhr die DB-Function public.fn_check_guthaben_2y_expiry() auf.',
    'Function findet alle credits mit source=„cancellation_choice" (oder NULL) und expires_at <= heute, die noch nicht vollständig verbraucht sind.',
    'Pro Treffer: credits.used = credits.total wird gesetzt (Guthaben gilt als „erledigt").',
    'admin_notifications-Zeile mit type=„guthaben_2y_expired" wird angelegt — sichtbar im Dashboard mit Link zur Yogi-Detail-Seite.',
    'pg_net.http_post triggert die Edge-Function trigger-admin-email → E-Mail-Template admin_guthaben_2y_expiry wird versandt an Sarah.',
    'Sarah sieht die Aufgabe im Dashboard, überweist den Geldbetrag und hakt die Notification ab.',
  ],
  regeln: [
    'Nur Kursabbruch-Guthaben (2 Jahre) betroffen — Krankheits-Guthaben (10 Monate, source=„illness") verfällt nach AGB ersatzlos und wird NICHT automatisch erstattet.',
    'Idempotent: bereits vollständig verbrauchte Guthaben werden nicht erneut verarbeitet.',
    'DB-Function nutzt net.http_post → trigger-admin-email → Edge-Function; verifiziert in Test 19-notifications.spec.ts.',
  ],
  emails: [
    {
      betreff: 'Guthaben nach 2 Jahren abgelaufen: [Yogi-Name] — bitte erstatten',
      an: 'Admin',
      kern: 'Hallo Sarah, das Kursabbruch-Guthaben von [Yogi-Name] ([X] Credits, vergeben am [Datum]) ist heute nach 2 Jahren abgelaufen. Du müsstest den entsprechenden Geldbetrag jetzt manuell überweisen. Hier ist der Link zur Yogi-Detail-Seite mit Bankverbindung.',
    },
  ],
  texte: [
    'Guthaben nach 2 Jahren abgelaufen',
    'Bitte Geldbetrag manuell überweisen',
  ],
  sonder: [
    'Damit erfüllt die App das in AGB § 1.2 versprochene „du verlierst in keinem Fall etwas" für Kursabbruch-Guthaben.',
  ],
}))

content.push(...ucase({
  titel: 'Account-Lösch-Bestätigungs-E-Mail an Yogi (DSGVO Art. 12)',
  was: 'Wenn ein Yogi seinen Account selbst löscht oder durch Sarah gelöscht wird, erhält der Yogi VOR dem finalen Auth-Delete eine Bestätigungs-Mail an seine bisherige E-Mail-Adresse. Diese E-Mail ist die letzte Nachricht der App an den Yogi.',
  wer: 'System (lib/email.ts → Email.accountDeletedYogi)',
  ablauf: [
    'Yogi (oder Sarah als Admin) löst die Löschung aus.',
    'Cascade läuft: Buchungen storniert, Wartelisten entfernt, Plätze freigegeben, PII anonymisiert, Credits/Guthaben verfallen.',
    'BEVOR der Auth-User in Supabase Auth gelöscht wird: System ruft Email.accountDeletedYogi({email, firstName}) auf.',
    'Yogi bekommt eine E-Mail mit Betreff „Dein Account bei Yoga mit Sarah wurde gelöscht".',
    'Erst danach wird der Supabase-Auth-User entfernt und die E-Mail-Adresse aus der Datenbank gelöscht.',
    'Parallel geht admin_dsgvo_deletion-Mail an Sarah (Hinweis auf manuelle PDF-Löschung).',
  ],
  regeln: [
    'Rechtsgrundlage: DSGVO Art. 12 (Transparenz) — der Yogi muss über die Verarbeitung (hier: die Löschung) informiert werden.',
    'E-Mail wird auch versandt, wenn Admin (Sarah) den Account löscht — nicht nur bei Selbstlöschung.',
    'Direkter fetch zur Edge-Function send-email wurde aus app/profil/page.tsx und app/admin/yogis/[id]/page.tsx entfernt (fehlte x-function-secret → 401); jetzt ausschließlich über zentralen Email-Helper.',
  ],
  emails: [
    {
      betreff: 'Dein Account bei Yoga mit Sarah wurde gelöscht',
      an: 'Yogi (an die noch existierende E-Mail-Adresse, letzte Nachricht)',
      kern: 'Hallo [Vorname], dein Account bei Yoga mit Sarah wurde gelöscht. Alle deine persönlichen Daten wurden entfernt bzw. anonymisiert, offene Buchungen storniert und etwaige Credits/Guthaben sind verfallen. Mit dieser E-Mail wird auch deine E-Mail-Adresse aus unserem System entfernt — du erhältst keine weiteren Nachrichten mehr. Solltest du irgendwann zurückkommen wollen, freue ich mich auf eine neue Registrierung. Alles Liebe, Sarah.',
    },
    {
      betreff: 'DSGVO: Account gelöscht – PDF bitte manuell löschen',
      an: 'Admin (parallel zur Yogi-Mail)',
      kern: 'Hallo Sarah, folgender Account wurde DSGVO-konform gelöscht: [Name], [E-Mail]. Bitte lösche die AGB-PDF im Google Drive manuell.',
    },
  ],
  sonder: [
    'Verifiziert durch tests/e2e/14a-account-loeschung-source.spec.ts: Source-Smoke-Tests prüfen Vorhandensein von Email.accountDeletedYogi in beiden Lösch-Pfaden und das Fehlen direkter send-email-Fetches.',
  ],
}))

// ════════════════════════════════════════════════════════════════════════════
// Welle I (2026-05-29): Gebündelte Audit-Fixes Fall 1–5
// ════════════════════════════════════════════════════════════════════════════
content.push(pageBreak())
content.push(h1('Welle I: Audit-Fixes (29.05.2026)'))
content.push(p('Welle I bündelt fünf abgestimmte Klarstellungen und Härtungen, die bei einem Code-Audit aufgefallen sind. Fall 1 war nur eine Bestätigung (kein Code), Fall 2–5 sind echte Korrekturen.'))
content.push(bullet('Fall 1: Guthaben-Fristen bestätigt — Krankheits-Guthaben 10 Monate, Kursabbruch-Guthaben 2 Jahre mit Auszahl-Erinnerung (kein Code geändert).'))
content.push(bullet('Fall 2: Kursabbruch löscht versehentlich KEIN Guthaben mehr.'))
content.push(bullet('Fall 3: Warteliste-Vorgänge werden jetzt lückenlos im Protokoll mitgeschrieben.'))
content.push(bullet('Fall 4: Account-Selbstlöschung räumt alle Daten explizit + meldet Auth-Fehler ehrlich.'))
content.push(bullet('Fall 5: Absage-Fristen rechnen jetzt verlässlich in deutscher Zeit (Europe/Berlin).'))

content.push(...ucase({
  titel: 'Fall 1: Guthaben-Fristen bestätigt (Krankheit 10 Monate / Kursabbruch 2 Jahre)',
  was: 'Bestätigung der zwei unterschiedlichen Guthaben-Fristen. Krankheits-Guthaben (source=„illness") ist 10 Monate ab Attest gültig; Kursabbruch-Guthaben (source=„cancellation_choice") ist 2 Jahre gültig und löst nach Ablauf eine Auszahl-Erinnerung an Sarah aus. Hier war nichts falsch — nur dokumentarisch verankert.',
  wer: 'System / Dokumentation',
  ablauf: [
    'Krankheits-Guthaben: gültig bis Attest-Datum + 10 Monate (Welle G).',
    'Kursabbruch-Guthaben: gültig 2 Jahre ab Vergabe (Welle H).',
    'Nach Ablauf des 2-Jahre-Guthabens läuft täglich um 04:00 Uhr der Cron fn_check_guthaben_2y_expiry → Dashboard-Notification + E-Mail „admin_guthaben_2y_expiry" an Sarah mit der Bitte, den Betrag manuell zu erstatten.',
  ],
  regeln: [
    'Beide Guthaben-Arten sind NUR mit einem neuen Kurs verrechenbar, nicht für Einzelstunden und nicht als Geld-Auszahlung (außer der manuellen 2-Jahre-Erstattung durch Sarah).',
  ],
}))

content.push(...ucase({
  titel: 'Fall 2: Kursabbruch schützt Guthaben vor versehentlicher Löschung',
  was: 'Beim kompletten Abbrechen eines Kurses (Admin) wurde bisher beim Aufräumen der Credits zu viel gelöscht — auch bereits vergebenes Guthaben hätte verschwinden können. Jetzt gilt dasselbe Schutzmuster wie beim Kurs-Löschen: Guthaben wird vom Kurs entkoppelt statt gelöscht.',
  wer: 'Admin (Kursabbruch unter /admin/kurse)',
  ablauf: [
    'Sarah bricht einen Kurs ab.',
    'Guthaben-Credits (model=„guthaben") werden vom Kurs gelöst (course_id wird geleert) und bleiben im Profil des Yogis erhalten.',
    'Nur die normalen Kurs-Credits (nicht-Guthaben) dieses Kurses werden gelöscht.',
  ],
  regeln: [
    'Identisches Verhalten wie beim Kurs-Löschen (deleteCourse) — die beiden Pfade sind jetzt konsistent.',
    'Vergebenes Guthaben eines Yogis kann durch einen Kursabbruch nicht mehr verloren gehen.',
  ],
}))

content.push(...ucase({
  titel: 'Fall 3: Warteliste-Vorgänge vollständig im Protokoll',
  was: 'Bisher tauchten manche Warteliste-Vorgänge nur als E-Mail auf, aber nicht im Protokoll bzw. in der Yogi-Historie. Jetzt werden drei Vorgänge lückenlos protokolliert — jeweils mit Name, Stundentitel und Datum/Uhrzeit, sichtbar im zentralen Protokoll und in der Historie des einzelnen Yogis.',
  wer: 'System (Warteliste-Automatik) + Yogi (Beitritt)',
  ablauf: [
    'Warteliste-Beitritt: Trägt sich ein Yogi auf eine Warteliste ein, wird das protokolliert („Auf Warteliste eingetragen").',
    'Automatisches Nachrücken: Wird ein Yogi automatisch von der Warteliste eingebucht, wird das protokolliert („Von Warteliste nachgerückt") — in beiden Nachrück-Wegen der App.',
    'Automatische Entfernung: Verbraucht ein Yogi durch das Nachrücken seinen letzten Credit, wird seine Entfernung von anderen Wartelisten protokolliert („Von Warteliste entfernt — letzter Credit verbraucht").',
  ],
  regeln: [
    'Das Protokoll-Schreiben ist so abgesichert, dass ein Fehler beim Protokollieren das eigentliche Nachrücken nie abbricht.',
    'Alle drei Vorgänge erscheinen sowohl im zentralen Protokoll als auch in der aufklappbaren Historie auf der Yogi-Detail-Seite.',
  ],
}))

content.push(...ucase({
  titel: 'Fall 4: Account-Selbstlöschung voll abgesichert',
  was: 'Beim Löschen des eigenen Accounts werden jetzt alle Yogi-Daten ausdrücklich entfernt (nicht nur über automatische Datenbank-Verknüpfungen). Schlägt die endgültige Zugangs-Löschung fehl, meldet das System das ehrlich und benachrichtigt Sarah — statt fälschlich „erfolgreich" zu melden.',
  wer: 'Yogi (Profil → Account löschen)',
  ablauf: [
    'Vor der eigentlichen Zugangs-Löschung werden Buchungen, Credits, Benachrichtigungs-Protokoll und Wartelisten-Angebote des Yogis ausdrücklich gelöscht.',
    'Erst danach wird der Auth-Zugang entfernt.',
    'Schlägt die Auth-Löschung fehl, meldet die Route einen ehrlichen Fehler (kein „success") und legt eine Admin-Benachrichtigung „auth_delete_failed" an, damit Sarah nachfassen kann.',
  ],
  regeln: [
    'Die Dashboard-Benachrichtigung „Account DSGVO-gelöscht" (mit Name + E-Mail) bleibt bewusst bestehen — sie wird für Sarahs manuelles Löschen der AGB-PDF im Google Drive gebraucht.',
  ],
}))

content.push(...ucase({
  titel: 'Fall 5: Absage-Fristen in deutscher Zeit (Europe/Berlin)',
  was: 'Die Stornofristen (z.B. 3 Stunden vor Stundenbeginn, 90-Minuten-Grenze) werden jetzt verlässlich in deutscher Zeitzone berechnet — unabhängig davon, welche Zeitzone das Gerät des Yogis eingestellt hat. Am Absage-Button steht ein klarer Hinweis dazu.',
  wer: 'Yogi (Abmeldung von einer Stunde)',
  ablauf: [
    'Stundenbeginn und die 3-Stunden- bzw. 90-Minuten-Grenze werden anhand der deutschen Wand-Uhrzeit (Europe/Berlin) berechnet.',
    'Am „Ja, abmelden"-Button erscheint der Hinweis „Für alle Fristen gilt die deutsche Zeitzone (Europe/Berlin)."',
  ],
  regeln: [
    'Falls die Berlin-Berechnung einmal nicht möglich ist, greift als Rückfall die bisherige Geräte-Zeit — die Frist wird also nie komplett umgangen.',
    'Bei kostenlosen (Charity-)Stunden gibt es weiterhin keine Frist und keinen Credit-Verlust; der Hinweis erscheint dort nicht.',
  ],
  texte: [
    'Für alle Fristen gilt die deutsche Zeitzone (Europe/Berlin).',
  ],
}))

content.push(pageBreak())
content.push(h1('Anhang: Begriffsklärung'))
content.push(...[
  ['Credit', 'Wertgutschrift für 1 Stunde. Unterschiedliche Arten (Kurs, Punktekarte, Guthaben).'],
  ['Guthaben', 'Restwert in Credits aus einem abgebrochenen Kurs. 2 Jahre gültig.'],
  ['Ersatzstunde', 'Eine neu angelegte Stunde, die eine abgesagte ersetzt.'],
  ['Vorholstunde', 'Eine Stunde, die ein Yogi vor seinem regulären Termin bucht, um eine zukünftige Stunde nachzuholen.'],
  ['Nachholstunde', 'Eine Stunde nach dem regulären Termin, um eine zuvor abgesagte Stunde aufzuholen.'],
  ['Drop-In', 'Einzelne Buchung in einem Kurs, in dem der Yogi nicht eingebucht ist.'],
  ['Charity-Stunde', 'Stunde ohne Credit-Verbrauch (Häkchen „Kostenlos" beim Anlegen).'],
  ['Warteliste', 'Yogi mit Credit wartet auf einen freien Platz und wird automatisch eingebucht.'],
  ['Nur benachrichtigen', 'Yogi ohne Credit wird nur informiert, wenn ein Platz frei wird.'],
  ['Late-Offer', '„Letzte-Chance"-E-Mail an alle Wartelisten-Yogis, wenn unter 90 Min. vor Start ein Platz frei wird.'],
  ['Auto-Promote', 'Automatisches Einbuchen des ersten Wartelisten-Yogis mit Credit, wenn ein Platz frei wird (über 90 Min. vor Start).'],
  ['Dummy-Yogi', 'Yogi-Profil ohne eigenen Zugang. Wird von Sarah verwaltet, bekommt keine E-Mails.'],
  ['Ausgeschlossene Stunde', 'Termin, den Sarah aus dem Kurs gestrichen hat (z.B. Feiertag). Wird Yogi NICHT angezeigt. Zählt nicht zur Kursdauer.'],
  ['Abgesagte Stunde', 'Termin, den Sarah einzeln abgesagt hat. Bleibt für Yogis sichtbar (mit Hinweis + ggf. Ersatztermin).'],
  ['Kursabbruch', 'Sarah beendet einen Kurs vorzeitig. Alle zukünftigen Stunden entfallen, Yogis bekommen Erstattung oder Guthaben.'],
  ['Punktekarte', 'Credit-Modell „tenpack" — Yogi kauft mehrere Einzelstunden-Credits. Default 90 Tage gültig (Welle C). Kursübergreifend einsetzbar.'],
  ['Quartal-Abo', 'Credit-Modell „quarterly" — Credits gelten für ein ganzes Quartal (Q1–Q4). Verfall = letzter Tag des Quartals. Bei „nächstes Quartal" wird valid_from gesetzt, Yogi sieht die Credits sofort, kann sie aber erst ab Quartalsstart einsetzen.'],
  ['valid_from', 'DB-Spalte auf credits-Tabelle (Welle C). Optional. Wenn gesetzt, ist der Credit erst ab diesem Datum nutzbar — der credit-selector überspringt ihn vorher. Yogi sieht den Hinweis „Nutzbar ab [Datum]".'],
  ['cancel_late', 'Flag auf Bookings. Wenn true beim Stornieren, wird der DB-Trigger trg_sync_credit_used unterdrückt → Credit kommt NICHT zurück. Wird im 3h-Frist-Modal genutzt, wenn Sarah „Credit verfällt" wählt.'],
  ['3h-Frist', 'Stornierungs-Frist: bis 3 Stunden vor Stundenbeginn kostenlos abmelden. Darunter verfällt der Credit (bei Yogi-Abmeldung immer; beim Admin-Austrag wählbar über das 3h-Modal seit Welle C).'],
  ['Late-Offer-Frist', '90 Minuten vor Stundenbeginn — bis dahin läuft Auto-Promote, danach kommt der Late-Offer-Workflow (Mail an alle Wartelisten-Yogis).'],
  ['Krankheits-Guthaben (Welle G)', 'Guthaben mit credits.source=„illness", angelegt bei Krankheits-Austragung. 10 Monate ab Attest-Datum gültig. Nur verrechenbar mit neuem Kurs, keine Auszahlung in Geld.'],
  ['credits.source', 'Spalte auf der credits-Tabelle (Welle G). Werte: NULL (Standard), „illness" (Krankheits-Austragung, 10 Mo), „cancellation_choice" (Kursabbruch-Wahl, 2 Jahre).'],
  ['enrollments.end_date / end_reason', 'Spalten auf enrollments (Welle G). end_date = Tag, an dem die Teilnahme endet (z.B. Attest-Datum). end_reason = „illness" / „course_cancelled" / „admin_removed".'],
  ['Click-Wrap (Welle H)', 'Aktive Zustimmung per Häkchen auf /rechtliches — Yogi bestätigt zusätzlich zu den AGB die „Allgemeinen Regeln" (Pünktlichkeit, Handy, Krankheit). Zeitstempel + Versionsnummer werden im Profil gespeichert.'],
  ['Stornofrist 14 Tage (Welle H)', 'Neue Frist seit 25.05.2026 — kostenfreier Rücktritt bis 14 Tage vor Kursbeginn, danach 30 € Bearbeitungsgebühr bis 7 Tage vorher, danach volle Kursgebühr.'],
  ['fn_check_guthaben_2y_expiry (Welle H)', 'DB-Function, die täglich 04:00 Uhr per pg_cron läuft. Findet abgelaufene Kursabbruch-Guthaben (2 Jahre), markiert sie als verbraucht, legt admin_notification an und triggert via pg_net Edge-Function trigger-admin-email → Mail an Sarah.'],
  ['admin_guthaben_2y_expiry (Mail-Template)', 'E-Mail-Template für die 2-Jahre-Auto-Refund-Benachrichtigung an Sarah. Subject: „Guthaben nach 2 Jahren abgelaufen: [Yogi-Name] — bitte erstatten".'],
  ['account_deleted_yogi (Mail-Template)', 'Bestätigungs-Mail an den Yogi vor dem finalen Auth-Delete (DSGVO Art. 12). Letzte Nachricht vor Entfernung der E-Mail-Adresse.'],
  ['Kursabbruch-Default (Welle H)', 'Seit 25.05.2026 ist die Geld-Erstattung (§ 326 BGB) der Default bei Kursabbruch ohne Yogi-Antwort. Bisher war es „Guthaben" — bewusst umgestellt.'],
].map(([term, def]) => pRich([
  { text: term + ': ', bold: true },
  { text: def },
])))

// ════════════════════════════════════════════════════════════════════════════
// Doc bauen + speichern
// ════════════════════════════════════════════════════════════════════════════
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: FONT, size: 22 } },
    },
  },
  features: { updateFields: true },
  sections: [{
    properties: {
      page: {
        margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1), right: convertInchesToTwip(1) },
      },
    },
    children: content,
  }],
})

Packer.toBuffer(doc).then(buf => {
  const out = path.join(__dirname, '..', 'Yoga-mit-Sarah-Anwendungsfaelle.docx')
  fs.writeFileSync(out, buf)
  console.log('✓ Dokument geschrieben:', out, '(' + (buf.length / 1024).toFixed(1) + ' KB)')
}).catch(err => {
  console.error('Fehler beim Bauen:', err)
  process.exit(1)
})
