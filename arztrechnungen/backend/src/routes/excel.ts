import { Router } from 'express';
import * as XLSX from 'xlsx';
import { listInvoices } from '../calc.js';

/**
 * Excel-Export der Rechnungsübersicht – ein Blatt je Jahr.
 *
 * Der frühere Import bestehender Jahres-Tabellen ist entfallen: die Altdaten
 * sind übernommen, neue Rechnungen entstehen über Upload oder Eingang.
 */
export const excelRouter = Router();

const STATUS_LABEL: Record<string, string> = {
  offen: 'offen',
  eingereicht: 'eingereicht',
  teilweise_bezahlt: 'teilweise bezahlt',
  bezahlt: 'bezahlt',
  abgelehnt: 'abgelehnt',
};

excelRouter.get('/export', (req, res) => {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const invoices = listInvoices({ year, includeArchived: true });

  const byYear = new Map<string, Record<string, unknown>[]>();
  for (const inv of invoices) {
    const y = (inv.invoice_date ?? inv.created_at).slice(0, 4);
    const dbv = inv.submissions.find((s) => s.target === 'dbv');
    const bh = inv.submissions.find((s) => s.target === 'beihilfe');
    const list = byYear.get(y) ?? [];
    list.push({
      Rechnungsdatum: inv.invoice_date ?? '',
      Behandlungsdatum: inv.treatment_date ?? '',
      Patient: inv.member_name,
      Arzt: inv.doctor,
      Rechnungsnummer: inv.invoice_number,
      Behandlungsart: inv.category,
      'Rechnungshöhe (€)': inv.amount,
      'Zahlung an Arzt': inv.paid_to_doctor_date ?? '',
      'Einreichung Beihilfe': bh?.submitted_date ?? '',
      'Status Beihilfe': STATUS_LABEL[bh?.status ?? 'offen'],
      'Erstattung Beihilfe (€)': bh?.paid_amount ?? '',
      'erwartet Beihilfe (€)': inv.expected_beihilfe,
      'Einreichung DBV': dbv?.submitted_date ?? '',
      'Status DBV': STATUS_LABEL[dbv?.status ?? 'offen'],
      'Erstattung DBV (€)': dbv?.paid_amount ?? '',
      'erwartet DBV (€)': inv.expected_dbv,
      'Erstattet gesamt (€)': inv.paid_total,
      'Offen (€)': inv.open_amount,
      Gesamtstatus: inv.overall_status,
      Kürzungsgrund: [bh?.rejection_reason, dbv?.rejection_reason].filter(Boolean).join(' | '),
      Entscheidung: [bh?.action_note, dbv?.action_note].filter(Boolean).join(' | '),
      Abgelegt: inv.archived_at ?? '',
      Bemerkung: inv.note,
    });
    byYear.set(y, list);
  }

  const wb = XLSX.utils.book_new();
  const years = [...byYear.keys()].sort().reverse();
  if (years.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Hinweis: 'Keine Rechnungen' }]), 'Leer');
  }
  for (const y of years) {
    const ws = XLSX.utils.json_to_sheet(byYear.get(y)!);
    ws['!cols'] = Object.keys(byYear.get(y)![0] ?? {}).map((k) => ({ wch: Math.max(12, k.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, y);
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const name = `Arztrechnungen${year ? `_${year}` : ''}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(buf);
});

