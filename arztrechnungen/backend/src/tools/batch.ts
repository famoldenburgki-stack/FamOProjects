/**
 * Wertet einen ganzen Bestand echter Belege aus und misst, wie zuverlässig die
 * Erkennung arbeitet. Der Ordnername liefert dabei den richtigen Patienten, so
 * dass die Patientenerkennung überprüfbar wird.
 *
 *   npm run batch -- "D:/Belege"
 *   npm run batch -- <ordner> --limit 40      nur die ersten 40 Dateien
 *   npm run batch -- <ordner> --no-ocr        gescannte Belege überspringen
 *
 * Der ausgelesene Text wird zwischengespeichert, weitere Läufe sind dadurch schnell.
 */
import fs from 'node:fs';
import * as dbModul from '../db.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractText, shutdownOcr } from '../ocr/extract.js';
import { parseInvoice } from '../ocr/parse.js';
import { detectDecisionFormat } from '../ocr/decisionFormats.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));

if (!root) {
  console.error('Bitte den Wurzelordner angeben, z.B.: npm run batch -- "D:/Belege"');
  process.exit(1);
}

const LIMIT = Number(value('limit') ?? Infinity);
const NO_OCR = flag('no-ocr');
const OUT = value('out') ?? path.resolve('batch-report.json');
const CACHE_DIR = value('cache') ?? path.resolve('.batch-cache');

/* Die Namen des Haushalts kommen aus der Datenbank – so passt das Werkzeug
   zu jeder Installation, nicht nur zu einer bestimmten Familie. */
const MEMBERS = (
  dbModul.db.prepare('SELECT name FROM family_members ORDER BY sort_order').all() as { name: string }[]
).map((r) => r.name);
const READABLE = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp']);

export interface FileReport {
  file: string;
  person: string;
  year: string;
  ext: string;
  size: number;
  source: string;
  warning?: string;
  text_length: number;
  kind: 'rechnung' | 'bescheid' | 'unklar';
  parsed: {
    doctor: string;
    invoice_number: string;
    invoice_date: string | null;
    treatment_date: string | null;
    amount: number | null;
    category: string;
    member_name: string | null;
    payment_due_date: string | null;
    payment_due_source: string;
    payment_due_line: string | null;
  };
  member_ok: boolean | null;
  first_lines: string[];
}

/* ---------- Textcache, damit erneute Läufe nicht wieder OCR brauchen ---------- */

fs.mkdirSync(CACHE_DIR, { recursive: true });

async function cachedText(file: string): Promise<{ text: string; source: string; warning?: string }> {
  const stat = fs.statSync(file);
  const key = crypto
    .createHash('sha1')
    .update(`${file}|${stat.size}|${Math.round(stat.mtimeMs)}`)
    .digest('hex');
  const cacheFile = path.join(CACHE_DIR, `${key}.json`);
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));

  const res = await extractText(file);
  const payload = { text: res.text, source: res.source, warning: res.warning };
  fs.writeFileSync(cacheFile, JSON.stringify(payload));
  return payload;
}

/* ---------- Dateien einsammeln ---------- */

interface Job {
  file: string;
  person: string;
  year: string;
}

function collect(): Job[] {
  const jobs: Job[] = [];
  for (const personDir of fs.readdirSync(root!, { withFileTypes: true })) {
    if (!personDir.isDirectory()) continue;
    // "2 Tim" -> "Tim"
    const person = personDir.name.replace(/^\d+\s+/, '').trim();
    const personPath = path.join(root!, personDir.name);

    for (const yearDir of fs.readdirSync(personPath, { withFileTypes: true })) {
      if (!yearDir.isDirectory() || !/^Belege/i.test(yearDir.name)) continue;
      const year = (yearDir.name.match(/\d{4}/) ?? ['?'])[0];
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else if (READABLE.has(path.extname(e.name).toLowerCase())) {
            jobs.push({ file: full, person, year });
          }
        }
      };
      walk(path.join(personPath, yearDir.name));
    }
  }
  return jobs;
}

/* ---------- Lauf ---------- */

const jobs = collect().slice(0, LIMIT);
console.log(`${jobs.length} Belege gefunden${NO_OCR ? ' (gescannte werden übersprungen)' : ''}\n`);

const reports: FileReport[] = [];
let done = 0;

for (const job of jobs) {
  done++;
  const ext = path.extname(job.file).toLowerCase();
  const stat = fs.statSync(job.file);
  const rel = path.relative(root!, job.file);

  if (NO_OCR && ext !== '.pdf') {
    process.stdout.write(`[${done}/${jobs.length}] übersprungen: ${rel}\n`);
    continue;
  }

  let text = '';
  let source = 'none';
  let warning: string | undefined;
  try {
    const res = await cachedText(job.file);
    text = res.text;
    source = res.source;
    warning = res.warning;
  } catch (err) {
    warning = err instanceof Error ? err.message : String(err);
  }

  const parsed = parseInvoice(text, MEMBERS);
  const decisionFormat = detectDecisionFormat(text);
  const kind: FileReport['kind'] =
    decisionFormat !== 'generisch'
      ? 'bescheid'
      : /rechnung|liquidation|honorarnote|quittung/i.test(text)
        ? 'rechnung'
        : 'unklar';

  reports.push({
    file: rel,
    person: job.person,
    year: job.year,
    ext,
    size: stat.size,
    source,
    warning,
    text_length: text.length,
    kind,
    parsed: {
      doctor: parsed.doctor,
      invoice_number: parsed.invoice_number,
      invoice_date: parsed.invoice_date,
      treatment_date: parsed.treatment_date,
      amount: parsed.amount,
      category: parsed.category,
      member_name: parsed.member_name,
      payment_due_date: parsed.payment_due_date,
      payment_due_source: parsed.payment_due.source,
      payment_due_line: parsed.payment_due.line,
    },
    member_ok: parsed.member_name === null ? null : parsed.member_name === job.person,
    first_lines: text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 6),
  });

  process.stdout.write(
    `[${done}/${jobs.length}] ${source.padEnd(8)} ${String(parsed.amount ?? '–').padStart(9)}  ${rel}\n`,
  );
}

await shutdownOcr();
fs.writeFileSync(OUT, JSON.stringify(reports, null, 1));

/* ---------- Auswertung ---------- */

const invoices = reports.filter((r) => r.kind !== 'bescheid');
const pct = (n: number, total = invoices.length) =>
  total === 0 ? '–' : `${Math.round((n / total) * 100)}%`.padStart(4);

console.log(`\n${'='.repeat(70)}`);
console.log(`${reports.length} Dateien ausgewertet, davon ${invoices.length} als Rechnung eingestuft`);
console.log('='.repeat(70));

const bySource = new Map<string, number>();
for (const r of reports) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
console.log('\nTextgewinnung:');
for (const [s, n] of [...bySource].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${s.padEnd(10)} ${String(n).padStart(4)}  ${pct(n, reports.length)}`);
}

console.log('\nErkennungsquote (nur Rechnungen):');
const found = {
  Rechnungsnummer: invoices.filter((r) => r.parsed.invoice_number).length,
  Rechnungsdatum: invoices.filter((r) => r.parsed.invoice_date).length,
  Behandlungsdatum: invoices.filter((r) => r.parsed.treatment_date).length,
  Betrag: invoices.filter((r) => r.parsed.amount !== null).length,
  Kategorie: invoices.filter((r) => r.parsed.category !== 'Sonstiges').length,
  Patient: invoices.filter((r) => r.parsed.member_name).length,
  Zahlungsfrist: invoices.filter((r) => r.parsed.payment_due_date).length,
};
for (const [label, n] of Object.entries(found)) {
  console.log(`  ${label.padEnd(18)} ${String(n).padStart(4)} von ${invoices.length}  ${pct(n)}`);
}

const withMember = invoices.filter((r) => r.member_ok !== null);
const correct = withMember.filter((r) => r.member_ok).length;
console.log(
  `\nPatient richtig zugeordnet: ${correct} von ${withMember.length} erkannten  ${pct(correct, withMember.length)}`,
);
const wrong = withMember.filter((r) => !r.member_ok);
if (wrong.length) {
  console.log('  falsch zugeordnet:');
  for (const r of wrong.slice(0, 15)) {
    console.log(`    ${r.person} -> ${r.parsed.member_name}   ${r.file}`);
  }
}

const noText = reports.filter((r) => r.text_length < 100);
if (noText.length) {
  console.log(`\nOhne verwertbaren Text (${noText.length}):`);
  for (const r of noText.slice(0, 15)) console.log(`  ${r.source.padEnd(8)} ${r.file} ${r.warning ?? ''}`);
}

console.log(`\nBericht geschrieben: ${OUT}`);
