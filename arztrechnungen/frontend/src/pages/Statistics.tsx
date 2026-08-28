import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api';
import { money, targetLabel } from '../format';
import { Alert, EmptyState, Spinner } from '../components/ui';
import { CHART, SERIES, STATUS, axisProps, eur, eurExact } from '../components/charts';
import type { Stats } from '../types';

export default function Statistics() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catYear, setCatYear] = useState<string>('');

  useEffect(() => {
    api
      .stats()
      .then((s) => {
        setStats(s);
        const last = s.years.at(-1)?.year;
        if (last) setCatYear(last);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const memberChart = useMemo(() => {
    if (!stats) return { data: [], members: [] as string[] };
    const members = [...new Set(stats.by_member.map((r) => r.member))];
    const byYear = new Map<string, Record<string, number | string>>();
    for (const row of stats.by_member) {
      const e = byYear.get(row.year) ?? { year: row.year };
      e[row.member] = row.total;
      byYear.set(row.year, e);
    }
    return {
      data: [...byYear.values()].sort((a, b) => String(a.year).localeCompare(String(b.year))),
      members,
    };
  }, [stats]);

  const categoryData = useMemo(() => {
    if (!stats) return [];
    return stats.by_category
      .filter((r) => !catYear || r.year === catYear)
      .reduce<{ category: string; total: number; count: number }[]>((acc, r) => {
        const found = acc.find((x) => x.category === r.category);
        if (found) {
          found.total += r.total;
          found.count += r.count;
        } else acc.push({ category: r.category, total: r.total, count: r.count });
        return acc;
      }, [])
      .sort((a, b) => b.total - a.total);
  }, [stats, catYear]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!stats) return <Spinner />;
  if (stats.years.length === 0)
    return (
      <EmptyState title="Noch keine Daten für Auswertungen">
        Sobald Rechnungen erfasst oder importiert sind, erscheinen hier Trend, Behandlungsarten,
        Beitragsrückerstattung und Kürzungsmuster.
      </EmptyState>
    );

  const years = stats.years.map((y) => y.year);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Statistik &amp; Entwicklung</h1>
        <p className="text-sm text-slate-600">
          Wohin die Kosten laufen, was erstattet wird und was du selbst getragen hast.
        </p>
      </div>

      {/* --- Jahresverlauf --- */}
      <div className="card">
        <h2 className="font-semibold">Kostenentwicklung pro Jahr</h2>
        <p className="mb-4 text-sm text-slate-500">
          Aufgeteilt nach der Erstattung beider Stellen und dem selbst getragenen Anteil
          (Eigenanteil erst gezählt, wenn beide Stellen entschieden haben).
        </p>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <BarChart data={stats.years} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="year" {...axisProps} />
              <YAxis tickFormatter={(v: number) => eur(v)} width={80} {...axisProps} />
              <Tooltip
                formatter={(v: number, name: string) => [eurExact(v), name]}
                contentStyle={{ borderRadius: 8, border: `1px solid ${CHART.grid}`, fontSize: 13 }}
              />
              <Legend wrapperStyle={{ fontSize: 13, color: CHART.text }} />
              <Bar dataKey="paid_beihilfe" name={`${targetLabel('beihilfe')} erstattet`} stackId="a" fill={SERIES[0]} stroke={CHART.surface} strokeWidth={2} />
              <Bar dataKey="paid_dbv" name={`${targetLabel('dbv')} erstattet`} stackId="a" fill={SERIES[2]} stroke={CHART.surface} strokeWidth={2} />
              <Bar
                dataKey="own_share"
                name="selbst getragen"
                stackId="a"
                fill={SERIES[1]}
                stroke={CHART.surface}
                strokeWidth={2}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-right">
            <thead>
              <tr>
                <th className="th text-left">Jahr</th>
                <th className="th text-right">Rechnungen</th>
                <th className="th text-right">Summe</th>
                <th className="th text-right">{targetLabel('beihilfe')}</th>
                <th className="th text-right">{targetLabel('dbv')}</th>
                <th className="th text-right">erstattet</th>
                <th className="th text-right">selbst getragen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {stats.years.map((y) => (
                <tr key={y.year}>
                  <td className="td text-left font-medium">{y.year}</td>
                  <td className="td">{y.count}</td>
                  <td className="td">{money(y.total)}</td>
                  <td className="td">{money(y.paid_beihilfe)}</td>
                  <td className="td">{money(y.paid_dbv)}</td>
                  <td className="td">{money(y.paid_total)}</td>
                  <td className="td">{money(y.own_share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- Pro Person --- */}
      <div className="card">
        <h2 className="font-semibold">Rechnungssummen pro Person</h2>
        <p className="mb-4 text-sm text-slate-500">Wer verursacht welchen Anteil der Kosten?</p>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <BarChart data={memberChart.data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="year" {...axisProps} />
              <YAxis tickFormatter={(v: number) => eur(v)} width={80} {...axisProps} />
              <Tooltip
                formatter={(v: number, name: string) => [eurExact(v), name]}
                contentStyle={{ borderRadius: 8, border: `1px solid ${CHART.grid}`, fontSize: 13 }}
              />
              <Legend wrapperStyle={{ fontSize: 13, color: CHART.text }} />
              {memberChart.members.map((m, i) => (
                <Bar
                  key={m}
                  dataKey={m}
                  name={m}
                  stackId="p"
                  fill={SERIES[i % SERIES.length]}
                  stroke={CHART.surface}
                  strokeWidth={2}
                  radius={i === memberChart.members.length - 1 ? [4, 4, 0, 0] : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead>
              <tr>
                <th className="th text-left">Jahr</th>
                {memberChart.members.map((m, i) => (
                  <th key={m} className="th text-right">
                    <span
                      className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                      style={{ background: SERIES[i % SERIES.length] }}
                    />
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {memberChart.data.map((row) => (
                <tr key={String(row.year)}>
                  <td className="td text-left font-medium">{String(row.year)}</td>
                  {memberChart.members.map((m) => (
                    <td key={m} className="td text-right">
                      {row[m] ? money(Number(row[m])) : '–'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- Behandlungsarten --- */}
      <div className="card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Kosten nach Behandlungsart</h2>
            <p className="text-sm text-slate-500">Zeigt, welche Bereiche die Kosten treiben.</p>
          </div>
          <div className="w-32">
            <label className="label">Jahr</label>
            <select className="input" value={catYear} onChange={(e) => setCatYear(e.target.value)}>
              <option value="">alle Jahre</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 w-full" style={{ height: Math.max(220, categoryData.length * 38) }}>
          <ResponsiveContainer>
            <BarChart data={categoryData} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
              <CartesianGrid stroke={CHART.grid} horizontal={false} />
              <XAxis type="number" tickFormatter={(v: number) => eur(v)} {...axisProps} />
              <YAxis type="category" dataKey="category" width={130} {...axisProps} />
              <Tooltip
                formatter={(v: number) => [eurExact(v), 'Rechnungssumme']}
                contentStyle={{ borderRadius: 8, border: `1px solid ${CHART.grid}`, fontSize: 13 }}
              />
              <Bar dataKey="total" name="Rechnungssumme" fill={SERIES[0]} radius={[0, 4, 4, 0]} barSize={20}>
                {categoryData.map((_, i) => (
                  <Cell key={i} fill={SERIES[0]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* --- Beitragsrückerstattung --- */}
      <div className="card">
        <h2 className="font-semibold">Beitragsrückerstattung ({targetLabel('dbv')}) – Stand {new Date().getFullYear()}</h2>
        <p className="mb-4 text-sm text-slate-500">
          Summe der bei {targetLabel('dbv')} eingereichten Erstattungsansprüche gegen die Schwelle deines Tarifs.
          Schwellen trägst du in den Einstellungen pro Person ein.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stats.bre.map((b) => {
            const tone =
              b.state === 'ueberschritten'
                ? { color: STATUS.critical, icon: '●', label: 'Schwelle überschritten' }
                : b.state === 'knapp'
                  ? { color: STATUS.warning, icon: '▲', label: 'knapp unter der Schwelle' }
                  : b.state === 'ok'
                    ? { color: STATUS.good, icon: '✓', label: 'im grünen Bereich' }
                    : { color: CHART.muted, icon: '–', label: 'keine Schwelle hinterlegt' };
            return (
              <div key={b.member_id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{b.member}</p>
                  <span className="text-sm" style={{ color: tone.color }}>
                    {tone.icon} {tone.label}
                  </span>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{money(b.submitted_dbv)}</p>
                <p className="text-xs text-slate-500">
                  aus {b.invoice_count} eingereichten Rechnungen
                  {b.threshold !== null ? ` · Schwelle ${money(b.threshold)}` : ''}
                </p>
                {b.remaining !== null ? (
                  <p className="mt-1 text-sm">
                    {b.remaining >= 0
                      ? `noch ${money(b.remaining)} Puffer bis zur Schwelle`
                      : `${money(-b.remaining)} über der Schwelle`}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* --- Kürzungsmuster --- */}
      <div className="card">
        <h2 className="font-semibold">Kürzungen und Ablehnungen</h2>
        <p className="mb-4 text-sm text-slate-500">
          {stats.rejections.affected_submissions} von {stats.rejections.total_decided_submissions}{' '}
          beschiedenen Einreichungen wurden gekürzt oder abgelehnt.
        </p>
        {stats.rejections.by_reason.length === 0 ? (
          <p className="text-sm text-slate-500">Bisher keine Kürzungen erfasst.</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Häufigste Gründe
              </h3>
              <table className="min-w-full divide-y divide-slate-200">
                <thead>
                  <tr>
                    <th className="th">Grund</th>
                    <th className="th text-right">Fälle</th>
                    <th className="th text-right">Summe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.rejections.by_reason.map((r) => (
                    <tr key={r.reason}>
                      <td className="td whitespace-normal">{r.reason}</td>
                      <td className="td text-right tabular-nums">{r.count}</td>
                      <td className="td text-right tabular-nums">{money(r.missing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Auffällige Ärzte
              </h3>
              <table className="min-w-full divide-y divide-slate-200">
                <thead>
                  <tr>
                    <th className="th">Arzt</th>
                    <th className="th text-right">Fälle</th>
                    <th className="th text-right">Summe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.rejections.by_doctor.map((d) => (
                    <tr key={d.doctor}>
                      <td className="td whitespace-normal">
                        {d.doctor}
                        <span className="block text-xs text-slate-500">{d.reasons.join(', ')}</span>
                      </td>
                      <td className="td text-right tabular-nums">{d.count}</td>
                      <td className="td text-right tabular-nums">{money(d.missing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
