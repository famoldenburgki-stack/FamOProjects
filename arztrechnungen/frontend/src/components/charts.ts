/**
 * Farb- und Achsen-Vorgaben für die Diagramme.
 * Kategoriale Reihenfolge ist fest – Reihen werden nie umgefärbt, wenn ein
 * Filter die Anzahl verändert.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];

export const CHART = {
  surface: '#ffffff',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  muted: '#898781',
  text: '#52514e',
};

export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

export const axisProps = {
  tick: { fill: CHART.muted, fontSize: 12 },
  stroke: CHART.axis,
  tickLine: false,
};

export const eur = (n: number) =>
  n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export const eurExact = (n: number) =>
  n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
