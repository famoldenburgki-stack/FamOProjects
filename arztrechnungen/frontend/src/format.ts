import type { OverallStatus, SubmissionStatus, Target } from './types';

export const money = (n: number | null | undefined): string =>
  n === null || n === undefined
    ? '–'
    : n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

export const date = (iso: string | null | undefined): string => {
  if (!iso) return '–';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : iso;
};

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** Volle Tage bis zum Stichtag; negativ = überfällig, null = kein Datum. */
export const daysUntil = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ziel = Date.parse(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(ziel)) return null;
  const heute = Date.parse(`${todayIso()}T00:00:00`);
  return Math.round((ziel - heute) / 86_400_000);
};

export const targetLabel = (t: Target): string => (t === 'dbv' ? 'DBV' : 'Beihilfe');

export const SUBMISSION_LABEL: Record<SubmissionStatus, string> = {
  offen: 'offen',
  eingereicht: 'eingereicht',
  teilweise_bezahlt: 'teilweise bezahlt',
  bezahlt: 'bezahlt',
  abgelehnt: 'abgelehnt',
};

export const OVERALL_LABEL: Record<OverallStatus, string> = {
  offen: 'nicht eingereicht',
  teilweise_eingereicht: 'teilweise eingereicht',
  eingereicht: 'eingereicht',
  in_bearbeitung: 'in Bearbeitung',
  abgeschlossen: 'abgeschlossen',
  eigenanteil_offen: 'Entscheidung nötig',
  abgelegt: 'abgelegt',
};

export const SUBMISSION_COLOR: Record<SubmissionStatus, string> = {
  offen: 'bg-slate-100 text-slate-700 border-slate-200',
  eingereicht: 'bg-blue-50 text-blue-700 border-blue-200',
  teilweise_bezahlt: 'bg-amber-50 text-amber-800 border-amber-200',
  bezahlt: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  abgelehnt: 'bg-red-50 text-red-700 border-red-200',
};

export const OVERALL_COLOR: Record<OverallStatus, string> = {
  offen: 'bg-slate-100 text-slate-700 border-slate-200',
  teilweise_eingereicht: 'bg-sky-50 text-sky-700 border-sky-200',
  eingereicht: 'bg-blue-50 text-blue-700 border-blue-200',
  in_bearbeitung: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  abgeschlossen: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  eigenanteil_offen: 'bg-red-50 text-red-700 border-red-200',
  abgelegt: 'bg-slate-50 text-slate-500 border-slate-200',
};
