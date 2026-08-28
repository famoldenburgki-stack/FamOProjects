import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { date, money, targetLabel } from '../format';
import { Alert, Field, OverallBadge, PaymentDue, Spinner } from '../components/ui';
import SubmissionCard from '../components/SubmissionCard';
import { DocumentDialog } from '../components/DocumentView';
import type { Invoice, Member } from '../types';

export default function InvoiceDetail() {
  const { id } = useParams();
  const invoiceId = Number(id);
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showFile, setShowFile] = useState(false);
  const [showDecision, setShowDecision] = useState<{ id: number; titel: string } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    api.getInvoice(invoiceId).then(setInvoice).catch((e: Error) => setError(e.message));
    api.settings().then((s) => {
      setMembers(s.members.filter((m) => m.active));
      setCategories(s.categories);
    });
  }, [invoiceId]);

  function startEdit(inv: Invoice) {
    setForm({
      family_member_id: String(inv.family_member_id),
      doctor: inv.doctor,
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date ?? '',
      treatment_date: inv.treatment_date ?? '',
      amount: String(inv.amount),
      category: inv.category,
      paid_to_doctor_date: inv.paid_to_doctor_date ?? '',
      payment_due_date: inv.payment_due_date ?? '',
      note: inv.note,
    });
    setEditing(true);
  }

  async function saveEdit() {
    try {
      const updated = await api.updateInvoice(invoiceId, {
        ...form,
        family_member_id: Number(form.family_member_id),
        amount: Number(form.amount.replace(',', '.')),
      });
      setInvoice(updated);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (error && !invoice) return <Alert kind="error">{error}</Alert>;
  if (!invoice) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-brand-700 hover:underline">
            ← zurück zur Übersicht
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-xl font-semibold">
            {invoice.doctor || 'Rechnung'} · {money(invoice.amount)}
            <OverallBadge status={invoice.overall_status} />
          </h1>
          <p className="text-sm text-slate-500">
            {invoice.member_name} · Rechnung vom {date(invoice.invoice_date)}
            {invoice.invoice_number ? ` · Nr. ${invoice.invoice_number}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {invoice.file_path ? (
            <>
              <button className="btn-secondary" onClick={() => setShowFile(true)}>
                Rechnung ansehen
              </button>
              {/* Für das Einreichen im Portal: Datei im Explorer markiert öffnen. */}
              <button
                className="btn-secondary"
                onClick={() =>
                  api.openArchive(invoice.id).catch((e: Error) => setError(e.message))
                }
                title="Beleg im Explorer zeigen – zum Hochladen ins Portal"
              >
                📁 Im Ordner zeigen
              </button>
            </>
          ) : null}
          <button className="btn-secondary" onClick={() => (editing ? setEditing(false) : startEdit(invoice))}>
            {editing ? 'Bearbeiten abbrechen' : 'Bearbeiten'}
          </button>
          <button
            className={invoice.archived_at ? 'btn-secondary' : 'btn-primary'}
            onClick={() =>
              api
                .archiveInvoice(invoice.id, !invoice.archived_at)
                .then(setInvoice)
                .catch((e: Error) => setError(e.message))
            }
          >
            {invoice.archived_at ? 'Ablage aufheben' : 'Als abgelegt markieren'}
          </button>
          <button
            className="btn-danger"
            onClick={() => {
              if (!confirm('Rechnung samt Einreichungen wirklich löschen?')) return;
              api.deleteInvoice(invoice.id).then(() => navigate('/'));
            }}
          >
            Löschen
          </button>
        </div>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}

      {invoice.ready_to_archive ? (
        <Alert kind="success" title="Vorgang abgeschlossen">
          Alles erstattet bzw. entschieden – die Papierrechnung kann abgelegt werden. Mit „Als abgelegt
          markieren“ verschwindet sie aus der Standardansicht.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-1">
          <h2 className="mb-3 font-semibold">Rechnungsdaten</h2>
          {editing ? (
            <div className="space-y-3">
              <Field label="Patient">
                <select
                  className="input"
                  value={form.family_member_id}
                  onChange={(e) => setForm({ ...form, family_member_id: e.target.value })}
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Arzt">
                <input className="input" value={form.doctor} onChange={(e) => setForm({ ...form, doctor: e.target.value })} />
              </Field>
              <Field label="Rechnungsnummer">
                <input
                  className="input"
                  value={form.invoice_number}
                  onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Rechnungsdatum">
                  <input
                    type="date"
                    className="input"
                    value={form.invoice_date}
                    onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
                  />
                </Field>
                <Field label="Behandlungsdatum">
                  <input
                    type="date"
                    className="input"
                    value={form.treatment_date}
                    onChange={(e) => setForm({ ...form, treatment_date: e.target.value })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Betrag (€)">
                  <input className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </Field>
                <Field label="Behandlungsart">
                  <select
                    className="input"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Zahlbar bis">
                <input
                  type="date"
                  className="input"
                  value={form.payment_due_date}
                  onChange={(e) => setForm({ ...form, payment_due_date: e.target.value })}
                />
              </Field>
              <Field label="Zahlung an Arzt">
                <input
                  type="date"
                  className="input"
                  value={form.paid_to_doctor_date}
                  onChange={(e) => setForm({ ...form, paid_to_doctor_date: e.target.value })}
                />
              </Field>
              <Field label="Bemerkung">
                <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </Field>
              <button className="btn-primary" onClick={saveEdit}>
                Speichern
              </button>
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-slate-500">Patient</dt>
              <dd>{invoice.member_name}</dd>
              <dt className="text-slate-500">Behandlungsart</dt>
              <dd>{invoice.category}</dd>
              <dt className="text-slate-500">Rechnungsdatum</dt>
              <dd>{date(invoice.invoice_date)}</dd>
              <dt className="text-slate-500">Behandlungsdatum</dt>
              <dd>{date(invoice.treatment_date)}</dd>
              <dt className="text-slate-500">Rechnungsnummer</dt>
              <dd>{invoice.invoice_number || '–'}</dd>
              <dt className="text-slate-500">Betrag</dt>
              <dd className="font-medium">{money(invoice.amount)}</dd>
              <dt className="text-slate-500">Zahlbar bis</dt>
              <dd>
                {invoice.payment_due_date ? (
                  <PaymentDue due={invoice.payment_due_date} paid={invoice.paid_to_doctor_date} />
                ) : (
                  <span className="text-slate-400">keine Frist erfasst</span>
                )}
              </dd>
              <dt className="text-slate-500">An Arzt gezahlt</dt>
              <dd>
                {invoice.paid_to_doctor_date ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-emerald-700">
                      {date(invoice.paid_to_doctor_date)}
                    </span>
                    <button
                      className="text-xs text-slate-400 hover:text-slate-700 hover:underline"
                      onClick={() =>
                        api
                          .markPaid(invoice.id, null)
                          .then(setInvoice)
                          .catch((e: Error) => setError(e.message))
                      }
                      title="Bestätigung zurücknehmen"
                    >
                      zurücknehmen
                    </button>
                  </span>
                ) : (
                  <button
                    className="rounded-lg border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                    onClick={() =>
                      api
                        .markPaid(invoice.id)
                        .then(setInvoice)
                        .catch((e: Error) => setError(e.message))
                    }
                  >
                    Heute bezahlt
                  </button>
                )}
              </dd>
              <dt className="text-slate-500">Erstattet</dt>
              <dd className="font-medium text-emerald-700">{money(invoice.paid_total)}</dd>
              <dt className="text-slate-500">Offen</dt>
              <dd className={invoice.open_amount > 0.005 ? 'font-medium text-amber-700' : ''}>
                {money(invoice.open_amount)}
              </dd>
              {invoice.archived_at ? (
                <>
                  <dt className="text-slate-500">Abgelegt am</dt>
                  <dd>{date(invoice.archived_at)}</dd>
                </>
              ) : null}
              {invoice.note ? (
                <>
                  <dt className="text-slate-500">Bemerkung</dt>
                  <dd>{invoice.note}</dd>
                </>
              ) : null}
            </dl>
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          {invoice.submissions.map((s) => (
            <SubmissionCard
              key={s.id}
              invoice={invoice}
              submission={s}
              onChange={setInvoice}
              onError={setError}
            />
          ))}
        </div>
      </div>

      {invoice.decision_items && invoice.decision_items.length > 0 ? (
        <div className="card">
          <h2 className="mb-3 font-semibold">Zugeordnete Bescheid-Positionen</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead>
                <tr>
                  <th className="th">Stelle</th>
                  <th className="th">Bescheid vom</th>
                  <th className="th">Rechnung vom (laut Bescheid)</th>
                  <th className="th">Position im Bescheid</th>
                  <th className="th text-right">Erstattet</th>
                  <th className="th">Grund</th>
                  <th className="th">Zuordnung</th>
                  <th className="th">Bescheid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoice.decision_items.map((it) => (
                  <tr key={it.id}>
                    <td className="td">{it.target ? targetLabel(it.target) : '–'}</td>
                    <td className="td">{date(it.d_date)}</td>
                    <td className="td">{date(it.invoice_date)}</td>
                    <td className="td">
                      {[it.member_name, it.service_label, it.invoice_number && `Nr. ${it.invoice_number}`]
                        .filter(Boolean)
                        .join(' · ') || '–'}
                    </td>
                    <td className="td text-right">{money(it.paid_amount)}</td>
                    <td className="td whitespace-normal">{it.reason || '–'}</td>
                    <td className="td text-slate-500">
                      {it.match_kind === 'number'
                        ? 'per Rechnungsnummer'
                        : it.match_kind === 'amount_date'
                          ? 'per Betrag/Datum'
                          : it.match_kind === 'manual'
                            ? 'manuell'
                            : 'offen'}
                    </td>
                    <td className="td">
                      {/* Direkt aus der Rechnung heraus in den Bescheid schauen. */}
                      <button
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        onClick={() =>
                          setShowDecision({
                            id: it.decision_id,
                            titel: `${it.target ? targetLabel(it.target) : '–'} · Bescheid vom ${date(it.d_date)}`,
                          })
                        }
                      >
                        ansehen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {showFile && invoice.file_path ? (
        <DocumentDialog
          src={`/api/invoices/${invoice.id}/file`}
          name={invoice.file_path}
          title={`${invoice.doctor} · ${date(invoice.invoice_date)}`}
          onClose={() => setShowFile(false)}
        />
      ) : null}

      {showDecision ? (
        <DocumentDialog
          src={`/api/decisions/${showDecision.id}/file`}
          name={`bescheid-${showDecision.id}.pdf`}
          title={showDecision.titel}
          onClose={() => setShowDecision(null)}
        />
      ) : null}
    </div>
  );
}
