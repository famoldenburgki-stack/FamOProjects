/**
 * Übernimmt vorhandene Bescheide in die App, ohne die Rechnungsdaten zu ändern.
 *
 * Die Dateien bleiben, wo sie sind – sie liegen bereits sortiert in den Ordnern
 * des Nutzers. Die App merkt sich nur den Pfad, erfasst die erkannten Positionen
 * und ordnet sie den Rechnungen zu. Status und Beträge der Einreichungen bleiben
 * unverändert; abweichende Beträge werden am Ende aufgelistet.
 *
 *   npm run --workspace backend bescheide-uebernehmen -- "<Ordner>" --target beihilfe --account Tim
 *   … --dry            nichts schreiben, nur zeigen
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractText, shutdownOcr } from '../ocr/extract.js';
import { parseDecision } from '../ocr/parse.js';
import { processDecision } from '../decisionEngine.js';
import { db } from '../db.js';
import type { Target } from '../types.js';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const value = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

if (!root) {
  console.error('Bitte den Ordner mit den Bescheiden angeben.');
  process.exit(1);
}

const targetArg = (value('target') ?? '').toLowerCase();
const vorgabe: Target | null = targetArg === 'dbv' || targetArg === 'beihilfe' ? targetArg : null;
const account = value('account') ?? 'Tim';
const cacheDir = value('cache') ?? '';
const nurZeigen = flag('dry');

const memberNames = (
  db.prepare('SELECT name FROM family_members ORDER BY sort_order').all() as { name: string }[]
).map((r) => r.name);

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
  if (!cacheDir) return (await extractText(file)).text;
  fs.mkdirSync(cacheDir, { recursive: true });
  const st = fs.statSync(file);
  const key = crypto.createHash('sha1').update(`${file}|${st.size}|${Math.round(st.mtimeMs)}`).digest('hex');
  const cached = path.join(cacheDir, `${key}.json`);
  if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf8')).text;
  const res = await extractText(file);
  fs.writeFileSync(cached, JSON.stringify({ text: res.text }));
  return res.text;
}

/*
 * Schon vorhandene Bescheide nicht doppelt erfassen. Der Pfad allein genügt nicht:
 * derselbe Bescheid kann bereits über die App hochgeladen worden sein und liegt dann
 * unter einem anderen Namen im Ablageordner. Deshalb zusätzlich Absender,
 * Bescheiddatum und Erstattungssumme als Kennzeichen.
 */
const vorhandenePfade = new Set(
  (db.prepare('SELECT file_path FROM decisions').all() as { file_path: string | null }[])
    .map((r) => (r.file_path ?? '').toLowerCase())
    .filter(Boolean),
);

const inhaltsSchluessel = (t: string, datum: string | null, summe: number | null) =>
  `${t}|${datum ?? '?'}|${summe === null ? '?' : summe.toFixed(2)}`;

const vorhandeneInhalte = new Set(
  (
    db.prepare('SELECT target, decision_date, total_paid FROM decisions').all() as {
      target: string;
      decision_date: string | null;
      total_paid: number | null;
    }[]
  )
    .filter((r) => r.decision_date)
    .map((r) => inhaltsSchluessel(r.target, r.decision_date, r.total_paid)),
);

const files = collect(root);
console.log(`${files.length} Dateien in ${root}${nurZeigen ? '  (Probelauf)' : ''}\n`);

interface Abweichung {
  datei: string;
  invoiceId: number;
  member: string;
  doctor: string;
  imBescheid: number;
  inDerApp: number | null;
}

const abweichungen: Abweichung[] = [];
let erfasst = 0;
let uebersprungen = 0;
let ohnePositionen = 0;

for (const [i, file] of files.entries()) {
  const rel = path.relative(root, file);
  if (vorhandenePfade.has(file.toLowerCase())) {
    uebersprungen++;
    continue;
  }

  const text = await textOf(file);
  const parsed = await parseDecision(text, memberNames);
  const target = vorgabe ?? parsed.target_hint;

  if (target && parsed.decision_date) {
    const schluessel = inhaltsSchluessel(target, parsed.decision_date, parsed.total_paid);
    if (vorhandeneInhalte.has(schluessel)) {
      uebersprungen++;
      console.log(`[${i + 1}/${files.length}] ${rel}\n    schon erfasst (${target}, ${parsed.decision_date}) – übersprungen`);
      continue;
    }
    vorhandeneInhalte.add(schluessel);
  }

  if (!target || parsed.items.length === 0) {
    ohnePositionen++;
    console.log(`[${i + 1}/${files.length}] ${rel}\n    keine Bescheidpositionen erkannt – nicht erfasst`);
    continue;
  }

  if (nurZeigen) {
    console.log(`[${i + 1}/${files.length}] ${rel} -> ${target}, ${parsed.items.length} Positionen`);
    erfasst++;
    continue;
  }

  const result = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO decisions (target, account, decision_date, file_path, ocr_text, total_paid)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      // Der Pfad zeigt auf die Originaldatei; verschoben wird nichts.
      .run(target, account, parsed.decision_date, file, text.slice(0, 200_000), parsed.total_paid);

    return processDecision(
      Number(info.lastInsertRowid),
      target,
      account,
      parsed.items,
      parsed.decision_date,
      parsed.total_paid,
      [],
      { apply: false },
    );
  });

  erfasst++;
  for (const p of result.items) {
    if (!p.match || p.item.paid_amount === null) continue;
    const s = db
      .prepare('SELECT paid_amount FROM submissions WHERE id = ?')
      .get(p.match.submission_id) as { paid_amount: number | null } | undefined;
    const inApp = s?.paid_amount ?? null;
    if (inApp === null || Math.abs(inApp - p.item.paid_amount) > 0.01) {
      abweichungen.push({
        datei: rel,
        invoiceId: p.match.invoice_id,
        member: p.match.member_name,
        doctor: p.match.doctor,
        imBescheid: p.item.paid_amount,
        inDerApp: inApp,
      });
    }
  }
  console.log(
    `[${i + 1}/${files.length}] ${rel}\n    ${target.toUpperCase()} vom ${parsed.decision_date ?? '?'} | ` +
      `${result.summary.detected} Positionen, ${result.summary.detected - result.summary.unmatched} zugeordnet`,
  );
}

console.log('\n' + '='.repeat(72));
console.log(`${erfasst} Bescheide erfasst, ${uebersprungen} schon vorhanden, ${ohnePositionen} ohne Positionen`);

if (abweichungen.length) {
  console.log(`\n${abweichungen.length} Positionen weichen von den Werten in der App ab:`);
  for (const a of abweichungen) {
    console.log(
      `   Rechnung #${a.invoiceId} ${a.member}/${a.doctor.slice(0, 20)}: ` +
        `Bescheid ${a.imBescheid.toFixed(2)} € | App ${a.inDerApp === null ? 'nichts hinterlegt' : a.inDerApp.toFixed(2) + ' €'}` +
        `\n      ${a.datei}`,
    );
  }
} else {
  console.log('\nKeine Abweichungen: die Bescheide bestätigen die Werte aus deiner Tabelle.');
}

await shutdownOcr();
