/**
 * Liest den überwachten Ordner ein.
 *
 * Dieses Werkzeug startet Windows beim Anmelden (siehe README). Es legt weder
 * Rechnungen noch geprüfte Bescheide an, sondern nur Entwürfe – bestätigt wird
 * in der App.
 *
 *   npm run --workspace backend eingang
 *   … --ordner "C:\Pfad"   einmalig einen anderen Ordner lesen
 */
import { scanInboxFolder, listInbox } from '../inbox.js';
import { shutdownOcr } from '../ocr/extract.js';
import { db } from '../db.js';

const args = process.argv.slice(2);
const value = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const eur = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${n.toFixed(2).replace('.', ',')} €`;

const ergebnis = await scanInboxFolder(value('ordner'));

if (!ergebnis.folder) {
  console.log('Kein Überwachungsordner eingerichtet – nichts zu tun.');
  console.log('Einzurichten in der App unter Einstellungen → Rechnungseingang.');
  await shutdownOcr();
  db.close();
  process.exit(0);
}

const neueBescheide = ergebnis.added.filter((e) => e.kind === 'bescheid');
const neueRechnungen = ergebnis.added.filter((e) => e.kind !== 'bescheid');

console.log(`Ordner: ${ergebnis.folder}`);
console.log(
  `${ergebnis.added.length} neue Dokumente eingelesen ` +
    `(${neueRechnungen.length} Rechnungen, ${neueBescheide.length} Bescheide), ` +
    `${ergebnis.skipped.length} übersprungen`,
);
for (const s of ergebnis.skipped) console.log(`   ${s.file}: ${s.reason}`);

for (const e of neueRechnungen) {
  const s = e.suggestion;
  console.log(
    `   ${e.original_name}\n      ${s.member_name ?? 'Patient offen'} · ${s.doctor || 'Arzt offen'} · ` +
      `${eur(s.amount)} · ${s.invoice_date ?? 'Datum offen'}` +
      (e.incomplete ? `  [es fehlt: ${e.missing.join(', ')}]` : ''),
  );
}

for (const e of neueBescheide) {
  const d = e.decision;
  console.log(
    `   ${e.original_name}  [BESCHEID]\n      ` +
      `${d?.target ? d.target.toUpperCase() : 'Absender offen'} · Zugang ${d?.account ?? '?'} · ` +
      `${d?.item_count ?? 0} Positionen · Erstattung ${eur(d?.total_paid)} · ` +
      `${d?.decision_date ?? 'Datum offen'}`,
  );
}

const offen = listInbox();
console.log(`\nInsgesamt ${offen.length} Entwürfe warten auf Bestätigung.`);
if (offen.length > 0) console.log('Zum Prüfen die App öffnen: http://localhost:4000/eingang');

await shutdownOcr();
db.close();
