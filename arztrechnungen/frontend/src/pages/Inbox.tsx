import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { date, money, targetLabel } from '../format';
import { Alert, EmptyState, Field, Spinner } from '../components/ui';
import { DocumentView } from '../components/DocumentView';
import type { InboxEntry, Member } from '../types';

/**
 * Eingang: Dokumente aus dem überwachten Ordner, die noch nicht bestätigt sind.
 * Rechnungen werden zu Rechnungen, Bescheide laufen durch die Prüfung – beides
 * erst auf Knopfdruck, nie unbeaufsichtigt.
 */
export default function Inbox() {
  const [entries, setEntries] = useState<InboxEntry[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [folder, setFolder] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const laden = useCallback(() => {
    api
      .inbox()
      .then((r) => {
        setEntries(r.entries);
        setMembers(r.members);
        setCategories(r.categories);
        setFolder(r.folder);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(laden, [laden]);

  async function jetztEinlesen() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.scanInbox();
      setEntries(r.entries);
      const bescheide = r.added.filter((e) => e.kind === 'bescheid').length;
      const rechnungen = r.added.length - bescheide;
      setHinweis(
        r.added.length > 0
          ? `Eingelesen: ${rechnungen} ${rechnungen === 1 ? 'Rechnung' : 'Rechnungen'}` +
              (bescheide > 0
                ? `, ${bescheide} ${bescheide === 1 ? 'Bescheid' : 'Bescheide'}.`
                : '.')
          : 'Keine neuen Dokumente im Ordner gefunden.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (entries === null) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">
              Eingang
              {entries.length > 0 ? (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-800">
                  {entries.length}
                </span>
              ) : null}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Rechnungen und Bescheide aus dem überwachten Ordner – die App erkennt selbst, was
              was ist. Es ist <strong>noch nichts gespeichert</strong>: erst dein Klick legt die
              Rechnung an bzw. lässt den Bescheid prüfen.
            </p>
          </div>
          <button className="btn-secondary" disabled={busy} onClick={jetztEinlesen}>
            {busy ? 'Lese ein …' : 'Ordner jetzt einlesen'}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Überwachter Ordner:{' '}
          {folder ? (
            <code className="rounded bg-slate-100 px-1.5 py-0.5">{folder}</code>
          ) : (
            <>
              noch keiner –{' '}
              <Link className="text-brand-700 hover:underline" to="/einstellungen">
                in den Einstellungen festlegen
              </Link>
            </>
          )}
        </p>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}
      {hinweis ? <Alert kind="success">{hinweis}</Alert> : null}

      {entries.length === 0 ? (
        <EmptyState title="Nichts zu prüfen">
          Sobald neue Rechnungen oder Bescheide im überwachten Ordner liegen, erscheinen sie hier.
        </EmptyState>
      ) : (
        entries.map((e) =>
          e.kind === 'bescheid' ? (
            <DecisionCard
              key={e.id}
              entry={e}
              members={members}
              onDone={(msg) => {
                setHinweis(msg);
                laden();
              }}
              onError={setError}
            />
          ) : (
            <InboxCard
              key={e.id}
              entry={e}
              members={members}
              categories={categories}
              onDone={(msg) => {
                setHinweis(msg);
                laden();
              }}
              onError={setError}
            />
          ),
        )
      )}
    </div>
  );
}

function InboxCard({
  entry,
  members,
  categories,
  onDone,
  onError,
}: {
  entry: InboxEntry;
  members: Member[];
  categories: string[];
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const s = entry.suggestion;
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    family_member_id: s.family_member_id ? String(s.family_member_id) : '',
    doctor: s.doctor ?? '',
    invoice_number: s.invoice_number ?? '',
    invoice_date: s.invoice_date ?? '',
    treatment_date: s.treatment_date ?? '',
    payment_due_date: s.payment_due_date ?? '',
    amount: s.amount !== null && s.amount !== undefined ? String(s.amount) : '',
    category: s.category ?? 'Sonstiges',
    submit_beihilfe: false,
    submit_dbv: false,
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const bereit = Boolean(form.family_member_id) && Number(form.amount) > 0;

  async function uebernehmen() {
    setBusy(true);
    try {
      const submitNow: string[] = [];
      if (form.submit_beihilfe) submitNow.push('beihilfe');
      if (form.submit_dbv) submitNow.push('dbv');
      const inv = await api.confirmInbox(entry.id, {
        family_member_id: Number(form.family_member_id),
        doctor: form.doctor,
        invoice_number: form.invoice_number,
        invoice_date: form.invoice_date || null,
        treatment_date: form.treatment_date || null,
        payment_due_date: form.payment_due_date || null,
        amount: Number(form.amount),
        category: form.category,
        submit_now: submitNow,
      });
      onDone(`Rechnung über ${money(inv.amount)} übernommen. Noch ${inv.remaining} im Eingang.`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verwerfen() {
    if (!window.confirm(`"${entry.original_name}" verwerfen?\n\nDie Datei wird nicht gelöscht, sondern in den Unterordner "verworfen" gelegt.`)) return;
    setBusy(true);
    try {
      const r = await api.discardInbox(entry.id);
      onDone(r.moved_to ? `Verworfen – Datei liegt jetzt unter ${r.moved_to}` : 'Entwurf verworfen.');
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{entry.original_name}</h2>
        {entry.incomplete ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            Es fehlt: {entry.missing.join(', ')}
          </span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            vollständig erkannt
          </span>
        )}
      </div>

      {entry.hints.length > 0 ? (
        <Alert kind="info" title="Bitte prüfen">
          <ul className="list-inside list-disc">
            {entry.hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="mt-3 grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Patient *">
            <select
              className="input"
              value={form.family_member_id}
              onChange={(e) => set('family_member_id', e.target.value)}
            >
              <option value="">bitte wählen</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rechnungsbetrag (€) *">
            <input className="input" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
          </Field>
          <Field label="Arzt / Aussteller">
            <input className="input" value={form.doctor} onChange={(e) => set('doctor', e.target.value)} />
          </Field>
          <Field label="Behandlungsart">
            <select className="input" value={form.category} onChange={(e) => set('category', e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rechnungsdatum">
            <input
              type="date"
              className="input"
              value={form.invoice_date}
              onChange={(e) => set('invoice_date', e.target.value)}
            />
          </Field>
          <Field label="Behandlungsdatum">
            <input
              type="date"
              className="input"
              value={form.treatment_date}
              onChange={(e) => set('treatment_date', e.target.value)}
            />
          </Field>
          <Field label="Zahlbar bis">
            <input
              type="date"
              className="input"
              value={form.payment_due_date}
              onChange={(e) => set('payment_due_date', e.target.value)}
            />
          </Field>
          <Field label="Rechnungsnummer">
            <input
              className="input"
              value={form.invoice_number}
              onChange={(e) => set('invoice_number', e.target.value)}
            />
          </Field>
          <div className="flex items-end gap-4 pb-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.submit_beihilfe}
                onChange={(e) => set('submit_beihilfe', e.target.checked)}
              />
              heute bei {targetLabel('beihilfe')} eingereicht
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.submit_dbv}
                onChange={(e) => set('submit_dbv', e.target.checked)}
              />
              bei {targetLabel('dbv')}
            </label>
          </div>
        </div>

        <aside>
          <DocumentView
            src={`/api/inbox/${entry.id}/file`}
            name={entry.original_name}
            height="h-[26rem]"
          />
        </aside>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy || !bereit} onClick={uebernehmen}>
          {busy ? 'Übernehme …' : 'Als Rechnung übernehmen'}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={verwerfen}>
          Verwerfen
        </button>
        <a className="btn-ghost" href={`/api/inbox/${entry.id}/file`} target="_blank" rel="noreferrer">
          In neuem Tab öffnen
        </a>
        {!bereit ? (
          <span className="self-center text-sm text-slate-500">
            Patient und Betrag werden zum Übernehmen gebraucht.
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Bescheid aus dem Eingang. Absender und Zugang lassen sich vor der Prüfung noch
 * korrigieren – danach läuft genau dieselbe Verarbeitung wie beim Hochladen von
 * Hand, samt Zuordnung zu den Einreichungen.
 */
function DecisionCard({
  entry,
  members,
  onDone,
  onError,
}: {
  entry: InboxEntry;
  members: Member[];
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const d = entry.decision;
  const [target, setTarget] = useState<string>(d?.target ?? '');
  const [account, setAccount] = useState<string>(d?.account ?? '');
  const [busy, setBusy] = useState(false);
  /*
   * Erkannter Absender ist der Normalfall – dann steht er als Angabe da, nicht als
   * Frage. Die Auswahl klappt nur auf, wenn die Erkennung nichts hergab oder du
   * ausdrücklich korrigieren willst.
   */
  const [aendern, setAendern] = useState(!d?.target);

  // Zugänge sind die Personen, über die eingereicht wird – nicht alle Patienten.
  const konten = [...new Set(members.map((m) => m.account))];

  async function pruefen() {
    if (!target) {
      onError('Bitte zuerst angeben, von welcher Stelle der Bescheid kommt.');
      setAendern(true);
      return;
    }
    setBusy(true);
    try {
      const r = await api.checkInboxDecision(entry.id, target, account);
      onDone(
        `Bescheid geprüft: ${r.summary.applied} von ${r.summary.detected} Positionen zugeordnet` +
          (r.summary.needs_action > 0 ? `, ${r.summary.needs_action} brauchen eine Entscheidung` : '') +
          `. ` +
          `Noch ${r.remaining} im Eingang.`,
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verwerfen() {
    if (!window.confirm(`"${entry.original_name}" verwerfen?`)) return;
    setBusy(true);
    try {
      const r = await api.discardInbox(entry.id);
      onDone(
        r.moved_to
          ? `Verworfen – Datei liegt jetzt unter ${r.moved_to}`
          : 'Verworfen.',
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card border-l-4 border-l-indigo-400">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          <span className="mr-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
            Bescheid
          </span>
          {entry.original_name}
        </h2>
        {d?.target ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            {targetLabel(d.target)} · Zugang {d.account} erkannt
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            Absender bitte wählen
          </span>
        )}
      </div>

      {entry.hints.length > 0 ? (
        <Alert kind="info" title="Bitte prüfen">
          <ul className="list-inside list-disc">
            {entry.hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="mt-3 grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Bescheiddatum</dt>
            <dd>{date(d?.decision_date)}</dd>
            <dt className="text-slate-500">Erstattung im Bescheid</dt>
            <dd className="font-medium">{money(d?.total_paid ?? null)}</dd>
            <dt className="text-slate-500">Erkannte Positionen</dt>
            <dd>{d?.item_count ?? 0}</dd>
            <dt className="text-slate-500">Patienten im Bescheid</dt>
            <dd>{d?.members?.length ? d.members.join(', ') : '–'}</dd>
          </dl>

          {aendern ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Absender *">
                <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">bitte wählen</option>
                  <option value="beihilfe">{targetLabel('beihilfe')}</option>
                  <option value="dbv">{targetLabel('dbv')}</option>
                </select>
              </Field>
              <Field label="Zugang" hint="über welche Anmeldung der Bescheid kam">
                <select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
                  {konten.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Absender und Zugang stammen aus dem Dokument.{' '}
              <button className="text-brand-700 hover:underline" onClick={() => setAendern(true)}>
                ändern
              </button>
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy} onClick={pruefen}>
              {busy ? 'Prüfe …' : 'Bescheid prüfen und übernehmen'}
            </button>
            <button className="btn-secondary" disabled={busy} onClick={verwerfen}>
              Verwerfen
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Die Prüfung ordnet die Positionen den offenen Einreichungen zu und vergleicht sie mit
            der erwarteten Erstattung. Das Ergebnis steht danach unter „Bescheid prüfen".
          </p>
        </div>

        <DocumentView src={`/api/inbox/${entry.id}/file`} name={entry.original_name} />
      </div>
    </div>
  );
}
