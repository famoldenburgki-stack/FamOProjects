import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { date, daysUntil, money } from '../format';
import { Alert, EmptyState, Spinner } from '../components/ui';
import type { SubmitGroup, SubmitItem } from '../types';

/**
 * Einreichen. Die App meldet sich nicht selbst an – sie legt die Belege bereit,
 * nennt Anzahl und Gesamtsumme für die Beihilfe-Maske und hakt anschließend
 * alles auf einmal ab.
 */
export default function Submit() {
  const [groups, setGroups] = useState<SubmitGroup[] | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  /** Abgewählte Einreichungen je Gruppe – standardmäßig ist alles ausgewählt. */
  const [abgewaehlt, setAbgewaehlt] = useState<Record<number, true>>({});
  const [busy, setBusy] = useState(false);

  function laden() {
    api
      .submitGroups()
      .then((r) => setGroups(r.groups))
      .catch((e: Error) => setError(e.message));
  }

  useEffect(() => {
    laden();
    api
      .settings()
      .then((s) =>
        setLinks({ beihilfe: s.settings.link_beihilfe ?? '', dbv: s.settings.link_dbv ?? '' }),
      )
      .catch(() => undefined);
  }, []);

  if (error && !groups) return <Alert kind="error">{error}</Alert>;
  if (!groups) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Einreichen</h1>
        <p className="text-sm text-slate-600">
          Alles, was noch bei Beihilfe oder DBV liegen bleibt – getrennt nach Zugang, weil du dich
          für jeden einzeln anmeldest. Die App legt die Belege bereit und hakt sie hinterher ab;
          anmelden und absenden machst du selbst im Portal.
        </p>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}
      {info ? <Alert kind="success">{info}</Alert> : null}

      {groups.length === 0 ? (
        <EmptyState title="Nichts offen">
          Jede Rechnung ist bei beiden Stellen eingereicht. 👍
        </EmptyState>
      ) : null}

      {groups.map((g) => (
        <Gruppe
          key={`${g.target}-${g.account}`}
          gruppe={g}
          link={links[g.target] ?? ''}
          abgewaehlt={abgewaehlt}
          setAbgewaehlt={setAbgewaehlt}
          busy={busy}
          setBusy={setBusy}
          onFehler={setError}
          onInfo={(m) => {
            setInfo(m);
            setError(null);
          }}
          neuLaden={laden}
          setGroups={setGroups}
        />
      ))}
    </div>
  );
}

function Gruppe({
  gruppe,
  link,
  abgewaehlt,
  setAbgewaehlt,
  busy,
  setBusy,
  onFehler,
  onInfo,
  setGroups,
}: {
  gruppe: SubmitGroup;
  link: string;
  abgewaehlt: Record<number, true>;
  setAbgewaehlt: (f: (a: Record<number, true>) => Record<number, true>) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onFehler: (m: string) => void;
  onInfo: (m: string) => void;
  neuLaden: () => void;
  setGroups: (g: SubmitGroup[]) => void;
}) {
  const gewaehlt = useMemo(
    () => gruppe.items.filter((i) => !abgewaehlt[i.submission_id]),
    [gruppe.items, abgewaehlt],
  );
  const summe = gewaehlt.reduce((s, i) => s + i.amount, 0);
  const ohneDatei = gewaehlt.filter((i) => !i.has_file).length;

  const umschalten = (id: number) =>
    setAbgewaehlt((a) => {
      const neu = { ...a };
      if (neu[id]) delete neu[id];
      else neu[id] = true;
      return neu;
    });

  const alle = (an: boolean) =>
    setAbgewaehlt((a) => {
      const neu = { ...a };
      for (const i of gruppe.items) {
        if (an) delete neu[i.submission_id];
        else neu[i.submission_id] = true;
      }
      return neu;
    });

  async function vorbereiten() {
    setBusy(true);
    try {
      const r = await api.prepareSubmission(gewaehlt.map((i) => i.submission_id));
      onInfo(
        `${r.copied} Belege liegen bereit in ${r.folder}` +
          (r.missing.length ? ` – ${r.missing.length} ohne Datei, siehe „00 Übersicht.txt".` : '.'),
      );
    } catch (e) {
      onFehler((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function abhaken() {
    if (
      !window.confirm(
        `${gewaehlt.length} Einreichungen bei ${gruppe.target_label} (${gruppe.account}) ` +
          `mit heutigem Datum als eingereicht markieren?\n\n` +
          `Gesamtbetrag ${money(summe)}.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const r = await api.markSubmitted(gewaehlt.map((i) => i.submission_id));
      setGroups(r.groups);
      onInfo(`${r.marked} Einreichungen auf „eingereicht am ${date(r.date)}" gesetzt.`);
    } catch (e) {
      onFehler((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">
            {gruppe.target_label} · Zugang {gruppe.account}
          </h2>
          <p className="text-sm text-slate-600">
            {gruppe.count} offene {gruppe.count === 1 ? 'Rechnung' : 'Rechnungen'} · erwartete
            Erstattung {money(gruppe.expected_total)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {link ? (
            <a className="btn-secondary" href={link} target="_blank" rel="noreferrer">
              {gruppe.target_label} öffnen ↗
            </a>
          ) : null}
          <button className="btn-secondary" disabled={busy || gewaehlt.length === 0} onClick={vorbereiten}>
            📁 Belege bereitlegen
          </button>
          <button className="btn-primary" disabled={busy || gewaehlt.length === 0} onClick={abhaken}>
            Als eingereicht abhaken
          </button>
        </div>
      </div>

      {/*
        Die Beihilfe fragt in ihrer Maske Anzahl und Gesamtbetrag ab – deshalb
        stehen beide groß da und zählen mit, wenn du einzelne Belege abwählst.
      */}
      <div className="flex flex-wrap gap-6 rounded-lg bg-brand-50 px-4 py-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Anzahl Belege</div>
          <div className="text-2xl font-semibold tabular-nums">{gewaehlt.length}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Gesamtbetrag</div>
          <div className="text-2xl font-semibold tabular-nums">{money(summe)}</div>
        </div>
        {gewaehlt.length !== gruppe.count ? (
          <div className="self-end text-sm text-slate-600">
            {gruppe.count - gewaehlt.length} abgewählt ·{' '}
            <button className="text-brand-700 hover:underline" onClick={() => alle(true)}>
              alle wieder auswählen
            </button>
          </div>
        ) : (
          <div className="self-end text-sm text-slate-500">
            <button className="text-brand-700 hover:underline" onClick={() => alle(false)}>
              alle abwählen
            </button>
          </div>
        )}
      </div>

      {ohneDatei > 0 ? (
        <Alert kind="warning">
          {ohneDatei} der gewählten Belege haben keine hinterlegte Datei – die musst du selbst
          heraussuchen. Sie stehen im Merkzettel des Sammelordners.
        </Alert>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead>
            <tr>
              <th className="th w-8"> </th>
              <th className="th">Nr.</th>
              <th className="th">Rechnung</th>
              <th className="th">Patient</th>
              <th className="th">Arzt</th>
              <th className="th text-right">Betrag</th>
              <th className="th">Beleg</th>
              <th className="th">Frist</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {gruppe.items.map((i, index) => (
              <Zeile
                key={i.submission_id}
                item={i}
                nummer={gewaehlt.indexOf(i) >= 0 ? gewaehlt.indexOf(i) + 1 : null}
                index={index}
                aus={Boolean(abgewaehlt[i.submission_id])}
                onToggle={() => umschalten(i.submission_id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Zeile({
  item,
  nummer,
  aus,
  onToggle,
}: {
  item: SubmitItem;
  nummer: number | null;
  index: number;
  aus: boolean;
  onToggle: () => void;
}) {
  const tage = daysUntil(item.deadline);
  return (
    <tr className={aus ? 'text-slate-400' : 'hover:bg-slate-50'}>
      <td className="td">
        <input type="checkbox" checked={!aus} onChange={onToggle} />
      </td>
      <td className="td tabular-nums text-slate-500">{nummer ?? '–'}</td>
      <td className="td">
        <Link className="font-medium text-brand-700 hover:underline" to={`/rechnung/${item.invoice_id}`}>
          {date(item.invoice_date)}
        </Link>
        {item.invoice_number ? (
          <span className="ml-2 text-xs text-slate-400">Nr. {item.invoice_number}</span>
        ) : null}
      </td>
      <td className="td">
        {item.member_name}
        {item.archived ? (
          <span className="ml-2 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-500">
            abgelegt
          </span>
        ) : null}
      </td>
      <td className="td max-w-56 truncate" title={item.doctor}>
        {item.doctor || '–'}
      </td>
      <td className="td text-right font-medium tabular-nums">{money(item.amount)}</td>
      <td className="td">
        {item.has_file ? (
          <span className="text-emerald-700" title={item.file_name ?? ''}>
            ✓
          </span>
        ) : (
          <span className="text-amber-700" title="Keine Datei hinterlegt">
            fehlt
          </span>
        )}
      </td>
      <td className="td whitespace-nowrap text-sm">
        {tage === null ? (
          <span className="text-slate-400">–</span>
        ) : tage < 0 ? (
          <span className="font-medium text-red-700">{-tage} Tage abgelaufen</span>
        ) : tage <= 42 ? (
          <span className="text-amber-700">noch {tage} Tage</span>
        ) : (
          <span className="text-slate-500">{date(item.deadline)}</span>
        )}
      </td>
    </tr>
  );
}
