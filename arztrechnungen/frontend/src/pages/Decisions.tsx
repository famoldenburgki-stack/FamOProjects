import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { date, money } from '../format';
import { Alert, EmptyState, Spinner, Stat } from '../components/ui';
import { DocumentDialog } from '../components/DocumentView';
import { SortableTh, compareValues, type SortState } from '../components/SortableTh';
import type { DecisionSummary } from '../types';

type SortKey = 'decision_date' | 'target' | 'account' | 'total_paid' | 'item_count' | 'unmatched_count';

const dateiName = (p: string | null) => (p ? p.split(/[\\/]/).pop() ?? '' : '');

/**
 * Übersicht aller eingelesenen Bescheide von Beihilfe und DBV. Sitzt unterhalb
 * des Uploads auf derselben Seite – zwei getrennte Listen wären dasselbe zweimal.
 */
export default function DecisionList({ reload }: { reload?: number }) {
  const [decisions, setDecisions] = useState<DecisionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [ansicht, setAnsicht] = useState<DecisionSummary | null>(null);
  const [absender, setAbsender] = useState<string>('');
  const [jahr, setJahr] = useState<string>('');
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'decision_date', dir: 'desc' });

  function laden() {
    api.listDecisions().then(setDecisions).catch((e: Error) => setError(e.message));
  }
  // `reload` erhöht der Upload-Teil nach einer Prüfung, damit die Liste nachzieht.
  useEffect(laden, [reload]);

  const jahre = useMemo(
    () =>
      [...new Set((decisions ?? []).map((d) => (d.decision_date ?? '').slice(0, 4)).filter(Boolean))].sort(
        (a, b) => b.localeCompare(a),
      ),
    [decisions],
  );

  const gefiltert = useMemo(() => {
    let list = decisions ?? [];
    if (absender) list = list.filter((d) => d.target === absender);
    if (jahr) list = list.filter((d) => (d.decision_date ?? '').startsWith(jahr));
    return [...list].sort((a, b) =>
      compareValues(
        (a as unknown as Record<string, unknown>)[sort.key],
        (b as unknown as Record<string, unknown>)[sort.key],
        sort.dir,
      ),
    );
  }, [decisions, absender, jahr, sort]);

  const summen = useMemo(() => {
    const bh = gefiltert.filter((d) => d.target === 'beihilfe');
    const dbv = gefiltert.filter((d) => d.target === 'dbv');
    const sum = (l: DecisionSummary[]) => l.reduce((s, d) => s + (d.total_paid ?? 0), 0);
    return { bh: bh.length, dbv: dbv.length, bhSum: sum(bh), dbvSum: sum(dbv) };
  }, [gefiltert]);

  const onSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  async function entfernen(d: DecisionSummary) {
    const stelle = d.target === 'beihilfe' ? 'Beihilfe' : 'DBV';
    /*
     * Ehrlich benennen, was passiert: Beträge, die dieser Bescheid schon in die
     * Rechnungen geschrieben hat, bleiben dort stehen – die App kennt keine
     * früheren Werte, auf die sie zurücksetzen könnte.
     */
    const text = [
      `Bescheid der ${stelle} vom ${date(d.decision_date)} aus der App entfernen?`,
      '',
      `• Die Datei selbst bleibt erhalten (${d.file_path ?? 'kein Pfad'}).`,
      `• Die ${d.item_count} erfassten Positionen werden gelöscht.`,
      '• Bereits in die Rechnungen übernommene Erstattungsbeträge bleiben stehen',
      '  und müssen bei Bedarf von Hand korrigiert werden.',
    ].join('\n');

    if (!window.confirm(text)) return;
    try {
      await api.deleteDecision(d.id);
      setHinweis(`Bescheid der ${stelle} vom ${date(d.decision_date)} entfernt. Die Datei ist erhalten.`);
      laden();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      {error ? <Alert kind="error">{error}</Alert> : null}
      {hinweis ? <Alert kind="success">{hinweis}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Bescheide Beihilfe" value={summen.bh} sub={`${money(summen.bhSum)} ausgewiesen`} />
        <Stat label="Bescheide DBV" value={summen.dbv} sub={`${money(summen.dbvSum)} ausgewiesen`} />
        <Stat label="Erfasste Positionen" value={gefiltert.reduce((s, d) => s + d.item_count, 0)} />
        <Stat
          label="Ohne Rechnung"
          value={gefiltert.reduce((s, d) => s + d.unmatched_count, 0)}
          sub="Positionen ohne zugeordnete Rechnung"
        />
      </div>

      <div className="card space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Vorliegende Bescheide</h1>
          <p className="text-sm text-slate-600">
            Alle eingelesenen Bescheide von Beihilfe und DBV. Über <em>ansehen</em> öffnet sich das
            Original, über das Datum die Auswertung mit allen Positionen.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <label className="label">Absender</label>
            <select className="input" value={absender} onChange={(e) => setAbsender(e.target.value)}>
              <option value="">alle</option>
              <option value="beihilfe">Beihilfe</option>
              <option value="dbv">DBV</option>
            </select>
          </div>
          <div className="w-32">
            <label className="label">Jahr</label>
            <select className="input" value={jahr} onChange={(e) => setJahr(e.target.value)}>
              <option value="">alle</option>
              {jahre.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </div>
        </div>

        {decisions === null ? (
          <Spinner />
        ) : gefiltert.length === 0 ? (
          <EmptyState title="Keine Bescheide vorhanden">
            Lade unter <em>Bescheid prüfen</em> einen Bescheid hoch.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead>
                <tr>
                  <SortableTh label="Bescheid vom" sortKey="decision_date" sort={sort} onSort={onSort} />
                  <SortableTh label="Absender" sortKey="target" sort={sort} onSort={onSort} />
                  <SortableTh label="Zugang" sortKey="account" sort={sort} onSort={onSort} />
                  <SortableTh label="Erstattung" sortKey="total_paid" sort={sort} onSort={onSort} align="right" />
                  <SortableTh label="Positionen" sortKey="item_count" sort={sort} onSort={onSort} align="right" />
                  <SortableTh label="ohne Rechnung" sortKey="unmatched_count" sort={sort} onSort={onSort} align="right" />
                  <th className="th">Datei</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gefiltert.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="td whitespace-nowrap font-medium">{date(d.decision_date)}</td>
                    <td className="td">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          d.target === 'beihilfe'
                            ? 'bg-brand-50 text-brand-700'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {d.target === 'beihilfe' ? 'Beihilfe' : 'DBV'}
                      </span>
                    </td>
                    <td className="td">{d.account}</td>
                    <td className="td text-right">{d.total_paid !== null ? money(d.total_paid) : '–'}</td>
                    <td className="td text-right">{d.item_count}</td>
                    <td
                      className={`td text-right ${d.unmatched_count > 0 ? 'text-amber-700' : 'text-slate-400'}`}
                    >
                      {d.unmatched_count}
                    </td>
                    <td className="td max-w-72 truncate text-xs text-slate-500" title={d.file_path ?? ''}>
                      {dateiName(d.file_path)}
                    </td>
                    <td className="td whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        {d.file_path ? (
                          <button
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            onClick={() => setAnsicht(d)}
                          >
                            ansehen
                          </button>
                        ) : null}
                        <button
                          className="rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                          onClick={() => entfernen(d)}
                          title="Bescheid aus der App löschen – die Datei bleibt erhalten"
                        >
                          löschen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {ansicht?.file_path ? (
        <DocumentDialog
          src={`/api/decisions/${ansicht.id}/file`}
          name={ansicht.file_path}
          title={`${ansicht.target === 'beihilfe' ? 'Beihilfe' : 'DBV'} · Bescheid vom ${date(ansicht.decision_date)}`}
          onClose={() => setAnsicht(null)}
        />
      ) : null}
    </div>
  );
}
