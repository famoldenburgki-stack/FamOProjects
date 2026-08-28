import { Router } from 'express';
import { db, getSettingNumber, targetLabel } from '../db.js';
import { daysSince, daysUntil, deadlineFor, listInvoices } from '../calc.js';
import { countInbox } from '../inbox.js';
import type { InvoiceDetail, Target } from '../types.js';

export const remindersRouter = Router();

export interface ReminderEntry {
  invoice_id: number;
  submission_id: number | null;
  target: Target | null;
  member_name: string;
  doctor: string;
  invoice_number: string;
  invoice_date: string | null;
  amount: number;
  detail: string;
  days: number | null;
  severity: 'kritisch' | 'warnung' | 'info';
}

const fmt = (n: number) =>
  `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fmtDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');

function base(inv: InvoiceDetail) {
  return {
    invoice_id: inv.id,
    member_name: inv.member_name,
    doctor: inv.doctor,
    invoice_number: inv.invoice_number,
    invoice_date: inv.invoice_date,
    amount: inv.amount,
  };
}

export function buildReminders() {
  const invoices = listInvoices({});
  const warnDays = getSettingNumber('deadline_warn_days', 42);
  const notSubmittedDays = getSettingNumber('remind_not_submitted_days', 30);
  const decisionDays = getSettingNumber('remind_decision_days', 45);

  const deadlines: ReminderEntry[] = [];
  const notSubmitted: ReminderEntry[] = [];
  const decisionOverdue: ReminderEntry[] = [];
  const needsDecision: ReminderEntry[] = [];
  const readyToArchive: ReminderEntry[] = [];
  const notPaid: ReminderEntry[] = [];
  const paymentDue: ReminderEntry[] = [];
  const paymentWarnDays = getSettingNumber('payment_warn_days', 7);

  for (const inv of invoices) {
    /*
     * Zahlungsfrist gegenüber dem Arzt. Anders als die Ausschlussfrist steht sie
     * auf der Rechnung selbst; versäumt kostet sie Mahngebühren.
     */
    if (inv.payment_due_date && !inv.paid_to_doctor_date && !inv.archived_at) {
      const left = daysUntil(inv.payment_due_date);
      if (left !== null && left <= paymentWarnDays) {
        paymentDue.push({
          ...base(inv),
          submission_id: null,
          target: null,
          days: left,
          severity: left < 0 ? 'kritisch' : 'warnung',
          detail:
            left < 0
              ? `Zahlung an ${inv.doctor || 'den Arzt'} ist seit ${-left} Tagen überfällig ` +
                `(war am ${fmtDate(inv.payment_due_date)}, ${fmt(inv.amount)}).`
              : left === 0
                ? `${fmt(inv.amount)} an ${inv.doctor || 'den Arzt'} sind heute fällig.`
                : `${fmt(inv.amount)} an ${inv.doctor || 'den Arzt'} sind in ${left} Tagen fällig ` +
                  `(am ${fmtDate(inv.payment_due_date)}).`,
        });
      }
    }

    /*
     * Rechnung erfasst, aber noch nicht an den Arzt gezahlt. Abgelegte Rechnungen
     * bleiben außen vor – die sind erledigt.
     */
    if (!inv.paid_to_doctor_date && !inv.archived_at) {
      notPaid.push({
        ...base(inv),
        submission_id: null,
        target: null,
        days: daysSince(inv.invoice_date),
        severity: 'info',
        detail: `${fmt(inv.amount)} noch nicht an ${inv.doctor || 'den Arzt'} gezahlt.`,
      });
    }

    for (const sub of inv.submissions) {
      /* Ausschlussfrist – höchste Priorität, hier geht sonst Geld verloren */
      if (sub.status === 'offen') {
        const deadline = deadlineFor(sub.target, inv.invoice_date);
        const left = daysUntil(deadline);
        if (deadline && left !== null && left <= warnDays) {
          deadlines.push({
            ...base(inv),
            submission_id: sub.id,
            target: sub.target,
            days: left,
            severity: left < 0 ? 'kritisch' : left <= 14 ? 'kritisch' : 'warnung',
            detail:
              left < 0
                ? `Frist für ${targetLabel(sub.target)} ist seit ${-left} Tagen abgelaufen (war am ${fmtDate(deadline)}).`
                : `Frist für ${targetLabel(sub.target)} läuft in ${left} Tagen ab (am ${fmtDate(deadline)}).`,
          });
        }

        const age = daysSince(inv.invoice_date);
        if (age !== null && age >= notSubmittedDays) {
          notSubmitted.push({
            ...base(inv),
            submission_id: sub.id,
            target: sub.target,
            days: age,
            severity: 'warnung',
            detail: `Seit ${age} Tagen nicht bei ${targetLabel(sub.target)} eingereicht (erwartet ${fmt(sub.expected_amount)}).`,
          });
        }
      }

      /* Eingereicht, aber kein Bescheid */
      if (sub.status === 'eingereicht') {
        const waiting = daysSince(sub.submitted_date);
        if (waiting !== null && waiting >= decisionDays) {
          decisionOverdue.push({
            ...base(inv),
            submission_id: sub.id,
            target: sub.target,
            days: waiting,
            severity: 'warnung',
            detail: `Seit ${waiting} Tagen bei ${targetLabel(sub.target)} eingereicht, noch kein Bescheid.`,
          });
        }
      }

      /* Bescheid da, aber gekürzt/abgelehnt und noch nicht entschieden */
      if (
        (sub.status === 'abgelehnt' || sub.status === 'teilweise_bezahlt') &&
        !sub.action_note.trim()
      ) {
        const missing = Math.max(0, sub.expected_amount - (sub.paid_amount ?? 0));
        needsDecision.push({
          ...base(inv),
          submission_id: sub.id,
          target: sub.target,
          days: daysSince(sub.decision_date),
          severity: 'kritisch',
          detail:
            sub.paid_amount === null
              ? `${targetLabel(sub.target)}: Status "${sub.status === 'abgelehnt' ? 'abgelehnt' : 'teilweise bezahlt'}", aber kein Erstattungsbetrag erfasst – bitte nachtragen (erwartet ${fmt(sub.expected_amount)}). ${sub.rejection_reason}`
              : `${targetLabel(sub.target)} hat ${fmt(sub.paid_amount)} von ${fmt(sub.expected_amount)} erstattet ` +
                `(offen ${fmt(missing)}). ${sub.rejection_reason || 'Kein Grund erfasst.'}`,
        });
      }
    }

    if (inv.ready_to_archive) {
      readyToArchive.push({
        ...base(inv),
        submission_id: null,
        target: null,
        days: null,
        severity: 'info',
        detail: `Vollständig abgeschlossen (${fmt(inv.paid_total)} erstattet) – Papierrechnung kann abgelegt werden.`,
      });
    }
  }

  const bySeverityThenDays = (a: ReminderEntry, b: ReminderEntry) =>
    (a.days ?? 0) - (b.days ?? 0);

  return {
    payment_due: paymentDue.sort((a, b) => (a.days ?? 0) - (b.days ?? 0)),
    deadlines: deadlines.sort(bySeverityThenDays),
    needs_decision: needsDecision,
    not_submitted: notSubmitted.sort((a, b) => (b.days ?? 0) - (a.days ?? 0)),
    decision_overdue: decisionOverdue.sort((a, b) => (b.days ?? 0) - (a.days ?? 0)),
    not_paid: notPaid.sort((a, b) => (b.days ?? 0) - (a.days ?? 0)),
    ready_to_archive: readyToArchive,
    counts: {
      payment_due: paymentDue.length,
      deadlines: deadlines.length,
      needs_decision: needsDecision.length,
      not_submitted: notSubmitted.length,
      decision_overdue: decisionOverdue.length,
      not_paid: notPaid.length,
      ready_to_archive: readyToArchive.length,
    },
  };
}

remindersRouter.get('/', (_req, res) => {
  res.json(buildReminders());
});

/** Kompakte Kennzahlen für das Dashboard. */
remindersRouter.get('/overview', (_req, res) => {
  const reminders = buildReminders();
  const invoices = listInvoices({});
  const openAmount = invoices
    .filter((i) => i.overall_status !== 'abgeschlossen')
    .reduce((s, i) => s + i.open_amount, 0);
  const year = new Date().getFullYear();
  const thisYear = invoices.filter((i) => (i.invoice_date ?? '').startsWith(String(year)));

  res.json({
    counts: { ...reminders.counts, inbox: countInbox() },
    open_invoices: invoices.filter((i) => i.overall_status !== 'abgeschlossen').length,
    open_amount: Math.round(openAmount * 100) / 100,
    year,
    year_total: Math.round(thisYear.reduce((s, i) => s + i.amount, 0) * 100) / 100,
    year_reimbursed: Math.round(thisYear.reduce((s, i) => s + i.paid_total, 0) * 100) / 100,
    total_invoices: db.prepare('SELECT COUNT(*) AS n FROM invoices').get() as { n: number },
  });
});
