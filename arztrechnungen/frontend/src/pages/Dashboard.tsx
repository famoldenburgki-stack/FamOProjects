import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { OVERALL_LABEL, date, daysUntil, money, targetLabel } from '../format';
import { Alert, EmptyState, OverallBadge, PaymentDue, Spinner, Stat, StatusBadge } from '../components/ui';
import { DocumentDialog } from '../components/DocumentView';
import { SortableTh, compareValues, type SortState } from '../components/SortableTh';
import type { Invoice, Member, Overview } from '../types';

type SortKey =
  | 'invoice_date'
  | 'treatment_date'
  | 'member_name'
  | 'doctor'
  | 'invoice_number'
  | 'amount'
  | 'payment'
  | 'beihilfe'
  | 'dbv'
  | 'paid_total'
  | 'open_amount'
  | 'overall_status';

/** Nach welchem Wert je Spalte sortiert wird. */
const sortValue = (inv: Invoice, key: SortKey): unknown => {
  switch (key) {
    /*
     * Zahlung: erst das Unbezahlte nach Fälligkeit, danach das Bezahlte. So steht
     * beim Sortieren oben, was als Nächstes überwiesen werden muss.
     */
    case 'payment':
      return inv.paid_to_doctor_date
        ? `2 ${inv.paid_to_doctor_date}`
        : `1 ${inv.payment_due_date ?? '9999-12-31'}`;
    case 'beihilfe':
      return inv.submissions.find((s) => s.target === 'beihilfe')?.status ?? '';
    case 'dbv':
      return inv.submissions.find((s) => s.target === 'dbv')?.status ?? '';
    default:
      return (inv as unknown as Record<string, unknown>)[key];
  }
};

export default function Dashboard() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [preview, setPreview] = useState<Invoice | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'invoice_date', dir: 'desc' });

  const [year, setYear] = useState<string>('');
  const [member, setMember] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [archived, setArchived] = useState(false);
  /*
   * Abgeschlossene Rechnungen sind der Großteil des Bestands und verdecken die
   * Vorgänge, an denen noch etwas zu tun ist – deshalb standardmäßig ausgeblendet.
   */
  const [hideDone, setHideDone] = useState(true);
  /** Nur Rechnungen, die noch an den Arzt zu zahlen sind. */
  const [nurUnbezahlt, setNurUnbezahlt] = useState(false);

  useEffect(() => {
    Promise.all([api.members(), api.years(), api.overview()])
      .then(([m, y, o]) => {
        setMembers(m);
        setYears(y);
        setOverview(o);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    setInvoices(null);
    api
      .listInvoices({ year, member, status, search, archived: archived ? 1 : undefined })
      .then(setInvoices)
      .catch((e: Error) => setError(e.message));
  }, [year, member, status, search, archived]);

  /** Erledigt heißt: beide Stellen haben abschließend gezahlt bzw. die Rechnung ist abgelegt. */
  const istErledigt = (inv: Invoice) =>
    inv.overall_status === 'abgeschlossen' || inv.overall_status === 'abgelegt';

  const sichtbar = useMemo(
    () =>
      (invoices ?? []).filter(
        (inv) => (!hideDone || !istErledigt(inv)) && (!nurUnbezahlt || !inv.paid_to_doctor_date),
      ),
    [invoices, hideDone, nurUnbezahlt],
  );
  const ausgeblendet = (invoices?.length ?? 0) - sichtbar.length;

  const totals = useMemo(() => {
    const list = sichtbar;
    return {
      amount: list.reduce((s, i) => s + i.amount, 0),
      paid: list.reduce((s, i) => s + i.paid_total, 0),
      open: list.reduce((s, i) => s + i.open_amount, 0),
      // Was noch an die Ärzte geht – unabhängig davon, was die beiden Stellen erstatten.
      unbezahlt: list.filter((i) => !i.paid_to_doctor_date).reduce((s, i) => s + i.amount, 0),
    };
  }, [sichtbar]);

  /*
   * Offene Arztzahlungen über den gesamten geladenen Bestand – nicht nur über die
   * sichtbaren Zeilen, sonst springt die Kennzahl mit jedem Filter.
   */
  const offeneZahlungen = useMemo(() => {
    const offen = (invoices ?? []).filter((i) => !i.paid_to_doctor_date && !i.archived_at);
    const faellig = offen.filter((i) => {
      const tage = daysUntil(i.payment_due_date);
      return tage !== null && tage <= 7;
    });
    return {
      anzahl: offen.length,
      summe: offen.reduce((s, i) => s + i.amount, 0),
      faellig: faellig.length,
    };
  }, [invoices]);

  const sortedInvoices = useMemo(() => {
    if (!invoices) return null;
    return [...sichtbar].sort((a, b) =>
      compareValues(sortValue(a, sort.key), sortValue(b, sort.key), sort.dir),
    );
  }, [invoices, sichtbar, sort]);

  function neuLaden() {
    api
      .listInvoices({ year, member, status, search, archived: archived ? 1 : undefined })
      .then(setInvoices)
      .catch((e: Error) => setError(e.message));
    api.overview().then(setOverview).catch(() => undefined);
  }

  const setArchive = (id: number, ablegen: boolean) =>
    api
      .archiveInvoice(id, ablegen)
      .then(neuLaden)
      .catch((e: Error) => setError(e.message));

  /*
   * Ablegbar sind alle geladenen erledigten Rechnungen – nicht nur die sichtbaren.
   * Sonst verschwände die Sammelaktion genau dann, wenn der Filter die erledigten
   * ausblendet, und das ist der Normalfall.
   */
  const ablegbar = (invoices ?? []).filter((inv) => inv.ready_to_archive && !inv.archived_at);

  async function alleAblegen() {
    if (
      !window.confirm(
        `${ablegbar.length} vollständig erledigte Rechnungen ablegen?\n\n` +
          'Sie verschwinden aus der Übersicht und können einzeln zurückgeholt werden.',
      )
    ) {
      return;
    }
    try {
      await api.archiveMany(ablegbar.map((i) => i.id), true);
      neuLaden();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** Erneuter Klick auf dieselbe Spalte dreht die Richtung um. */
  const onSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  return (
    <div className="space-y-6">
      {error ? <Alert kind="error">{error}</Alert> : null}

      {overview ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Dringende Aufgaben"
            value={(overview.counts.payment_due ?? 0) + (overview.counts.deadlines ?? 0) + (overview.counts.needs_decision ?? 0)}
            tone={
              (overview.counts.payment_due ?? 0) +
                (overview.counts.deadlines ?? 0) +
                (overview.counts.needs_decision ?? 0) >
              0
                ? 'danger'
                : 'good'
            }
            sub={
              <Link className="text-brand-600 hover:underline" to="/aufgaben">
                Fristen &amp; Entscheidungen ansehen
              </Link>
            }
          />
          <Stat
            label="Nicht abgeschlossen"
            value={overview.open_invoices}
            sub={`${money(overview.open_amount)} noch nicht erstattet`}
          />
          <Stat
            label={`Rechnungen ${overview.year}`}
            value={money(overview.year_total)}
            sub={`${money(overview.year_reimbursed)} erstattet`}
          />
          <Stat
            label="Noch an Ärzte zu zahlen"
            value={money(offeneZahlungen.summe)}
            tone={offeneZahlungen.faellig > 0 ? 'danger' : undefined}
            sub={
              offeneZahlungen.anzahl === 0
                ? 'alles bezahlt'
                : `${offeneZahlungen.anzahl} offen${
                    offeneZahlungen.faellig > 0 ? `, ${offeneZahlungen.faellig} davon fällig` : ''
                  }`
            }
          />
          <Stat
            label="Bereit zur Ablage"
            value={overview.counts.ready_to_archive ?? 0}
            tone="good"
            sub="Papierrechnung kann weggelegt werden"
          />
        </div>
      ) : null}

      <div className="card space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32">
            <label className="label">Jahr</label>
            <select className="input" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">alle</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="w-40">
            <label className="label">Patient</label>
            <select className="input" value={member} onChange={(e) => setMember(e.target.value)}>
              <option value="">alle</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-48">
            <label className="label">Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">alle</option>
              {Object.entries(OVERALL_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-48 flex-1">
            <label className="label">Suche (Arzt, Nummer, Notiz)</label>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="z.B. Dr. Müller"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
            abgeschlossene ausblenden
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={nurUnbezahlt}
              onChange={(e) => setNurUnbezahlt(e.target.checked)}
            />
            nur unbezahlte
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            abgelegte laden
          </label>
          <div className="flex gap-2 pb-1">
            <a className="btn-secondary" href={`/api/excel/export${year ? `?year=${year}` : ''}`}>
              Excel-Export
            </a>
            <Link className="btn-primary" to="/rechnung-neu">
              + Rechnung
            </Link>
          </div>
        </div>

        {invoices === null ? (
          <Spinner />
        ) : invoices.length === 0 ? (
          <EmptyState title="Keine Rechnungen gefunden">
            Lade oben rechts eine Rechnung hoch oder importiere deine bisherige Excel-Tabelle.
          </EmptyState>
        ) : (
          <>
            {/* Sonst wirkt die Liste unvollständig, ohne dass klar ist warum. */}
            {ausgeblendet > 0 ? (
              <p className="text-sm text-slate-500">
                {ausgeblendet} abgeschlossene {ausgeblendet === 1 ? 'Rechnung' : 'Rechnungen'}{' '}
                ausgeblendet.{' '}
                <button className="text-brand-700 hover:underline" onClick={() => setHideDone(false)}>
                  alle anzeigen
                </button>
              </p>
            ) : null}

            {ablegbar.length > 1 ? (
              <p className="text-sm">
                <button className="btn-secondary" onClick={alleAblegen}>
                  {ablegbar.length} erledigte Rechnungen auf einmal ablegen
                </button>
              </p>
            ) : null}

            {sichtbar.length === 0 ? (
              <EmptyState title="Alles erledigt">
                Zu den {invoices.length} gefundenen Rechnungen ist nichts mehr offen.{' '}
                <button className="text-brand-700 hover:underline" onClick={() => setHideDone(false)}>
                  Abgeschlossene einblenden
                </button>
              </EmptyState>
            ) : null}

            <div className={`overflow-x-auto ${sichtbar.length === 0 ? 'hidden' : ''}`}>
              <table className="min-w-full divide-y divide-slate-200">
                <thead>
                  <tr>
                    <SortableTh label="Rechnung" sortKey="invoice_date" sort={sort} onSort={onSort} />
                    <SortableTh label="Behandlung" sortKey="treatment_date" sort={sort} onSort={onSort} />
                    <SortableTh label="Patient" sortKey="member_name" sort={sort} onSort={onSort} />
                    <SortableTh label="Arzt" sortKey="doctor" sort={sort} onSort={onSort} />
                    <SortableTh label="Nummer" sortKey="invoice_number" sort={sort} onSort={onSort} />
                    <SortableTh label="Betrag" sortKey="amount" sort={sort} onSort={onSort} align="right" />
                    <SortableTh label="Zahlung" sortKey="payment" sort={sort} onSort={onSort} />
                    <SortableTh label={targetLabel('beihilfe')} sortKey="beihilfe" sort={sort} onSort={onSort} />
                    <SortableTh label={targetLabel('dbv')} sortKey="dbv" sort={sort} onSort={onSort} />
                    <SortableTh label="Erstattet" sortKey="paid_total" sort={sort} onSort={onSort} align="right" />
                    <SortableTh label="Offen" sortKey="open_amount" sort={sort} onSort={onSort} align="right" />
                    <SortableTh label="Gesamt" sortKey="overall_status" sort={sort} onSort={onSort} />
                    <th className="th">Beleg</th>
                    <th className="th">Ablage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(sortedInvoices ?? []).map((inv) => {
                    const bh = inv.submissions.find((s) => s.target === 'beihilfe');
                    const dbv = inv.submissions.find((s) => s.target === 'dbv');
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50">
                        <td className="td">
                          <Link className="font-medium text-brand-700 hover:underline" to={`/rechnung/${inv.id}`}>
                            {date(inv.invoice_date)}
                          </Link>
                        </td>
                        <td className="td text-slate-500">{date(inv.treatment_date)}</td>
                        <td className="td">{inv.member_name}</td>
                        <td className="td max-w-56 truncate" title={inv.doctor}>
                          {inv.doctor || '–'}
                        </td>
                        <td className="td text-slate-500">{inv.invoice_number || '–'}</td>
                        <td className="td text-right font-medium">{money(inv.amount)}</td>
                        <td className="td whitespace-nowrap">
                          {inv.paid_to_doctor_date ? (
                            <span
                              className="text-emerald-700"
                              title={`Am ${date(inv.paid_to_doctor_date)} an den Arzt gezahlt`}
                            >
                              ✓ bezahlt
                            </span>
                          ) : (
                            <span className="flex flex-wrap items-center gap-2">
                              <button
                                className="rounded-lg border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                                onClick={() =>
                                  api
                                    .markPaid(inv.id)
                                    .then(neuLaden)
                                    .catch((e: Error) => setError(e.message))
                                }
                                title="Zahlung an den Arzt mit heutigem Datum bestätigen"
                              >
                                bezahlt
                              </button>
                              {inv.payment_due_date ? (
                                <PaymentDue due={inv.payment_due_date} paid={null} />
                              ) : null}
                            </span>
                          )}
                        </td>
                        <td className="td">{bh ? <StatusBadge status={bh.status} /> : '–'}</td>
                        <td className="td">{dbv ? <StatusBadge status={dbv.status} /> : '–'}</td>
                        <td className="td text-right">{money(inv.paid_total)}</td>
                        <td className={`td text-right ${inv.open_amount > 0.005 ? 'text-amber-700' : 'text-slate-400'}`}>
                          {money(inv.open_amount)}
                        </td>
                        <td className="td">
                          <OverallBadge status={inv.overall_status} />
                        </td>
                        <td className="td">
                          {inv.file_path ? (
                            <button
                              className="text-brand-700 hover:underline"
                              onClick={() => setPreview(inv)}
                              title="Beleg ansehen"
                            >
                              ansehen
                            </button>
                          ) : (
                            <span className="text-slate-300">–</span>
                          )}
                        </td>
                        <td className="td whitespace-nowrap">
                          {inv.archived_at ? (
                            <button
                              className="text-xs text-slate-400 hover:text-slate-700 hover:underline"
                              onClick={() => setArchive(inv.id, false)}
                              title={`Abgelegt am ${date(inv.archived_at)} – zurückholen`}
                            >
                              zurückholen
                            </button>
                          ) : (
                            <button
                              className={`rounded-lg border px-2 py-1 text-xs font-medium ${
                                inv.ready_to_archive
                                  ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                                  : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                              }`}
                              onClick={() => setArchive(inv.id, true)}
                              title={
                                inv.ready_to_archive
                                  ? 'Vollständig erledigt – Papierrechnung ablegen'
                                  : 'Noch nicht abgeschlossen – trotzdem ablegen'
                              }
                            >
                              ablegen
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-semibold">
                    <td className="td" colSpan={5}>
                      {sichtbar.length} Rechnungen
                    </td>
                    <td className="td text-right">{money(totals.amount)}</td>
                    <td className="td text-slate-600">
                      {totals.unbezahlt > 0.005 ? `${money(totals.unbezahlt)} offen` : 'alles bezahlt'}
                    </td>
                    <td className="td" colSpan={2} />
                    <td className="td text-right">{money(totals.paid)}</td>
                    <td className="td text-right">{money(totals.open)}</td>
                    <td className="td" colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>

      {preview?.file_path ? (
        <DocumentDialog
          src={`/api/invoices/${preview.id}/file`}
          name={preview.file_path}
          title={`${preview.member_name} · ${preview.doctor} · ${date(preview.invoice_date)}`}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
