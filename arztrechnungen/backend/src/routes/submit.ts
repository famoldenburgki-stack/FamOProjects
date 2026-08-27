/**
 * Einreich-Assistent.
 *
 * Die App reicht nicht selbst ein – die Portale von Beihilfe und DBV verlangen
 * eine Anmeldung durch dich. Sie bereitet aber alles so vor, dass der Vorgang
 * im Portal nur noch aus Anmelden, Dateien hineinziehen und Absenden besteht:
 *
 *   1. je Zugang und Stelle auflisten, was offen ist – einzeln, mit Anzahl und
 *      Gesamtsumme (die Beihilfe fragt beides in ihrer Maske ab),
 *   2. die Belege in einen Sammelordner kopieren und im Explorer öffnen,
 *   3. nach dem Absenden alle Einreichungen auf einmal abhaken.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Router } from 'express';
import { db } from '../db.js';
import { deadlineFor, listInvoices, round2 } from '../calc.js';
import { getArchiveRoot, resolveStoredPath } from '../archive.js';
import { TARGETS, type Target } from '../types.js';

export const submitRouter = Router();

const todayIso = () => new Date().toISOString().slice(0, 10);
const targetLabel = (t: Target) => (t === 'dbv' ? 'DBV' : 'Beihilfe');

export interface SubmitItem {
  submission_id: number;
  invoice_id: number;
  member_name: string;
  doctor: string;
  invoice_number: string;
  invoice_date: string | null;
  amount: number;
  expected_amount: number;
  /** Liegt eine Datei vor, die sich hochladen lässt? */
  has_file: boolean;
  file_name: string | null;
  /** Ausschlussfrist der Einreichung und verbleibende Tage. */
  deadline: string | null;
  paid_to_doctor: boolean;
  /** Rechnung ist schon abgelegt, die Einreichung aber noch offen – eine Ungereimtheit. */
  archived: boolean;
}

export interface SubmitGroup {
  target: Target;
  target_label: string;
  /** Zugang, über den eingereicht wird – dort meldest du dich an. */
  account: string;
  count: number;
  total: number;
  expected_total: number;
  /** Belege ohne hinterlegte Datei – die musst du selbst heraussuchen. */
  without_file: number;
  items: SubmitItem[];
}

/** Alles, was noch offen ist – gruppiert nach Stelle und Zugang. */
export function buildSubmitGroups(): SubmitGroup[] {
  /*
   * Auch abgelegte Rechnungen: eine abgelegte Rechnung mit offener Einreichung ist
   * ein Widerspruch, und genau dort geht sonst still Geld verloren. Sie wird in der
   * Liste als abgelegt gekennzeichnet.
   */
  const invoices = listInvoices({ includeArchived: true });
  const groups = new Map<string, SubmitGroup>();

  for (const inv of invoices) {
    for (const sub of inv.submissions) {
      if (sub.status !== 'offen') continue;

      const key = `${sub.target}|${inv.member_account}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          target: sub.target,
          target_label: targetLabel(sub.target),
          account: inv.member_account,
          count: 0,
          total: 0,
          expected_total: 0,
          without_file: 0,
          items: [],
        };
        groups.set(key, group);
      }

      const datei = inv.file_path ? resolveStoredPath(inv.file_path) : null;
      const vorhanden = Boolean(datei && fs.existsSync(datei));

      group.items.push({
        submission_id: sub.id,
        invoice_id: inv.id,
        member_name: inv.member_name,
        doctor: inv.doctor,
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        amount: inv.amount,
        expected_amount: sub.expected_amount,
        has_file: vorhanden,
        file_name: datei ? path.basename(datei) : null,
        deadline: deadlineFor(sub.target, inv.invoice_date),
        paid_to_doctor: Boolean(inv.paid_to_doctor_date),
        archived: Boolean(inv.archived_at),
      });
      group.count += 1;
      group.total = round2(group.total + inv.amount);
      group.expected_total = round2(group.expected_total + sub.expected_amount);
      if (!vorhanden) group.without_file += 1;
    }
  }

  for (const group of groups.values()) {
    // Älteste zuerst: dort läuft die Frist als Erstes ab.
    group.items.sort((a, b) => (a.invoice_date ?? '').localeCompare(b.invoice_date ?? ''));
  }

  return [...groups.values()].sort(
    (a, b) =>
      TARGETS.indexOf(a.target) - TARGETS.indexOf(b.target) || a.account.localeCompare(b.account),
  );
}

submitRouter.get('/', (_req, res) => {
  res.json({ groups: buildSubmitGroups(), today: todayIso() });
});

/* ------------------------------------------------------------------ */
/*  Sammelordner vorbereiten                                           */
/* ------------------------------------------------------------------ */

/** Windows-tauglicher Dateiname. */
const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

/**
 * Kopiert die gewählten Belege in einen Sammelordner. Bewusst **kopiert**, nicht
 * verschoben: das Archiv bleibt vollständig, auch wenn beim Hochladen etwas
 * schiefgeht. Der Ordner lässt sich nach dem Einreichen einfach löschen.
 */
submitRouter.post('/vorbereiten', (req, res) => {
  const { submission_ids: ids } = req.body as { submission_ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'Keine Einreichungen ausgewählt.' });
    return;
  }

  const root = getArchiveRoot();
  if (!root || !fs.existsSync(root)) {
    res.status(400).json({
      error: root
        ? `Der Ablageordner ist nicht erreichbar: ${root}`
        : 'Es ist noch kein Ablageordner eingerichtet – ohne ihn gibt es keinen Ort für die Sammlung.',
    });
    return;
  }

  const rows = db
    .prepare(
      `SELECT s.id AS submission_id, s.target, i.file_path, i.invoice_date, i.doctor, i.amount,
              m.name AS member_name, m.account
         FROM submissions s
         JOIN invoices i ON i.id = s.invoice_id
         JOIN family_members m ON m.id = i.family_member_id
        WHERE s.id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids) as {
    submission_id: number;
    target: Target;
    file_path: string | null;
    invoice_date: string | null;
    doctor: string;
    amount: number;
    member_name: string;
    account: string;
  }[];

  if (rows.length === 0) {
    res.status(404).json({ error: 'Zu den gewählten Einreichungen wurde nichts gefunden.' });
    return;
  }

  const target = rows[0].target;
  const account = rows[0].account;
  const ordner = path.join(
    root,
    'Einreichungen',
    `${todayIso()} ${targetLabel(target)} ${safe(account)}`,
  );

  let angelegt: string[] = [];
  const fehlend: string[] = [];
  try {
    fs.mkdirSync(ordner, { recursive: true });
  } catch (err) {
    res.status(400).json({
      error: `Der Sammelordner ließ sich nicht anlegen: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  /*
   * Durchnummeriert, damit die Reihenfolge im Portal der Liste in der App
   * entspricht – bei zwanzig Belegen ist das der Unterschied zwischen
   * "abhaken" und "suchen".
   */
  const sortiert = [...rows].sort((a, b) =>
    (a.invoice_date ?? '').localeCompare(b.invoice_date ?? ''),
  );

  let nr = 0;
  for (const row of sortiert) {
    nr += 1;
    const quelle = row.file_path ? resolveStoredPath(row.file_path) : null;
    if (!quelle || !fs.existsSync(quelle)) {
      fehlend.push(`${row.member_name} · ${row.doctor} · ${row.amount.toFixed(2)} €`);
      continue;
    }
    const name = `${String(nr).padStart(2, '0')} ${safe(
      `${row.invoice_date ?? 'ohne Datum'} ${row.member_name} ${row.doctor} ${row.amount
        .toFixed(2)
        .replace('.', ',')} EUR`,
    )}${path.extname(quelle).toLowerCase() || '.pdf'}`;
    const ziel = path.join(ordner, name);
    try {
      fs.copyFileSync(quelle, ziel);
      angelegt.push(name);
    } catch (err) {
      fehlend.push(`${row.member_name} · ${row.doctor} (${err instanceof Error ? err.message : ''})`);
    }
  }

  // Merkzettel für die Beihilfe-Maske: sie fragt Anzahl und Gesamtbetrag ab.
  const summe = sortiert.reduce((s, r) => s + r.amount, 0);
  const zettel = [
    `Einreichung ${targetLabel(target)} – Zugang ${account}`,
    `Erstellt am ${todayIso().split('-').reverse().join('.')}`,
    '',
    `Anzahl Belege: ${angelegt.length}`,
    `Gesamtbetrag:  ${summe.toFixed(2).replace('.', ',')} EUR`,
    '',
    ...sortiert.map(
      (r, i) =>
        `${String(i + 1).padStart(2, '0')}  ${(r.invoice_date ?? 'ohne Datum')
          .split('-')
          .reverse()
          .join('.')}  ${r.member_name}  ${r.doctor}  ${r.amount.toFixed(2).replace('.', ',')} EUR`,
    ),
    ...(fehlend.length
      ? ['', 'Ohne hinterlegte Datei (bitte selbst beilegen):', ...fehlend.map((f) => `  - ${f}`)]
      : []),
  ].join('\r\n');
  try {
    fs.writeFileSync(path.join(ordner, '00 Übersicht.txt'), zettel, 'utf8');
  } catch {
    // Der Merkzettel ist Beiwerk – ohne ihn ist die Sammlung trotzdem brauchbar.
  }

  if (process.platform === 'win32') {
    const proc = spawn('explorer.exe', [ordner], { detached: true, stdio: 'ignore' });
    proc.unref();
  }

  res.json({
    folder: ordner,
    copied: angelegt.length,
    missing: fehlend,
    total: round2(summe),
  });
});

/* ------------------------------------------------------------------ */
/*  Nach dem Absenden abhaken                                          */
/* ------------------------------------------------------------------ */

submitRouter.post('/erledigt', (req, res) => {
  const { submission_ids: ids, date } = req.body as { submission_ids?: number[]; date?: string };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'Keine Einreichungen ausgewählt.' });
    return;
  }
  const tag = (date || todayIso()).slice(0, 10);

  const stmt = db.prepare(
    `UPDATE submissions
        SET status = 'eingereicht', submitted_date = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'offen'`,
  );
  const geaendert = db.transaction(() => {
    let n = 0;
    for (const id of ids) n += Number(stmt.run(tag, id).changes);
    return n;
  });

  res.json({ marked: geaendert, date: tag, groups: buildSubmitGroups() });
});
