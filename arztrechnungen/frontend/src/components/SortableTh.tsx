/** Klickbare Spaltenüberschrift zum Sortieren. */
export interface SortState<K extends string> {
  key: K;
  dir: 'asc' | 'desc';
}

export function SortableTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  align?: 'left' | 'right';
}) {
  const aktiv = sort.key === sortKey;
  return (
    <th className={`th ${align === 'right' ? 'text-right' : ''}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-slate-900 ${
          aktiv ? 'text-slate-900' : ''
        } ${align === 'right' ? 'flex-row-reverse' : ''}`}
        title={`Nach ${label} sortieren`}
      >
        {label}
        {/* Der Pfeil steht immer, damit die Spaltenbreite beim Sortieren nicht springt. */}
        <span className={aktiv ? 'text-brand-600' : 'text-slate-300'}>
          {aktiv && sort.dir === 'desc' ? '▼' : '▲'}
        </span>
      </button>
    </th>
  );
}

/**
 * Vergleicht zwei Werte für die Sortierung. Leere Werte landen immer am Ende,
 * unabhängig von der Richtung – eine Rechnung ohne Datum soll nicht die Liste
 * anführen.
 */
export function compareValues(a: unknown, b: unknown, dir: 'asc' | 'desc'): number {
  const leer = (v: unknown) => v === null || v === undefined || v === '';
  if (leer(a) && leer(b)) return 0;
  if (leer(a)) return 1;
  if (leer(b)) return -1;

  const faktor = dir === 'asc' ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * faktor;
  return String(a).localeCompare(String(b), 'de', { numeric: true, sensitivity: 'base' }) * faktor;
}
