import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api';
import { date, money, targetLabel } from '../format';
import { Alert, Field, Spinner, Stat } from '../components/ui';
import type { DecisionResult, Member, ProcessedItem } from '../types';
import DecisionList from './Decisions';

export default function DecisionUpload() {
  const [members, setMembers] = useState<Member[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  /*
   * Absender und Zugang bleiben leer: die App bestimmt sie aus dem Dokument. Die
   * Auswahl erscheint erst, wenn das nicht gelingt – siehe `nachfragen`.
   */
  const [target, setTarget] = useState<'' | 'beihilfe' | 'dbv'>('');
  const [account, setAccount] = useState('');
  const [nachfragen, setNachfragen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DecisionResult | null>(null);
  /** Wird erhöht, damit die Liste darunter nach einer Prüfung neu lädt. */
  const [reloadZaehler, setReloadZaehler] = useState(0);

  useEffect(() => {
    api.members().then((m) => {
      setMembers(m);
      setAccounts([...new Set(m.map((x) => x.account))]);
    });
  }, []);

  const loadHistory = () => setReloadZaehler((n) => n + 1);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.uploadDecision(file, target || undefined, account || undefined);
      setResult(res);
      setNachfragen(false);
      // Nach einer erfolgreichen Prüfung wieder auf Automatik zurück.
      setTarget('');
      setAccount('');
      loadHistory();
    } catch (e) {
      setError((e as Error).message);
      /*
       * Nur wenn das Dokument den Absender nicht hergibt, erscheinen die
       * Auswahlfelder – die Datei bleibt dabei ausgewählt, ein zweites Suchen im
       * Dateisystem ist nicht nötig.
       */
      if (e instanceof ApiError && e.needs_choice) {
        setNachfragen(true);
        if (e.suggestion?.account) setAccount(e.suggestion.account);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Bescheid hochladen und prüfen</h1>
          <p className="mt-1 text-sm text-slate-600">
            Datei auswählen, fertig. Von welcher der beiden Stellen der Bescheid kommt und über
            welchen Zugang er kam, erkennt die App selbst; sie liest die Positionen aus, ordnet sie
            den eingereichten Rechnungen zu, vergleicht die Erstattung mit dem erwarteten Betrag und
            meldet dir das Ergebnis. Nachgefragt wird nur, wenn der Absender im Dokument nicht
            steht.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Datei (PDF oder Foto)">
            <input
              type="file"
              className="input"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                // Neue Datei, neuer Versuch: erst wieder automatisch erkennen.
                setNachfragen(false);
                setTarget('');
                setError(null);
              }}
            />
          </Field>
          {nachfragen ? (
            <>
              <Field label="Von wem ist der Bescheid? *">
                <select
                  className="input"
                  value={target}
                  onChange={(e) => setTarget(e.target.value as '' | 'beihilfe' | 'dbv')}
                >
                  <option value="">bitte wählen</option>
                  <option value="beihilfe">{targetLabel('beihilfe')}</option>
                  <option value="dbv">{targetLabel('dbv')}</option>
                </select>
              </Field>
              <Field
                label="Aus welchem Zugang?"
                hint="Schränkt die Zuordnung auf die dort versicherten Personen ein."
              >
                <select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a} value={a}>
                      {a} ({members.filter((m) => m.account === a).map((m) => m.name).join(', ')})
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : null}
        </div>
        <button
          className="btn-primary"
          disabled={!file || busy || (nachfragen && !target)}
          onClick={upload}
        >
          {busy ? 'Bescheid wird geprüft …' : nachfragen ? 'Erneut prüfen' : 'Bescheid prüfen'}
        </button>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}
      {busy ? <Spinner label="Text wird ausgelesen und mit den Einreichungen verglichen …" /> : null}

      {result ? <DecisionResultView result={result} onRefresh={loadHistory} /> : null}

      {/* Eine einzige Liste – die Übersicht sitzt direkt unter dem Upload. */}
      <DecisionList reload={reloadZaehler} />
    </div>
  );
}

function DecisionResultView({ result, onRefresh }: { result: DecisionResult; onRefresh: () => void }) {
  const [items, setItems] = useState<ProcessedItem[]>(result.items);
  const s = result.summary;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Erkannte Positionen" value={s.detected} sub={`${s.applied} automatisch zugeordnet`} />
        <Stat
          label="Vollständig erstattet"
          value={s.fully_paid}
          tone={s.fully_paid > 0 ? 'good' : 'default'}
          sub={`${money(s.sum_paid)} von erwartet ${money(s.sum_expected)}`}
        />
        <Stat
          label="Gekürzt / abgelehnt"
          value={s.reduced + s.rejected}
          tone={s.reduced + s.rejected > 0 ? 'warn' : 'good'}
          sub={`${s.reduced} gekürzt, ${s.rejected} abgelehnt`}
        />
        <Stat
          label="Handlungsbedarf"
          value={s.needs_action}
          tone={s.needs_action > 0 ? 'danger' : 'good'}
          sub={s.unmatched > 0 ? `${s.unmatched} nicht zugeordnet` : 'alles zugeordnet'}
        />
      </div>

      {result.warnings.length > 0 ? (
        <Alert kind="warning" title="Hinweise zur Prüfung">
          <ul className="list-inside list-disc space-y-1">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {s.detected > 0 && s.needs_action === 0 ? (
        <Alert kind="success" title="Alles geprüft – kein Handlungsbedarf">
          Alle {s.detected} Positionen wurden zugeordnet und in voller erwarteter Höhe erstattet. Die
          Status der Rechnungen sind aktualisiert.
        </Alert>
      ) : null}

      <div className="space-y-3">
        {items.map((entry, idx) => (
          <ItemCard
            key={entry.item.id}
            entry={entry}
            options={result.options}
            onAssigned={(updated) => {
              setItems((list) => list.map((x, i) => (i === idx ? updated : x)));
              onRefresh();
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ItemCard({
  entry,
  options,
  onAssigned,
}: {
  entry: ProcessedItem;
  options: DecisionResult['options'];
  onAssigned: (e: ProcessedItem) => void;
}) {
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ev = entry.evaluation;

  const tone = !entry.match
    ? 'border-amber-300 bg-amber-50/50'
    : ev?.status === 'bezahlt'
      ? 'border-emerald-200 bg-emerald-50/40'
      : 'border-red-300 bg-red-50/40';

  async function assign() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.assignItem(entry.item.id, Number(selected));
      onAssigned({
        ...entry,
        match: {
          submission_id: Number(selected),
          invoice_id: res.invoice?.id ?? 0,
          invoice_number: res.invoice?.invoice_number ?? '',
          invoice_date: res.invoice?.invoice_date ?? null,
          invoice_amount: res.invoice?.amount ?? 0,
          doctor: res.invoice?.doctor ?? '',
          member_name: res.invoice?.member_name ?? '',
        },
        item: { ...entry.item, match_kind: 'manual', applied: 1 },
        evaluation: {
          status: 'bezahlt',
          expected: 0,
          paid: 0,
          difference: 0,
          needs_action: false,
          message: res.evaluation.message,
        },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-sm">
          <p className="font-semibold">
            {[
              entry.item.member_name,
              entry.item.service_label,
              entry.item.invoice_number && `Nr. ${entry.item.invoice_number}`,
              entry.item.invoice_date
                ? `Rechnung vom ${date(entry.item.invoice_date)}`
                : entry.item.treatment_year
                  ? `Behandlungsjahr ${entry.item.treatment_year}`
                  : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Position ohne Kennzeichnung'}
          </p>
          <p className="text-slate-600">
            Rechnungsbetrag laut Bescheid {money(entry.item.invoice_amount)} · erstattet{' '}
            <strong>{money(entry.item.paid_amount)}</strong>
            {entry.item.rejected_amount ? ` · davon abgelehnt ${money(entry.item.rejected_amount)}` : ''}
            {entry.item.rate !== null ? ` · Satz ${Math.round(entry.item.rate * 100)} %` : ''}
          </p>
          {entry.item.reason ? (
            <p className="mt-1 text-amber-800">Begründung: {entry.item.reason}</p>
          ) : null}
        </div>
        {entry.match ? (
          <Link className="btn-secondary" to={`/rechnung/${entry.match.invoice_id}`}>
            Rechnung öffnen
          </Link>
        ) : null}
      </div>

      {entry.match ? (
        <p className="mt-2 text-sm">
          Zugeordnet zu: <strong>{entry.match.member_name}</strong> · {entry.match.doctor || 'ohne Arzt'} ·{' '}
          {entry.match.invoice_number ? `Nr. ${entry.match.invoice_number} · ` : ''}
          {money(entry.match.invoice_amount)} (
          {entry.item.match_kind === 'number'
            ? 'über Rechnungsnummer erkannt'
            : entry.item.match_kind === 'manual'
              ? 'manuell zugeordnet'
              : 'über Betrag/Datum erkannt'}
          )
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium text-amber-900">
            Nicht eindeutig zuordenbar – bitte die passende Einreichung auswählen.
            {entry.ambiguous.length > 0 ? ' Mögliche Kandidaten sind vorausgewählt.' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <select className="input max-w-xl" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">bitte wählen …</option>
              {(entry.ambiguous.length > 0
                ? entry.ambiguous.map((a) => ({ submission_id: a.submission_id, label: a.label, status: '' }))
                : options
              ).map((o) => (
                <option key={o.submission_id} value={o.submission_id}>
                  {o.label}
                  {o.status ? ` — ${o.status}` : ''}
                </option>
              ))}
            </select>
            <button className="btn-primary" disabled={!selected || busy} onClick={assign}>
              Zuordnen &amp; prüfen
            </button>
          </div>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      )}

      {ev ? (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            ev.status === 'bezahlt' ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'
          }`}
        >
          {ev.message}
        </p>
      ) : null}

      {entry.item.raw_line ? (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
            Originaltext aus dem Bescheid
          </summary>
          <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
            {entry.item.raw_line}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
