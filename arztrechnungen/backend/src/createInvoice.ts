/**
 * Anlegen einer Rechnung – gemeinsam genutzt vom Hochladen von Hand und vom
 * Bestätigen eines Entwurfs aus dem Eingang. Beide Wege müssen dasselbe tun:
 * Datei ablegen, Datensatz schreiben, Einreichungen anlegen, Muster lernen.
 */
import path from 'node:path';
import { db } from './db.js';
import { round2 } from './calc.js';
import { archiveFile, getArchiveRoot } from './archive.js';
import { learnFromInvoice } from './patterns.js';
import { FALLBACK_CATEGORY, TARGETS, type FamilyMember, type Target } from './types.js';

const todayIso = () => new Date().toISOString().slice(0, 10);

export interface InvoiceInput {
  family_member_id: number;
  doctor?: string;
  invoice_number?: string;
  invoice_date?: string | null;
  treatment_date?: string | null;
  amount: number;
  category?: string;
  paid_to_doctor_date?: string | null;
  /** Bis wann die Rechnung an den Arzt zu zahlen ist. */
  payment_due_date?: string | null;
  note?: string;
  file_path?: string | null;
  ocr_text?: string | null;
  submit_now?: Target[];
}

export type CreateResult =
  | { ok: false; error: string }
  | { ok: true; invoiceId: number; archiveNote: string | null };

export function createInvoice(body: InvoiceInput): CreateResult {
  if (!body.family_member_id) return { ok: false, error: 'Bitte einen Patienten auswählen.' };

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Bitte einen gültigen Rechnungsbetrag angeben.' };
  }

  const member = db.prepare('SELECT * FROM family_members WHERE id = ?').get(body.family_member_id) as
    | FamilyMember
    | undefined;
  if (!member) return { ok: false, error: 'Der gewählte Patient existiert nicht.' };

  /*
   * Die Datei zuerst in die Ablage verschieben – so steht in der Datenbank
   * gleich der endgültige Pfad.
   */
  let filePath = body.file_path || null;
  let archiveNote: string | null = null;
  if (filePath) {
    const result = archiveFile(filePath, {
      member: member.name,
      memberOrder: member.sort_order,
      invoiceDate: body.invoice_date || null,
      doctor: (body.doctor ?? '').trim(),
      amount: round2(amount),
      extension: path.extname(filePath).toLowerCase() || '.pdf',
    });
    filePath = result.path;
    if (!result.archived && result.reason && getArchiveRoot()) {
      archiveNote = `Die Datei konnte nicht in die Ablage verschoben werden: ${result.reason}`;
    }
  }

  const invoiceId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO invoices
           (family_member_id, doctor, invoice_number, invoice_date, treatment_date, amount,
            category, paid_to_doctor_date, payment_due_date, note, file_path, ocr_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        body.family_member_id,
        (body.doctor ?? '').trim(),
        (body.invoice_number ?? '').trim(),
        body.invoice_date || null,
        body.treatment_date || null,
        round2(amount),
        body.category || FALLBACK_CATEGORY,
        body.paid_to_doctor_date || null,
        body.payment_due_date || null,
        (body.note ?? '').trim(),
        filePath,
        body.ocr_text || null,
      );
    const id = Number(info.lastInsertRowid);
    const insertSub = db.prepare(
      `INSERT INTO submissions (invoice_id, target, status, submitted_date) VALUES (?, ?, ?, ?)`,
    );
    for (const target of TARGETS) {
      const submitNow = body.submit_now?.includes(target);
      insertSub.run(id, target, submitNow ? 'eingereicht' : 'offen', submitNow ? todayIso() : null);
    }
    return id;
  });

  /*
   * Aus der bestätigten Rechnung lernen. Für einen unbekannten Aussteller
   * entsteht dabei automatisch ein neues Muster.
   */
  learnFromInvoice({
    doctor: (body.doctor ?? '').trim(),
    ocr_text: body.ocr_text,
    invoice_number: body.invoice_number,
    amount: round2(amount),
    invoice_date: body.invoice_date,
    treatment_date: body.treatment_date,
    category: body.category,
  });

  return { ok: true, invoiceId, archiveNote };
}
