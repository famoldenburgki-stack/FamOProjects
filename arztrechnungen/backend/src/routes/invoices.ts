import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, getCategories } from '../db.js';
import { getInvoiceDetail, listInvoices, round2 } from '../calc.js';
import { extractText } from '../ocr/extract.js';
import { parseInvoice } from '../ocr/parse.js';
import { detectDecisionFormat } from '../ocr/decisionFormats.js';
import { applyPattern, findPattern, learnFromInvoice, patternSummary } from '../patterns.js';
import { archiveFile, getArchiveRoot, reArchiveFile, resolveStoredPath } from '../archive.js';
import { invoiceUpload, relativeUploadPath } from '../upload.js';
import { BACKEND_ROOT } from '../paths.js';
import { evaluate, applyToSubmission } from '../decisionEngine.js';
import { type FamilyMember, type SubmissionRow, type Target } from '../types.js';
import { createInvoice, type InvoiceInput } from '../createInvoice.js';

export const invoicesRouter = Router();

const todayIso = () => new Date().toISOString().slice(0, 10);

/* ---------- Analyse eines Uploads (noch ohne Speichern) ---------- */

invoicesRouter.post('/analyze', invoiceUpload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Keine Datei empfangen.' });
    return;
  }
  const members = db
    .prepare('SELECT * FROM family_members WHERE active = 1 ORDER BY sort_order')
    .all() as FamilyMember[];

  const { text, source, warning } = await extractText(req.file.path);
  const suggestion = parseInvoice(text, members.map((m) => m.name), getCategories());

  /*
   * Kennt die App den Aussteller bereits, füllt sein gelerntes Muster die
   * Felder, die die allgemeinen Regeln offen lassen.
   */
  const pattern = findPattern(text, suggestion.doctor);
  let patternInfo: ReturnType<typeof patternSummary> | null = null;
  let patternFields: string[] = [];
  if (pattern) {
    const applied = applyPattern(pattern, text, {
      invoice_number: suggestion.invoice_number,
      amount: suggestion.amount,
      invoice_date: suggestion.invoice_date,
      treatment_date: suggestion.treatment_date,
      category: suggestion.category,
    });
    if (applied.values.invoice_number !== undefined) {
      suggestion.invoice_number = String(applied.values.invoice_number);
    }
    if (applied.values.amount !== undefined) suggestion.amount = Number(applied.values.amount);
    if (applied.values.invoice_date !== undefined) {
      suggestion.invoice_date = String(applied.values.invoice_date);
    }
    if (applied.values.treatment_date !== undefined) {
      suggestion.treatment_date = String(applied.values.treatment_date);
    }
    if (applied.category) suggestion.category = applied.category;
    // Der zuletzt bestätigte Name ist sauberer als eine frische Texterkennung.
    if (pattern.display_name) suggestion.doctor = pattern.display_name;

    patternFields = applied.fields;
    patternInfo = patternSummary(pattern);
  }

  const member = suggestion.member_name
    ? members.find((m) => m.name === suggestion.member_name)
    : undefined;

  /*
   * In den Belegordnern liegen Rechnungen, Bescheide und Schriftwechsel bunt
   * gemischt. Wird hier ein Bescheid hochgeladen, käme sonst eine sinnlose
   * "Rechnung" heraus – deshalb der Hinweis auf den richtigen Weg.
   */
  const hints: string[] = [];
  const format = detectDecisionFormat(text);
  if (format !== 'generisch') {
    hints.push(
      `Das sieht nach einem Bescheid ${format === 'dbv' ? 'der DBV' : 'der Beihilfe'} aus, nicht nach einer Arztrechnung. Für Bescheide gibt es die Seite "Bescheid prüfen" – dort werden die Erstattungen automatisch den Rechnungen zugeordnet.`,
    );
  }
  if (text.trim().length < 120) {
    hints.push(
      'Aus dem Dokument ließ sich kaum Text gewinnen. Bitte alle Felder selbst ausfüllen – bei Fotos hilft eine gerade, gut ausgeleuchtete Aufnahme.',
    );
  }
  /*
   * Bei Kinderrechnungen stehen regelmäßig zwei Namen auf dem Beleg: der Elternteil
   * als Rechnungsempfänger und das Kind als Patient. Nennt der Beleg den Patienten
   * ausdrücklich, ist das eindeutig – nur ohne diese Beschriftung wird gewarnt.
   */
  if (suggestion.member_candidates.length > 1 && !suggestion.member_from_label) {
    hints.push(
      `Im Dokument kommen mehrere Familienmitglieder vor (${suggestion.member_candidates.join(', ')}). Falls der Scan mehrere Rechnungen enthält, bitte je Rechnung einzeln erfassen.`,
    );
  } else if (!suggestion.member_name) {
    hints.push('Der Patient war nicht eindeutig erkennbar – bitte selbst auswählen.');
  }
  if (suggestion.treatment_date && !suggestion.confidence.treatment_date) {
    hints.push(
      'Das Behandlungsdatum ist geschätzt (frühestes Datum der Leistungsaufstellung) – bitte gegenprüfen.',
    );
  }
  /*
   * Zahlungsfrist. Eine Tagesfrist ist auf das Rechnungsdatum gerechnet – stimmt
   * das Rechnungsdatum nicht, stimmt auch die Frist nicht.
   */
  if (suggestion.payment_due.source === 'frist' && suggestion.payment_due.days !== null) {
    hints.push(
      suggestion.payment_due_date
        ? `Zahlbar innerhalb von ${suggestion.payment_due.days} Tagen – gerechnet ab Rechnungsdatum ergibt das den ${suggestion.payment_due_date.split('-').reverse().join('.')}.`
        : `Auf dem Beleg steht eine Zahlungsfrist von ${suggestion.payment_due.days} Tagen, aber kein Rechnungsdatum – bitte das Fälligkeitsdatum selbst eintragen.`,
    );
  }
  if (suggestion.amount !== null && suggestion.amount_source !== 'endsumme') {
    hints.push(
      suggestion.amount_source === 'summenzeile'
        ? `Der Betrag stammt aus einer Zeile mit „${suggestion.amount_label}" – auf dem Beleg war keine ausdrücklich bezeichnete Endsumme zu finden. Bitte gegenprüfen.`
        : 'Der Betrag ist der höchste auf dem Beleg gefundene – eine bezeichnete Endsumme wurde nicht erkannt. Bitte gegenprüfen.',
    );
  }
  if (suggestion.amount === null) {
    /*
     * In den Belegordnern liegen viele Rezepte und Arztberichte. Sie tragen keinen
     * Betrag und sind für sich genommen keine Rechnung – der Betrag steht auf der
     * Apothekenquittung, die dazugehört.
     */
    // Der Dateiname zählt mit: bei schlecht lesbaren Scans ist er oft der
    // einzige Hinweis darauf, worum es sich handelt.
    const wieRezept = /(rezept|verordnung|apotheken-?nummer|bezugsdatum|igel-leistung|arztbericht|befund)/i.test(
      `${text}\n${req.file.originalname}`,
    );
    hints.push(
      wieRezept
        ? 'Kein Betrag gefunden – das Dokument sieht nach einem Rezept oder Bericht aus. Rezepte gehören zur Quittung der Apotheke; erfasse am besten diese als Rechnung und lege das Rezept bei.'
        : 'Es wurde kein Rechnungsbetrag gefunden – bitte selbst eintragen.',
    );
  }

  res.json({
    file_path: relativeUploadPath(req.file.path),
    original_name: req.file.originalname,
    ocr_source: source,
    ocr_warning: warning ?? null,
    ocr_text: text.slice(0, 20_000),
    document_kind: format !== 'generisch' ? 'bescheid' : 'rechnung',
    hints,
    pattern: patternInfo,
    pattern_fields: patternFields,
    suggestion: { ...suggestion, family_member_id: member?.id ?? null },
    categories: getCategories(),
  });
});

/* ---------- Rechnung anlegen ---------- */

invoicesRouter.post('/', (req, res) => {
  const result = createInvoice(req.body as InvoiceInput);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.status(201).json({ ...getInvoiceDetail(result.invoiceId), archive_note: result.archiveNote });
});

/* ---------- Liste & Detail ---------- */

invoicesRouter.get('/', (req, res) => {
  const q = req.query;
  res.json(
    listInvoices({
      year: q.year ? Number(q.year) : undefined,
      memberId: q.member ? Number(q.member) : undefined,
      status: (q.status as never) || undefined,
      target: (q.target as Target) || undefined,
      targetStatus: (q.target_status as never) || undefined,
      search: (q.search as string) || undefined,
      includeArchived: q.archived === '1',
    }),
  );
});

invoicesRouter.get('/years', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT DISTINCT strftime('%Y', COALESCE(invoice_date, created_at)) AS year
       FROM invoices ORDER BY year DESC`,
    )
    .all() as { year: string }[];
  res.json(rows.map((r) => Number(r.year)).filter((y) => Number.isFinite(y)));
});

invoicesRouter.get('/:id', (req, res) => {
  const detail = getInvoiceDetail(Number(req.params.id));
  if (!detail) {
    res.status(404).json({ error: 'Rechnung nicht gefunden.' });
    return;
  }
  const items = db
    .prepare(
      `SELECT di.*, d.target, d.decision_date AS d_date, d.file_path AS decision_file
       FROM decision_items di
       JOIN decisions d ON d.id = di.decision_id
       WHERE di.matched_submission_id IN (SELECT id FROM submissions WHERE invoice_id = ?)`,
    )
    .all(detail.id);
  res.json({ ...detail, decision_items: items });
});

/* ---------- Rechnung ändern / löschen / ablegen ---------- */

const EDITABLE = [
  'family_member_id', 'doctor', 'invoice_number', 'invoice_date', 'treatment_date',
  'amount', 'category', 'paid_to_doctor_date', 'payment_due_date', 'note',
] as const;

/*
 * Nur Datumsfelder dürfen leer bleiben. Textspalten sind in der Datenbank als
 * NOT NULL angelegt – ein geleertes Feld muss dort als leerer Text landen,
 * sonst bricht das Speichern ab ("NOT NULL constraint failed").
 */
const NULLABLE = new Set([
  'invoice_date',
  'treatment_date',
  'paid_to_doctor_date',
  'payment_due_date',
]);

invoicesRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of EDITABLE) {
    if (!(key in body)) continue;
    let value = body[key];
    if (key === 'amount') value = round2(Number(value));
    if (value === '' || value === null || value === undefined) {
      if (key === 'amount') value = 0;
      else if (NULLABLE.has(key)) value = null;
      else if (key === 'family_member_id') continue; // ohne Patient gibt es keine Rechnung
      else value = '';
    }
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (sets.length === 0) {
    res.status(400).json({ error: 'Keine Änderungen übergeben.' });
    return;
  }
  params.push(id);
  db.prepare(`UPDATE invoices SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  /*
   * Der Dateiname in der Ablage enthält Datum, Arzt und Betrag – ändert sich
   * eines davon, wird die abgelegte Datei entsprechend umbenannt.
   */
  const updated = getInvoiceDetail(id);
  if (updated?.file_path && path.isAbsolute(updated.file_path)) {
    const m = db.prepare('SELECT * FROM family_members WHERE id = ?').get(updated.family_member_id) as
      | FamilyMember
      | undefined;
    if (m) {
      const moved = reArchiveFile(updated.file_path, {
        member: m.name,
        memberOrder: m.sort_order,
        invoiceDate: updated.invoice_date,
        doctor: updated.doctor,
        amount: updated.amount,
        extension: path.extname(updated.file_path).toLowerCase() || '.pdf',
      });
      if (moved.archived && moved.path !== updated.file_path) {
        db.prepare('UPDATE invoices SET file_path = ? WHERE id = ?').run(moved.path, id);
      }
    }
  }

  res.json(getInvoiceDetail(id));
});

/**
 * Zahlung an den Arzt bestätigen – ohne Datum wird der heutige Tag gesetzt.
 * `null` nimmt die Bestätigung zurück.
 */
invoicesRouter.post('/:id/paid', (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as { date?: string | null };
  const datum = body.date === null ? null : (body.date || todayIso());

  const vorhanden = db.prepare('SELECT id FROM invoices WHERE id = ?').get(id);
  if (!vorhanden) {
    res.status(404).json({ error: 'Rechnung nicht gefunden.' });
    return;
  }
  db.prepare('UPDATE invoices SET paid_to_doctor_date = ? WHERE id = ?').run(datum, id);
  res.json(getInvoiceDetail(id));
});

/**
 * Mehrere Rechnungen auf einmal ablegen oder zurückholen. Ohne das wären es bei
 * einem gewachsenen Bestand dutzende Einzelklicks.
 */
invoicesRouter.post('/archive-many', (req, res) => {
  const body = req.body as { ids?: unknown; archived?: boolean };
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger) : [];
  if (ids.length === 0) {
    res.status(400).json({ error: 'Keine Rechnungen übergeben.' });
    return;
  }
  const datum = body.archived === false ? null : todayIso();

  const stmt = db.prepare('UPDATE invoices SET archived_at = ? WHERE id = ?');
  const changed = db.transaction(() =>
    ids.reduce((n, id) => n + Number(stmt.run(datum, id).changes), 0),
  );
  res.json({ changed, archived: datum !== null });
});

invoicesRouter.post('/:id/archive', (req, res) => {
  const id = Number(req.params.id);
  const archive = req.body?.archived !== false;
  db.prepare('UPDATE invoices SET archived_at = ? WHERE id = ?').run(
    archive ? todayIso() : null,
    id,
  );
  res.json(getInvoiceDetail(id));
});

invoicesRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT file_path FROM invoices WHERE id = ?').get(id) as
    | { file_path: string | null }
    | undefined;
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id);

  /*
   * Nur Dateien aus dem App-Ordner werden mitgelöscht. Was einmal in der Ablage
   * des Nutzers liegt, bleibt dort – das ist sein Aktenordner, nicht unserer.
   */
  const kept = Boolean(row?.file_path && path.isAbsolute(row.file_path));
  if (row?.file_path && !kept) {
    fs.promises.unlink(resolveStoredPath(row.file_path)).catch(() => undefined);
  }
  res.json({ ok: true, file_kept: kept ? row!.file_path : null });
});

/* ---------- Datei einer Rechnung ausliefern ---------- */

invoicesRouter.get('/:id/file', (req, res) => {
  const row = db.prepare('SELECT file_path FROM invoices WHERE id = ?').get(Number(req.params.id)) as
    | { file_path: string | null }
    | undefined;
  if (!row?.file_path) {
    res.status(404).json({ error: 'Zu dieser Rechnung ist keine Datei gespeichert.' });
    return;
  }
  const abs = resolveStoredPath(row.file_path);
  if (!fs.existsSync(abs)) {
    res.status(410).json({
      error: `Die Datei liegt nicht mehr unter "${row.file_path}". Ist der Ablageordner erreichbar?`,
    });
    return;
  }
  // Zum Anzeigen im Browser, nicht als Download – erst beim Klick auf Herunterladen.
  if (req.query.download === '1') {
    res.download(abs);
    return;
  }
  res.sendFile(abs);
});

/* ---------- Einreichungen ---------- */

export const submissionsRouter = Router();

submissionsRouter.post('/:id/submit', (req, res) => {
  const id = Number(req.params.id);
  const date = (req.body?.date as string) || todayIso();
  db.prepare(
    `UPDATE submissions SET status = 'eingereicht', submitted_date = ?, updated_at = datetime('now')
     WHERE id = ? AND status IN ('offen','eingereicht')`,
  ).run(date, id);
  res.json(reloadInvoiceOf(id));
});

submissionsRouter.post('/:id/reset', (req, res) => {
  const id = Number(req.params.id);
  db.prepare(
    `UPDATE submissions
        SET status = 'offen', submitted_date = NULL, decision_date = NULL, paid_amount = NULL,
            rejection_reason = '', action_note = '', decision_id = NULL, updated_at = datetime('now')
      WHERE id = ?`,
  ).run(id);
  res.json(reloadInvoiceOf(id));
});

/** Bescheid-Ergebnis manuell eintragen bzw. korrigieren. */
submissionsRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id) as
    | SubmissionRow
    | undefined;
  if (!sub) {
    res.status(404).json({ error: 'Einreichung nicht gefunden.' });
    return;
  }
  const body = req.body as {
    status?: string;
    submitted_date?: string | null;
    decision_date?: string | null;
    paid_amount?: number | null;
    rejection_reason?: string;
    action_note?: string;
    recalculate?: boolean;
  };

  let status = body.status ?? sub.status;
  const paid = body.paid_amount === undefined ? sub.paid_amount : body.paid_amount;

  // Auf Wunsch den Status aus dem eingetragenen Betrag ableiten
  if (body.recalculate && paid !== null) {
    const info = db
      .prepare(
        `SELECT i.amount, m.beihilfe_rate FROM submissions s
         JOIN invoices i ON i.id = s.invoice_id
         JOIN family_members m ON m.id = i.family_member_id WHERE s.id = ?`,
      )
      .get(id) as { amount: number; beihilfe_rate: number };
    status = evaluate(sub.target, info.amount, info.beihilfe_rate, paid, body.rejection_reason ?? '')
      .status;
  }

  db.prepare(
    `UPDATE submissions
        SET status = ?, submitted_date = ?, decision_date = ?, paid_amount = ?,
            rejection_reason = ?, action_note = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).run(
    status,
    body.submitted_date === undefined ? sub.submitted_date : body.submitted_date || null,
    body.decision_date === undefined ? sub.decision_date : body.decision_date || null,
    paid === null ? null : round2(Number(paid)),
    body.rejection_reason ?? sub.rejection_reason,
    body.action_note ?? sub.action_note,
    id,
  );
  res.json(reloadInvoiceOf(id));
});

/** Kurzweg: Eigenanteil akzeptieren – schließt den Vorgang ab. */
submissionsRouter.post('/:id/accept', (req, res) => {
  const id = Number(req.params.id);
  const note = (req.body?.note as string) || 'Eigenanteil akzeptiert';
  db.prepare(
    `UPDATE submissions SET action_note = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(note, id);
  res.json(reloadInvoiceOf(id));
});

function reloadInvoiceOf(submissionId: number) {
  const row = db.prepare('SELECT invoice_id FROM submissions WHERE id = ?').get(submissionId) as
    | { invoice_id: number }
    | undefined;
  return row ? getInvoiceDetail(row.invoice_id) : null;
}

export { applyToSubmission };
