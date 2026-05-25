/* eslint-disable */
/**
 * Generiert "Yoga-mit-Sarah-Datenschutzerklaerung.docx" als fertiges Word-Dokument.
 *
 * Stand: Mai 2026 — komplette Datenschutzerklaerung mit allen App-bezogenen
 * Ergaenzungen (Vercel, Supabase, App-Hosting, Audit-Log, Cookies in der App).
 *
 * Aufruf: node scripts/generate-datenschutz.js
 */

const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  PageOrientation, PageBreak, convertInchesToTwip, LevelFormat,
} = require('docx')

const FONT = 'Arial'

// ────────────── Hilfsfunktionen ──────────────
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, ...(opts.spacing || {}) },
    alignment: opts.alignment,
    children: [new TextRun({
      text, font: FONT,
      size: opts.size || 22,
      bold: opts.bold, italics: opts.italic, color: opts.color,
    })],
  })
}

function pRich(runs, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, ...(opts.spacing || {}) },
    alignment: opts.alignment,
    children: runs.map(r => new TextRun({ font: FONT, size: r.size || 22, ...r })),
  })
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 180 },
    children: [new TextRun({ text, font: FONT, size: 32, bold: true, color: '3d3a39' })],
  })
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 100 },
    children: [new TextRun({ text, font: FONT, size: 22, bold: true, color: '8a6020' })],
  })
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: FONT, size: 22 })],
  })
}

function bulletRich(runs) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 60 },
    children: runs.map(r => new TextRun({ font: FONT, size: r.size || 22, ...r })),
  })
}

function spacer() {
  return new Paragraph({ spacing: { after: 200 }, children: [new TextRun('')] })
}

function divider() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: '─── · ───', font: FONT, size: 22, color: '999999' })],
  })
}

// ────────────── Dokument-Inhalt ──────────────
const doc = new Document({
  creator: 'Yoga mit Sarah',
  title: 'Datenschutzerklaerung Yoga mit Sarah',
  description: 'Datenschutzerklaerung fuer yogamitsarah.me und kurse.yogamitsarah.me',
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
  },
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{
        level: 0,
        format: LevelFormat.BULLET,
        text: '•',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 360, hanging: 240 } } },
      }],
    }],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: {
          top: convertInchesToTwip(0.9),
          right: convertInchesToTwip(0.9),
          bottom: convertInchesToTwip(0.9),
          left: convertInchesToTwip(0.9),
        },
      },
    },
    children: [
      // ─────── TITEL ───────
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: 'Datenschutzerklärung', font: FONT, size: 44, bold: true, color: '3d3a39' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 360 },
        children: [new TextRun({ text: 'Stand: Mai 2026', font: FONT, size: 22, italics: true, color: '666666' })],
      }),

      // ─────── § 1 Verantwortlicher ───────
      h1('1. Verantwortlicher'),
      p('Verantwortlich für die Datenverarbeitung auf dieser Website und in der zugehörigen Buchungs-App ist:'),
      p('Sarah Lerch'),
      p('Fuldaer Str. 7'),
      p('63628 Bad Soden-Salmünster'),
      p('E-Mail: Mail@yogamitsarah.me'),

      // ─────── § 2 Allgemeine Hinweise ───────
      h1('2. Allgemeine Hinweise zur Datenverarbeitung'),
      h2('Umfang der Verarbeitung personenbezogener Daten'),
      p('Wir verarbeiten personenbezogene Daten unserer Nutzer grundsätzlich nur, soweit dies zur Bereitstellung einer funktionsfähigen Website, unserer Buchungs-App und unserer Inhalte und Leistungen erforderlich ist. Die Verarbeitung erfolgt regelmäßig nur nach Einwilligung des Nutzers oder zur Erfüllung eines Vertrages.'),
      h2('Rechtsgrundlage für die Verarbeitung personenbezogener Daten'),
      p('Soweit wir eine Einwilligung der betroffenen Person einholen, dient Art. 6 Abs. 1 lit. a DSGVO als Rechtsgrundlage. Bei der Verarbeitung von Daten zur Vertragserfüllung dient Art. 6 Abs. 1 lit. b DSGVO. Ist die Verarbeitung zur Wahrung berechtigter Interessen erforderlich, dient Art. 6 Abs. 1 lit. f DSGVO als Rechtsgrundlage.'),
      h2('Datenlöschung und Speicherdauer'),
      p('Die personenbezogenen Daten werden gelöscht oder gesperrt, sobald der Zweck der Speicherung entfällt. Eine darüber hinausgehende Speicherung kann erfolgen, wenn dies gesetzlich vorgesehen ist. Konkrete Aufbewahrungsfristen finden Sie in den jeweiligen Abschnitten.'),

      // ─────── § 3 Website-Hosting ───────
      h1('3. Website-Hosting (WordPress-Seite yogamitsarah.me)'),
      h2('Anbieter'),
      p('Unsere Hauptwebsite yogamitsarah.me wird gehostet bei:'),
      p('united-domains AG'),
      p('Gautinger Str. 10'),
      p('82319 Starnberg'),
      p('Deutschland'),
      p('Telefon: +49 (0)8151-36867-0'),
      p('E-Mail: info@united-domains.de'),
      h2('Art und Umfang der Datenverarbeitung'),
      p('Server-Logfiles erfassen automatisiert:'),
      bullet('IP-Adresse des zugreifenden Rechners'),
      bullet('Datum und Uhrzeit der Serveranfrage'),
      bullet('Name und URL der abgerufenen Datei'),
      bullet('Referrer-URL'),
      bullet('Verwendeter Browser und Betriebssystem sowie Access-Provider'),
      h2('Zweck der Datenverarbeitung'),
      p('Ordnungsgemäße Auslieferung, Stabilität und Sicherheit, Optimierung des Angebots, Informierung der Strafverfolgungsbehörden bei Cyberangriffen.'),
      h2('Rechtsgrundlage'),
      p('Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse).'),
      h2('Speicherdauer'),
      p('Logfiles werden nach spätestens 30 Tagen automatisch gelöscht.'),
      h2('Auftragsverarbeitung'),
      p('Mit united-domains AG besteht ein Vertrag zur Auftragsverarbeitung (AVV) gemäß Art. 28 DSGVO (Vertragsdatum: 26.09.2025). Die Datenverarbeitung erfolgt ausschließlich in der Europäischen Union. Datenschutzbeauftragter: Daniel Dingeldey (datenschutz@united-domains.de).'),

      // ─────── § 4 Logfiles ───────
      h1('4. Bereitstellung der Website und Erstellung von Logfiles'),
      p('Bei jedem Aufruf unserer Internetseite erfasst unser System automatisiert folgende Daten:'),
      bullet('Informationen über den Browsertyp und die verwendete Version'),
      bullet('Das Betriebssystem des Nutzers'),
      bullet('Den Internet-Service-Provider des Nutzers'),
      bullet('Die IP-Adresse des Nutzers'),
      bullet('Datum und Uhrzeit des Zugriffs'),
      bullet('Websites, von denen das System des Nutzers auf unsere Internetseite gelangt'),
      bullet('Websites, die vom System des Nutzers über unsere Website aufgerufen werden'),
      h2('Rechtsgrundlage'),
      p('Art. 6 Abs. 1 lit. f DSGVO.'),
      h2('Zweck'),
      p('Auslieferung der Website, Sicherstellung der Funktionsfähigkeit, Optimierung, Sicherheit der informationstechnischen Systeme.'),
      h2('Speicherdauer'),
      p('Sitzungsbezogene Daten werden mit Sitzungsende gelöscht. Logfiles werden nach spätestens sieben Tagen gelöscht.'),

      // ─────── § 5 Cookies ───────
      h1('5. Verwendung von Cookies'),
      h2('WordPress-Hauptseite yogamitsarah.me'),
      p('Auf der WordPress-Seite verwenden wir Cookies. Detaillierte Informationen — inklusive Consent-Management (Complianz) und Liste aller eingesetzten Anbieter (WordPress, Facebook, WhatsApp, Google Fonts, Google Maps, YouTube, OptinMonster) — finden Sie in unserer separaten Cookie-Richtlinie unter:'),
      p('https://yogamitsarah.me/cookie-richtlinie-eu/'),
      h2('Buchungs-App kurse.yogamitsarah.me'),
      p('Die Buchungs-App verwendet ausschließlich technisch notwendige Cookies und lokalen Speicher. Es werden keine Tracking- oder Marketing-Cookies eingesetzt, daher ist kein Consent-Banner erforderlich.'),
      bulletRich([{ text: 'Supabase-Auth-Cookie ', bold: true }, { text: '(essenziell): hält Sie nach dem Login eingeloggt. Lebensdauer maximal 7 Tage. Wird beim Logout gelöscht.' }]),
      bulletRich([{ text: 'localStorage — Onboarding-Status: ', bold: true }, { text: 'speichert, dass Sie die einmalige Einführungs-Tour gesehen haben.' }]),
      bulletRich([{ text: 'localStorage — ausgeblendete Hinweise: ', bold: true }, { text: 'speichert, welche In-App-Hinweise (z. B. „Credits laufen bald ab") Sie weggeklickt haben.' }]),
      bulletRich([{ text: 'Service-Worker-Cache (PWA): ', bold: true }, { text: 'speichert Teile der App offline auf Ihrem Gerät, damit die App auch bei schlechter Verbindung schnell lädt.' }]),
      p('Diese Daten verbleiben ausschließlich in Ihrem Browser. Sie können sie jederzeit über die Browser-Einstellungen löschen.'),
      h2('Rechtsgrundlage'),
      p('Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einer funktionsfähigen App) bzw. § 25 Abs. 2 Nr. 2 TTDSG (technisch notwendig).'),

      // ─────── § 6 YouTube ───────
      h1('6. YouTube-Videos'),
      h2('Art und Umfang der Datenverarbeitung'),
      p('Auf unserer Website sind YouTube-Videos eingebettet. Betreiber von YouTube ist die Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland.'),
      p('Wenn Sie eine unserer Webseiten besuchen, auf denen YouTube eingebunden ist, wird eine Verbindung zu den Servern von YouTube hergestellt. Dabei wird dem YouTube-Server mitgeteilt, welche unserer Seiten Sie besucht haben.'),
      p('Des Weiteren kann YouTube verschiedene Cookies auf Ihrem Endgerät speichern oder vergleichbare Wiedererkennungstechnologien verwenden. Auf diese Weise kann YouTube Informationen über Besucher dieser Website erhalten. Diese Informationen werden u.a. verwendet, um Videostatistiken zu erfassen, die Anwenderfreundlichkeit zu verbessern und Betrugsversuchen vorzubeugen.'),
      p('Wenn Sie in Ihrem YouTube-Account eingeloggt sind, ermöglichen Sie YouTube, Ihr Surfverhalten direkt Ihrem persönlichen Profil zuzuordnen. Dies können Sie verhindern, indem Sie sich aus Ihrem YouTube-Account ausloggen.'),
      h2('Rechtsgrundlage'),
      p('Art. 6 Abs. 1 lit. a DSGVO (Einwilligung). Sie können Ihre Einwilligung jederzeit widerrufen.'),
      h2('Zweck und berechtigte Interessen'),
      p('Ansprechende Darstellung unserer Online-Angebote und Bereitstellung informativer Inhalte.'),
      h2('Speicherdauer'),
      p('YouTube speichert Daten solange, wie es für den jeweiligen Zweck erforderlich ist. Nähere Informationen: https://policies.google.com/privacy'),

      // ─────── § 7 Google Fonts ───────
      h1('7. Google Fonts'),
      h2('Art und Umfang der Datenverarbeitung'),
      p('Diese Website nutzt zur einheitlichen Darstellung von Schriftarten sogenannte Web Fonts, die von Google bereitgestellt werden. Beim Aufruf einer Seite lädt Ihr Browser die benötigten Web Fonts in den Browsercache, um Texte und Schriftarten korrekt anzuzeigen.'),
      p('Zu diesem Zweck muss der von Ihnen verwendete Browser Verbindung zu den Servern von Google aufnehmen. Hierdurch erlangt Google Kenntnis darüber, dass über Ihre IP-Adresse diese Website aufgerufen wurde.'),
      h2('Rechtsgrundlage'),
      p('Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einer einheitlichen und ansprechenden Darstellung unserer Website).'),
      h2('Anbieter'),
      p('Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland.'),
      h2('Weitere Informationen'),
      p('https://fonts.google.com/about und https://policies.google.com/privacy'),

      // ─────── § 8 SSL ───────
      h1('8. SSL-Verschlüsselung'),
      p('Diese Website nutzt zur Sicherung der Übertragung vertraulicher Inhalte eine SSL-Verschlüsselung. Eine verschlüsselte Verbindung erkennen Sie daran, dass die Adresszeile des Browsers von „http://" auf „https://" wechselt und an dem Schloss-Symbol in Ihrer Browserzeile.'),
      p('Wenn die SSL-Verschlüsselung aktiviert ist, können die Daten, die Sie an uns übermitteln, nicht von Dritten mitgelesen werden.'),

      // ─────── § 9 Kursanmeldung ───────
      h1('9. Kursanmeldung und Vertragsabwicklung'),
      h2('Art und Umfang der Datenverarbeitung'),
      p('Für die Anmeldung zu unseren Yogakursen erheben wir folgende personenbezogene Daten:'),
      bullet('Vor- und Nachname'),
      bullet('E-Mail-Adresse'),
      bullet('Telefonnummer'),
      bullet('Geburtsdatum'),
      bullet('Name und Telefonnummer einer Notfallkontaktperson (für medizinische Notfälle während der Kursstunden)'),
      bullet('Unterschrift (bei Papier-Anmeldebögen)'),
      h2('Zweck der Datenverarbeitung'),
      bullet('Durchführung der Vertragsabwicklung (Kursanmeldung, Teilnahmebestätigung)'),
      bullet('Kommunikation bezüglich der Kurse (Bestätigungen, Erinnerungen, Absagen)'),
      bullet('Notfallkontakt während der Kursstunden'),
      bullet('Erfüllung rechtlicher Verpflichtungen (Haftung, Versicherung)'),
      bullet('Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen'),
      h2('Rechtsgrundlage'),
      p('Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung) sowie Art. 6 Abs. 1 lit. f DSGVO (berechtigte Interessen, insbesondere Notfallkontakt).'),
      h2('Speicherdauer'),
      bullet('Papier-Anmeldebögen: 10 Jahre nach Ende der Kursteilnahme (wegen möglicher Haftungsansprüche)'),
      bullet('Digitale Kontaktdaten und Profilangaben: 3 Jahre nach der letzten Kursteilnahme bzw. nach Account-Löschung in der App (siehe § 9a)'),
      bullet('E-Mail-Kommunikation: bis 3 Jahre nach Ende der Geschäftsbeziehung'),

      // ─────── § 9a App ───────
      h1('9a. Yoga-App: Nutzerkonto und Online-Buchungssystem'),
      h2('Was die App ist'),
      p('Unter kurse.yogamitsarah.me betreiben wir eine Buchungs-App (Progressive Web App, PWA), über die Yogis ihre Kursteilnahmen, Einzelstunden und Credits selbst verwalten können.'),
      h2('Art und Umfang der Datenverarbeitung'),
      p('Im Nutzerkonto verarbeiten wir folgende Daten:'),
      bulletRich([{ text: 'Stammdaten: ', bold: true }, { text: 'Vorname, Nachname, E-Mail-Adresse, Telefonnummer, Geburtsdatum' }]),
      bulletRich([{ text: 'Notfallkontakt: ', bold: true }, { text: 'Name und Telefonnummer einer Vertrauensperson (freiwillig)' }]),
      bulletRich([{ text: 'Login-Daten: ', bold: true }, { text: 'E-Mail-Adresse und gehashtes Passwort (verwaltet durch Supabase Auth, siehe § 9c)' }]),
      bulletRich([{ text: 'Zustimmung zu AGB: ', bold: true }, { text: 'Versionsnummer und Zeitstempel der Akzeptanz' }]),
      bulletRich([{ text: 'Status: ', bold: true }, { text: 'Tag der ersten Anmeldung, ob die Einführungs-Tour abgeschlossen wurde' }]),
      bulletRich([{ text: 'Einstellungen für Erinnerungen: ', bold: true }, { text: 'gewünschte Zeit für Reminder-E-Mails vor Stunden' }]),
      bulletRich([{ text: 'Buchungs- und Vertragsdaten: ', bold: true }, { text: 'gebuchte Stunden, Stornierungen, Wartelisten-Einträge, gekaufte und verbrauchte Credits (Punktekarten, Quartals-Abos, Kurs-Credits), Gültigkeitszeiträume' }]),
      bulletRich([{ text: 'Hinweis-Status: ', bold: true }, { text: 'welche In-App-Hinweise (z. B. „Credits laufen bald ab") bereits weggeklickt wurden' }]),
      h2('Zweck der Datenverarbeitung'),
      bullet('Bereitstellung und Verwaltung Ihres Nutzerkontos'),
      bullet('Durchführung der Vertragsabwicklung (Buchung, Stornierung, Warteliste, Credits)'),
      bullet('Versand notwendiger Transaktions-E-Mails (siehe § 11)'),
      bullet('Kommunikation zu Kursabsagen, Ersatzterminen, Warteliste-Aufrückungen'),
      bullet('Erfüllung rechtlicher Pflichten (Haftung, Nachweisbarkeit von Vertragsänderungen)'),
      h2('Rechtsgrundlage'),
      p('Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung) sowie Art. 6 Abs. 1 lit. a DSGVO (Einwilligung, z. B. für optionale Erinnerungen). Für die rechtssichere Dokumentation der AGB-Zustimmung: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an Nachweisbarkeit).'),
      h2('Account-Löschung und Recht auf Vergessenwerden (Art. 17 DSGVO)'),
      p('Sie können Ihren Account jederzeit selbst in der App löschen unter: Profil → „Account löschen". Bei der Löschung passiert automatisch:'),
      bullet('Alle zukünftigen Buchungen werden storniert'),
      bullet('Wartelisten-Einträge werden entfernt'),
      bullet('Freiwerdende Plätze werden automatisch der Warteliste angeboten'),
      bullet('Ihre Profildaten werden gelöscht'),
      bullet('Der App-interne Protokollverlauf wird anonymisiert (siehe § 9d)'),
      bullet('Sie werden ausgeloggt und können sich nicht mehr anmelden'),
      p('Alternativ können Sie die Löschung jederzeit formlos per E-Mail an Mail@yogamitsarah.me verlangen.'),
      h2('Speicherdauer'),
      bullet('Aktive Nutzerkonten: solange das Konto besteht'),
      bullet('Nach Account-Löschung: Stammdaten und Buchungshistorie werden gelöscht, anonymisierte Protokoll-Einträge bleiben bis zu 24 Monate erhalten (zur Wahrung berechtigter Interessen an System-Nachvollziehbarkeit)'),
      bullet('Steuerlich relevante Buchungsdaten: 10 Jahre gemäß § 147 AO (in anonymisierter Form, falls Account gelöscht)'),

      // ─────── § 9b Vercel ───────
      h1('9b. App-Hosting (Vercel)'),
      h2('Anbieter'),
      p('Die Buchungs-App wird gehostet bei:'),
      p('Vercel Inc.'),
      p('440 N Barranca Avenue #4133'),
      p('Covina, CA 91723'),
      p('USA'),
      h2('Speicherort und Datenverarbeitung'),
      p('Wir betreiben die App ausschließlich auf EU-Servern (Frankfurt / Paris). Die Verarbeitung Ihrer Daten im Rahmen des Webhostings findet damit innerhalb der Europäischen Union statt.'),
      p('Da Vercel Inc. seinen Hauptsitz in den USA hat, kann es im Rahmen von Wartung, Support oder Diagnose zu einem Zugriff aus den USA kommen. Vercel ist nach dem EU-U.S. Data Privacy Framework zertifiziert und hat sich den EU-Standardvertragsklauseln (SCCs) unterworfen.'),
      h2('Erhobene Daten'),
      p('IP-Adresse, Datum/Uhrzeit, abgerufene URL, Browsertyp, Betriebssystem (Server-Logs).'),
      h2('Rechtsgrundlage'),
      p('Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einer schnellen, sicheren App-Auslieferung).'),
      h2('Auftragsverarbeitung'),
      p('Mit Vercel besteht ein AVV nach Art. 28 DSGVO (pre-signed, gilt durch Nutzung des Vercel-Dienstes als angenommen). Weitere Informationen: https://vercel.com/legal/privacy-policy'),
      h2('Speicherdauer'),
      p('Server-Logs werden nach spätestens 30 Tagen gelöscht.'),

      // ─────── § 9c Supabase ───────
      h1('9c. Datenbank und Authentifizierung (Supabase)'),
      h2('Anbieter'),
      p('Alle App-Daten (Stammdaten, Buchungen, Credits, Authentifizierung) werden gespeichert und verwaltet durch:'),
      p('Supabase Inc.'),
      p('970 Toa Payoh North #07-04'),
      p('Singapore 318992'),
      h2('Speicherort'),
      p('Die Datenbank wird in der EU-Region eu-central-1 (Frankfurt am Main) betrieben. Ihre Daten werden physisch innerhalb der EU gespeichert.'),
      p('Da Supabase Inc. außerhalb der EU sitzt, kann es im Rahmen von Wartung und Support technisch zu einem Zugriff aus dem Ausland kommen. Supabase hat sich den EU-Standardvertragsklauseln (SCCs) unterworfen.'),
      h2('Art der Verarbeitung'),
      bulletRich([{ text: 'Authentifizierung: ', bold: true }, { text: 'Verwaltung Ihres Logins (E-Mail + gehashtes Passwort), Magic-Link- und Passwort-Reset-Mails, Session-Tokens.' }]),
      bulletRich([{ text: 'Datenbank: ', bold: true }, { text: 'Speicherung aller in § 9a aufgeführten Daten in einer PostgreSQL-Datenbank mit Row-Level-Security (jeder Nutzer sieht nur seine eigenen Daten; Admin-Zugriff nur für Sarah Lerch).' }]),
      bulletRich([{ text: 'Datei-Speicher: ', bold: true }, { text: 'Bilder zu Kursen und Charity-Stunden (öffentlich abrufbar).' }]),
      h2('Rechtsgrundlage'),
      p('Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung).'),
      h2('Auftragsverarbeitung'),
      p('Mit Supabase besteht ein AVV nach Art. 28 DSGVO. Weitere Informationen: https://supabase.com/privacy'),

      // ─────── § 9d Audit-Log ───────
      h1('9d. Protokollierung in der App (Audit-Log)'),
      p('Zur Nachvollziehbarkeit und Sicherheit führen wir innerhalb der App ein internes Protokoll (Audit-Log) über bestimmte Vorgänge:'),
      bullet('Buchungen und Stornierungen (wann, durch wen, für welche Stunde)'),
      bullet('Anlage und Verbrauch von Credits'),
      bullet('Admin-Aktionen (z. B. Yogi in Stunde einbuchen, Kurs absagen, Account löschen)'),
      bullet('Erfolgte E-Mail-Versendungen (zur Vermeidung von Doppel-Versand)'),
      h2('Zweck'),
      p('Nachvollziehbarkeit von Buchungsänderungen, Konflikt-Lösung, Bug-Analyse, Erkennen von Missbrauch.'),
      h2('Rechtsgrundlage'),
      p('Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an System-Integrität).'),
      h2('Anonymisierung bei Account-Löschung'),
      p('Wenn Sie Ihren Account löschen, wird Ihre Nutzer-ID in allen Protokoll-Einträgen anonymisiert. Die Einträge bleiben dann ausschließlich in nicht-personenbeziehbarer Form bis zu 24 Monate bestehen.'),
      h2('Speicherdauer'),
      p('Maximal 24 Monate.'),

      // ─────── § 10 WhatsApp ───────
      h1('10. WhatsApp-Kommunikation'),
      h2('Art und Umfang der Datenverarbeitung'),
      p('Wir nutzen WhatsApp für die Kommunikation mit unseren Kursteilnehmern in folgenden Bereichen:'),
      bullet('Direkte Kommunikation: Kursorganisation, Terminabsprachen, individuelle Anfragen'),
      bullet('Kursgruppen: Informationsaustausch innerhalb spezifischer Yogakurse'),
      bullet('Yoga-Community: Allgemeine Informationen und Austausch (freiwillige Teilnahme)'),
      p('Bei der Nutzung von WhatsApp werden folgende Daten verarbeitet:'),
      bullet('Telefonnummer'),
      bullet('Profilbild und Name (soweit von Ihnen hinterlegt)'),
      bullet('Nachrichteninhalte'),
      bullet('Zeitpunkt der Nachrichten'),
      bullet('Metadaten (Zustellstatus, etc.)'),
      h2('Rechtsgrundlage'),
      p('Art. 6 Abs. 1 lit. a DSGVO (Einwilligung) sowie Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung).'),
      h2('Datenübertragung in Drittländer'),
      p('WhatsApp wird von Meta Platforms Ireland Ltd. betrieben. Da WhatsApp zu Meta (ehemals Facebook) gehört, können Ihre Daten in die USA übertragen werden. Meta hat sich den neuen Standard-Datenschutzklauseln der EU-Kommission unterworfen.'),
      h2('Freiwilligkeit und Alternativen'),
      p('Die Nutzung von WhatsApp ist freiwillig. Sie können auch ohne WhatsApp an unseren Kursen teilnehmen. Alternative Kontaktmöglichkeiten sind E-Mail und Telefon.'),
      h2('Speicherdauer und Löschung'),
      p('WhatsApp-Chats werden gespeichert, solange Sie aktiver Kursteilnehmer sind, plus ein Jahr nach Ende der letzten Kursteilnahme. Sie können jederzeit aus WhatsApp-Gruppen austreten oder die Löschung Ihrer Daten verlangen.'),
      h2('Widerruf'),
      p('Sie können Ihre Einwilligung zur WhatsApp-Nutzung jederzeit widerrufen, indem Sie uns unter Mail@yogamitsarah.me kontaktieren.'),

      // ─────── § 11 Email & Newsletter ───────
      h1('11. E-Mail-Kommunikation und Newsletter'),
      h2('11.1 Transaktions-E-Mails über Brevo'),
      p('Für alle automatischen E-Mails rund um Ihre Kursbuchungen nutzen wir den Dienst Brevo:'),
      bullet('Anmeldebestätigungen (Account-Registrierung)'),
      bullet('Buchungsbestätigungen und Stornierungs-Bestätigungen'),
      bullet('Erinnerungen vor Stunden (siehe § 11.2)'),
      bullet('Wartelisten-Benachrichtigungen (Aufrücken, freier Platz, Last-Minute-Angebote)'),
      bullet('Kursabsage- und Ersatztermin-Mitteilungen'),
      bullet('Passwort-Reset-Anfragen'),
      bullet('Einladungslinks zu Kursen'),
      pRich([{ text: 'Verarbeitete Daten: ', bold: true }, { text: 'Vorname, Nachname, E-Mail-Adresse, individuelle Inhalte (z. B. Kursname, Termin, Stundenanzahl).' }]),
      pRich([{ text: 'Rechtsgrundlage: ', bold: true }, { text: 'Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung).' }]),
      pRich([{ text: 'Anbieter: ', bold: true }, { text: 'Brevo GmbH, Köpenicker Straße 126, 10179 Berlin (Tochter von Sendinblue SAS, 55 rue d\'Amsterdam, 75008 Paris, Frankreich).' }]),
      pRich([{ text: 'Speicherort: ', bold: true }, { text: 'Server in der Europäischen Union.' }]),
      pRich([{ text: 'Auftragsverarbeitung: ', bold: true }, { text: 'Mit Brevo besteht ein AVV gemäß Art. 28 DSGVO.' }]),

      h2('11.2 Automatisierte Stunden-Erinnerungen'),
      p('Die App kann Ihnen vor jeder gebuchten Stunde eine Erinnerungs-E-Mail senden. Sie können selbst in Ihrem Profil festlegen, ob und wie viele Stunden vorher Sie erinnert werden möchten — oder die Erinnerungen komplett deaktivieren.'),
      p('Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung über Profil-Einstellung). Widerruf jederzeit über das Profil oder per E-Mail.'),

      h2('11.3 Newsletter'),
      p('Für den Versand unseres Newsletters nutzen wir ebenfalls den Dienst Brevo. Bei der Anmeldung zum Newsletter erheben wir:'),
      bullet('Vorname'),
      bullet('Nachname'),
      bullet('E-Mail-Adresse'),
      p('Diese Daten werden an Brevo übermittelt und dort gespeichert.'),
      pRich([{ text: 'Rechtsgrundlage: ', bold: true }, { text: 'Der Newsletter-Versand erfolgt nur mit Ihrer ausdrücklichen Einwilligung (Art. 6 Abs. 1 lit. a DSGVO).' }]),
      h2('Double-Opt-in-Verfahren'),
      p('Die Anmeldung zum Newsletter erfolgt über ein Double-Opt-in-Verfahren:'),
      bullet('Sie tragen Ihre Daten in das Newsletter-Formular ein'),
      bullet('Sie erhalten eine Bestätigungs-E-Mail mit einem Link'),
      bullet('Erst nach Klick auf diesen Link wird Ihre Anmeldung aktiviert'),
      p('Dies stellt sicher, dass nur Sie selbst sich für den Newsletter anmelden können.'),
      h2('Zweck der Datenverarbeitung'),
      p('Der Newsletter informiert Sie über:'),
      bullet('Neue Kursangebote'),
      bullet('Workshops und Events'),
      bullet('Gesundheitstipps rund um Yoga'),
      bullet('Besondere Aktionen'),
      h2('Analyse und Tracking'),
      p('Brevo ermöglicht die Analyse des Newsletter-Nutzungsverhaltens. Dabei können folgende Daten erfasst werden:'),
      bullet('Öffnungsrate der E-Mails'),
      bullet('Klicks auf Links im Newsletter'),
      bullet('Zeitpunkt des Öffnens'),
      bullet('Verwendetes Endgerät'),
      p('Diese Daten dienen der Optimierung unseres Newsletter-Angebots.'),
      h2('Widerruf und Abmeldung'),
      p('Sie können Ihre Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen:'),
      bullet('Über den Abmelde-Link in jeder Newsletter-E-Mail'),
      bullet('Per E-Mail an: Mail@yogamitsarah.me'),
      bullet('Schriftlich an: Sarah Lerch, Fuldaer Str. 7, 63628 Bad Soden-Salmünster'),
      p('Nach der Abmeldung werden Ihre Daten bei Brevo gelöscht, es sei denn, es bestehen gesetzliche Aufbewahrungspflichten.'),
      h2('Weitere Informationen'),
      p('https://www.brevo.com/de/legal/privacypolicy/'),

      // ─────── § 12 Kontaktaufnahme ───────
      h1('12. Kontaktaufnahme über Website'),
      p('Wenn Sie per E-Mail oder WhatsApp-Link Kontakt mit uns aufnehmen, werden Ihre Angaben aus der Anfrage inklusive der von Ihnen dort angegebenen Kontaktdaten zwecks Bearbeitung der Anfrage und für den Fall von Anschlussfragen bei uns gespeichert. Diese Daten geben wir nicht ohne Ihre Einwilligung weiter.'),
      p('Die Verarbeitung dieser Daten erfolgt auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO, sofern Ihre Anfrage mit der Erfüllung eines Vertrags zusammenhängt oder zur Durchführung vorvertraglicher Maßnahmen erforderlich ist. In allen übrigen Fällen beruht die Verarbeitung auf unserem berechtigten Interesse an der effektiven Bearbeitung der an uns gerichteten Anfragen (Art. 6 Abs. 1 lit. f DSGVO) oder auf Ihrer Einwilligung (Art. 6 Abs. 1 lit. a DSGVO).'),
      p('Die von Ihnen an uns per Kontaktanfragen übersandten Daten verbleiben bei uns, bis Sie uns zur Löschung auffordern, Ihre Einwilligung zur Speicherung widerrufen oder der Zweck für die Datenspeicherung entfällt. Zwingende gesetzliche Bestimmungen — insbesondere gesetzliche Aufbewahrungsfristen — bleiben unberührt.'),

      // ─────── § 13 Rechte ───────
      h1('13. Ihre Rechte als Betroffener'),
      h2('Auskunftsrecht'),
      p('Sie haben das Recht, von uns eine Bestätigung darüber zu verlangen, ob Sie betreffende personenbezogene Daten verarbeitet werden. Liegt eine solche Verarbeitung vor, haben Sie ein Recht auf Auskunft über diese personenbezogenen Daten und auf die in Art. 15 DSGVO im einzelnen aufgeführten Informationen.'),
      pRich([{ text: 'Selbstbedienung in der App: ', bold: true }, { text: 'Über Ihr Nutzerkonto in der Buchungs-App können Sie jederzeit alle zu Ihrer Person gespeicherten Stammdaten und Ihre Buchungshistorie einsehen. Für eine vollständige Auskunft nach Art. 15 DSGVO genügt eine formlose E-Mail an Mail@yogamitsarah.me.' }]),
      h2('Recht auf Berichtigung und Löschung'),
      p('Sie haben ein Recht auf Berichtigung unrichtiger oder auf Vervollständigung richtiger Daten nach Art. 16 DSGVO. Sie haben auch ein Recht auf Löschung Ihrer bei uns gespeicherten personenbezogenen Daten nach Art. 17 DSGVO, es sei denn, die Verarbeitung ist zur Ausübung des Rechts auf freie Meinungsäußerung und Information, zur Erfüllung einer rechtlichen Verpflichtung, aus Gründen des öffentlichen Interesses oder zur Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen erforderlich.'),
      pRich([{ text: 'Selbstbedienung in der App: ', bold: true }, { text: 'Sie können Ihren App-Account jederzeit selbst löschen unter Profil → „Account löschen". Details siehe § 9a. Alternativ per E-Mail an Mail@yogamitsarah.me. Vor- und Nachname, Telefonnummer, Geburtsdatum, Notfallkontakt sowie Erinnerungs-Einstellungen können Sie jederzeit selbst in der App unter Profil → Bearbeiten ändern.' }]),
      h2('Recht auf Einschränkung'),
      p('Unter den Voraussetzungen des Art. 18 DSGVO haben Sie das Recht, die Einschränkung der Verarbeitung Ihrer personenbezogenen Daten zu verlangen.'),
      h2('Recht auf Datenübertragbarkeit'),
      p('Unter den Voraussetzungen des Art. 20 DSGVO haben Sie das Recht, die Sie betreffenden personenbezogenen Daten in einem strukturierten, gängigen und maschinenlesbaren Format zu erhalten oder die Übermittlung an einen anderen Verantwortlichen zu verlangen. Auf Anfrage erhalten Sie Ihre App-Daten in einem maschinenlesbaren Format (z. B. JSON).'),
      h2('Widerspruchsrecht'),
      p('Sie haben nach Art. 21 DSGVO das Recht, aus Gründen, die sich aus Ihrer besonderen Situation ergeben, jederzeit gegen die Verarbeitung Sie betreffender personenbezogener Daten, die aufgrund von Art. 6 Abs. 1 lit. f DSGVO erfolgt, Widerspruch einzulegen.'),
      h2('Widerruf erteilter Einwilligungen'),
      p('Sie haben das Recht, erteilte Einwilligungen nach Art. 7 Abs. 3 DSGVO mit Wirkung für die Zukunft zu widerrufen.'),
      h2('Beschwerderecht'),
      p('Sie haben das Recht, sich bei einer Aufsichtsbehörde zu beschweren. In der Regel können Sie sich hierfür an die Aufsichtsbehörde insbesondere in dem Mitgliedstaat ihres Aufenthaltsorts, ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes wenden.'),
      p('Für Hessen ist die zuständige Aufsichtsbehörde:'),
      p('Der Hessische Beauftragte für Datenschutz und Informationsfreiheit'),
      p('Postfach 3163'),
      p('65021 Wiesbaden'),
      p('Telefon: +49 611 1408-0'),
      p('E-Mail: poststelle@datenschutz.hessen.de'),

      // ─────── § 14 Änderungen ───────
      h1('14. Änderungen der Datenschutzerklärung'),
      p('Wir behalten uns vor, diese Datenschutzerklärung anzupassen, damit sie stets den aktuellen rechtlichen Anforderungen entspricht oder um Änderungen unserer Leistungen umzusetzen. Bei wesentlichen Änderungen werden registrierte Nutzer in der App über einen Hinweis informiert und um erneute Bestätigung gebeten. Für Ihren erneuten Besuch gilt dann die neue Datenschutzerklärung.'),

      divider(),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240 },
        children: [new TextRun({ text: 'Stand: Mai 2026', font: FONT, size: 22, italics: true, color: '666666' })],
      }),
    ],
  }],
})

// ────────────── Datei schreiben ──────────────
const OUT = path.join(__dirname, '..', 'Yoga-mit-Sarah-Datenschutzerklaerung.docx')
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf)
  const kb = (buf.length / 1024).toFixed(1)
  console.log(`✅ Datenschutzerklaerung generiert: ${OUT}`)
  console.log(`   Groesse: ${kb} KB`)
})
