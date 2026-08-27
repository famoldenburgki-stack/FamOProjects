/**
 * Gelernte Aussteller-Muster.
 *
 * Arztrechnungen wiederholen sich: dieselbe Praxis schreibt Jahr für Jahr
 * gleich aufgebaute Rechnungen. Die App merkt sich deshalb je Aussteller, wie
 * dessen Belege aussehen – welche Form die Rechnungsnummer hat, hinter welcher
 * Beschriftung der Betrag steht, welche Behandlungsart es ist. Beim nächsten
 * Beleg desselben Ausstellers werden damit die Lücken gefüllt, die die
 * allgemeinen Regeln offen lassen.
 *
 * Für einen unbekannten Aussteller wird beim Speichern automatisch ein neues
 * Muster angelegt, das mit jeder weiteren Rechnung sicherer wird.
 */
import { db } from './db.js';
import { allAmounts, allDates, toIsoDate } from './ocr/parse.js';

/* ------------------------------------------------------------------ */
/*  Datenmodell                                                        */
/* ------------------------------------------------------------------ */

type Tally = Record<string, number>;

interface FieldRule {
  /** Zeichenform des Wertes, z.B. "A#########" für A020193779. */
  shapes?: Tally;
  /** Beschriftung, hinter der der Wert stand. */
  labels?: Tally;
  /** Wie viele Zeilen unter der Beschriftung der Wert stand. */
  offsets?: Tally;
}

export type PatternField = 'invoice_number' | 'amount' | 'invoice_date' | 'treatment_date';
const FIELDS: PatternField[] = ['invoice_number', 'amount', 'invoice_date', 'treatment_date'];

type Rules = Partial<Record<PatternField, FieldRule>>;

export interface IssuerPattern {
  id: number;
  key: string;
  display_name: string;
  fingerprint: string;
  category: string;
  samples: number;
  rules: Rules;
  created_at: string;
  updated_at: string;
}

interface PatternRow extends Omit<IssuerPattern, 'rules'> {
  rules: string;
}

const parseRow = (r: PatternRow): IssuerPattern => ({
  ...r,
  rules: safeJson(r.rules),
});

function safeJson(raw: string): Rules {
  try {
    return JSON.parse(raw) as Rules;
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/*  Erkennung des Ausstellers                                          */
/* ------------------------------------------------------------------ */

/** Häufige Wörter, die keinen Aussteller unterscheiden. */
const STOPWORDS = new Set([
  'rechnung', 'praxis', 'strasse', 'straße', 'telefon', 'datum', 'seite', 'patient',
  'patientin', 'oldenburg', 'usingen', 'frankfurt', 'behandlung', 'leistung', 'betrag',
  'summe', 'euro', 'bitte', 'zahlung', 'ihre', 'sehr', 'geehrte', 'geehrter', 'freundlichen',
  'gruessen', 'grüßen', 'anschrift', 'konto', 'bank', 'gesamt', 'nummer', 'herrn', 'frau',
]);

const normalizeWord = (w: string) =>
  w
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z]/g, '');

/**
 * Markante Wörter aus dem Briefkopf. Sie dienen als Fingerabdruck, weil der
 * Ausstellername selbst aus der Texterkennung mal so und mal anders kommt.
 */
export function fingerprintOf(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 12);
  const words = new Set<string>();
  for (const line of lines) {
    for (const raw of line.split(/\s+/)) {
      const w = normalizeWord(raw);
      if (w.length >= 5 && !STOPWORDS.has(w)) words.add(w);
    }
  }
  return [...words].sort();
}

/** Normalisierter Schlüssel aus dem bestätigten Ausstellernamen. */
export function issuerKey(doctor: string): string {
  return doctor
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length >= 3)
    .sort()
    .join('-')
    .slice(0, 120);
}

const jaccard = (a: string[], b: string[]): number => {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const shared = a.filter((x) => setB.has(x)).length;
  return shared / (a.length + b.length - shared);
};

export function listPatterns(): IssuerPattern[] {
  return (
    db.prepare('SELECT * FROM issuer_patterns ORDER BY samples DESC, display_name').all() as PatternRow[]
  ).map(parseRow);
}

/**
 * Sucht das Muster, das zu diesem Beleg passt – zuerst über den
 * Ausstellernamen, sonst über die Überschneidung der Briefkopf-Wörter.
 */
export function findPattern(text: string, doctorHint?: string): IssuerPattern | null {
  const patterns = listPatterns();
  if (patterns.length === 0) return null;

  if (doctorHint?.trim()) {
    const key = issuerKey(doctorHint);
    const exact = patterns.find((p) => p.key === key);
    if (exact) return exact;
  }

  const fp = fingerprintOf(text);
  let best: { pattern: IssuerPattern; score: number } | null = null;
  for (const p of patterns) {
    const score = jaccard(fp, p.fingerprint.split(' ').filter(Boolean));
    if (score > (best?.score ?? 0)) best = { pattern: p, score };
  }
  // Genug Überschneidung, damit nicht jeder beliebige Beleg zugeordnet wird.
  return best && best.score >= 0.3 ? best.pattern : null;
}

/* ------------------------------------------------------------------ */
/*  Lernen                                                             */
/* ------------------------------------------------------------------ */

/** Zeichenform eines Wertes: Ziffern zu #, Buchstaben zu A. */
export function shapeOf(token: string): string {
  return token.replace(/\d/g, '#').replace(/\p{L}/gu, 'A');
}

/** Beschriftungen, die als gelernter Anker taugen. */
const LABEL_WORDS = [
  'rechnungsnummer', 'rechnungs-nr', 'rechnung-nr', 'rechnungsnr', 'rg-nr', 'belegnummer',
  'rechnungsdatum', 'rechnung vom', 'rg-datum', 'datum',
  'behandlungsdatum', 'leistungsdatum', 'behandelt', 'erbrachte leistungen',
  'gesamtbetrag', 'rechnungsbetrag', 'zu zahlender betrag', 'zahlbetrag', 'endbetrag',
  'rechnungssumme', 'gesamtsumme', 'summe', 'gesamt', 'honorar',
];

const bump = (t: Tally | undefined, key: string): Tally => {
  const next = { ...(t ?? {}) };
  next[key] = (next[key] ?? 0) + 1;
  return next;
};

/** Die häufigste Ausprägung – nur wenn sie oft genug belegt ist. */
export function dominant(t: Tally | undefined, minCount = 2): string | null {
  if (!t) return null;
  const sorted = Object.entries(t).sort((a, b) => b[1] - a[1]);
  return sorted[0] && sorted[0][1] >= minCount ? sorted[0][0] : null;
}

/** Sucht, wo ein bestätigter Wert im Text steht, und leitet daraus eine Regel ab. */
function observe(rule: FieldRule, lines: string[], needles: string[]): FieldRule {
  let out = rule;
  for (let i = 0; i < lines.length; i++) {
    const hit = needles.find((n) => n && lines[i].includes(n));
    if (!hit) continue;

    const token = lines[i].split(/\s+/).find((t) => t.includes(hit)) ?? hit;
    out = { ...out, shapes: bump(out.shapes, shapeOf(token)) };

    // Beschriftung in derselben oder einer der drei Zeilen darüber suchen
    for (let back = 0; back <= 3 && i - back >= 0; back++) {
      const lower = lines[i - back].toLowerCase();
      const label = LABEL_WORDS.find((l) => lower.includes(l));
      if (label) {
        out = { ...out, labels: bump(out.labels, label), offsets: bump(out.offsets, String(back)) };
        break;
      }
    }
    return out;
  }
  return out;
}

export interface LearnInput {
  doctor: string;
  ocr_text: string | null | undefined;
  invoice_number?: string | null;
  amount?: number | null;
  invoice_date?: string | null;
  treatment_date?: string | null;
  category?: string | null;
}

const germanDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}.${m}.${y}` : null;
};

const germanAmount = (n: number | null | undefined): string | null =>
  n === null || n === undefined ? null : n.toFixed(2).replace('.', ',');

/**
 * Lernt aus einer bestätigten Rechnung. Ist der Aussteller unbekannt, entsteht
 * dabei automatisch ein neues Muster.
 */
export function learnFromInvoice(input: LearnInput): IssuerPattern | null {
  const doctor = (input.doctor ?? '').trim();
  const text = input.ocr_text ?? '';
  if (!doctor || text.length < 40) return null;

  const key = issuerKey(doctor);
  if (!key) return null;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const existing = (
    db.prepare('SELECT * FROM issuer_patterns WHERE key = ?').get(key) as PatternRow | undefined
  );
  const rules: Rules = existing ? safeJson(existing.rules) : {};

  const evidence: Record<PatternField, string[]> = {
    invoice_number: [input.invoice_number?.trim() || ''],
    amount: [germanAmount(input.amount) ?? ''],
    invoice_date: [germanDate(input.invoice_date) ?? ''],
    treatment_date: [germanDate(input.treatment_date) ?? ''],
  };

  for (const field of FIELDS) {
    const needles = evidence[field].filter((n) => n.length >= 3);
    if (needles.length === 0) continue;
    rules[field] = observe(rules[field] ?? {}, lines, needles);
  }

  const fingerprint = fingerprintOf(text).join(' ');
  const category = input.category && input.category !== 'Sonstiges' ? input.category : (existing?.category ?? '');

  if (existing) {
    db.prepare(
      `UPDATE issuer_patterns
          SET display_name = ?, fingerprint = ?, category = ?, samples = samples + 1,
              rules = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).run(doctor, fingerprint || existing.fingerprint, category, JSON.stringify(rules), existing.id);
    return getPattern(existing.id);
  }

  const info = db
    .prepare(
      `INSERT INTO issuer_patterns (key, display_name, fingerprint, category, samples, rules)
       VALUES (?, ?, ?, ?, 1, ?)`,
    )
    .run(key, doctor, fingerprint, category, JSON.stringify(rules));
  return getPattern(Number(info.lastInsertRowid));
}

export function getPattern(id: number): IssuerPattern | null {
  const row = db.prepare('SELECT * FROM issuer_patterns WHERE id = ?').get(id) as PatternRow | undefined;
  return row ? parseRow(row) : null;
}

export function deletePattern(id: number): boolean {
  return db.prepare('DELETE FROM issuer_patterns WHERE id = ?').run(id).changes > 0;
}

/* ------------------------------------------------------------------ */
/*  Anwenden                                                           */
/* ------------------------------------------------------------------ */

export interface PatternApplication {
  /** Welche Felder aus dem Muster stammen. */
  fields: PatternField[];
  values: Partial<Record<PatternField, string | number>>;
  category?: string;
}

/** Wert an einer gelernten Beschriftung samt Zeilenversatz suchen. */
function byLabel(lines: string[], rule: FieldRule, pick: (line: string) => string | null): string | null {
  const label = dominant(rule.labels);
  if (!label) return null;
  const offset = Number(dominant(rule.offsets) ?? '0');

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].toLowerCase().includes(label)) continue;
    for (const step of [offset, 0, 1, 2]) {
      const line = lines[i + step];
      if (!line) continue;
      const value = pick(line);
      if (value) return value;
    }
  }
  return null;
}

/**
 * Füllt anhand des gelernten Musters die Felder, die die allgemeinen Regeln
 * nicht bestimmen konnten. Bereits erkannte Werte bleiben unangetastet – außer
 * bei der Rechnungsnummer, wo die gelernte Zeichenform verlässlicher ist.
 */
export function applyPattern(
  pattern: IssuerPattern,
  text: string,
  base: {
    invoice_number: string;
    amount: number | null;
    invoice_date: string | null;
    treatment_date: string | null;
    category: string;
  },
): PatternApplication {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const used: PatternField[] = [];
  const values: PatternApplication['values'] = {};

  /* Rechnungsnummer: über die gelernte Zeichenform */
  const numberRule = pattern.rules.invoice_number;
  const shape = dominant(numberRule?.shapes, 2);
  if (shape) {
    const candidates = lines
      .flatMap((l) => l.split(/\s+/))
      .map((t) => t.replace(/[.,;:!]+$/, ''))
      .filter((t) => t.length >= 4 && shapeOf(t) === shape);
    const found = candidates[0] ?? null;
    // Nur übernehmen, wenn nichts erkannt wurde oder das Erkannte nicht zur
    // sonst immer gleichen Form dieses Ausstellers passt.
    if (found && (!base.invoice_number || shapeOf(base.invoice_number) !== shape)) {
      values.invoice_number = found;
      used.push('invoice_number');
    }
  }

  /* Betrag über die gelernte Beschriftung */
  if (base.amount === null && pattern.rules.amount) {
    const hit = byLabel(lines, pattern.rules.amount, (line) => {
      const amounts = allAmounts(line);
      return amounts.length ? String(amounts[amounts.length - 1]) : null;
    });
    if (hit) {
      values.amount = Number(hit);
      used.push('amount');
    }
  }

  /* Datumsangaben über die gelernte Beschriftung */
  for (const field of ['invoice_date', 'treatment_date'] as const) {
    if (base[field] !== null || !pattern.rules[field]) continue;
    const hit = byLabel(lines, pattern.rules[field]!, (line) => {
      const dates = allDates(line);
      return dates.length ? dates[0] : null;
    });
    if (hit) {
      values[field] = hit;
      used.push(field);
    }
  }

  const category =
    base.category === 'Sonstiges' && pattern.category ? pattern.category : undefined;

  return { fields: used, values, category };
}

/** Nur für die Anzeige: wie sicher ist das Muster inzwischen? */
export function patternSummary(p: IssuerPattern): {
  id: number;
  name: string;
  samples: number;
  category: string;
  learned: string[];
} {
  const learned: string[] = [];
  const label: Record<PatternField, string> = {
    invoice_number: 'Rechnungsnummer',
    amount: 'Betrag',
    invoice_date: 'Rechnungsdatum',
    treatment_date: 'Behandlungsdatum',
  };
  for (const f of FIELDS) {
    const rule = p.rules[f];
    if (!rule) continue;
    // Die Zeichenform wird nur für die Rechnungsnummer ausgewertet; bei Daten und
    // Beträgen ist sie immer gleich und würde nur verwirren.
    const shape = f === 'invoice_number' ? dominant(rule.shapes, 2) : null;
    const lbl = dominant(rule.labels);
    if (shape) learned.push(`${label[f]} in der Form ${shape}`);
    else if (lbl) learned.push(`${label[f]} hinter „${lbl}"`);
  }
  return { id: p.id, name: p.display_name, samples: p.samples, category: p.category, learned };
}

export { toIsoDate };
