import { useState } from 'react';
import { api } from '../api';
import { SUBMISSION_LABEL, date, money, targetLabel, todayIso } from '../format';
import { Field, StatusBadge } from './ui';
import type { Invoice, Submission, SubmissionStatus } from '../types';

const STATUSES: SubmissionStatus[] = [
  'offen',
  'eingereicht',
  'teilweise_bezahlt',
  'bezahlt',
  'abgelehnt',
];

export default function SubmissionCard({
  invoice,
  submission,
  onChange,
  onError,
}: {
  invoice: Invoice;
  submission: Submission;
  onChange: (inv: Invoice) => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    status: submission.status,
    submitted_date: submission.submitted_date ?? '',
    decision_date: submission.decision_date ?? '',
    paid_amount: submission.paid_amount === null ? '' : String(submission.paid_amount),
    rejection_reason: submission.rejection_reason,
    action_note: submission.action_note,
  });

  const missing = Math.max(0, submission.expected_amount - (submission.paid_amount ?? 0));
  const needsAction =
    (submission.status === 'abgelehnt' || submission.status === 'teilweise_bezahlt') &&
    !submission.action_note.trim();

  async function run(fn: () => Promise<Invoice | null>) {
    setBusy(true);
    try {
      const updated = await fn();
      if (updated) onChange(updated);
      setEditing(false);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`rounded-xl border p-4 ${
        needsAction ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{targetLabel(submission.target)}</h3>
          <p className="text-xs text-slate-500">
            Erwartet {money(submission.expected_amount)}
            {submission.target === 'beihilfe'
              ? ` (${Math.round(invoice.beihilfe_rate * 100)} % Beihilfesatz)`
              : ` (${Math.round((1 - invoice.beihilfe_rate) * 100)} % Restanteil)`}
            {' · '}Zugang {invoice.member_account}
          </p>
        </div>
        <StatusBadge status={submission.status} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate-500">Eingereicht</dt>
        <dd>{date(submission.submitted_date)}</dd>
        <dt className="text-slate-500">Bescheid</dt>
        <dd>{date(submission.decision_date)}</dd>
        <dt className="text-slate-500">Erstattet</dt>
        <dd className={submission.paid_amount ? 'font-medium' : ''}>{money(submission.paid_amount)}</dd>
        {missing > 0.005 && submission.paid_amount !== null ? (
          <>
            <dt className="text-slate-500">Differenz</dt>
            <dd className="font-medium text-amber-700">− {money(missing)}</dd>
          </>
        ) : null}
      </dl>

      {submission.rejection_reason ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-semibold">Begründung: </span>
          {submission.rejection_reason}
        </p>
      ) : null}

      {submission.action_note ? (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <span className="font-semibold">Entscheidung: </span>
          {submission.action_note}
        </p>
      ) : null}

      {needsAction ? (
        <div className="mt-3 space-y-2 rounded-lg border border-red-200 bg-white px-3 py-2">
          <p className="text-sm font-medium text-red-800">Hier ist eine Entscheidung nötig</p>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => run(() => api.acceptShare(submission.id, `Eigenanteil akzeptiert (${money(missing)})`))}
            >
              Eigenanteil akzeptieren
            </button>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() =>
                run(() => api.acceptShare(submission.id, `Arzt um korrigierte Rechnung gebeten am ${date(todayIso())}`))
              }
            >
              Arzt kontaktiert
            </button>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() =>
                run(() => api.acceptShare(submission.id, `Widerspruch/Antwort auf Bescheid am ${date(todayIso())}`))
              }
            >
              Widerspruch eingelegt
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {submission.status === 'offen' ? (
          <button className="btn-primary" disabled={busy} onClick={() => run(() => api.submit(submission.id))}>
            Heute eingereicht
          </button>
        ) : null}
        <button className="btn-secondary" disabled={busy} onClick={() => setEditing((v) => !v)}>
          {editing ? 'Abbrechen' : 'Bescheid/Status eintragen'}
        </button>
        {submission.status !== 'offen' ? (
          <button className="btn-ghost" disabled={busy} onClick={() => run(() => api.resetSubmission(submission.id))}>
            Zurücksetzen
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-4 space-y-3 rounded-lg bg-slate-50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status">
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as SubmissionStatus })}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {SUBMISSION_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Erstatteter Betrag (€)">
              <input
                className="input"
                value={form.paid_amount}
                onChange={(e) => setForm({ ...form, paid_amount: e.target.value })}
              />
            </Field>
            <Field label="Eingereicht am">
              <input
                type="date"
                className="input"
                value={form.submitted_date}
                onChange={(e) => setForm({ ...form, submitted_date: e.target.value })}
              />
            </Field>
            <Field label="Bescheid vom">
              <input
                type="date"
                className="input"
                value={form.decision_date}
                onChange={(e) => setForm({ ...form, decision_date: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Begründung der Kürzung/Ablehnung">
            <input
              className="input"
              value={form.rejection_reason}
              onChange={(e) => setForm({ ...form, rejection_reason: e.target.value })}
            />
          </Field>
          <Field label="Meine Entscheidung / Notiz" hint="Solange leer, bleibt der Vorgang in den Aufgaben.">
            <input
              className="input"
              value={form.action_note}
              onChange={(e) => setForm({ ...form, action_note: e.target.value })}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                run(() =>
                  api.updateSubmission(submission.id, {
                    ...form,
                    paid_amount: form.paid_amount === '' ? null : Number(form.paid_amount.replace(',', '.')),
                  }),
                )
              }
            >
              Speichern
            </button>
            <button
              className="btn-secondary"
              disabled={busy || form.paid_amount === ''}
              onClick={() =>
                run(() =>
                  api.updateSubmission(submission.id, {
                    ...form,
                    paid_amount: Number(form.paid_amount.replace(',', '.')),
                    recalculate: true,
                  }),
                )
              }
              title="Status automatisch aus dem erstatteten Betrag ableiten"
            >
              Speichern &amp; Status berechnen
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
