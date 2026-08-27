import type { ReactNode } from 'react';
import {
  date,
  daysUntil,
  OVERALL_COLOR,
  OVERALL_LABEL,
  SUBMISSION_COLOR,
  SUBMISSION_LABEL,
} from '../format';
import type { OverallStatus, SubmissionStatus } from '../types';

export function StatusBadge({ status }: { status: SubmissionStatus }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${SUBMISSION_COLOR[status]}`}>
      {SUBMISSION_LABEL[status]}
    </span>
  );
}

export function OverallBadge({ status }: { status: OverallStatus }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${OVERALL_COLOR[status]}`}>
      {OVERALL_LABEL[status]}
    </span>
  );
}

/**
 * Zahlungsfrist gegenüber dem Arzt. Ist die Rechnung bezahlt, zählt die Frist
 * nicht mehr – dann steht das Datum nur noch grau als Information da.
 */
export function PaymentDue({ due, paid }: { due: string | null; paid: string | null }) {
  if (!due) return <span className="text-slate-400">–</span>;
  const tage = daysUntil(due);
  if (paid || tage === null) {
    return <span className="text-slate-500">{date(due)}</span>;
  }
  const farbe =
    tage < 0
      ? 'bg-red-50 text-red-700 border-red-200'
      : tage <= 7
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  const text =
    tage < 0
      ? `${-tage} Tage überfällig`
      : tage === 0
        ? 'heute fällig'
        : `in ${tage} Tagen`;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span>{date(due)}</span>
      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${farbe}`}>{text}</span>
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Alert({
  kind = 'info',
  title,
  children,
}: {
  kind?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    info: 'border-blue-200 bg-blue-50 text-blue-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-900',
  }[kind];
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? 'mt-1' : ''}>{children}</div>
    </div>
  );
}

export function Spinner({ label = 'Lade …' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-8 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {children ? <div className="mt-1 text-sm text-slate-500">{children}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'warn' | 'danger' | 'good';
}) {
  const toneClass = {
    default: 'text-slate-900',
    warn: 'text-amber-700',
    danger: 'text-red-700',
    good: 'text-emerald-700',
  }[tone];
  return (
    <div className="card">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}
