import { db, getSettingNumber } from './db.js';
import type {
  InvoiceDetail,
  InvoiceRow,
  OverallStatus,
  SubmissionRow,
  SubmissionStatus,
  Target,
} from './types.js';

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Erwartete Erstattung einer Einreichung: Beihilfe = Satz, DBV = Rest. */
export function expectedAmount(target: Target, amount: number, rate: number): number {
  return round2(target === 'beihilfe' ? amount * rate : amount * (1 - rate));
}

const DECIDED: SubmissionStatus[] = ['bezahlt', 'teilweise_bezahlt', 'abgelehnt'];
const isDecided = (s: SubmissionStatus) => DECIDED.includes(s);

export function overallStatus(
  invoice: InvoiceRow,
  subs: Pick<SubmissionRow, 'status' | 'action_note'>[],
): OverallStatus {
  if (invoice.archived_at) return 'abgelegt';

  const statuses = subs.map((s) => s.status);
  if (statuses.every((s) => s === 'offen')) return 'offen';
  if (statuses.every((s) => isDecided(s))) {
    const unresolved = subs.filter((s) => s.status !== 'bezahlt' && !s.action_note.trim());
    return unresolved.length > 0 ? 'eigenanteil_offen' : 'abgeschlossen';
  }
  if (statuses.some((s) => isDecided(s))) return 'in_bearbeitung';
  if (statuses.every((s) => s === 'eingereicht')) return 'eingereicht';
  return 'teilweise_eingereicht';
}

const invoiceSelect = `
  SELECT i.*, m.name AS member_name, m.account AS member_account, m.beihilfe_rate AS beihilfe_rate
  FROM invoices i JOIN family_members m ON m.id = i.family_member_id
`;

type InvoiceJoined = InvoiceRow & {
  member_name: string;
  member_account: string;
  beihilfe_rate: number;
};

/** Baut das vollständige Detail-Objekt (inkl. berechneter Beträge) für Rechnungen. */
export function buildInvoiceDetails(rows: InvoiceJoined[]): InvoiceDetail[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const subs = db
    .prepare(
      `SELECT * FROM submissions WHERE invoice_id IN (${placeholders})
       ORDER BY CASE target WHEN 'beihilfe' THEN 0 ELSE 1 END`,
    )
    .all(...ids) as SubmissionRow[];

  const byInvoice = new Map<number, SubmissionRow[]>();
  for (const s of subs) {
    const list = byInvoice.get(s.invoice_id) ?? [];
    list.push(s);
    byInvoice.set(s.invoice_id, list);
  }

  return rows.map((inv) => {
    const mySubs = byInvoice.get(inv.id) ?? [];
    const withExpected = mySubs.map((s) => ({
      ...s,
      expected_amount: expectedAmount(s.target, inv.amount, inv.beihilfe_rate),
    }));
    const paid_total = round2(
      withExpected.reduce((sum, s) => sum + (s.paid_amount ?? 0), 0),
    );
    const status = overallStatus(inv, withExpected);
    return {
      ...inv,
      submissions: withExpected,
      expected_beihilfe: expectedAmount('beihilfe', inv.amount, inv.beihilfe_rate),
      expected_dbv: expectedAmount('dbv', inv.amount, inv.beihilfe_rate),
      paid_total,
      open_amount: round2(inv.amount - paid_total),
      overall_status: status,
      ready_to_archive: status === 'abgeschlossen' && !inv.archived_at,
    };
  });
}

export function getInvoiceDetail(id: number): InvoiceDetail | undefined {
  const row = db.prepare(`${invoiceSelect} WHERE i.id = ?`).get(id) as InvoiceJoined | undefined;
  return row ? buildInvoiceDetails([row])[0] : undefined;
}

export interface InvoiceFilter {
  year?: number;
  memberId?: number;
  status?: OverallStatus;
  target?: Target;
  targetStatus?: SubmissionStatus;
  search?: string;
  includeArchived?: boolean;
}

export function listInvoices(filter: InvoiceFilter = {}): InvoiceDetail[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.year) {
    where.push("strftime('%Y', COALESCE(i.invoice_date, i.created_at)) = ?");
    params.push(String(filter.year));
  }
  if (filter.memberId) {
    where.push('i.family_member_id = ?');
    params.push(filter.memberId);
  }
  if (!filter.includeArchived && filter.status !== 'abgelegt') {
    where.push('i.archived_at IS NULL');
  }
  if (filter.search) {
    where.push('(i.doctor LIKE ? OR i.invoice_number LIKE ? OR i.note LIKE ?)');
    const q = `%${filter.search}%`;
    params.push(q, q, q);
  }
  if (filter.target && filter.targetStatus) {
    where.push(
      'EXISTS (SELECT 1 FROM submissions s WHERE s.invoice_id = i.id AND s.target = ? AND s.status = ?)',
    );
    params.push(filter.target, filter.targetStatus);
  }

  const sql = `${invoiceSelect} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY COALESCE(i.invoice_date, i.created_at) DESC, i.id DESC`;
  const rows = db.prepare(sql).all(...params) as InvoiceJoined[];
  let details = buildInvoiceDetails(rows);
  if (filter.status) details = details.filter((d) => d.overall_status === filter.status);
  return details;
}

/** Ausschlussfrist einer Einreichung (Monate ab Rechnungsdatum), 0 = keine Frist. */
export function deadlineFor(target: Target, invoiceDate: string | null): string | null {
  if (!invoiceDate) return null;
  const months = getSettingNumber(
    target === 'beihilfe' ? 'deadline_beihilfe_months' : 'deadline_dbv_months',
    target === 'beihilfe' ? 12 : 24,
  );
  if (months <= 0) return null;
  const d = new Date(`${invoiceDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function daysUntil(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const target = new Date(`${isoDate}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return null;
  const today = new Date();
  const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - todayUTC) / 86_400_000);
}

export function daysSince(isoDate: string | null): number | null {
  const d = daysUntil(isoDate);
  return d === null ? null : -d;
}
