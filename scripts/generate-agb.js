/* eslint-disable */
/**
 * Generiert "Yoga-mit-Sarah-AGB.docx" — Allgemeine Geschaeftsbedingungen.
 *
 * Stand: Mai 2026 — neue Stornofrist (14 Tage), App-Pflicht-Klausel,
 * Kursabbruch-Wahloption, Wartelisten-Regelung, Vorholfrist, Account-Loeschung.
 *
 * Aufruf: node scripts/generate-agb.js
 */

const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  convertInchesToTwip, LevelFormat,
} = require('docx')

const FONT = 'Arial'

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
    children: [new TextRun({ text, font: FONT, size: 24, bold: true, color: '8a6020' })],
  })
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: FONT, size: 22 })],
  })
}

function divider() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: '─── · ───', font: FONT, size: 22, color: '999999' })],
  })
}

// ────────────── Dokument ──────────────
const doc = new Document({
  creator: 'Yoga mit Sarah',
  title: 'Allgemeine Geschaeftsbedingungen Yoga mit Sarah',
  description: 'AGB fuer Kurse, Veranstaltungen, Personal Yoga und Firmenyoga',
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
        size: { width: 11906, height: 16838 },
        margin: {
          top: convertInchesToTwip(0.9),
          right: convertInchesToTwip(0.9),
          bottom: convertInchesToTwip(0.9),
          left: convertInchesToTwip(0.9),
        },
      },
    },
    children: [
      // TITEL
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: 'Allgemeine Geschäftsbedingungen', font: FONT, size: 40, bold: true, color: '3d3a39' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: 'und Haftungsausschluss', font: FONT, size: 28, bold: true, color: '3d3a39' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 360 },
        children: [new TextRun({ text: 'Stand: Mai 2026', font: FONT, size: 22, italics: true, color: '666666' })],
      }),

      // Praeambel
      p('Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für sämtliche Verträge zwischen Sarah Lerch (Yoga mit Sarah) und ihren Kunden ab dem 01. Dezember 2025. Gegenstand dieser Bedingungen sind alle Angebote und Dienstleistungen von Yoga mit Sarah, unabhängig von Ort, Zeit und Dauer der Durchführung, sofern sich nicht aus den jeweiligen Verträgen etwas anderes ergibt. Diese AGB werden mit deiner Anmeldung/Buchung und Teilnahme an meinen Angeboten akzeptiert und automatisch Bestandteil aller Verträge.'),

      // § 1
      h1('1. Gruppenangebote: Kurse und Veranstaltungen'),

      // § 1.0 NEU
      h2('1.0 Yoga-App: Voraussetzung für Kursteilnahme'),
      p('Die Verwaltung aller laufenden Yogakurse erfolgt ausschließlich über meine Buchungs-App unter kurse.yogamitsarah.me. Mit der Anmeldung zu einem Kurs verpflichtest du dich, einen kostenlosen Nutzer-Account in der App anzulegen und zu nutzen. Über die App siehst du deine Stunden, meldest dich ab, verwaltest deine Credits, siehst Ersatztermine und kannst dich auf Wartelisten setzen.'),
      p('Alle Stunden-Buchungen, Abmeldungen, Nachhol-Buchungen, Wartelisten-Einträge und Krankheits-Austragungen werden ausschließlich über die App geregelt. E-Mail- oder WhatsApp-Abmeldungen werden — außer in technischen Notfällen — nicht mehr akzeptiert.'),
      pRich([
        { text: 'Account-Löschung: ', bold: true },
        { text: 'Du kannst deinen App-Account jederzeit selbstständig unter Profil → „Account löschen“ löschen. Mit der Löschung verfallen alle offenen Buchungen, Wartelisten-Einträge, Credits und Guthaben ersatzlos. Eine Rückerstattung von verbleibenden Credits oder Guthaben erfolgt nicht. Vor dem endgültigen Entfernen deines Auth-Zugangs erhältst du gemäß Art. 12 DSGVO eine Bestätigungs-E-Mail an deine bisherige Adresse, in der die Löschung der Daten, die Stornierung aller offenen Buchungen sowie die Entfernung deiner E-Mail-Adresse zusammengefasst sind. Diese E-Mail ist die letzte Nachricht, die du von der App erhältst.' },
      ]),
      p('Diese Regelung gilt nicht für Personal-Yoga-Einheiten (§ 2), Veranstaltungen außerhalb der Kursreihen (§ 1.2 „Veranstaltungen") und Firmenyoga (§ 3) — dort gilt die jeweilige individuelle Vereinbarung.'),

      // § 1.1
      h2('1.1 Anmeldung und Bezahlung'),
      p('Die Anmeldung zu Kursen und Veranstaltungen erfolgt schriftlich per WhatsApp oder E-Mail und ist verbindlich. Yogakurse haben eine feste Anzahl an Einheiten und sind nur als kompletter Kurs buchbar. Die Gebühren ergeben sich aus den jeweils bestehenden Angeboten. Kurse sind nicht übertragbar. Plätze in Kursen oder Veranstaltungen sind begrenzt und dein Platz wird mit deiner Anmeldung für dich reserviert, beachte daher bitte die Stornobedingungen unter 1.2. Die Gebühr ist spätestens 7 Tage vor Kurs- oder Veranstaltungsbeginn fällig.'),
      p('Bezahlung kann bar, per PayPal oder per Banküberweisung erfolgen.'),

      // § 1.2
      h2('1.2 Widerrufsrecht und Stornobedingungen'),
      p('Bei Anmeldungen über E-Mail oder WhatsApp steht dir grundsätzlich ein gesetzliches Widerrufsrecht von 14 Tagen zu. Da meine Kurse und Veranstaltungen mit festen Terminen sorgfältig vorbereitet und Plätze verbindlich reserviert werden, beginne ich bereits vor Kursbeginn mit der Vorbereitung meiner Leistung (z. B. Raumplanung, Ablaufgestaltung, Material und Teilnehmerorganisation). Mit deiner Buchung stimmst du ausdrücklich zu, dass ich bereits 7 Tage vor Kurs- oder Veranstaltungsbeginn mit der Vorbereitung und Erbringung meiner Leistung beginne. Du bestätigst, dass dir bewusst ist, dass dein Widerrufsrecht mit Beginn dieser Leistung gemäß § 356 Abs. 4 BGB erlischt.'),
      p('Ab diesem Zeitpunkt gilt:'),
      pRich([{ text: 'Für Veranstaltungen (z. B. Workshops, Specials):', bold: true }]),
      p('Eine kostenfreie Stornierung ist bis 7 Tage vor Veranstaltungsbeginn möglich. Danach fällt die vollständige Veranstaltungsgebühr an. Sollte die Gebühr bis 7 Tage vorher noch nicht bezahlt sein, bleibt die Rechnung dennoch bestehen und ist vollständig zu begleichen. Ausnahme: Du benennst einen Ersatzteilnehmer, der deinen Platz einnimmt. Rückst du automatisch von der Warteliste nach, steht dir innerhalb von 60 Minuten nach dem Nachrücken ein kostenfreies Rücktrittsrecht zu; nach Ablauf dieser 60 Minuten gilt die 7-Tage-Stornofrist entsprechend.'),
      p('Danke für Dein Verständnis und deine Wertschätzung für meine Planung ❤️'),
      pRich([{ text: 'Für Kurse (mit festen Kursreihen):', bold: true }]),
      bullet('Eine kostenfreie Stornierung ist bis 14 Tage vor Kursbeginn möglich.'),
      bullet('Danach gilt: gebucht ist gebucht — die vollständige Kursgebühr fällt an.'),
      bullet('Option: Du kannst einen passenden Ersatzteilnehmer benennen.'),
      bullet('Danke für Dein Verständnis und deine Wertschätzung für meine Planung ❤️'),
      pRich([{ text: 'Während eines laufenden Kurses (Krankheits-Austragung):', bold: true }]),
      p('Wenn der Teilnehmende krankheitsbedingt für mindestens 4 Einheiten nicht am Kurs teilnehmen kann, erfolgt auf Wunsch eine Gutschrift über die ab dem Attest-Datum noch ausstehenden Stunden des Kurses. Voraussetzung ist die Vorlage eines ärztlichen Attestes; die Austragung erfolgt durch mich (Sarah) im Admin-Bereich mit ausdrücklicher Bestätigung, dass mir das Attest vorliegt.'),
      bullet('Die Gutschrift wird in deinem App-Profil als „Krankheits-Guthaben“ hinterlegt.'),
      bullet('Sie ist 10 Monate ab Attest-Datum gültig (eigene Frist; weicht bewusst von der 2-Jahres-Frist beim Kursabbruch ab).'),
      bullet('Sie kann ausschließlich mit der Buchung eines neuen Kurses verrechnet werden — keine Auszahlung in Geld und keine Verwendung für einzelne Drop-In-Stunden.'),
      bullet('Alle bestehenden Vorhol- und Nachholbuchungen werden zum Zeitpunkt der Austragung ersatzlos storniert.'),
      bullet('Ist kein Platz in einem passenden Folgekurs frei oder findet innerhalb der 10 Monate kein passender Kurs statt, verfällt der Anspruch ersatzlos.'),

      // Kursabbruch durch Yogalehrerin (Welle Mai 2026: Default Erstattung + 2J-Auto-Refund)
      pRich([{ text: 'Kursabbruch durch die Yogalehrerin (mit Wahloption Erstattung oder Guthaben):', bold: true }]),
      p('Die Yogalehrerin ist berechtigt, bei Nichterreichen der im Angebot genannten Mindestteilnehmerzahl oder aus einem wichtigen privaten Grund (z. B. Krankheit, Unfall, Todesfall) einen Kurs vor Beginn oder während der Laufzeit abzusagen.'),
      p('Wird ein Kurs vor Beginn abgesagt, werden bereits gezahlte Gebühren in voller Höhe zurückerstattet.'),
      p('Wird ein Kurs während der Laufzeit abgesagt, hast du für die noch nicht stattgefundenen Einheiten innerhalb von 7 Tagen die Wahl zwischen:'),
      bullet('Anteilige Erstattung des Kurspreises für die ausgefallenen Einheiten, oder'),
      bullet('Kurs-Guthaben in Höhe der ausgefallenen Stunden, hinterlegt in der App und einlösbar ausschließlich für einen neuen Kurs innerhalb von 2 Jahren ab Vergabe.'),
      p('Triffst du innerhalb von 7 Tagen keine Wahl, wird dir der anteilige Geldbetrag automatisch erstattet. Ich melde mich dann persönlich bei dir wegen der Überweisung.'),
      p('Ich freue mich aber besonders, wenn du das Guthaben wählst — dann sehen wir uns hoffentlich im nächsten Kurs wieder. Das Guthaben ist 2 Jahre gültig. Sollte es bis dahin nicht eingelöst worden sein (z. B. weil kein passender Kurs zustande kommt oder du keinen freien Platz findest), wird dir der entsprechende Geldbetrag automatisch ausgezahlt — du verlierst also in keinem Fall etwas.'),

      // § 1.3
      h2('1.3 Stundenausfall und Nachholregelung — Kurse'),
      pRich([{ text: 'Absage durch Schüler: ', bold: true }, { text: 'Eine Abmeldung von einzelnen Stunden erfolgt eigenverantwortlich über die App.' }]),
      bullet('Bis 3 Stunden vor Stundenbeginn: kostenfreie Abmeldung, dein Credit wird zurückgebucht und kann für eine andere Stunde innerhalb der Gültigkeitsfrist verwendet werden.'),
      bullet('Weniger als 3 Stunden vor Stundenbeginn oder Nichterscheinen: kein Credit zurück, die Stunde gilt als wahrgenommen.'),
      pRich([{ text: 'Nachholen: ', bold: true }, { text: 'Versäumte oder rechtzeitig abgemeldete Stunden können über die App in einer anderen gleichwertigen Stunde innerhalb der Credit-Gültigkeit (bis 8 Tage nach Kursende) nachgeholt werden, sofern dort ein Platz frei ist.' }]),
      pRich([{ text: 'Vorholen: ', bold: true }, { text: 'Stunden aus deinem laufenden Kurs dürfen maximal 10 Tage im Voraus in einer anderen gleichwertigen Stunde vorgeholt werden, sofern dort ein Platz frei ist.' }]),
      p('Es besteht kein Anspruch auf einen freien Platz in einer bestimmten Stunde. Ein Mitnehmen von Credits in einen Folgekurs ist nicht möglich.'),
      pRich([{ text: 'Absage durch Yogalehrerin: ', bold: true }, { text: 'Bei Absage einer einzelnen Kursstunde aus einem wichtigen Grund (z. B. Krankheit, Unfall, Todesfall) wird die Gebühr nicht erstattet, sondern die Einheit durch einen Ersatztermin ersetzt. Der Ersatztermin wird in der App eingetragen. Du wirst automatisch auf den Ersatztermin umgebucht und per E-Mail benachrichtigt. Falls du am Ersatztermin nicht teilnehmen kannst, gelten die normalen Abmelderegeln aus § 1.3 (Absage durch Schüler). Sollte der Schüler bei dem Ersatztermin nicht anwesend sein können, ist das Nachholen der Stunde in einem gleichwertigen Kurs nach Absprache möglich. Findet kein gleichwertiger Kurs statt, verfällt der Anspruch auf einen weiteren Ersatztermin.' }]),

      // § 1.4
      h2('1.4 Allgemeine Regeln (Verhalten im Kurs)'),
      p('Folgende Regeln sind verbindlicher Bestandteil deiner Teilnahme an meinen Kursen und Stunden. Du bestätigst sie zusätzlich bei deinem ersten App-Login per Click-Wrap unter „Rechtliches“:'),
      bullet('Pünktlichkeit: Bitte sei pünktlich auf deiner Matte. Bei Verspätung erfolgt kein Eintritt während der Anfangsentspannung — bitte warte vor dem Kursraum, bis die Anfangsentspannung beendet ist.'),
      bullet('Handy: Bitte schalte dein Handy immer stumm oder ganz aus, bevor die Stunde beginnt.'),
      bullet('Krankheit / Erkältung: Aus Rücksicht auf die Gruppe bitte ich dich, bei ansteckenden Erkrankungen oder deutlichen Erkältungssymptomen nicht am Unterricht teilzunehmen.'),
      p('Die Yogalehrerin behält sich das Recht vor, Kurszeiten und Kursort in zumutbarer Weise zu ändern.'),

      // § 1.5 NEU - Warteliste
      h2('1.5 Warteliste'),
      p('Ist ein Kurs oder eine einzelne Stunde ausgebucht, kannst du dich über die App auf die Warteliste setzen.'),
      bullet('Wird ein Platz mehr als 90 Minuten vor Stundenbeginn frei: Der/die erste Wartende wird automatisch eingebucht und per E-Mail informiert. Er/Sie hat ab dem automatischen Aufrücken eine Stunde Zeit, sich kostenlos wieder abzumelden, falls er/sie doch nicht teilnehmen kann.'),
      bullet('Wird ein Platz weniger als 90 Minuten vor Stundenbeginn frei: Alle Wartenden erhalten ein „Last-Minute"-Angebot per E-Mail. Wer zuerst über den Link annimmt, bekommt den Platz.'),
      p('Voraussetzung für die Wartelisten-Eintragung ist ein gültiger freier Credit. Es besteht kein Anspruch auf einen freiwerdenden Platz.'),

      // § 2 Personal Yoga (unverändert)
      h1('2. Einzelangebote: Personal Yoga'),

      h2('2.1 Anmeldung und Bezahlung'),
      p('Mit der Buchung eines Personal-Yoga-Pakets (z. B. Einzeltermin, 5er- oder 10er-Karte) kommt ein verbindlicher Vertrag über die vereinbarte Anzahl an Einzelstunden zustande. Der Vertrag über Personal-Yoga-Pakete wird im persönlichen Erstgespräch vereinbart. Die Terminabsprachen erfolgen individuell.'),
      p('Die Bezahlung des vollständigen Paketpreises wird mit Bestätigung der Buchung fällig. Erst nach Zahlungseingang sind die Termine verbindlich reserviert. Die Termine sind nicht übertragbar.'),
      p('Die Bezahlung kann bar, per PayPal oder per Banküberweisung erfolgen.'),

      h2('2.2 Widerrufsrecht und Stornobedingungen'),
      p('Da der Vertrag vor Ort geschlossen wird, besteht kein Widerrufsrecht nach § 312g BGB. Eine Stornierung des gesamten Pakets ist jedoch bis 7 Tage vor der ersten Einheit möglich. Danach ist kein Rücktritt vom Paket mehr möglich, da die Yogalehrerin Kapazitäten und Zeiten verbindlich plant und reserviert. Es gelten dann die Regeln für den Ausfall von einzelnen Stunden, siehe unten.'),
      p('Die Yogalehrerin ist berechtigt, aus einem wichtigen privaten Grund (z. B. Krankheit, Unfall, Todesfall) vom Vertrag zurückzutreten. Bereits gezahlte Gebühren werden in voller Höhe oder anteilig, wenn bereits Stunden stattgefunden haben, zurückerstattet.'),

      h2('2.3 Stundenausfall — Personal Yoga'),
      pRich([{ text: 'Absage durch Schüler', bold: true }]),
      p('Bis 24 Stunden vor dem vereinbarten Termin: kostenfreie Terminverschiebung möglich. Die Ersatzstunde muss innerhalb von 6 Monaten stattfinden. Nicht vereinbarte oder abgesprochene Stunden verfallen nach Ablauf dieser Frist. Bitte kontaktiere die Yogalehrerin rechtzeitig, um Ersatztermine zu vereinbaren.'),
      p('Weniger als 24 Stunden vor dem Termin: 50 % der Gebühr werden als Ausfallgebühr berechnet. Die verbleibenden 50 % können innerhalb von 6 Monaten auf einen neu vereinbarten Ersatztermin angerechnet werden. Danach verfällt die Gebühr. Eine Rückerstattung erfolgt grundsätzlich nicht.'),
      p('Bei Nichterscheinen ohne Absage: die Stunde gilt als wahrgenommen, der Anspruch auf einen Ersatztermin entfällt.'),
      pRich([{ text: 'Absage durch Lehrerin: ', bold: true }, { text: 'Bei Absage aus wichtigem Grund (z. B. Krankheit, Unfall, Todesfall) wird ein Ersatztermin vereinbart. Sollte ein Ersatztermin nicht möglich sein, wird die Gebühr erstattet.' }]),

      h2('2.4 Sonstiges'),
      p('Bitte sei pünktlich auf deiner Matte. Bei Verspätung in einer Personal-Yoga-Einheit reduziert sich deine verbleibende Praxis-Zeit entsprechend.'),

      // § 3
      h1('3. Firmenyoga'),
      p('Die Geschäftsbedingungen für Firmenyoga werden grundsätzlich über einen Einzelvertrag vereinbart.'),

      // § 4
      h1('4. Gutscheine'),
      p('Gutscheine sind 3 Jahre ab Ausstellungsdatum gültig. Nach Ablauf der Frist verfällt der Gutschein, eine Barauszahlung ist ausgeschlossen.'),
      p('Der Gutscheinwert wird auf die jeweils gültige Kurs- oder Eventgebühr angerechnet. Eine Einlösung ist nur nach vorheriger Anmeldung und bei verfügbaren Kursplätzen möglich. Eine Teilnahme ist nicht garantiert, sofern der Kurs bereits ausgebucht ist.'),
      p('Gutscheine sind übertragbar, können jedoch nicht in bar ausgezahlt werden.'),
      p('Bei Verlust oder Diebstahl des Gutscheins wird kein Ersatz geleistet.'),

      // § 5
      h1('5. Haftungsausschluss'),
      p('Yoga und körperliches Training sind mit einem erhöhten Verletzungs- und Beschwerderisiko verbunden. Teilnehmende nehmen während Kursstunden oder Personal-Yoga-Einheiten auf eigene Verantwortung teil. Die Übungen in Personal-Yoga-Stunden werden auf die individuellen Fähigkeiten der Teilnehmenden abgestimmt.'),
      p('Du solltest zum Zeitpunkt der Teilnahme körperlich gesund sein. Falsches oder unachtsames Ausführen von Übungen kann gesundheitliche Auswirkungen haben. Bei Zweifeln an deinem Gesundheitszustand wird empfohlen, vor der Teilnahme ärztlichen Rat einzuholen. Teilnehmende verpflichten sich, die Yogalehrerin über gesundheitliche Veränderungen, Verletzungen oder Beschwerden während der Kursdauer zu informieren.'),
      p('Die Yogalehrerin ist keine Ärztin oder Physiotherapeutin. Yoga ersetzt keine medizinische oder therapeutische Behandlung. Alle Hinweise und Anleitungen erfolgen nach bestem Wissen und Gewissen auf Basis ihrer Ausbildung und Erfahrung.'),
      p('Die Yogalehrerin haftet uneingeschränkt nach den gesetzlichen Bestimmungen für Schäden an Leben, Körper und Gesundheit, die auf einer fahrlässigen Pflichtverletzung von der Yogalehrerin beruhen. Für sonstige Schäden haftet die Yogalehrerin nur im Falle von Vorsatz oder grober Fahrlässigkeit.'),
      p('Die Yogalehrerin übernimmt keine Haftung für die vom Teilnehmenden zu den Kursterminen mitgebrachten Wertgegenstände.'),
      p('Für Schäden, für die die Yogalehrerin gesetzlich verantwortlich ist, besteht eine Berufshaftpflichtversicherung mit einer Deckungssumme von 3.000.000 € pauschal für Personen-, Sach- und Vermögensschäden.'),

      // § 6
      h1('6. Datenschutz'),
      p('Die Verarbeitung deiner personenbezogenen Daten erfolgt gemäß meiner Datenschutzerklärung. Mit deiner Anmeldung erklärst du dich damit einverstanden, dass deine Daten im Rahmen der Erfüllung des Vertrages und für organisatorische Informationen zum gebuchten Angebot verarbeitet werden. Für Newsletter oder werbliche Informationen ist eine separate Einwilligung erforderlich. Du kannst der Nutzung deiner Daten für Werbezwecke jederzeit unter Mail@yogamitsarah.me widersprechen.'),
      p('Insbesondere werden Daten zur Verwaltung deines App-Accounts (z. B. Buchungshistorie, Credits, Notfallkontakt) bei den von mir genutzten Auftragsverarbeitern (Vercel, Supabase, Brevo) verarbeitet — Details siehe Datenschutzerklärung.'),
      pRich([
        { text: 'Löschung bei langer Inaktivität: ', bold: true },
        { text: 'Aus Gründen der Datensparsamkeit (Art. 5 Abs. 1 lit. e DSGVO) werden App-Accounts, die länger als 24 Monate nicht mehr genutzt wurden, automatisch gelöscht bzw. anonymisiert. Maßgeblich ist dein letzter Login in der App. Bevor dein Account gelöscht wird, erhältst du rechtzeitig eine Vorwarnung per E-Mail an deine hinterlegte Adresse, und du kannst die Löschung jederzeit verhindern, indem du dich einfach wieder in der App anmeldest. Accounts mit noch offenen Credits, Guthaben oder zukünftigen Buchungen sind von der automatischen Löschung ausgenommen, solange ein gültiger Anspruch besteht. Bei der Löschung werden dein Name und deine E-Mail-Adresse entfernt; eine anonymisierte Buchungshistorie kann aus rechtlichen Gründen erhalten bleiben. Bereits verfallene Credits oder Guthaben werden nicht erstattet.' },
      ]),

      // § 7
      h1('7. Salvatorische Klausel'),
      p('Sollten einzelne Bestimmungen dieser Allgemeinen Geschäftsbedingungen ganz oder teilweise unwirksam oder undurchführbar sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt. Anstelle der unwirksamen oder undurchführbaren Bestimmung gilt diejenige rechtlich zulässige Regelung als vereinbart, die dem wirtschaftlichen Zweck der ursprünglichen Bestimmung am nächsten kommt. Gleiches gilt im Falle einer Regelungslücke.'),

      // § 8 NEU
      h1('8. Änderungen dieser AGB'),
      p('Ich behalte mir vor, diese AGB anzupassen, wenn dies gesetzlich erforderlich wird oder ich meine Leistungen weiterentwickle (z. B. neue Funktionen in der App). Bei wesentlichen Änderungen wirst du in der App und per E-Mail informiert und um erneute Bestätigung gebeten. Die jeweils aktuelle Version findest du unter yogamitsarah.me/agb und in der App im Bereich „Rechtliches".'),

      // Schlusssatz
      divider(),
      pRich([{ text: 'Mit der Teilnahme an meinen Angeboten erkennen Teilnehmende den Haftungsausschluss sowie die Teilnahmebedingungen an.', italics: true }], { alignment: AlignmentType.CENTER }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240 },
        children: [new TextRun({ text: 'Stand: Mai 2026', font: FONT, size: 22, italics: true, color: '666666' })],
      }),
    ],
  }],
})

const OUT = path.join(__dirname, '..', 'Yoga-mit-Sarah-AGB.docx')
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf)
  console.log(`✅ AGB generiert: ${OUT}`)
  console.log(`   Groesse: ${(buf.length / 1024).toFixed(1)} KB`)
})
