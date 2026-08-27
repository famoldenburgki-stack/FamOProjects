/** Kurzprüfung der Erkennungsregeln an konstruierten Beispielen. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasWord, hasWordStart, parseInvoice } from '../ocr/parse.js';

// Eigene Datenbank für den Prüflauf – die echten Daten bleiben unberührt.
const testDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'arzt-selftest-')), 'test.db');
process.env.ARZTRECHNUNGEN_DB = testDb;
const { applyPattern, findPattern, learnFromInvoice } = await import('../patterns.js');

const MEMBERS = ['Ali', 'Nora', 'Ina', 'Bela', 'Jonas'];
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FEHL'} ${label.padEnd(52)} ${JSON.stringify(actual)}`);
}

const noise = 'Die Qualität war optimal, Praxisinhaberin Dr. Berg. Millionen Patienten. Bahnhofstrasse 5.';

check('"Ali" nicht in Qualität', hasWord(noise, 'Ali'), false);
check('"Ina" nicht in Praxisinhaberin', hasWord(noise, 'Ina'), false);
check('"Ali" als eigener Name', hasWord('Patient: Ali Musterl', 'Ali'), true);
check('"Bela" mit Komma', hasWord('Musterl, Bela', 'Bela'), true);
check('"hno" nicht in Bahnhofstrasse', hasWordStart(noise, 'hno'), false);
check('"hno" in HNO-Praxis', hasWordStart('HNO-Praxis Dr. Berg', 'hno'), true);
check('"zahnarzt" in Zahnarztpraxis', hasWordStart('Zahnarztpraxis Weber', 'zahnarzt'), true);

const rechnung = [
  'Praxis Dr. med. Anna Welter',
  'Fachärztin für Gynäkologie',
  'Dahlmannstraße 31',
  '60385 Frankfurt',
  'Tel: 069 25629647',
  '',
  'Rechnung Nr: 2019175-P',
  'Datum: 29.10.2019',
  'Patient: Nora Musterl',
  'Behandlungsdatum: 15.10.2019',
  '',
  'Gesamtbetrag: 204,78 EUR',
  'Mit freundlichen Grüßen',
].join('\n');

const p = parseInvoice(rechnung, MEMBERS);
check('Arzt', p.doctor, 'Praxis Dr. med. Anna Welter');
check('Rechnungsnummer', p.invoice_number, '2019175-P');
check('Rechnungsdatum', p.invoice_date, '2019-10-29');
check('Behandlungsdatum', p.treatment_date, '2019-10-15');
check('Betrag', p.amount, 204.78);
check('Patient', p.member_name, 'Nora');
check('Kategorie', p.category, 'Facharzt');

// Zwei Familienmitglieder im Text -> nicht raten
const zweiNamen = 'Rechnung\nPatientin: Nora Musterl\nBegleitperson: Ali Musterl\nSumme: 50,00';
check('mehrdeutiger Patient bleibt offen', parseInvoice(zweiNamen, MEMBERS).member_name, 'Nora');

const ohneLabel = 'Rechnung\nEltern: Ali und Nora Musterl\nSumme: 50,00';
check('ohne Kennzeichnung nicht raten', parseInvoice(ohneLabel, MEMBERS).member_name, null);

// Rechnungsnummer als Tabellenspalte (Wert erst in einer Folgezeile)
const tabelle = [
  'Laborarztpraxis',
  'Postfach 560253 60407 Frankfurt Rechnungs-Nr. Rechnungsdatum',
  'LAURA MARIA OLDENBURG A020193779 11.01.2021',
  'Bitte bei Zahlung stets Rechnungs-Nr. angeben !',
  'Summe: 152,33',
].join('\n');
check('Nummer aus Spaltenkopf', parseInvoice(tabelle, MEMBERS).invoice_number, 'A020193779');

const vierSpalten = [
  'Chirurgie Maintaunus',
  'Datum Rechnungs-Nr. Zahlungstermin Rechnungsbetrag',
  '14.12.2021 512345 28.12.2021 398,58',
].join('\n');
check('Nummer neben Datum und Betrag', parseInvoice(vierSpalten, MEMBERS).invoice_number, '512345');

const nurHinweis = 'Praxis Dr. Weber\nDatum: 22.02.2022\nBitte überweisen Sie den Betrag unter Angabe der Rechnungsnummer bis zum 15.03.2022.\nSumme 398,58';
check('Zahlungshinweis liefert keine Nummer', parseInvoice(nurHinweis, MEMBERS).invoice_number, '');

// Briefköpfe, wie die Texterkennung sie aus Logos und Stempeln liefert
for (const [roh, soll] of [
  ['@_ BHYVY Dr. med. J. Scholl', 'Dr. med. J. Scholl'],
  ['SL ® X 03 zz Dr. med. C. Welter, MBA', 'Dr. med. C. Welter, MBA'],
  ['be} 25 AA Laborarztpraxis', 'Laborarztpraxis'],
  ['HE Klinikum Frankfurt Höchst', 'Klinikum Frankfurt Höchst'],
  ['Grit-Anke Schröter —', 'Grit-Anke Schröter'],
] as const) {
  check(`Briefkopf: ${roh.slice(0, 28)}`, parseInvoice(`${roh}\nRechnung\nSumme 10,00`, MEMBERS).doctor, soll);
}

// Geburtsdatum darf nicht als Behandlungsdatum durchgehen
const mitGeburtsdatum = [
  'Klinikum Frankfurt Höchst',
  'Patient: Bela Musterl Geb.-Dat. 09.02.2020',
  'RG-Datum 15.09.2021',
  'Leistungen 20.08.2021 Ziffer 1',
  'Leistungen 25.08.2021 Ziffer 5',
  'Summe 149,80',
].join('\n');
check(
  'Geburtsdatum ist kein Behandlungsdatum',
  parseInvoice(mitGeburtsdatum, MEMBERS).treatment_date,
  '2021-08-20',
);

// Kinderrechnung: Rechnung an den Vater, behandelt wurde das Kind
const kinderrechnung = [
  'Kinderarztpraxis Dr. Sommer',
  'Herrn Ali Musterl',
  'Musterweg 12',
  '12345 Musterstadt',
  'Behandelt wurde: Ina Musterl geb.: 14.06.2018',
  'Rechnungsdatum: 01.12.2021',
  'Gesamtbetrag: 96,30',
].join('\n');
const kr = parseInvoice(kinderrechnung, MEMBERS);
check('Kinderrechnung: Patient ist das Kind', kr.member_name, 'Ina');
check('Kinderrechnung: beide Namen gemeldet', kr.member_candidates, ['Ali', 'Ina']);

// Geburtsdatum darf auch nicht als Rechnungsdatum durchgehen
const ohneRechnungsdatum = [
  'Laborarztpraxis',
  'OLDENBURG MARLO',
  'geboren am: 11.05.2021',
  'Leistungen erbracht 14.02.2025',
  'Summe 126,03',
].join('\n');
check(
  'Geburtsdatum ist kein Rechnungsdatum',
  parseInvoice(ohneRechnungsdatum, MEMBERS).invoice_date,
  '2025-02-14',
);
check(
  'Kinderrechnung gilt als eindeutig',
  parseInvoice(kinderrechnung, MEMBERS).member_from_label,
  true,
);

// Liquidation: Ausstellungsdatum im Kopf, Zahlungsfrist weiter unten
const liquidation = [
  'Praxis Dr. Hellweg',
  'Liquidation 2202-004348 Frankfurt am Main, den 22.02.2022',
  'Behandelt wurde : Nora Musterl - geb. 07.11.1988',
  'Erbrachte Leistungen vom 14.01.2022',
  'Erbrachte Leistungen vom 04.02.2022',
  'Bitte überweisen Sie den Betrag bis zum',
  '08.03.2022',
  'Gesamtbetrag 398,58',
].join('\n');
const liq = parseInvoice(liquidation, MEMBERS);
check('Liquidation: Ausstellungsdatum statt Frist', liq.invoice_date, '2022-02-22');
check('Liquidation: Behandlungsdatum', liq.treatment_date, '2022-01-14');
check('Liquidation: Patient', liq.member_name, 'Nora');

/* ---------- Behandlungsarten ---------- */

const kinderbeleg = 'Kinderarztpraxis Anke Abou Saif\nRechnung vom 01.12.2021\nGesamtbetrag 48,43';

// Ohne eigene Art greift die Stichwortliste: Kinderarzt zählt als Facharzt.
check('ohne eigene Art: Facharzt', parseInvoice(kinderbeleg, MEMBERS).category, 'Facharzt');

// Ist "Kinderarzt" angelegt, ist das die genauere Antwort.
check(
  'eigene Art gewinnt',
  parseInvoice(kinderbeleg, MEMBERS, ['Facharzt', 'Kinderarzt', 'Sonstiges']).category,
  'Kinderarzt',
);

// Zusammengesetzte Namen greifen über ihren ersten Teil.
check(
  'zusammengesetzter Name',
  parseInvoice('Zahnarztpraxis Weber\nSumme 48,53', MEMBERS, ['Zahnarzt/KFO', 'Sonstiges']).category,
  'Zahnarzt/KFO',
);

// Wortstamm: "Osteopathische Behandlung" muss die Art "Osteopathie" finden.
check(
  'Endung wird abgeschnitten',
  parseInvoice(
    'Praxis Röhl\n35.2 Osteopathische Behandlung\nSumme 124,80',
    MEMBERS,
    ['Osteopathie', 'Heilpraktiker', 'Sonstiges'],
  ).category,
  'Osteopathie',
);

// Eine Art, die es nicht gibt, darf nicht zurückgegeben werden.
check(
  'unbekannte Art fällt zurück',
  parseInvoice(kinderbeleg, MEMBERS, ['Sonstiges']).category,
  'Sonstiges',
);

/* ---------- Betragserkennung ---------- */

const { allAmounts } = await import('../ocr/parse.js');

check('Komma-Betrag', allAmounts('Gesamtbetrag 1.234,56'), [1234.56]);
check('mehrere Beträge in Lesereihenfolge', allAmounts('8,74 2,30 20,11'), [8.74, 2.3, 20.11]);
check('Datum ist kein Betrag', allAmounts('Rechnung vom 12.03.2026'), []);
check(
  'Gesetzesangabe ist kein Betrag',
  allAmounts('Steuerbefreiung gem. 84.14 UstG'),
  [],
);
check('Punkt-Betrag mit Währung zählt', allAmounts('Summe EUR 84.14'), [84.14]);
check('Punkt-Betrag mit Eurozeichen zählt', allAmounts('84.14 €'), [84.14]);

/* ---------- Rechnungssumme ---------- */

// Leistungsaufstellung mit Zwischensummen – die Endsumme steht ganz unten
const mitZwischensummen = [
  'Praxis Dr. Hellweg',
  'Rechnung vom 22.02.2022',
  'Ziffer 1 Beratung 10,72',
  'Ziffer 5 Untersuchung 15,15',
  'Zwischensumme 25,87',
  'Ziffer 250 Blutentnahme 4,20',
  'Ziffer 3541 Laborleistung 8,74',
  'Zwischensumme 12,94',
  'Summe der Leistungen 38,81',
  'zuzüglich Auslagen 3,20',
  'Gesamtbetrag 42,01',
].join('\n');
const zs = parseInvoice(mitZwischensummen, MEMBERS);
check('Endsumme statt Zwischensumme', zs.amount, 42.01);
check('Endsumme gilt als sicher', zs.amount_source, 'endsumme');

// Endsumme oben im Kopf, Einzelpositionen darunter (häufig bei Abrechnungsstellen)
const kopfsumme = [
  'Abrechnungsstelle Nord',
  'Rechnungsbetrag 1.240,50 EUR',
  'Rechnung vom 12.01.2025',
  'Position 1 400,00',
  'Position 2 840,50',
].join('\n');
check('Endsumme im Kopf', parseInvoice(kopfsumme, MEMBERS).amount, 1240.5);

// Abzüge nach der Summe: maßgeblich ist der Zahlbetrag
const mitAbzug = [
  'Zahnarztpraxis Weber',
  'Rechnung vom 03.02.2026',
  'Gesamtsumme 480,00',
  'abzüglich Anzahlung 100,00',
  'Zu zahlender Betrag 380,00',
].join('\n');
check('Zahlbetrag schlägt Gesamtsumme', parseInvoice(mitAbzug, MEMBERS).amount, 380.0);

// Steuer- und Punktzeilen dürfen nicht als Summe gelten
const mitSteuer = [
  'Heilpraktikerin Meier',
  'Rechnung vom 10.03.2026',
  'Leistungen netto 100,00',
  'zzgl. 19 % MwSt 19,00',
  'Gesamtbetrag 119,00',
].join('\n');
check('Steuerzeile ist keine Summe', parseInvoice(mitSteuer, MEMBERS).amount, 119.0);

// Beschriftung und Wert in getrennten Zeilen
const getrennt = [
  'Klinikum Nord',
  'Rechnung vom 15.09.2021',
  'Ziffer 1 20,00',
  'Rechnungsbetrag',
  '149,80 EUR',
].join('\n');
check('Summe in der Folgezeile', parseInvoice(getrennt, MEMBERS).amount, 149.8);

// Texterkennung verdoppelt Buchstaben – die Beschriftung muss trotzdem greifen
const verlesen = [
  'Klinikum Frankfurt Höchst',
  'Rechnung vom 15.09.2021',
  'Arzthonorar Laborgemeinschaft 4 149,80 100,00 149,80',
  'Zwischensumme 149,80',
  'TU U zu zahllender Betrag 149,80',
  '3581.H1 Bilirubin Neugeb. spektralphotometrisch 1 2,33 2,68',
].join('\n');
const vl = parseInvoice(verlesen, MEMBERS);
check('verlesene Beschriftung wird erkannt', vl.amount, 149.8);
check('trotz Verlesung als Endsumme', vl.amount_source, 'endsumme');

// Ohne jede Beschriftung bleibt der größte Betrag – aber als unsicher markiert
const ohneLabel2 = ['Praxis Dr. X', 'Rechnung vom 01.02.2026', '12,00', '48,53', '9,10'].join('\n');
const ol = parseInvoice(ohneLabel2, MEMBERS);
check('ohne Beschriftung der größte Betrag', ol.amount, 48.53);
check('ohne Beschriftung als unsicher', ol.amount_source, 'groesster-betrag');
check('unsichere Summe nicht als sicher gezählt', ol.confidence.amount, false);

/* ---------- Gelernte Aussteller-Muster ---------- */

const laborRechnung = (nr: string, datum: string, betrag: string) =>
  [
    'Laborarztpraxis',
    'Dres. Walther, Weindel und Kollegen',
    'Postfach 560253 60407 Frankfurt Rechnungs-Nr. Rechnungsdatum',
    `LAURA MARIA OLDENBURG ${nr} ${datum}`,
    'Bitte bei Zahlung stets Rechnungs-Nr. angeben !',
    `Gesamtbetrag: ${betrag}`,
  ].join('\n');

// Zwei Rechnungen desselben Ausstellers lernen lassen …
for (const [nr, datum, betrag] of [
  ['A020193779', '11.01.2021', '152,33'],
  ['A020174599', '03.12.2020', '204,78'],
] as const) {
  const text = laborRechnung(nr, datum, betrag);
  const p = parseInvoice(text, MEMBERS);
  learnFromInvoice({
    doctor: 'Laborarztpraxis Dres. Walther, Weindel',
    ocr_text: text,
    invoice_number: nr,
    amount: p.amount,
    invoice_date: p.invoice_date,
    treatment_date: null,
    category: 'Labor',
  });
}

const gelernt = findPattern(laborRechnung('A210031774', '20.01.2021', '99,00'));
check('Muster wird wiedererkannt', gelernt?.display_name, 'Laborarztpraxis Dres. Walther, Weindel');
check('Muster zählt beide Belege', gelernt?.samples, 2);

// … und auf einem Beleg anwenden, dessen Nummer die allgemeinen Regeln übersehen
const schlechterScan = [
  'Laborarztpraxis',
  'Dres. Walther, Weindel und Kollegen',
  'Postfach 560253 60407 Frankfurt',
  'LAURA MARIA OLDENBURG A210031774 20.01.2021',
  'Gesamtbetrag: 99,00',
].join('\n');
const roh = parseInvoice(schlechterScan, MEMBERS);
check('ohne Muster keine Nummer', roh.invoice_number, '');

const angewandt = applyPattern(findPattern(schlechterScan)!, schlechterScan, {
  invoice_number: roh.invoice_number,
  amount: roh.amount,
  invoice_date: roh.invoice_date,
  treatment_date: roh.treatment_date,
  category: roh.category,
});
check('Muster findet die Nummer', angewandt.values.invoice_number, 'A210031774');
check('Muster meldet das Feld', angewandt.fields, ['invoice_number']);

// Ein fremder Aussteller darf nicht auf dieses Muster fallen
const fremd = 'Zahnarztpraxis Dr. Zickgraf\nWiesenweg 4\nRechnung\nSumme 70,42';
check('fremder Aussteller trifft nicht', findPattern(fremd)?.display_name ?? null, null);

/* ---------- Ablage ---------- */

const { archivePathFor, checkArchiveRoot, personFolder } = await import('../archive.js');
const archiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arzt-ablage-'));

check('Personenordner mit Nummer', personFolder('Ali', 2), '2 Ali');
check('Personenordner ohne Nummer', personFolder('Ali', 0), 'Ali');

check(
  'Zielpfad einer Rechnung',
  archivePathFor(archiveRoot, {
    member: 'Ali',
    memberOrder: 2,
    invoiceDate: '2026-05-29',
    doctor: 'Praxis Dr. Fröhlich',
    amount: 63.01,
    extension: '.pdf',
  }),
  path.join(archiveRoot, '2 Ali', 'Belege 2026', '2026-05-29 Praxis Dr. Fröhlich 63,01 EUR.pdf'),
);

check(
  'unerlaubte Zeichen im Arztnamen',
  path.basename(
    archivePathFor(archiveRoot, {
      member: 'Nora',
      memberOrder: 1,
      invoiceDate: '2026-01-02',
      doctor: 'Dr. A/B: "Praxis" <Nord>',
      amount: 1234.5,
      extension: '.jpg',
    }),
  ),
  '2026-01-02 Dr. A B Praxis Nord 1234,50 EUR.jpg',
);

const { decisionArchivePathFor } = await import('../archive.js');

check(
  'Zielpfad eines Beihilfebescheids',
  decisionArchivePathFor(archiveRoot, {
    account: 'Ali',
    accountOrder: 1,
    target: 'beihilfe',
    decisionDate: '2026-06-22',
    totalPaid: 394.84,
    extension: '.pdf',
  }),
  path.join(archiveRoot, '1 Ali', 'Bescheide 2026', '2026-06-22 Beihilfe 394,84 EUR.pdf'),
);

check(
  'Zielpfad eines DBV-Bescheids ohne Betrag',
  path.basename(
    decisionArchivePathFor(archiveRoot, {
      account: 'Nora',
      accountOrder: 2,
      target: 'dbv',
      decisionDate: '2026-05-21',
      totalPaid: null,
      extension: '.pdf',
    }),
  ),
  '2026-05-21 DBV.pdf',
);

check('leerer Pfad wird abgelehnt', Boolean(checkArchiveRoot('').error), true);
check('relativer Pfad wird abgelehnt', Boolean(checkArchiveRoot('belege').error), true);
check('vorhandener Ordner ist beschreibbar', checkArchiveRoot(archiveRoot).writable, true);
check(
  'fehlender Ordner wird auf Wunsch angelegt',
  checkArchiveRoot(path.join(archiveRoot, 'neu'), true).created,
  true,
);

fs.rmSync(archiveRoot, { recursive: true, force: true });

const { db } = await import('../db.js');
db.close();
fs.rmSync(path.dirname(testDb), { recursive: true, force: true });

console.log(failed === 0 ? '\nalle Prüfungen bestanden' : `\n${failed} Prüfungen fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
