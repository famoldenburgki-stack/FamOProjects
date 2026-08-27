import { DEFAULT_CATEGORIES, FALLBACK_CATEGORY as FALLBACK } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Grundbausteine: deutsche Zahlen und Datumsangaben                  */
/* ------------------------------------------------------------------ */

/**
 * Beträge wie 1.234,56 oder 480,00. Die Wächter am Ende verhindern, dass
 * Datumsangaben (12.03.2026 -> "12.03") oder Tausenderzahlen ohne Dezimalstellen
 * (1.234 -> "1.23") fälschlich als Betrag gelesen werden.
 */
const AMOUNT_RE = /(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d+)([,.])(\d{2})(?!\d|\.\d|,\d)/g;

/**
 * Ein Punkt als Dezimaltrenner ist auf deutschen Rechnungen unüblich und meist
 * gar kein Betrag: "Steuerbefreiung gem. § 4 Nr. 14 UStG" wird von der
 * Texterkennung zu "84.14", Paragraphen und Ziffern ebenso. Solche Zahlen zählen
 * nur mit einer Währungsangabe unmittelbar daneben.
 */
const CURRENCY_NEAR = /(€|eur\b|euro)/i;
const DATE_RE = /(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?!\d)/g;
const ISO_DATE_RE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;

export function parseGermanAmount(raw: string): number | null {
  return allAmounts(raw)[0] ?? null;
}

/** Alle Betragsangaben eines Textstücks in Lesereihenfolge. */
export function allAmounts(raw: string): number[] {
  const out: number[] = [];
  for (const m of raw.matchAll(AMOUNT_RE)) {
    const value = Number(`${m[1].replace(/\./g, '')}.${m[3]}`);
    if (m[2] === ',') {
      out.push(value);
      continue;
    }
    const at = m.index ?? 0;
    const before = raw.slice(Math.max(0, at - 10), at);
    const after = raw.slice(at + m[0].length, at + m[0].length + 8);
    if (CURRENCY_NEAR.test(before) || CURRENCY_NEAR.test(after)) out.push(value);
  }
  return out;
}

export function toIsoDate(raw: string): string | null {
  const iso = new RegExp(ISO_DATE_RE.source).exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = new RegExp(DATE_RE.source).exec(raw);
  if (!m) return null;
  const day = m[1].padStart(2, '0');
  const month = m[2].padStart(2, '0');
  let year = m[3];
  if (year.length === 2) year = `${Number(year) > 70 ? '19' : '20'}${year}`;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return `${year}-${month}-${day}`;
}

export function allDates(raw: string): string[] {
  const out: string[] = [];
  for (const m of raw.matchAll(DATE_RE)) {
    const iso = toIsoDate(m[0]);
    if (iso) out.push(iso);
  }
  for (const m of raw.matchAll(ISO_DATE_RE)) out.push(m[0]);
  return out;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Sucht die Zeile mit einem der Stichwörter und gibt sie inkl. Folgezeile zurück. */
function findLabeled(lines: string[], labels: string[]): { line: string; index: number } | null {
  const lower = labels.map((l) => l.toLowerCase());
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    if (lower.some((label) => l.includes(label))) return { line: lines[i], index: i };
  }
  return null;
}

const toMatcher = (label: string | RegExp): RegExp =>
  typeof label === 'string'
    ? new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    : label;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Kommt das Wort eigenständig vor? `\b` allein genügt nicht, weil Umlaute und
 * ß in JavaScript als Wortgrenze gelten; deshalb wird auf Buchstaben geprüft.
 */
export function hasWord(haystack: string, word: string): boolean {
  return new RegExp(`(?<!\\p{L})${escapeRe(word)}(?!\\p{L})`, 'iu').test(haystack);
}

/** Beginnt an einer Wortgrenze ein Wort mit diesem Stamm? ("zahnarzt" in "Zahnarztpraxis") */
export function hasWordStart(haystack: string, stem: string): boolean {
  return new RegExp(`(?<!\\p{L})${escapeRe(stem)}`, 'iu').test(haystack);
}

/** Deutsche Betragsschreibweise ("1.234,56") in eine Zahl wandeln. */
export function num(raw: string): number {
  return Number(raw.replace(/\./g, '').replace(',', '.'));
}

/** Textzeilen normalisiert und ohne Leerzeilen – Basis aller Bescheidparser. */
export function toLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);
}

/**
 * Betrag zu einem Stichwort – erst in derselben Zeile, sonst in der nächsten.
 * Die Stichwörter werden in der übergebenen Reihenfolge geprüft, das erste
 * Stichwort gewinnt also gegen ein später genanntes (Priorität statt Zeilenfolge).
 */
function labeledAmount(lines: string[], labels: (string | RegExp)[]): number | null {
  for (const label of labels) {
    const re = toMatcher(label);
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      const here = allAmounts(lines[i]);
      if (here.length) return here[here.length - 1];
      const next = lines[i + 1] ? allAmounts(lines[i + 1]) : [];
      if (next.length) return next[next.length - 1];
    }
  }
  return null;
}

function labeledDate(lines: string[], labels: (string | RegExp)[]): string | null {
  for (const label of labels) {
    const re = toMatcher(label);
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      const here = allDates(lines[i]);
      if (here.length) return here[0];
      const next = lines[i + 1] ? allDates(lines[i + 1]) : [];
      if (next.length) return next[0];
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Rechnungen                                                         */
/* ------------------------------------------------------------------ */

/*
 * Rechnungsnummer. "Rechnung" und "Nr" dürfen durch Leerzeichen oder Bindestrich
 * getrennt sein ("Rechnung Nr:", "Rechnungs-Nr.", "Rg.Nr"). Der erkannte Wert muss
 * mindestens eine Ziffer enthalten – sonst wird das nächstbeste Wort eingesammelt
 * ("Mit freundlichen Grüßen" lieferte vorher "Mit").
 */
const INVOICE_NUMBER_RE =
  /(?:rechnung(?:s)?|rg|beleg|invoice)[\s.\-]*(?:nummer|nr|no)\b\.?\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9\-_/.]{2,29})/i;

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Zahnarzt/KFO': [
    'zahnarzt', 'zahnärzt', 'zahnaerzt', 'kieferorthop', 'zahnmedizin', 'dental',
    'goz', 'zahnersatz', 'prophylaxe',
  ],
  Sehhilfe: ['optik', 'brille', 'sehhilfe', 'kontaktlinse', 'augenoptik'],
  Heilpraktiker: ['heilpraktiker', 'osteopath', 'naturheil'],
  Physiotherapie: ['physiotherap', 'krankengymnastik', 'ergotherap', 'logopäd', 'logopaed', 'massage'],
  Labor: ['laborgemeinschaft', 'labormedizin', 'laborarzt', 'labor'],
  Krankenhaus: ['klinikum', 'krankenhaus', 'klinik', 'ambulanz', 'stationär'],
  Medikamente: ['apotheke', 'rezept', 'arzneimittel'],
  Facharzt: [
    'orthopäd', 'dermatolog', 'hautarzt', 'radiolog', 'augenarzt', 'hno', 'urolog',
    'gynäkolog', 'frauenarzt', 'kinderarzt', 'kinder- und jugendmedizin', 'neurolog',
    'kardiolog', 'chirurg', 'anästhes',
  ],
  Allgemeinarzt: ['allgemeinmedizin', 'hausarzt', 'praktischer arzt', 'hausärzt'],
};

/*
 * Rechnungssumme.
 *
 * Arztrechnungen führen viele Beträge: Einzelleistungen, Zwischensummen je
 * Abschnitt, Steigerungsfaktoren, Umsatzsteuer, Abzüge. Maßgeblich ist der
 * ausdrücklich als Endsumme bezeichnete Betrag – und der steht am Ende des
 * Belegs, nicht am Anfang.
 */
/*
 * Als Muster statt fester Wörter, weil die Texterkennung Buchstaben verdoppelt
 * oder verschluckt – "zu zahllender Betrag" ist auf echten Belegen vorgekommen.
 */
/** Was tatsächlich zu zahlen ist – schlägt die Bruttosumme, wenn Abzüge bestehen. */
const PAYABLE_TOTAL = [
  /zu\s*zahl\w*\s*betrag/i,
  /zahl(?:ungs)?betrag/i,
  /betrag\s+zu\s+zahlen/i,
  /[üu]berweisungsbetrag/i,
];

/** Die ausgewiesene Rechnungssumme. */
const STRONG_TOTAL = [
  /liquidations?betrag/i,
  /rechnungs?\s?betrag/i,
  /gesamt\s?betrag/i,
  /end\s?betrag/i,
  /end\s?summe/i,
  /rechnungs?\s?summe/i,
  /gesamt\s?summe/i,
  /abrechnungs?betrag/i,
  /gesamtforderung/i,
];

const WEAK_TOTAL = [/summe/i, /gesamt/i, /total/i, /betrag/i, /honorar/i];

/**
 * Zeilen, deren Betrag nie die Endsumme ist – Teilsummen, Steuerzeilen, Abzüge
 * und Zahlenangaben, die gar kein Geldbetrag sind.
 */
const NOT_A_TOTAL =
  /(zwischensumme|teilsumme|übertrag|uebertrag|zw\.-?summe|netto|mwst|mehrwertsteuer|umsatzsteuer|ust\.|steuer|abz[üu]glich|anzahlung|bereits\s+(gezahlt|bezahlt|beglichen)|gutschrift|rabatt|minderung|erstattet|eigenanteil|punkt|faktor|steigerung|ziffer|goä|goz|nummer|iban|bic|konto|kto|blz|seite|telefon|steuernr)/i;

interface TotalResult {
  value: number | null;
  /** Woher der Betrag stammt – bestimmt, ob die App zum Prüfen auffordert. */
  source: 'endsumme' | 'summenzeile' | 'groesster-betrag' | 'keiner';
  label: string | null;
}

function findTotalAmount(lines: string[]): TotalResult {
  /** Alle Zeilen, die eines der Stichwörter tragen und keine Teilsumme sind. */
  const candidates = (
    labels: RegExp[],
    /*
     * Nur bei eindeutigen Bezeichnungen wird in den Folgezeilen weitergesucht.
     * Bei vagen Wörtern wie "Betrag" fängt man damit sonst einen beliebigen
     * Wert aus der Leistungsaufstellung ein.
     */
    lookAhead: boolean,
  ): { value: number; label: string; index: number }[] => {
    const found: { value: number; label: string; index: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const label = labels.find((re) => re.test(line));
      if (!label || NOT_A_TOTAL.test(line)) continue;

      let amounts = allAmounts(line);
      let at = i;
      /*
       * In Folgezeilen wird nur gesucht, wenn die Zeile eine reine Beschriftung
       * ist. Zahlungsbedingungen enthalten dieselben Wörter im Fließtext und
       * lieferten sonst den nächstbesten Betrag – etwa eine Mahngebühr.
       */
      if (lookAhead && amounts.length === 0 && line.length <= 40) {
        for (let step = 1; amounts.length === 0 && step <= 2; step++) {
          if (!lines[i + step]) break;
          amounts = allAmounts(lines[i + step]);
          at = i + step;
        }
      }
      if (amounts.length) {
        found.push({ value: amounts[amounts.length - 1], label: String(label), index: at });
      }
    }
    return found;
  };

  /*
   * Innerhalb einer Stufe gewinnt der größte Wert. Die Stichwörter tauchen auf
   * langen Rechnungen mehrfach auf – in Zahlungsbedingungen, Fußzeilen und
   * Abschnittssummen –, und die Endsumme ist unter diesen Nennungen die größte.
   */
  for (const [labels, source] of [
    [PAYABLE_TOTAL, 'endsumme'],
    [STRONG_TOTAL, 'endsumme'],
  ] as const) {
    const found = candidates(labels, true);
    if (found.length) {
      const best = found.reduce((a, b) => (b.value > a.value ? b : a));
      return { value: best.value, source, label: best.label };
    }
  }

  /*
   * Ohne klare Bezeichnung ist die Position im Beleg kein verlässlicher Hinweis –
   * eine Zeile mit "Betrag" kann irgendwo in der Leistungsaufstellung stehen.
   * Dann gilt der größte so gefundene Betrag als Summe.
   */
  const weak = candidates(WEAK_TOTAL, false);
  if (weak.length) {
    const best = weak.reduce((a, b) => (b.value > a.value ? b : a));
    return { value: best.value, source: 'summenzeile', label: best.label };
  }

  const all = allAmounts(lines.join('\n'));
  return all.length
    ? { value: Math.max(...all), source: 'groesster-betrag', label: null }
    : { value: null, source: 'keiner', label: null };
}

/** Zeilen mit einem Geburtsdatum – steht auf fast jeder Rechnung, ist aber nie das Rechnungs- oder Behandlungsdatum. */
const BIRTH_LINE = /(geb\.?\s*-?\s*(dat|datum)?\s*[:.]?|geboren|geburtstag|geburtsdatum)/i;

/** Zeilen zu Zahlungsfristen – deren Datum liegt nach dem Rechnungsdatum. */
const DEADLINE_LINE = /(zahlbar|zahlungsziel|f[äa]llig|bis zum|innerhalb von|zahlungstermin)/i;

/**
 * Alle Datumsangaben, die als Rechnungs- oder Behandlungsdatum in Frage kommen,
 * aufsteigend sortiert. Ausgeschlossen sind Geburtsdaten, Zahlungsfristen und
 * alles, was für eine Arztrechnung zu weit zurückliegt – die Texterkennung wirft
 * Geburts- und Leistungsdatum sonst in dieselbe Zeile.
 */
/** Älteste Datumsangabe, die für eine Arztrechnung noch sinnvoll ist. */
function oldestSensibleDate(): string {
  const oldest = new Date();
  oldest.setFullYear(oldest.getFullYear() - 15);
  return oldest.toISOString().slice(0, 10);
}

function plausibleDates(lines: string[]): string[] {
  const limit = oldestSensibleDate();

  const found = new Set<string>();
  for (const line of lines) {
    if (BIRTH_LINE.test(line) || DEADLINE_LINE.test(line)) continue;
    for (const d of allDates(line)) if (d >= limit) found.add(d);
  }
  return [...found].sort();
}

/* ------------------------------------------------------------------ */
/*  Zahlungsfrist                                                      */
/* ------------------------------------------------------------------ */

/** Ein konkret genanntes Zahlungsdatum: "zahlbar bis zum 15.03.2026". */
const DUE_DATE_LABEL =
  /(zahlbar\s+(?:bis|bis\s+zum|bis\s+spätestens)|f[äa]llig(?:keit|keitsdatum)?(?:\s+am)?|zahlungsziel|zahlungstermin|zu\s+zahlen\s+bis|überweisung\s+bis|ueberweisung\s+bis|bitte\s+bis\s+zum)/i;

/**
 * Eine Frist in Tagen: "zahlbar innerhalb von 14 Tagen", "binnen 30 Tagen",
 * "14 Tage netto", "Zahlungsziel 30 Tage". Die Zahl ist auf 1–90 begrenzt –
 * sonst greift die Erkennung Hausnummern und Gebührenziffern ab.
 */
const DUE_DAYS_RE =
  /(?:zahlbar|zahlung|zahlungsziel|betrag|rechnungsbetrag|bitte|überweisen|ueberweisen|netto|rein\s+netto)?[^.\n]{0,40}?(?:innerhalb\s+von|innerhalb|binnen|innert|in)\s+(\d{1,2})\s*(?:kalender)?tagen?|(?<![\d,.])(\d{1,2})\s*(?:kalender)?tage[nr]?\s*(?:netto|nach\s+(?:rechnungs)?(?:erhalt|eingang|datum|zugang)|ab\s+rechnungsdatum|zahlungsziel)/i;

/** "sofort fällig", "zahlbar sofort", "sofort ohne Abzug" – Frist = Rechnungsdatum. */
const DUE_NOW_RE = /(sofort\s+(?:f[äa]llig|zahlbar|ohne\s+abzug)|zahlbar\s+sofort|sofort\s+rein\s+netto)/i;

export interface PaymentDue {
  /** Errechnetes oder abgelesenes Fälligkeitsdatum, ISO. */
  date: string | null;
  /** Woher es stammt – ein abgelesenes Datum ist verlässlicher als eine Frist. */
  source: 'datum' | 'frist' | 'sofort' | 'keine';
  /** Bei einer Frist: die Zahl der Tage, sonst null. */
  days: number | null;
  /** Die Belegzeile, aus der die Frist stammt – zur Kontrolle im Formular. */
  line: string | null;
}

const plusDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Zahlungsfrist der Rechnung. Ein ausdrücklich genanntes Datum gewinnt; sonst
 * wird eine Tagesfrist auf das Rechnungsdatum gerechnet. Ohne Rechnungsdatum
 * bleibt die Tagesfrist unaufgelöst – der Wert wandert dann nur als Hinweis
 * ins Formular, statt ein falsches Datum zu behaupten.
 */
export function findPaymentDue(lines: string[], invoiceDate: string | null): PaymentDue {
  // 1) Konkretes Datum
  for (const line of lines) {
    if (!DUE_DATE_LABEL.test(line)) continue;
    // "Fälligkeit" steht auch in Mahnungen über bereits verstrichene Termine –
    // das Datum muss trotzdem hinter dem Rechnungsdatum liegen, sonst ist es
    // eher das Rechnungs- oder Leistungsdatum in derselben Zeile.
    const kandidaten = allDates(line).filter((d) => !invoiceDate || d >= invoiceDate);
    if (kandidaten.length) {
      return { date: kandidaten[0], source: 'datum', days: null, line: line.slice(0, 160) };
    }
  }

  // 2) Frist in Tagen
  for (const line of lines) {
    const m = DUE_DAYS_RE.exec(line);
    if (!m) continue;
    const days = Number(m[1] ?? m[2]);
    if (!Number.isFinite(days) || days < 1 || days > 90) continue;
    return {
      date: invoiceDate ? plusDays(invoiceDate, days) : null,
      source: 'frist',
      days,
      line: line.slice(0, 160),
    };
  }

  // 3) Sofort fällig
  for (const line of lines) {
    if (!DUE_NOW_RE.test(line)) continue;
    return { date: invoiceDate, source: 'sofort', days: 0, line: line.slice(0, 160) };
  }

  return { date: null, source: 'keine', days: null, line: null };
}

const NUMBER_LABEL = /(?:rechnung(?:s)?|rg|beleg|invoice)[\s.\-]*(?:nummer|nr|no)\b/i;

/** Sieht der Textbaustein wie eine Rechnungsnummer aus – und nicht wie Datum oder Betrag? */
function looksLikeNumber(token: string): boolean {
  const t = token.replace(/[.,;:!]+$/, '');
  if (t.length < 4 || t.length > 30) return false;
  if (!/\d/.test(t)) return false;
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(t)) return false; // Datum
  if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(t)) return false; // Betrag
  if (/^\d{4}$/.test(t)) return false; // bloße Jahreszahl
  return /^[A-Za-z0-9][A-Za-z0-9\-_/.]*$/.test(t);
}

/**
 * Rechnungsnummer suchen. Viele Praxisrechnungen führen sie als Tabellenspalte:
 * die Beschriftung steht in einer Kopfzeile ("Rechnungs-Nr. Rechnungsdatum"),
 * der Wert erst eine oder zwei Zeilen darunter. Deshalb wird erst dieselbe Zeile
 * geprüft und nur ersatzweise darunter weitergesucht.
 */
function findInvoiceNumber(lines: string[]): string {
  // 1) Wert direkt hinter der Beschriftung
  for (const line of lines) {
    const m = INVOICE_NUMBER_RE.exec(line);
    if (m && looksLikeNumber(m[1])) return m[1].replace(/[.,;:!]+$/, '');
  }

  // 2) Beschriftung ohne eigenen Wert -> in den folgenden Zeilen nachsehen
  for (let i = 0; i < lines.length; i++) {
    if (!NUMBER_LABEL.test(lines[i])) continue;
    // Zahlungshinweise nennen die Beschriftung, ohne dass ein Wert folgt.
    if (/(angeben|überweis|ueberweis|bitte|zahlen sie|vermerken)/i.test(lines[i])) continue;
    for (const next of lines.slice(i + 1, i + 4)) {
      const token = next.split(/\s+/).find(looksLikeNumber);
      if (token) return token.replace(/[.,;:!]+$/, '');
    }
  }
  return '';
}

/* Zeilen, die im Briefkopf stehen, aber nie den Aussteller benennen. */
const NOT_A_DOCTOR = [
  /\b\d{5}\s+\p{Lu}/u, // Postleitzahl + Ort
  /(straße|strasse|str\.|weg|platz|allee|gasse|ring)\s*\d/iu,
  /\b(tel|telefon|fax|e-?mail|internet|www\.|@|ust|steuer-?nr|iban|bic|bank)\b/i,
  /\b(seite|datum|rechnung|patient|versicherte|formular|antrag|anlage|bescheid)\b/i,
  /^\s*[-–—]/,
  /^\d/,
];

/** Merkmale, die eine Zeile als Praxis- oder Ausstellerzeile ausweisen. */
const DOCTOR_HINT =
  /(dr\.|dr\b|prof\.|dipl\.|praxis|zahnarzt|zahnärzt|zahnaerzt|ärzt|aerzt|arzt|mvz|klinik|apotheke|optik|therapie|heilpraktiker|hebamme|labor|zentrum|gemeinschaft)/i;

/**
 * Aussteller der Rechnung. Der Name steht fast immer im Briefkopf, dort aber
 * zwischen Anschrift, Bankverbindung und Formulartiteln – die werden verworfen.
 */
function findDoctor(lines: string[]): string {
  const head = lines.slice(0, 15).filter((l) => l.length >= 4 && l.length <= 120);
  const usable = head.filter((l) => !NOT_A_DOCTOR.some((re) => re.test(l)));
  const ordered = [...usable.filter((l) => DOCTOR_HINT.test(l)), ...usable];

  for (const line of ordered) {
    const cleaned = cleanDoctorLine(line);
    if (cleaned.length >= 4) return cleaned.slice(0, 120);
  }
  return (head[0] ?? lines[0] ?? '').replace(/\s{2,}/g, ' ').trim().slice(0, 120);
}

/**
 * Entfernt den Zeichensalat, den die Texterkennung aus Logos und Stempeln macht.
 * Aus "@_ BHYVY Dr. med. J. Scholl" wird "Dr. med. J. Scholl".
 */
function cleanDoctorLine(line: string): string {
  const tokens = line.split(/\s+/);
  const isRealWord = (t: string) => {
    if (/^(dr|prof|dipl|med|mvz)\b/i.test(t)) return true;
    const letters = t.replace(/[^\p{L}]/gu, '');
    // Ohne echten Vokal ist es Zeichensalat ("BHYVY"), kein Name.
    return letters.length >= 4 && /[aeiouäöü]/i.test(letters);
  };

  const start = tokens.findIndex(isRealWord);
  if (start < 0) return '';

  const kept = tokens.slice(start);
  // Zahlen- und Zeichenreste am Ende abschneiden (Kundennummern, Rahmenlinien).
  while (kept.length > 1 && !/\p{L}/u.test(kept[kept.length - 1])) kept.pop();

  return kept
    .join(' ')
    .replace(/[^\p{L}\p{N}.,&\-/()' ]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Das im Text zuerst genannte Familienmitglied. Die Position entscheidet, nicht
 * die Reihenfolge der Stammdaten – bei "Patient: Nora … Begleitperson: Ali"
 * ist Nora gemeint.
 */
function firstMemberIn(text: string, memberNames: string[]): string | null {
  let best: { name: string; at: number } | null = null;
  for (const name of memberNames) {
    const m = new RegExp(`(?<!\\p{L})${escapeRe(name)}(?!\\p{L})`, 'iu').exec(text);
    if (m && (best === null || m.index < best.at)) best = { name, at: m.index };
  }
  return best?.name ?? null;
}

/**
 * Frühestes Leistungsdatum aus der Aufstellung schätzen: das älteste Datum, das
 * höchstens zwei Jahre vor dem Rechnungsdatum liegt und nicht das Rechnungsdatum
 * selbst ist. Ohne mehrere Datumsangaben wird nicht geraten.
 */
function guessTreatmentDate(lines: string[], invoiceDate: string | null): string | null {
  if (!invoiceDate) return null;
  const earliestAllowed = new Date(invoiceDate);
  earliestAllowed.setFullYear(earliestAllowed.getFullYear() - 2);
  const limit = earliestAllowed.toISOString().slice(0, 10);

  const candidates = plausibleDates(lines).filter((d) => d < invoiceDate && d >= limit);
  return candidates.length >= 1 ? candidates[0] : null;
}

export interface InvoiceSuggestion {
  doctor: string;
  invoice_number: string;
  invoice_date: string | null;
  treatment_date: string | null;
  amount: number | null;
  category: string;
  member_name: string | null;
  /** Alle im Dokument gefundenen Familienmitglieder – mehr als eines heißt: prüfen. */
  member_candidates: string[];
  /** Wurde der Patient über eine ausdrückliche Beschriftung bestimmt? */
  member_from_label: boolean;
  /** Woher der Rechnungsbetrag stammt und unter welcher Beschriftung er stand. */
  amount_source: 'endsumme' | 'summenzeile' | 'groesster-betrag' | 'keiner';
  amount_label: string | null;
  /** Bis wann die Rechnung an den Arzt zu zahlen ist. */
  payment_due_date: string | null;
  payment_due: PaymentDue;
  confidence: Record<string, boolean>;
}

export function parseInvoice(
  text: string,
  memberNames: string[],
  /** Die tatsächlich gepflegten Behandlungsarten; ohne Angabe der Startbestand. */
  categories: string[] = [...DEFAULT_CATEGORIES],
): InvoiceSuggestion {
  const lines = text
    .split(/\r?\n/)
    .map((l) => clean(l))
    .filter((l) => l.length > 0);
  const joined = lines.join('\n');
  const lower = joined.toLowerCase();

  const invoiceNumber = findInvoiceNumber(lines);

  /*
   * Datumsangaben. Der Rückfall auf "erstes Datum im Dokument" darf keine
   * Geburtsdaten aufgreifen – die stehen auf fast jeder Rechnung und lieferten
   * sonst Rechnungsdaten wie 1991 oder das Geburtsjahr des Kindes.
   */
  const plausible = plausibleDates(lines);

  // Kopfbereich des Belegs: dort steht das Ausstellungsdatum, während
  // Zahlungsfristen im Text weiter unten stehen.
  const headLines = lines.slice(0, Math.max(8, Math.ceil(lines.length * 0.4)));
  const plausibleHead = plausibleDates(headLines);

  // Auch beschriftete Datumsangaben werden auf Plausibilität geprüft – sonst
  // rutscht eine falsch erkannte Jahreszahl ("2001") ungeprüft durch.
  const plausibleOnly = (d: string | null) => (d && d >= oldestSensibleDate() ? d : null);

  const invoiceDate =
    plausibleOnly(
      labeledDate(lines, ['rechnungsdatum', 'rechnung vom', 'datum der rechnung', 'rg-datum']),
    ) ??
    // "Frankfurt am Main, den 22.02.2022" – bei Liquidationen die Regel
    plausibleOnly(labeledDate(lines, [/,\s*den\b/i])) ??
    plausibleOnly(labeledDate(lines.filter((l) => !BIRTH_LINE.test(l)), ['datum'])) ??
    // Ohne Beschriftung das jüngste brauchbare Datum aus dem Kopfbereich;
    // Leistungen liegen davor, Geburtsdaten weit davor.
    plausibleHead[plausibleHead.length - 1] ??
    plausible[plausible.length - 1] ??
    null;

  /*
   * Behandlungsdatum. Nur wenige Rechnungen beschriften es; meist steht es in der
   * Leistungsaufstellung. Fehlt eine Beschriftung, wird deshalb das früheste Datum
   * genommen, das vor dem Rechnungsdatum liegt und nicht zu weit zurückreicht –
   * das ist geraten und wird über `confidence` als unsicher gekennzeichnet.
   */
  const labeledTreatment = labeledDate(lines, [
    'behandlungsdatum', 'behandlungszeitraum', 'leistungsdatum', 'leistungszeitraum',
    'behandlungstag', 'erbracht am', 'datum der behandlung', 'behandlung vom',
    'leistung vom', 'leistungen vom', 'behandelt am', 'tag der behandlung',
  ]);
  const treatmentDate = labeledTreatment ?? guessTreatmentDate(lines, invoiceDate);

  const total = findTotalAmount(lines);
  const amount = total.value;

  const paymentDue = findPaymentDue(lines, invoiceDate);

  const doctor = findDoctor(lines);

  /*
   * Kategorie. Die Stichwörter müssen am Wortanfang stehen, sonst findet sich
   * "hno" in "Bahnhofstraße" und "labor" in "Laboratorium des Nachbarn".
   */
  let category = FALLBACK;

  /*
   * Selbst angelegte Behandlungsarten haben Vorrang: steht "Kinderarzt" auf dem
   * Beleg und gibt es diese Art, ist sie die genauere Antwort als das allgemeine
   * "Facharzt" aus der Stichwortliste. Die längsten Namen zuerst, damit
   * "Zahnarzt/KFO" vor "Zahnarzt" greift.
   */
  const eigene = [...categories]
    .filter((c) => c !== FALLBACK)
    .sort((a, b) => b.length - a.length);
  for (const name of eigene) {
    // Bei zusammengesetzten Namen genügt ein Teil ("Zahnarzt/KFO" -> "Zahnarzt").
    const treffer = name.split(/[\/,]/).some((teil) => {
      const wort = teil.trim();
      if (wort.length < 4) return false;
      /*
       * Zusätzlich zum ganzen Wort auch der Stamm ohne deutsche Endung: der Beleg
       * schreibt "Osteopathische Behandlung", die Behandlungsart heißt
       * "Osteopathie" – ohne Stamm greift keiner von beiden.
       */
      const stamm = wort.replace(/(ische|isch|ien|ie|ungen|ung|en|e)$/i, '');
      return (
        hasWordStart(joined, wort) || (stamm.length >= 5 && hasWordStart(joined, stamm))
      );
    });
    if (treffer) {
      category = name;
      break;
    }
  }

  if (category === FALLBACK) {
    for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
      if (words.some((w) => hasWordStart(joined, w))) {
        category = cat;
        break;
      }
    }
  }
  // Nur zurückgeben, was es wirklich gibt – sonst zeigt das Formular ins Leere.
  if (!categories.includes(category)) category = FALLBACK;

  /*
   * Patient: bekannter Vorname im Text – zwingend auf Wortgrenzen geprüft.
   * Ohne die steckt "Ali" in "Qualität" und "Ina" in "Praxisinhaberin" –
   * "Millionen"; die Rechnung liefe dann unbemerkt auf die falsche Person und
   * damit auf den falschen Beihilfesatz.
   */
  /*
   * Beschriftungen, mit denen Praxen den Patienten benennen. "behandelt" deckt
   * die bei Kinderrechnungen übliche Form "Behandelt wurde: <Name>" mit ab –
   * dort ist der Rechnungsempfänger ein Elternteil, der Patient aber das Kind.
   */
  const labeled = findLabeled(lines, [
    'behandelt', 'behandelte person', 'patient', 'patientin', 'versicherte',
    'name des patienten', 'für das kind', 'pat.:',
  ]);
  // Erst die Beschriftungszeile selbst, nur ersatzweise die Zeile darunter –
  // sonst zieht eine folgende Zeile ("Begleitperson: …") den falschen Namen herein.
  let memberName =
    firstMemberIn(labeled?.line ?? '', memberNames) ??
    firstMemberIn(labeled ? (lines[labeled.index + 1] ?? '') : '', memberNames);
  // Woher der Patient stammt: eine ausdrückliche Beschriftung ist verlässlich,
  // ein bloßer Namensfund im Text nicht.
  const memberFromLabel = memberName !== null;

  // Alle im Dokument vorkommenden Familienmitglieder – gescannte Sammelbelege
  // enthalten mitunter Rechnungen für mehrere Personen.
  const memberCandidates = memberNames.filter((name) => hasWord(joined, name));
  if (!memberName && memberCandidates.length === 1) memberName = memberCandidates[0];

  return {
    doctor,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    treatment_date: treatmentDate,
    amount,
    category,
    member_name: memberName,
    member_candidates: memberCandidates,
    member_from_label: memberFromLabel,
    amount_source: total.source,
    amount_label: total.label,
    payment_due_date: paymentDue.date,
    payment_due: paymentDue,
    confidence: {
      invoice_number: Boolean(invoiceNumber),
      invoice_date: Boolean(invoiceDate),
      // Nur ein beschriftetes Behandlungsdatum gilt als sicher, das geschätzte nicht.
      treatment_date: Boolean(labeledTreatment),
      // Nur eine ausdrücklich bezeichnete Endsumme gilt als sicher.
      amount: total.source === 'endsumme',
      member_name: Boolean(memberName),
      // Ein abgelesenes Datum ist sicher; eine hochgerechnete Frist nicht.
      payment_due_date: paymentDue.source === 'datum',
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Bescheide                                                          */
/* ------------------------------------------------------------------ */

/*
 * Umlaute werden tolerant behandelt: Bescheide kommen als PDF mit echten
 * Umlauten, aus OCR aber auch mal als ae/oe/ue oder ohne Umlaut.
 */
const AE = '(?:ä|ae|a)';
const OE = '(?:ö|oe|o)';
const UE = '(?:ü|ue|u)';
const FAEHIG = `f${AE}hig`;

const reason = (source: string) => new RegExp(source, 'i');

/** Erkennbare Kürzungs-/Ablehnungsgründe mit Klartext-Bezeichnung. */
const REASON_PATTERNS: { re: RegExp; label: string }[] = [
  { re: reason(`nicht\\s+beihilfe(${FAEHIG}|berechtigt)`), label: 'Nicht beihilfefähig' },
  { re: reason(`nicht\\s+erstattungs${FAEHIG}`), label: 'Nicht erstattungsfähig' },
  { re: reason('nicht\\s+(medizinisch\\s+)?notwendig'), label: 'Medizinische Notwendigkeit bestritten' },
  {
    re: reason(`(${OE}chstsatz|schwellenwert|geb${UE}hrenrahmen|1,?\\d\\s*-?fach|h${OE}chstsatz)`),
    label: 'Gebührensatz/Höchstsatz überschritten',
  },
  { re: reason(`(gek${UE}rzt|k${UE}rzung|reduziert)`), label: 'Betrag gekürzt' },
  { re: reason('(selbstbehalt|eigenbehalt|eigenanteil)'), label: 'Selbstbehalt/Eigenanteil abgezogen' },
  { re: reason(`(h${OE}chstbetrag|begrenzt\\s+auf)`), label: 'Höchstbetrag begrenzt' },
  {
    re: reason('(beleg|nachweis|unterlage)[^.]{0,40}(fehlt|fehlen|nachreichen|erforderlich)'),
    label: 'Beleg/Nachweis fehlt',
  },
  { re: reason('(bereits\\s+(abgerechnet|erstattet|eingereicht)|doppel)'), label: 'Bereits abgerechnet' },
  { re: reason('(wartezeit|nicht\\s+versichert|tarif[^.]{0,30}(nicht|kein))'), label: 'Tarif/Wartezeit' },
  {
    re: reason(`(analogberechnung|nicht\\s+ansatz${FAEHIG}|nebeneinander\\s+nicht\\s+berechnungs${FAEHIG})`),
    label: 'Position nicht ansatzfähig',
  },
  {
    re: reason(`ziffer\\s+\\d+[^.]{0,60}(geb${UE}hrenordnung|GO${AE}|GOZ)`),
    label: 'Gebührenposition nicht anerkannt',
  },
  { re: reason('nicht\\s+ber[üu]cksichtigt'), label: 'Position nicht berücksichtigt' },
  { re: reason('ablehnungsbetrag'), label: 'Teilbetrag abgelehnt' },
  { re: reason('abgelehnt'), label: 'Abgelehnt' },
];

export function detectReasons(text: string): string[] {
  const found: string[] = [];
  for (const { re, label } of REASON_PATTERNS) {
    if (re.test(text) && !found.includes(label)) found.push(label);
  }
  return found;
}

/**
 * Der erstattete Betrag – nach Genauigkeit geordnet. Wichtig: "beihilfefähiger
 * Betrag" ist die Bemessungsgrundlage, nicht die Erstattung, und darf deshalb
 * nicht mit "Beihilfe: …" verwechselt werden.
 */
const PAID_LABELS: (string | RegExp)[] = [
  /auszahlungsbetrag/i,
  /erstattungsbetrag/i,
  /(überweisungs|ueberweisungs)betrag/i,
  /(versicherungs|tarif|beihilfe)leistung/i,
  /\bbeihilfe\b\s*(\([^)]*\))?\s*[:.]/i,
  /\bbeihilfe\b/i,
  /(erstattet|erstattung|gezahlt|zahlbetrag|auszahlung)/i,
  /\bleistung\b/i,
];

/** Der eingereichte Rechnungsbetrag laut Bescheid. */
const INVOICE_AMOUNT_LABELS: (string | RegExp)[] = [
  /aufwendung/i,
  /rechnungsbetrag/i,
  /eingereichter betrag/i,
  /gesamtbetrag der rechnung/i,
  /rechnungssumme/i,
  /liquidation/i,
];

export interface DecisionItemSuggestion {
  invoice_number: string;
  invoice_date: string | null;
  invoice_amount: number | null;
  paid_amount: number | null;
  reason: string;
  raw_line: string;
  /** Patient laut Bescheid – in echten Bescheiden das verlässlichste Zuordnungsmerkmal. */
  member_name?: string | null;
  /** Abgelehnter bzw. nicht beihilfefähiger Teilbetrag. */
  rejected_amount?: number | null;
  /** Bemessungssatz laut Bescheid (z.B. 0.65) – dient dem Abgleich mit den Einstellungen. */
  rate?: number | null;
  /** Behandlungsjahr (DBV nennt kein Rechnungsdatum). */
  treatment_year?: number | null;
  /** Arztname bzw. Leistungsbezeichnung aus dem Bescheid. */
  service_label?: string;
}

export interface DecisionSuggestion {
  decision_date: string | null;
  /** Summe der Erstattungen laut Bescheid (Kontrollwert für die erkannten Positionen). */
  total_paid: number | null;
  /** Tatsächlich überwiesener Betrag – kann durch Verrechnungen davon abweichen. */
  payout_amount?: number | null;
  items: DecisionItemSuggestion[];
  detected_account_hint: string | null;
  target_hint: 'dbv' | 'beihilfe' | null;
  /** Erkanntes Bescheidformat – nur zur Information/Diagnose. */
  format: 'beihilfe-hessen' | 'dbv' | 'generisch';
  notes?: string[];
}

const ANCHOR_RE =
  /(rechnungs-?\s*(?:nummer|nr\.?|no\.?)|rg\.?-?nr\.?|beleg-?\s*nr\.?|rechnung\s+vom|liquidation\s+vom)/i;

/**
 * Liest einen Bescheid. Für die bekannten Formate von Beihilfe Hessen und DBV
 * gibt es eigene Tabellenparser; alles andere läuft über die allgemeine
 * Blockerkennung unten.
 */
export async function parseDecision(
  text: string,
  memberNames: string[] = [],
): Promise<DecisionSuggestion> {
  const { detectDecisionFormat, parseBeihilfeHessen, parseDbv } = await import('./decisionFormats.js');
  const format = detectDecisionFormat(text);

  if (format === 'beihilfe-hessen') {
    const parsed = parseBeihilfeHessen(text, memberNames);
    if (parsed.items.length > 0) return parsed;
  }
  if (format === 'dbv') {
    const parsed = parseDbv(text, memberNames);
    if (parsed.items.length > 0) return parsed;
  }
  return parseDecisionGeneric(text);
}

/* Merkmale im Briefkopf, die den Absender ausweisen. */
const BEIHILFE_SENDER = /(regierungspr[äa]sidium|beihilfestelle|beihilfen\b|festsetzungsstelle)/i;
const DBV_SENDER = /(\bdbv\b|axa|beamtenversicherung|krankenversicherung ag)/i;

/**
 * Absender eines Bescheids bestimmen. Ausschlaggebend ist der **Briefkopf**, nicht
 * der Fließtext: eine DBV-Abrechnung erwähnt im Text regelmäßig die Beihilfe
 * ("abzüglich Beihilfeanteil"), und ein Beihilfebescheid nennt die private
 * Krankenversicherung. Wer nur nach Stichwörtern im ganzen Dokument sucht,
 * verwechselt beide – und schreibt dann den falschen Anteil in die falsche
 * Einreichung.
 *
 * Erst wenn der Briefkopf nichts hergibt, entscheidet die Häufigkeit im
 * Gesamttext; bleibt es unklar, wird `null` zurückgegeben und die App fragt.
 */
export function detectSender(lines: string[]): 'dbv' | 'beihilfe' | null {
  const kopf = lines.slice(0, 20).join('\n');
  const kopfBeihilfe = BEIHILFE_SENDER.test(kopf);
  const kopfDbv = DBV_SENDER.test(kopf);
  if (kopfDbv && !kopfBeihilfe) return 'dbv';
  if (kopfBeihilfe && !kopfDbv) return 'beihilfe';

  const ganz = lines.join('\n');
  const zaehle = (re: RegExp) => (ganz.match(new RegExp(re.source, 'gi')) ?? []).length;
  const bh = zaehle(BEIHILFE_SENDER);
  const dbv = zaehle(DBV_SENDER);
  if (dbv > bh) return 'dbv';
  if (bh > dbv) return 'beihilfe';
  return null;
}

/** Allgemeine Erkennung für unbekannte Bescheidformate. */
export function parseDecisionGeneric(text: string): DecisionSuggestion {
  const lines = text
    .split(/\r?\n/)
    .map((l) => clean(l))
    .filter((l) => l.length > 0);
  const joined = lines.join('\n');
  const lower = joined.toLowerCase();

  const decision_date =
    labeledDate(lines, ['bescheid vom', 'bescheiddatum', 'datum des bescheides', 'ausgestellt am']) ??
    labeledDate(lines.slice(0, 15), ['datum']) ??
    allDates(lines.slice(0, 15).join('\n'))[0] ??
    null;

  const total_paid = labeledAmount(lines, [
    'auszahlungsbetrag', 'überweisungsbetrag', 'ueberweisungsbetrag', 'gesamterstattung',
    'summe der beihilfe', 'gesamtbetrag der beihilfe', 'erstattungsbetrag', 'auszahlung',
  ]);

  const target_hint = detectSender(lines);

  /* --- Variante 1: Blöcke, die je mit einer Rechnungs-Referenz beginnen --- */
  const anchorIdx: number[] = [];
  lines.forEach((l, i) => {
    if (ANCHOR_RE.test(l)) anchorIdx.push(i);
  });

  /*
   * Eine Position wird oft über mehrere Zeilen referenziert ("Rechnungsnummer: …"
   * gefolgt von "Rechnung vom …"). Ein neuer Block beginnt deshalb erst, wenn seit
   * dem letzten Blockanfang ein Betrag aufgetaucht ist oder genug Abstand liegt –
   * sonst würde eine Position in mehrere zerfallen.
   */
  const starts: number[] = [];
  for (const idx of anchorIdx) {
    const last = starts.at(-1);
    if (
      last !== undefined &&
      idx - last <= 3 &&
      !lines.slice(last, idx).some((l) => allAmounts(l).length > 0)
    ) {
      continue;
    }
    starts.push(idx);
  }

  const items: DecisionItemSuggestion[] = [];

  for (let a = 0; a < starts.length; a++) {
    const start = starts[a];
    const end = a + 1 < starts.length ? starts[a + 1] : Math.min(lines.length, start + 14);
    const item = parseBlock(lines.slice(start, end));
    if (item) items.push(item);
  }

  /* --- Variante 2: Tabellenzeilen (Datum + mindestens zwei Beträge) --- */
  if (items.length === 0) {
    for (const line of lines) {
      const amounts = allAmounts(line);
      const dates = allDates(line);
      if (amounts.length < 2 || dates.length === 0) continue;
      if (/summe|gesamt|übertrag|uebertrag/i.test(line)) continue;
      const token = /(?<!\d)([A-Z0-9][A-Z0-9\-_/]{4,})(?!\d)/.exec(line);
      items.push({
        invoice_number: token ? token[1] : '',
        invoice_date: dates[0],
        invoice_amount: amounts[0],
        paid_amount: amounts[amounts.length - 1],
        reason: detectReasons(line).join('; '),
        raw_line: line,
      });
    }
  }

  return {
    decision_date,
    total_paid,
    payout_amount: total_paid,
    items,
    detected_account_hint: null,
    target_hint,
    format: 'generisch',
    notes: [],
  };
}

function parseBlock(block: string[]): DecisionItemSuggestion | null {
  const blockText = block.join('\n');
  const numMatch = INVOICE_NUMBER_RE.exec(blockText);
  const invoice_number = numMatch ? numMatch[1].replace(/[.,;:]$/, '') : '';

  const invoice_date =
    labeledDate(block, ['rechnung vom', 'rechnungsdatum', 'liquidation vom', 'vom']) ??
    allDates(blockText)[0] ??
    null;

  const invoice_amount = labeledAmount(block, INVOICE_AMOUNT_LABELS);
  let paid_amount = labeledAmount(block, PAID_LABELS);

  const amounts = allAmounts(blockText);
  if (paid_amount === null && amounts.length >= 2) paid_amount = amounts[amounts.length - 1];
  if (paid_amount === null && amounts.length === 1 && invoice_amount === null) {
    paid_amount = amounts[0];
  }

  const reason = detectReasons(blockText).join('; ');
  if (invoice_number === '' && invoice_date === null && paid_amount === null) return null;

  return {
    invoice_number,
    invoice_date,
    invoice_amount: invoice_amount ?? (amounts.length >= 2 ? amounts[0] : null),
    paid_amount,
    reason,
    raw_line: blockText.slice(0, 600),
  };
}

/** Normalisiert Rechnungsnummern für den Vergleich (OCR-tolerant). */
export function normalizeInvoiceNumber(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8');
}
