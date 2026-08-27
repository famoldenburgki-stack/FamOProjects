import { Router } from 'express';
import { db } from '../db.js';
import { listInvoices, round2 } from '../calc.js';
import type { FamilyMember, InvoiceDetail } from '../types.js';

export const statsRouter = Router();

const yearOf = (inv: InvoiceDetail) => (inv.invoice_date ?? inv.created_at).slice(0, 4);
const paidFor = (inv: InvoiceDetail, target: 'dbv' | 'beihilfe') =>
  inv.submissions.find((s) => s.target === target)?.paid_amount ?? 0;

/** Eigenanteil zählt erst, wenn beide Stellen entschieden haben. */
const isSettled = (inv: InvoiceDetail) =>
  inv.overall_status === 'abgeschlossen' || inv.overall_status === 'eigenanteil_offen' ||
  inv.overall_status === 'abgelegt';

statsRouter.get('/', (_req, res) => {
  const invoices = listInvoices({ includeArchived: true });
  const members = db
    .prepare('SELECT * FROM family_members ORDER BY sort_order')
    .all() as FamilyMember[];

  /* ---- Jahresverlauf ---- */
  const yearMap = new Map<
    string,
    { year: string; total: number; paid_beihilfe: number; paid_dbv: number; own_share: number; count: number }
  >();
  for (const inv of invoices) {
    const y = yearOf(inv);
    const e =
      yearMap.get(y) ??
      { year: y, total: 0, paid_beihilfe: 0, paid_dbv: 0, own_share: 0, count: 0 };
    e.total += inv.amount;
    e.paid_beihilfe += paidFor(inv, 'beihilfe');
    e.paid_dbv += paidFor(inv, 'dbv');
    if (isSettled(inv)) e.own_share += Math.max(0, inv.open_amount);
    e.count += 1;
    yearMap.set(y, e);
  }
  const years = [...yearMap.values()]
    .map((e) => ({
      ...e,
      total: round2(e.total),
      paid_beihilfe: round2(e.paid_beihilfe),
      paid_dbv: round2(e.paid_dbv),
      paid_total: round2(e.paid_beihilfe + e.paid_dbv),
      own_share: round2(e.own_share),
    }))
    .sort((a, b) => a.year.localeCompare(b.year));

  /* ---- Pro Person und Jahr ---- */
  const memberMap = new Map<string, { year: string; member: string; total: number; paid_total: number }>();
  for (const inv of invoices) {
    const key = `${yearOf(inv)}|${inv.member_name}`;
    const e = memberMap.get(key) ?? { year: yearOf(inv), member: inv.member_name, total: 0, paid_total: 0 };
    e.total += inv.amount;
    e.paid_total += inv.paid_total;
    memberMap.set(key, e);
  }
  const byMember = [...memberMap.values()]
    .map((e) => ({ ...e, total: round2(e.total), paid_total: round2(e.paid_total) }))
    .sort((a, b) => a.year.localeCompare(b.year) || a.member.localeCompare(b.member));

  /* ---- Pro Behandlungsart und Jahr ---- */
  const catMap = new Map<string, { year: string; category: string; total: number; count: number }>();
  for (const inv of invoices) {
    const key = `${yearOf(inv)}|${inv.category}`;
    const e = catMap.get(key) ?? { year: yearOf(inv), category: inv.category, total: 0, count: 0 };
    e.total += inv.amount;
    e.count += 1;
    catMap.set(key, e);
  }
  const byCategory = [...catMap.values()]
    .map((e) => ({ ...e, total: round2(e.total) }))
    .sort((a, b) => a.year.localeCompare(b.year) || b.total - a.total);

  /* ---- Beitragsrückerstattung: was ist dieses Jahr bei der DBV gelandet ---- */
  const currentYear = String(new Date().getFullYear());
  const bre = members
    .filter((m) => m.active)
    .map((m) => {
      const relevant = invoices.filter(
        (i) =>
          i.family_member_id === m.id &&
          yearOf(i) === currentYear &&
          (i.submissions.find((s) => s.target === 'dbv')?.submitted_date ?? null) !== null,
      );
      const submitted = round2(relevant.reduce((s, i) => s + i.expected_dbv, 0));
      const threshold = m.bre_threshold;
      return {
        member_id: m.id,
        member: m.name,
        year: currentYear,
        submitted_dbv: submitted,
        invoice_count: relevant.length,
        threshold,
        remaining: threshold === null ? null : round2(threshold - submitted),
        state:
          threshold === null
            ? ('unbekannt' as const)
            : submitted > threshold
              ? ('ueberschritten' as const)
              : submitted > threshold * 0.7
                ? ('knapp' as const)
                : ('ok' as const),
      };
    });

  /* ---- Kürzungsmuster ---- */
  const rows = db
    .prepare(
      `SELECT s.target, s.status, s.rejection_reason, s.paid_amount,
              i.doctor, i.category, i.amount, m.beihilfe_rate,
              strftime('%Y', COALESCE(i.invoice_date, i.created_at)) AS year
       FROM submissions s
       JOIN invoices i ON i.id = s.invoice_id
       JOIN family_members m ON m.id = i.family_member_id
       WHERE s.status IN ('teilweise_bezahlt','abgelehnt')`,
    )
    .all() as {
    target: 'dbv' | 'beihilfe';
    status: string;
    rejection_reason: string;
    paid_amount: number | null;
    doctor: string;
    category: string;
    amount: number;
    beihilfe_rate: number;
    year: string;
  }[];

  const missingOf = (r: (typeof rows)[number]) => {
    const expected = r.target === 'beihilfe' ? r.amount * r.beihilfe_rate : r.amount * (1 - r.beihilfe_rate);
    return Math.max(0, round2(expected - (r.paid_amount ?? 0)));
  };

  const reasonMap = new Map<string, { reason: string; count: number; missing: number }>();
  const doctorMap = new Map<string, { doctor: string; count: number; missing: number; reasons: Set<string> }>();
  const yearMissing = new Map<string, number>();

  for (const r of rows) {
    const missing = missingOf(r);
    const reasons = r.rejection_reason.trim() ? r.rejection_reason.split(';').map((s) => s.trim()) : ['Ohne Grundangabe'];
    for (const reason of reasons) {
      const e = reasonMap.get(reason) ?? { reason, count: 0, missing: 0 };
      e.count += 1;
      e.missing += missing;
      reasonMap.set(reason, e);
    }
    const key = r.doctor || '(ohne Arzt)';
    const d = doctorMap.get(key) ?? { doctor: key, count: 0, missing: 0, reasons: new Set<string>() };
    d.count += 1;
    d.missing += missing;
    reasons.forEach((x) => d.reasons.add(x));
    doctorMap.set(key, d);
    yearMissing.set(r.year, round2((yearMissing.get(r.year) ?? 0) + missing));
  }

  const totalSubmissions = (
    db.prepare(`SELECT COUNT(*) AS n FROM submissions WHERE status <> 'offen'`).get() as { n: number }
  ).n;

  res.json({
    years,
    by_member: byMember,
    by_category: byCategory,
    bre,
    rejections: {
      by_reason: [...reasonMap.values()]
        .map((e) => ({ ...e, missing: round2(e.missing) }))
        .sort((a, b) => b.count - a.count),
      by_doctor: [...doctorMap.values()]
        .map((e) => ({ doctor: e.doctor, count: e.count, missing: round2(e.missing), reasons: [...e.reasons] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
      by_year: [...yearMissing.entries()]
        .map(([year, missing]) => ({ year, missing }))
        .sort((a, b) => a.year.localeCompare(b.year)),
      affected_submissions: rows.length,
      total_decided_submissions: totalSubmissions,
    },
  });
});
