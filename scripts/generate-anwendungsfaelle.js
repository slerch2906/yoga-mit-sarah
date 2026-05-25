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
  children: [new TextRun({ text: 'Version 1.0 (initiale Erfassung — Stand der App nach Welle Charity / Mai 2026)', font: FONT, size: 22 })],
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
  ],
  klaren: [
    'Genauer Wortlaut der Fehlermeldung bei falschem Passwort.',
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
  titel: 'Credit-Anzeige auf „Meine"-Seite',
  was: 'Yogi sieht eine Übersicht seiner verfügbaren Credits, gruppiert nach Kurs/Quelle.',
  wer: 'Yogi (eingeloggt)',
  ablauf: [
    'Yogi öffnet „Meine".',
    'Oberhalb der Buchungen sieht er eine Card mit allen Credits.',
    'Pro Credit wird angezeigt: Anzahl frei (von Gesamt), Quelle/Kurs, Ablaufdatum.',
  ],
  regeln: [
    'Abgelaufene Credits (expires_at < heute) werden NICHT angezeigt.',
    'Voll verbrauchte Credits (0 frei) werden NICHT angezeigt.',
    'Bei Kurs-Credits steht zusätzlich „aus Kurs: [Name]".',
  ],
  texte: [
    'Du hast keine freien Credits.',
    'aus Kurs: [Name]',
    'Verfallen am [Datum]',
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
    'Angezeigt: Vorname, Nachname, E-Mail (nicht änderbar), Geburtsdatum, Telefon, Notfallkontakt.',
    'Felder können direkt bearbeitet werden, „Speichern" sichert die Änderung.',
  ],
  regeln: [
    'E-Mail-Adresse kann der Yogi NICHT selbst ändern (Sicherheit + Brevo-Versand).',
    'Notfallkontakt ist optional, aber empfohlen.',
  ],
  klaren: [
    'Genauer Wortlaut der Speicher-Bestätigung („Profil gespeichert" o.ä.) bitte verifizieren.',
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
  titel: 'Account löschen (DSGVO-konform)',
  was: 'Yogi löscht sein Konto endgültig. Persönliche Daten werden anonymisiert, Buchungs-Historie bleibt aus rechtlichen Gründen anonym erhalten.',
  wer: 'Yogi',
  ablauf: [
    'Profil → ganz unten: „Account löschen".',
    'Bestätigungs-Dialog mit klarem Hinweis auf Endgültigkeit.',
    'Nach Bestätigung: Vor-/Nachname werden auf „Gelöscht" gesetzt, E-Mail auf eine Anonym-Form, Telefon entfernt.',
    'Buchungen, Audit-Logs etc. bleiben anonymisiert für Statistik und Steuer.',
    'Sarah erhält eine separate E-Mail, dass die AGB-PDF im Drive manuell gelöscht werden soll.',
  ],
  emails: [
    {
      betreff: 'DSGVO: Account gelöscht – PDF bitte manuell löschen',
      an: 'Admin',
      kern: 'Hallo Sarah, folgender Account wurde DSGVO-konform gelöscht: [Name], [E-Mail]. Bitte lösche die AGB-PDF im Google Drive manuell. Suche nach: "[Name]"',
    },
  ],
  klaren: [
    'Genauer Wortlaut des Bestätigungs-Dialogs vor Löschung („Bist du sicher? ..." etc.) ist noch nicht final, bitte einmal festlegen.',
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
      kern: 'Hallo [Vorname], ich habe dich in einen Kurs eingetragen. Kurs: [Name]. 📅 [Wochentag] um [Uhrzeit]. [Dauer] Minuten pro Einheit. ✅ Du nimmst an allen [X] Stunden teil — du hast dafür [X] Credits in deinem Profil. Wichtige Regeln: Abmeldung kostenlos bis 3 Stunden vorher, Nachholen bis 8 Tage nach Kursende, Vorholen max. 10 Tage im Voraus, Rücktritt vom Kurs bis 7 Tage vor Beginn.',
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
    'Wählt der Yogi „Guthaben": Credits bleiben als Guthaben in seinem Profil, 2 Jahre gültig.',
    'Wählt er „Erstattung": Guthaben-Credit wird gelöscht, Sarah muss Geld auszahlen.',
    'Antwortet der Yogi nicht innerhalb 7 Tagen → automatisch Guthaben.',
  ],
  regeln: [
    'Provisorisches Guthaben wird sofort beim Abbrechen sichtbar in der App, mit Hinweis „bei Wahl Erstattung wieder entfernt".',
  ],
  emails: [
    {
      betreff: 'Kurs abgesagt: [Kursname]',
      an: 'Alle Kurs-Teilnehmer',
      kern: 'Hallo [Vorname], leider muss ich den folgenden Kurs absagen. Für die [X] noch nicht stattgefundenen Kurseinheiten hast du die Wahl zwischen einer anteiligen Erstattung oder Kurs-Guthaben (2 Jahre gültig). 💡 Du siehst die [X] Credits ab sofort als Guthaben in deiner App-Übersicht. Bei der Wahl „Anteilige Erstattung" werden sie wieder entfernt. Du hast 7 Tage Zeit. Ohne Rückmeldung wird dir automatisch das Guthaben gutgeschrieben.',
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
  titel: 'Quick-Credit vergeben',
  was: 'Sarah gibt einem Yogi schnell zusätzliche Einzelstunden-Credits (z.B. nach Bar-Zahlung einer Punktekarte).',
  wer: 'Admin',
  ablauf: [
    'Yogi-Detail → Bereich „Credits" → „Credit hinzufügen".',
    'Anzahl und Modell (single / tenpack / guthaben) wählen, Ablaufdatum setzen.',
    'Speichern → Credit ist sofort sichtbar in Yogi-Übersicht.',
  ],
  klaren: [
    'Genaues UI dieser Funktion (Button-Beschriftung, Standardwerte) bitte vor Live-Gang prüfen.',
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
  titel: 'Yogi aus Stunde austragen',
  was: 'Sarah meldet einen Yogi nachträglich von einer Stunde ab (z.B. Yogi kann nicht, hat aber selbst nicht abgesagt).',
  wer: 'Admin',
  ablauf: [
    'Stunde verwalten → bei Yogi „Austragen".',
    'Bestätigungs-Dialog erscheint.',
    'Buchung wird storniert, Credit wird zurückgebucht (auch innerhalb 3-Stunden-Frist — Admin überstimmt die Frist).',
    'Yogi bekommt E-Mail „Abmeldung bestätigt — Credit gutgeschrieben".',
    'Automatischer Auto-Promote der Warteliste, falls Platz frei.',
  ],
  klaren: [
    'Soll der Admin einen Hinweis bekommen, dass der Credit IMMER zurückgebucht wird (auch < 3h), oder ist das selbsterklärend?',
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
