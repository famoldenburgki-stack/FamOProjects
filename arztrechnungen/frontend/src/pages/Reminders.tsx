import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { date, money, targetLabel } from '../format';
import { Alert, EmptyState, Spinner } from '../components/ui';
import type { ReminderEntry, Reminders as RemindersData } from '../types';

const SECTIONS: {
  key: keyof Omit<RemindersData, 'counts'>;
  title: string;
  hint: string;
  tone: string;
}[] = [
  {
    key: 'payment_due',
    title: 'Zahlung an den Arzt fällig',
    hint: 'Die Zahlungsfrist der Rechnung läuft ab – hier drohen Mahngebühren.',
    tone: 'border-red-300 bg-red-50',
  },
  {
    key: 'deadlines',
    title: 'Fristen laufen ab',
    hint: 'Nach Ablauf der Ausschlussfrist ist der Anspruch endgültig verloren – hier zuerst handeln.',
    tone: 'border-red-300 bg-red-50',
  },
  {
    key: 'needs_decision',
    title: 'Entscheidung nötig',
    hint: 'Gekürzt oder abgelehnt: Eigenanteil akzeptieren, Arzt kontaktieren oder Widerspruch einlegen.',
    tone: 'border-red-200 bg-red-50/60',
  },
  {
    key: 'not_submitted',
    title: 'Noch nicht eingereicht',
    hint: 'Diese Rechnungen liegen bereits eine Weile unbearbeitet.',
    tone: 'border-amber-200 bg-amber-50/60',
  },
  {
    key: 'decision_overdue',
    title: 'Bescheid überfällig',
    hint: 'Eingereicht, aber seit längerem keine Rückmeldung – ggf. nachfragen.',
    tone: 'border-sky-200 bg-sky-50/60',
  },
  {
    key: 'not_paid',
    title: 'Noch nicht an den Arzt gezahlt',
    hint: 'Diese Rechnungen sind erfasst, aber die Zahlung ist noch nicht bestätigt.',
    tone: 'border-slate-300 bg-slate-50',
  },
  {
    key: 'ready_to_archive',
    title: 'Bereit zur Ablage',
    hint: 'Vollständig erledigt – Papierrechnung kann weggelegt werden.',
    tone: 'border-emerald-200 bg-emerald-50/60',
  },
];

export default function Reminders() {
  const [data, setData] = useState<RemindersData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.reminders().then(setData).catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <Spinner />;

  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Aufgaben</h1>
        <p className="text-sm text-slate-600">
          Alles, was gerade deine Aufmerksamkeit braucht – von oben nach unten nach Dringlichkeit.
        </p>
      </div>

      {total === 0 ? (
        <EmptyState title="Nichts zu tun">
          Keine ablaufenden Fristen, keine offenen Entscheidungen. 👍
        </EmptyState>
      ) : null}

      {SECTIONS.map((section) => {
        const entries = data[section.key] as ReminderEntry[];
        if (entries.length === 0) return null;
        return (
          <div key={section.key} className={`rounded-xl border p-5 ${section.tone}`}>
            <h2 className="font-semibold">
              {section.title}{' '}
              <span className="ml-1 rounded-full bg-white/70 px-2 py-0.5 text-xs">{entries.length}</span>
            </h2>
            <p className="mb-3 text-sm text-slate-600">{section.hint}</p>
            <div className="space-y-2">
              {entries.map((e, i) => (
                <div
                  key={`${e.invoice_id}-${e.submission_id}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {e.member_name} · {e.doctor || 'ohne Arzt'} · {money(e.amount)}
                      {e.target ? (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                          {targetLabel(e.target)}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-slate-600">{e.detail}</p>
                    <p className="text-xs text-slate-400">
                      Rechnung vom {date(e.invoice_date)}
                      {e.invoice_number ? ` · Nr. ${e.invoice_number}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {e.submission_id && section.key === 'deadlines' ? (
                      <button
                        className="btn-secondary"
                        onClick={() => api.submit(e.submission_id!).then(load)}
                      >
                        Heute eingereicht
                      </button>
                    ) : null}
                    {section.key === 'not_submitted' && e.submission_id ? (
                      <button
                        className="btn-secondary"
                        onClick={() => api.submit(e.submission_id!).then(load)}
                      >
                        Heute eingereicht
                      </button>
                    ) : null}
                    {section.key === 'not_paid' ? (
                      <button
                        className="btn-secondary"
                        onClick={() => api.markPaid(e.invoice_id).then(load)}
                      >
                        Heute bezahlt
                      </button>
                    ) : null}
                    {section.key === 'ready_to_archive' ? (
                      <button
                        className="btn-secondary"
                        onClick={() => api.archiveInvoice(e.invoice_id, true).then(load)}
                      >
                        Abgelegt
                      </button>
                    ) : null}
                    <Link className="btn-ghost" to={`/rechnung/${e.invoice_id}`}>
                      Öffnen
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
