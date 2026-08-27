/**
 * Diagnose der Betragserkennung: zeigt alle gefundenen Beträge eines Belegs und
 * welche Zeile als Endsumme gewertet wird.
 *
 *   npm run --workspace backend betrag -- "<Pfad zur Datei>"
 */
import fs from 'node:fs';
import { db } from '../db.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractText, shutdownOcr } from '../ocr/extract.js';
import { allAmounts, parseInvoice } from '../ocr/parse.js';

const CACHE = process.env.BATCH_CACHE ?? '';

async function textOf(file: string): Promise<string> {
  if (CACHE) {
    const st = fs.statSync(file);
    const key = crypto
      .createHash('sha1')
      .update(file + '|' + st.size + '|' + Math.round(st.mtimeMs))
      .digest('hex');
    const cached = path.join(CACHE, key + '.json');
    if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf8')).text;
  }
  return (await extractText(file)).text;
}

const file = path.resolve(process.argv[2]);
const text = await textOf(file);
const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

console.log(`${path.basename(file)}\n`);
console.log('Alle erkannten Beträge:', allAmounts(text).join('  '));
console.log();

for (const [i, line] of lines.entries()) {
  const amounts = allAmounts(line);
  if (amounts.length) console.log(`${String(i).padStart(3)} | ${line.slice(0, 100)}`);
}

const namen = (
  db.prepare('SELECT name FROM family_members ORDER BY sort_order').all() as { name: string }[]
).map((r) => r.name);
const p = parseInvoice(text, namen);
console.log(`\nGewählt: ${p.amount} (${p.amount_source}${p.amount_label ? `, "${p.amount_label}"` : ''})`);

await shutdownOcr();
