import { Router } from 'express';
import fs from 'node:fs';
import { db, getCategories, getSettings, setSetting } from '../db.js';
import { getInvoiceDetail } from '../calc.js';
import { createInvoice, type InvoiceInput } from '../createInvoice.js';
import { createDecision } from '../createDecision.js';
import { resolveStoredPath, checkArchiveRoot } from '../archive.js';
import {
  discardInbox,
  getInboxRow,
  listInbox,
  removeInboxRow,
  scanInboxFolder,
} from '../inbox.js';

export const inboxRouter = Router();

inboxRouter.get('/', (_req, res) => {
  res.json({
    entries: listInbox(),
    folder: (getSettings().inbox_folder ?? '').trim(),
    categories: getCategories(),
    members: db.prepare('SELECT * FROM family_members WHERE active = 1 ORDER BY sort_order').all(),
  });
});

/** Überwachten Ordner jetzt einlesen. */
inboxRouter.post('/scan', async (_req, res) => {
  try {
    const result = await scanInboxFolder();
    res.json({ ...result, entries: listInbox() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Den Überwachungsordner festlegen – geprüft wie der Ablageordner. */
inboxRouter.post('/folder', (req, res) => {
  const { path: dir, create } = req.body as { path?: string; create?: boolean };
  if (!dir?.trim()) {
    setSetting('inbox_folder', '');
    res.json({ path: '', saved: true });
    return;
  }
  const check = checkArchiveRoot(dir, Boolean(create));
  if (!check.exists || !check.writable) {
    res.status(400).json({ error: check.error ?? 'Der Ordner ist nicht beschreibbar.', check });
    return;
  }
  setSetting('inbox_folder', check.path);
  res.json({ ...check, saved: true });
});

inboxRouter.get('/:id/file', (req, res) => {
  const row = getInboxRow(Number(req.params.id));
  if (!row) {
    res.status(404).json({ error: 'Entwurf nicht gefunden.' });
    return;
  }
  const abs = resolveStoredPath(row.file_path);
  if (!fs.existsSync(abs)) {
    res.status(410).json({ error: `Die Datei liegt nicht mehr unter "${row.file_path}".` });
    return;
  }
  if (req.query.download === '1') {
    res.download(abs);
    return;
  }
  res.sendFile(abs);
});

/**
 * Entwurf bestätigen: die – gegebenenfalls korrigierten – Felder werden zur
 * Rechnung. Erst wenn das gelungen ist, verschwindet der Entwurf.
 */
inboxRouter.post('/:id/confirm', (req, res) => {
  const id = Number(req.params.id);
  const row = getInboxRow(id);
  if (!row) {
    res.status(404).json({ error: 'Entwurf nicht gefunden.' });
    return;
  }

  const body = req.body as Partial<InvoiceInput>;
  const result = createInvoice({
    ...(body as InvoiceInput),
    // Datei und erkannter Text kommen immer aus dem Entwurf.
    file_path: row.file_path,
    ocr_text: row.ocr_text,
  });

  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  removeInboxRow(id);
  res.status(201).json({
    ...getInvoiceDetail(result.invoiceId),
    archive_note: result.archiveNote,
    remaining: listInbox().length,
  });
});

/**
 * Bescheid-Entwurf prüfen lassen. Läuft durch dieselbe Verarbeitung wie ein von
 * Hand hochgeladener Bescheid – Absender und Zugang lassen sich vorher noch
 * korrigieren. Erst wenn das gelungen ist, verschwindet der Entwurf.
 */
inboxRouter.post('/:id/pruefen', async (req, res) => {
  const id = Number(req.params.id);
  const row = getInboxRow(id);
  if (!row) {
    res.status(404).json({ error: 'Entwurf nicht gefunden.' });
    return;
  }
  if (row.kind !== 'bescheid') {
    res.status(400).json({ error: 'Dieser Entwurf ist eine Rechnung, kein Bescheid.' });
    return;
  }

  const { target, account } = req.body as { target?: string; account?: string };
  const outcome = await createDecision({
    filePath: row.file_path,
    originalName: row.original_name,
    targetInput: target,
    account,
    // Der Text wurde beim Einlesen schon gewonnen – kein zweiter OCR-Lauf.
    text: row.ocr_text || undefined,
    ocrSource: row.ocr_source,
  });

  if (!outcome.ok) {
    res.status(400).json({
      error: outcome.error,
      needs_choice: outcome.needs_choice ?? false,
      suggestion: outcome.suggestion,
    });
    return;
  }

  removeInboxRow(id);
  res.status(201).json({
    ...outcome.result,
    ocr_source: outcome.ocr_source,
    options: outcome.options,
    detected: outcome.detected,
    remaining: listInbox().length,
  });
});

inboxRouter.delete('/:id', (req, res) => {
  const result = discardInbox(Number(req.params.id));
  if (!result.ok) {
    res.status(404).json({ error: 'Entwurf nicht gefunden.' });
    return;
  }
  res.json({ ...result, remaining: listInbox().length });
});
