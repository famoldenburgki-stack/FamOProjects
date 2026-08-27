import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { resolveStoredPath } from '../archive.js';
import { decisionUpload, relativeUploadPath } from '../upload.js';
import { createDecision } from '../createDecision.js';
import { assignItemManually, openSubmissionsFor, type ProcessResult } from '../decisionEngine.js';
import { getInvoiceDetail } from '../calc.js';
import type { DecisionItemRow, Target } from '../types.js';

export const decisionsRouter = Router();

/**
 * Bescheid hochladen: Text auslesen, Positionen erkennen, den Einreichungen
 * zuordnen, Beträge gegen die erwartete Erstattung prüfen und das Ergebnis
 * direkt speichern.
 */
decisionsRouter.post('/upload', decisionUpload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Keine Datei empfangen.' });
    return;
  }

  const outcome = await createDecision({
    filePath: relativeUploadPath(req.file.path),
    originalName: req.file.originalname,
    targetInput: String(req.body?.target ?? ''),
    account: String(req.body?.account ?? ''),
  });

  if (!outcome.ok) {
    // needs_choice sagt der Oberfläche: jetzt – und nur jetzt – nachfragen.
    res.status(400).json({
      error: outcome.error,
      needs_choice: outcome.needs_choice ?? false,
      suggestion: outcome.suggestion,
    });
    return;
  }
  res.status(201).json({
    ...outcome.result,
    ocr_source: outcome.ocr_source,
    options: outcome.options,
    detected: outcome.detected,
  });
});

/* ---------- Bescheid-Übersicht ---------- */

decisionsRouter.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT d.*, COUNT(di.id) AS item_count,
              SUM(CASE WHEN di.matched_submission_id IS NULL THEN 1 ELSE 0 END) AS unmatched_count
       FROM decisions d LEFT JOIN decision_items di ON di.decision_id = d.id
       GROUP BY d.id ORDER BY COALESCE(d.decision_date, d.created_at) DESC, d.id DESC`,
    )
    .all() as Record<string, unknown>[];
  res.json(rows.map((r) => ({ ...r, ocr_text: undefined })));
});

decisionsRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const decision = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as
    | { id: number; target: Target; account: string; decision_date: string | null; total_paid: number | null }
    | undefined;
  if (!decision) {
    res.status(404).json({ error: 'Bescheid nicht gefunden.' });
    return;
  }
  const items = db
    .prepare(
      `SELECT di.*, i.id AS invoice_id, i.invoice_number AS matched_invoice_number,
              i.invoice_date AS matched_invoice_date, i.amount AS matched_amount,
              i.doctor AS matched_doctor, m.name AS matched_member
       FROM decision_items di
       LEFT JOIN submissions s ON s.id = di.matched_submission_id
       LEFT JOIN invoices i ON i.id = s.invoice_id
       LEFT JOIN family_members m ON m.id = i.family_member_id
       WHERE di.decision_id = ? ORDER BY di.id`,
    )
    .all(id);
  res.json({
    ...decision,
    items,
    options: openSubmissionsFor(decision.target, decision.account),
  });
});

decisionsRouter.get('/:id/file', (req, res) => {
  const row = db.prepare('SELECT file_path FROM decisions WHERE id = ?').get(Number(req.params.id)) as
    | { file_path: string | null }
    | undefined;
  if (!row?.file_path) {
    res.status(404).json({ error: 'Zu diesem Bescheid ist keine Datei gespeichert.' });
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

/* ---------- Manuelle Zuordnung einer Position ---------- */

decisionsRouter.post('/items/:itemId/assign', (req, res) => {
  const submissionId = Number(req.body?.submission_id);
  if (!Number.isFinite(submissionId)) {
    res.status(400).json({ error: 'Bitte eine Einreichung auswählen.' });
    return;
  }
  try {
    const processed = assignItemManually(Number(req.params.itemId), submissionId);
    res.json({
      ...processed,
      invoice: processed.match ? getInvoiceDetail(processed.match.invoice_id) : null,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Position bewusst ignorieren (z.B. betrifft eine noch nicht erfasste Rechnung). */
decisionsRouter.post('/items/:itemId/ignore', (req, res) => {
  db.prepare(
    `UPDATE decision_items SET match_kind = 'unmatched', matched_submission_id = NULL, applied = 0 WHERE id = ?`,
  ).run(Number(req.params.itemId));
  res.json(
    db.prepare('SELECT * FROM decision_items WHERE id = ?').get(Number(req.params.itemId)) as DecisionItemRow,
  );
});

decisionsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT file_path FROM decisions WHERE id = ?').get(id) as
    | { file_path: string | null }
    | undefined;
  db.prepare('DELETE FROM decisions WHERE id = ?').run(id);

  // Wie bei den Rechnungen: was in der Ablage liegt, bleibt dort.
  const behalten = Boolean(row?.file_path && path.isAbsolute(row.file_path));
  if (row?.file_path && !behalten) {
    fs.promises.unlink(resolveStoredPath(row.file_path)).catch(() => undefined);
  }
  res.json({ ok: true, file_kept: behalten ? row!.file_path : null });
});

export type { ProcessResult };
