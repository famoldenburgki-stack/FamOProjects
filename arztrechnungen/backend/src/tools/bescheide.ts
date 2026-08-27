/**
 * Probelauf über einen Ordner voller Bescheide. Es wird nichts geschrieben –
 * das Werkzeug zeigt nur, was die App erkennen und zuordnen würde.
 *
 *   npm run --workspace backend bescheide -- "<Ordner>" --target beihilfe --account Tim
 *   … --limit 5      nur die ersten Dateien
 *   … --json <Datei> Ergebnis zusätzlich als JSON ablegen
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractText, shutdownOcr } from '../ocr/extract.js';
import { parseDecision } from '../ocr/parse.js';
import { simulateDecision } from '../decisionEngine.js';
import { db } from '../db.js';
import type { Target } from '../types.js';

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));

if (!root) {
  console.error('Bitte den Ordner mit den Bescheiden angeben.');
  process.exit(1);
}

const targetArg = (value('target') ?? '').toLowerCase();
const target: Target | null = targetArg === 'dbv' || targetArg === 'beihilfe' ? targetArg : null;
const account = value('account') ?? 'Tim';
const limit = Number(value('limit') ?? Infinity);
const cacheDir = value('cache') ?? '';
const jsonOut = value('json');

const memberNames = (
  db.prepare('SELECT name FROM family_members ORDER BY sort_order').all() as { name: string }[]
).map((r) => r.name);

/* Dateien einsammeln, älteste zuerst – so trifft die Zuordnung auf offene Vorgänge. */
function collect(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(full));
    else if (/\.(pdf|jpe?g|png|tiff?)$/i.test(e.name)) out.push(full);
  }
  return out.sort();
}

async function textOf(file: string): Promise<string> {
  if (cacheDir) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const st = fs.statSync(file);
    const key = crypto
      .createHash('sha1')
      .update(`${file}|${st.size}|${Math.round(st.mtimeMs)}`)
      .digest('hex');
    const cached = path.join(cacheDir, `${key}.json`);
    if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf8')).text;
    const res = await extractText(file);
    fs.writeFileSync(cached, JSON.stringify({ text: res.text }));
    return res.text;
  }
  return (await extractText(file)).text;
}

const files = collect(root).slice(0, limit);
console.log(`${files.length} Bescheide in ${root}\n`);

const berichte: unknown[] = [];
let gesamtErkannt = 0;
let gesamtZugeordnet = 0;
let gesamtUeberschreiben = 0;
const ohneErkennung: string[] = [];

for (const [i, file] of files.entries()) {
  const rel = path.relative(root, file);
  const text = await textOf(file);
  const parsed = await parseDecision(text, memberNames);

  const wirkTarget: Target | null = target ?? parsed.target_hint;
  if (!wirkTarget) {
    console.log(`[${i + 1}/${files.length}] ${rel}\n    Absender nicht erkennbar – übersprungen`);
    ohneErkennung.push(rel);
    continue;
  }

  const sim = simulateDecision(
    wirkTarget,
    account,
    parsed.items,
    parsed.decision_date,
    parsed.total_paid,
    [...(parsed.notes ?? [])],
  );

  gesamtErkannt += sim.summary.detected;
  gesamtZugeordnet += sim.summary.matched;
  gesamtUeberschreiben += sim.summary.would_overwrite;
  if (sim.summary.detected === 0) ohneErkennung.push(rel);

  console.log(
    `[${i + 1}/${files.length}] ${rel}\n` +
      `    ${wirkTarget.toUpperCase()} vom ${sim.decision_date ?? '?'} | ${sim.summary.detected} Positionen, ` +
      `${sim.summary.matched} zuordenbar, ${sim.summary.would_overwrite} bereits beschieden | Summe ${sim.total_paid ?? '?'} €`,
  );
  for (const it of sim.items) {
    const ziel = it.match
      ? `#${it.match.invoice_id} ${it.match.member_name}/${it.match.doctor.slice(0, 18)}${it.match_already_decided ? ' [schon beschieden]' : ''}`
      : it.ambiguous > 0
        ? `mehrdeutig (${it.ambiguous} Kandidaten)`
        : 'keine Rechnung gefunden';
    console.log(
      `       ${String(it.member_name ?? '?').padEnd(8)} ${String(it.invoice_amount ?? '?').padStart(8)} € -> ${String(it.paid_amount ?? '?').padStart(8)} €  ${ziel}`,
    );
  }
  berichte.push({ file: rel, ...sim });
}

console.log('\n' + '='.repeat(70));
console.log(`${gesamtErkannt} Positionen erkannt, ${gesamtZugeordnet} zuordenbar (${
  gesamtErkannt ? Math.round((gesamtZugeordnet / gesamtErkannt) * 100) : 0
} %)`);
console.log(`${gesamtUeberschreiben} Positionen träfen auf bereits beschiedene Einreichungen`);
if (ohneErkennung.length) {
  console.log(`\n${ohneErkennung.length} Dateien ohne erkannte Positionen:`);
  for (const f of ohneErkennung) console.log(`   ${f}`);
}

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify(berichte, null, 1));
  console.log(`\nBericht: ${jsonOut}`);
}

await shutdownOcr();
