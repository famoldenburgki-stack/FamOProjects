/**
 * Diagnose-Werkzeug: zeigt für eine Rechnung oder einen Bescheid, welchen Text
 * die App ausliest und was sie daraus erkennt. Dient dem Abgleich der
 * Erkennungsregeln mit echten Dokumenten.
 *
 *   npm run analyse -- "muster/bescheid_beihilfe.pdf"
 *   npm run analyse -- --text "muster/*.pdf"     (nur den Rohtext ausgeben)
 */
import fs from 'node:fs';
import * as dbModul from '../db.js';
import path from 'node:path';
import { extractText, shutdownOcr } from '../ocr/extract.js';
import { parseDecision, parseInvoice } from '../ocr/parse.js';

const args = process.argv.slice(2);
const textOnly = args.includes('--text');
const files = args.filter((a) => !a.startsWith('--'));

if (files.length === 0) {
  console.error('Bitte mindestens eine Datei angeben, z.B.: npm run analyse -- "muster/bescheid.pdf"');
  process.exit(1);
}

/* Die Namen des Haushalts kommen aus der Datenbank – so passt das Werkzeug
   zu jeder Installation, nicht nur zu einer bestimmten Familie. */
const MEMBERS = (
  dbModul.db.prepare('SELECT name FROM family_members ORDER BY sort_order').all() as { name: string }[]
).map((r) => r.name);

const line = (char = '─') => console.log(char.repeat(78));

/** Pfade dürfen relativ zum Projektverzeichnis oder zum backend-Ordner angegeben werden. */
function resolveFile(file: string): string | null {
  for (const base of [process.cwd(), path.resolve(process.cwd(), '..')]) {
    const candidate = path.resolve(base, file);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

for (const file of files) {
  const abs = resolveFile(file);
  if (!abs) {
    console.error(`\nnicht gefunden: ${file}`);
    continue;
  }

  line('═');
  console.log(path.basename(abs));
  line('═');

  const { text, source, warning } = await extractText(abs);
  console.log(`Textquelle: ${source}${warning ? ` | Hinweis: ${warning}` : ''}`);
  console.log(`Zeichen: ${text.length}`);

  line();
  console.log('AUSGELESENER TEXT');
  line();
  console.log(text || '(kein Text)');

  if (textOnly) continue;

  line();
  console.log('ALS RECHNUNG GELESEN');
  line();
  console.log(JSON.stringify(parseInvoice(text, MEMBERS), null, 1));

  line();
  console.log('ALS BESCHEID GELESEN');
  line();
  const decision = await parseDecision(text, MEMBERS);
  console.log(`Erkanntes Format:  ${decision.format}`);
  console.log(`Absender:          ${decision.target_hint ?? 'unklar'}`);
  console.log(`Bescheiddatum:     ${decision.decision_date ?? 'nicht erkannt'}`);
  console.log(`Summe Erstattung:  ${decision.total_paid ?? 'nicht erkannt'}`);
  console.log(`Auszahlungsbetrag: ${decision.payout_amount ?? 'nicht erkannt'}`);
  console.log(`Positionen:        ${decision.items.length}`);
  for (const note of decision.notes ?? []) console.log(`Hinweis: ${note}`);

  let sum = 0;
  decision.items.forEach((item, i) => {
    sum += item.paid_amount ?? 0;
    console.log(`\n  [${i + 1}] Patient:         ${item.member_name ?? '– nicht erkannt –'}`);
    console.log(`      Leistung/Arzt:   ${item.service_label || '–'}`);
    console.log(`      Rechnungsdatum:  ${item.invoice_date ?? (item.treatment_year ? `nur Jahr ${item.treatment_year}` : '– nicht erkannt –')}`);
    console.log(`      Rechnungsbetrag: ${item.invoice_amount ?? '– nicht erkannt –'}`);
    console.log(`      erstattet:       ${item.paid_amount ?? '– nicht erkannt –'}`);
    console.log(`      abgelehnt:       ${item.rejected_amount ?? '–'}`);
    console.log(`      Satz laut Besch.:${item.rate !== null && item.rate !== undefined ? ` ${(item.rate * 100).toFixed(2)} %` : ' –'}`);
    console.log(`      Grund:           ${item.reason || '– keiner erkannt –'}`);
    console.log(`      Rohtext:         ${item.raw_line.replace(/\n/g, ' ⏎ ').slice(0, 220)}`);
  });
  console.log(
    `\n  Summe der erkannten Erstattungen: ${Math.round(sum * 100) / 100}` +
      (decision.total_paid !== null ? ` (Bescheid: ${decision.total_paid})` : ''),
  );
  console.log();
}

await shutdownOcr();
