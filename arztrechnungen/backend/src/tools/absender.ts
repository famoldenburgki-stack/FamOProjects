/**
 * Prüft, wie zuverlässig Absender (Beihilfe/DBV) und Zugang aus einem Bescheid
 * selbst bestimmt werden – ohne jede Angabe des Nutzers.
 *
 * Die Wahrheit liefert der Ordnername: "<Nr> <Zugang>" für den Zugang,
 * "001 DBV Bescheide" bzw. "002 Beihilfe Bescheide" für den Absender.
 *
 *   npm run --workspace backend absender -- "D:/Belege"
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractText, shutdownOcr } from '../ocr/extract.js';
import { parseDecision } from '../ocr/parse.js';
import { guessAccount } from '../createDecision.js';
import { db } from '../db.js';

const root = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!root) {
  console.error('Bitte den Wurzelordner angeben.');
  process.exit(1);
}

const memberNames = (
  db.prepare('SELECT name FROM family_members ORDER BY sort_order').all() as { name: string }[]
).map((r) => r.name);

interface Fall {
  file: string;
  sollZiel: 'dbv' | 'beihilfe';
  sollZugang: string;
}

/* Zugänge des Haushalts – danach werden die Ordnernamen erkannt. */
const zugaenge = [
  ...new Set(
    (db.prepare('SELECT account FROM family_members ORDER BY sort_order').all() as { account: string }[])
      .map((r) => r.account)
      .filter(Boolean),
  ),
];

const faelle: Fall[] = [];

function sammeln(dir: string, zugang: string | null, ziel: 'dbv' | 'beihilfe' | null): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Ordner der Form "2 Vorname" benennen den Zugang – welche es gibt, sagt die Datenbank
      const z = new RegExp('^\\d+\\s+(' + zugaenge.join('|') + ')$', 'i').exec(e.name);
      const t = /DBV Bescheide/i.test(e.name)
        ? ('dbv' as const)
        : /Beihilfe Bescheide/i.test(e.name)
          ? ('beihilfe' as const)
          : null;
      sammeln(p, z ? z[1] : zugang, t ?? ziel);
      continue;
    }
    if (path.extname(e.name).toLowerCase() !== '.pdf') continue;
    if (!zugang || !ziel) continue;
    faelle.push({ file: p, sollZiel: ziel, sollZugang: zugang });
  }
}

sammeln(root, null, null);
console.log(`${faelle.length} Bescheide gefunden\n`);

let zielOk = 0;
let zielLeer = 0;
const zielFalsch: string[] = [];
let zugangOk = 0;
const zugangFalsch: string[] = [];

for (const [i, fall] of faelle.entries()) {
  let text = '';
  try {
    text = (await extractText(fall.file)).text;
  } catch {
    /* unlesbar – zählt als nicht erkannt */
  }
  const parsed = await parseDecision(text, memberNames);
  const zugang = guessAccount(text);
  const rel = path.relative(root, fall.file);

  if (parsed.target_hint === null) {
    zielLeer++;
    console.log(`[${i + 1}/${faelle.length}] kein Absender erkannt  ${rel}`);
  } else if (parsed.target_hint === fall.sollZiel) {
    zielOk++;
  } else {
    zielFalsch.push(`${fall.sollZiel} -> ${parsed.target_hint}   ${rel}`);
  }

  if (zugang.account === fall.sollZugang) zugangOk++;
  else zugangFalsch.push(`${fall.sollZugang} -> ${zugang.account}${zugang.confident ? ' (sicher!)' : ''}   ${rel}`);
}

const pct = (n: number) => `${Math.round((n / faelle.length) * 100)}%`;

console.log(`\n${'='.repeat(70)}`);
console.log(`Absender richtig: ${zielOk} von ${faelle.length}  ${pct(zielOk)}`);
console.log(`Absender nicht erkannt: ${zielLeer}  (Nachfrage in der App)`);
console.log(`Absender FALSCH: ${zielFalsch.length}`);
for (const z of zielFalsch) console.log(`   ${z}`);
console.log(`\nZugang richtig: ${zugangOk} von ${faelle.length}  ${pct(zugangOk)}`);
for (const z of zugangFalsch) console.log(`   ${z}`);

await shutdownOcr();
db.close();
