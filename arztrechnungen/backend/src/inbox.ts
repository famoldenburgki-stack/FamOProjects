/**
 * Eingang für Rechnungen und Bescheide.
 *
 * Ein überwachter Ordner (z.B. ein Cloud-Ordner, in den das Handy scannt) wird
 * eingelesen. Jedes Dokument wird ausgewertet und als **Entwurf** abgelegt –
 * nicht als Rechnung und nicht als geprüfter Bescheid. Erst nach Bestätigung in
 * der App entsteht ein echter Datensatz.
 *
 * Ob ein Dokument eine Rechnung oder ein Bescheid ist, entscheidet die
 * Formaterkennung. So kannst du von unterwegs beides in denselben Ordner legen –
 * einen Bescheid aus dem Portal genauso wie eine abfotografierte Rechnung.
 *
 * Das ist Absicht: die Erkennung liegt bei manchen Belegen daneben, und ein
 * unbeaufsichtigt angelegter Datensatz mit falschem Betrag oder Patienten fällt
 * später kaum auf. Ein Entwurf, den man abnicken muss, schon.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, getCategories, getSettings } from './db.js';
import { INBOX_DIR } from './paths.js';
import { extractText } from './ocr/extract.js';
import { hasWord, parseDecision, parseInvoice, type InvoiceSuggestion } from './ocr/parse.js';
import { detectDecisionFormat } from './ocr/decisionFormats.js';
import { applyPattern, findPattern, patternSummary } from './patterns.js';
import { resolveStoredPath } from './archive.js';
import type { FamilyMember } from './types.js';

const READABLE = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp']);

export interface InboxRow {
  id: number;
  /** 'rechnung' oder 'bescheid' – bestimmt, was beim Bestätigen passiert. */
  kind: string;
  decision: string;
  file_path: string;
  original_name: string;
  content_hash: string;
  source: string;
  ocr_source: string;
  ocr_text: string;
  suggestion: string;
  hints: string;
  created_at: string;
}

/** Was die App in einem Bescheid-Entwurf schon erkannt hat. */
export interface DecisionPreview {
  target: 'dbv' | 'beihilfe' | null;
  account: string;
  decision_date: string | null;
  total_paid: number | null;
  item_count: number;
  /** Patienten, die im Bescheid vorkommen – zur Kontrolle des Zugangs. */
  members: string[];
  format: string;
}

export interface InboxEntry
  extends Omit<InboxRow, 'suggestion' | 'hints' | 'ocr_text' | 'decision'> {
  suggestion: InvoiceSuggestion & { family_member_id: number | null };
  decision: DecisionPreview | null;
  hints: string[];
  /** Fehlt etwas Wesentliches, damit daraus eine Rechnung werden kann? */
  incomplete: boolean;
  missing: string[];
}

const parseJson = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

/** Was zwingend gefüllt sein muss, bevor ein Entwurf zur Rechnung wird. */
function missingFields(s: InboxEntry['suggestion']): string[] {
  const fehlt: string[] = [];
  if (!s.family_member_id) fehlt.push('Patient');
  if (s.amount === null || !(s.amount > 0)) fehlt.push('Betrag');
  if (!s.invoice_date) fehlt.push('Rechnungsdatum');
  return fehlt;
}

export function toEntry(row: InboxRow): InboxEntry {
  const suggestion = parseJson(row.suggestion, {} as InboxEntry['suggestion']);
  const bescheid = row.kind === 'bescheid';
  // Für einen Bescheid gelten die Pflichtfelder einer Rechnung nicht.
  const missing = bescheid ? [] : missingFields(suggestion);
  // Der erkannte Text bleibt in der Datenbank, muss aber nicht in jede Liste.
  const { ocr_text: _text, decision: _decision, ...rest } = row;
  return {
    ...rest,
    suggestion,
    decision: bescheid ? parseJson<DecisionPreview | null>(row.decision, null) : null,
    hints: parseJson<string[]>(row.hints, []),
    incomplete: missing.length > 0,
    missing,
  };
}

export function listInbox(): InboxEntry[] {
  const rows = db.prepare('SELECT * FROM inbox ORDER BY id').all() as InboxRow[];
  return rows.map(toEntry);
}

export function countInbox(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM inbox').get() as { n: number }).n;
}

/* ------------------------------------------------------------------ */
/*  Einlesen                                                           */
/* ------------------------------------------------------------------ */

const hashOf = (file: string): string =>
  crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

/** Hängt " (2)" an, falls im Zielordner schon eine Datei so heißt. */
function freeName(dir: string, name: string): string {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let n = 2; fs.existsSync(candidate) && n < 500; n++) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
  }
  return candidate;
}

export interface IntakeResult {
  added: InboxEntry[];
  skipped: { file: string; reason: string }[];
  folder: string;
}

/**
 * Liest den überwachten Ordner ein. Erkannte Belege wandern in den App-Ordner,
 * damit der Überwachungsordner leer bleibt und klar ist, was noch offen ist.
 */
export async function scanInboxFolder(folderOverride?: string): Promise<IntakeResult> {
  const folder = (folderOverride ?? getSettings().inbox_folder ?? '').trim();
  const result: IntakeResult = { added: [], skipped: [], folder };
  if (!folder || !fs.existsSync(folder)) return result;

  fs.mkdirSync(INBOX_DIR, { recursive: true });

  const members = db
    .prepare('SELECT * FROM family_members WHERE active = 1 ORDER BY sort_order')
    .all() as FamilyMember[];
  const memberNames = members.map((m) => m.name);
  const categories = getCategories();
  // Zugänge, über die eingereicht wird – daraus wird der Zugang eines Bescheids geraten.
  const konten = [...new Set(members.map((m) => m.account))];

  const bekannt = new Set(
    (db.prepare('SELECT content_hash FROM inbox').all() as { content_hash: string }[]).map(
      (r) => r.content_hash,
    ),
  );

  for (const eintrag of fs.readdirSync(folder, { withFileTypes: true })) {
    // Unterordner bleiben außen vor – dort liegen verworfene und verarbeitete Belege.
    if (!eintrag.isFile()) continue;
    const quelle = path.join(folder, eintrag.name);
    if (!READABLE.has(path.extname(eintrag.name).toLowerCase())) {
      result.skipped.push({ file: eintrag.name, reason: 'kein lesbarer Dateityp' });
      continue;
    }

    let hash: string;
    try {
      hash = hashOf(quelle);
    } catch (err) {
      // Datei wird gerade noch synchronisiert oder ist gesperrt – nächstes Mal wieder.
      result.skipped.push({ file: eintrag.name, reason: `nicht lesbar: ${msg(err)}` });
      continue;
    }
    if (bekannt.has(hash)) {
      result.skipped.push({ file: eintrag.name, reason: 'bereits im Eingang' });
      continue;
    }

    const { text, source, warning } = await extractText(quelle);

    /*
     * Bescheid oder Rechnung? Die Formaterkennung entscheidet. Ein Bescheid
     * bekommt einen eigenen Entwurf – beim Bestätigen läuft er durch dieselbe
     * Prüfung wie ein von Hand hochgeladener.
     */
    const format = detectDecisionFormat(text);
    if (format !== 'generisch') {
      const eingelesen = await eingangBescheid({
        text,
        source,
        warning,
        fileName: eintrag.name,
        quelle,
        hash,
        konten,
        memberNames,
        format,
      });
      bekannt.add(hash);
      result.added.push(eingelesen);
      continue;
    }

    const suggestion = parseInvoice(text, memberNames, categories);

    /* Gelerntes Muster des Ausstellers anwenden, wie beim Hochladen von Hand. */
    const pattern = findPattern(text, suggestion.doctor);
    if (pattern) {
      const angewandt = applyPattern(pattern, text, {
        invoice_number: suggestion.invoice_number,
        amount: suggestion.amount,
        invoice_date: suggestion.invoice_date,
        treatment_date: suggestion.treatment_date,
        category: suggestion.category,
      });
      if (angewandt.values.invoice_number !== undefined) {
        suggestion.invoice_number = String(angewandt.values.invoice_number);
      }
      if (angewandt.values.amount !== undefined) suggestion.amount = Number(angewandt.values.amount);
      if (angewandt.values.invoice_date !== undefined) {
        suggestion.invoice_date = String(angewandt.values.invoice_date);
      }
      if (angewandt.values.treatment_date !== undefined) {
        suggestion.treatment_date = String(angewandt.values.treatment_date);
      }
      if (angewandt.category) suggestion.category = angewandt.category;
      if (pattern.display_name) suggestion.doctor = pattern.display_name;
    }

    const hints = buildHints(text, eintrag.name, suggestion, pattern ? patternSummary(pattern) : null);
    if (warning) hints.unshift(warning);

    // Beleg in den App-Ordner übernehmen, damit der Überwachungsordner leer bleibt.
    const ziel = freeName(INBOX_DIR, eintrag.name);
    try {
      fs.renameSync(quelle, ziel);
    } catch {
      fs.copyFileSync(quelle, ziel);
      fs.rmSync(quelle, { force: true });
    }

    const member = suggestion.member_name
      ? members.find((m) => m.name === suggestion.member_name)
      : undefined;

    const info = db
      .prepare(
        `INSERT INTO inbox
           (file_path, original_name, content_hash, source, ocr_source, ocr_text, suggestion, hints)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ziel,
        eintrag.name,
        hash,
        'ordner',
        source,
        text.slice(0, 200_000),
        JSON.stringify({ ...suggestion, family_member_id: member?.id ?? null }),
        JSON.stringify(hints),
      );

    bekannt.add(hash);
    const row = db.prepare('SELECT * FROM inbox WHERE id = ?').get(Number(info.lastInsertRowid)) as InboxRow;
    result.added.push(toEntry(row));
  }

  return result;
}

/**
 * Einen erkannten Bescheid als Entwurf aufnehmen. Geprüft und den Rechnungen
 * zugeordnet wird erst beim Bestätigen in der App – hier entsteht nur die
 * Vorschau, damit du siehst, was auf dich zukommt.
 */
async function eingangBescheid(args: {
  text: string;
  source: string;
  warning?: string;
  fileName: string;
  quelle: string;
  hash: string;
  konten: string[];
  memberNames: string[];
  format: string;
}): Promise<InboxEntry> {
  const parsed = await parseDecision(args.text, args.memberNames);

  /*
   * Zugang raten: Bescheide gehen an die beihilfeberechtigte bzw. versicherte
   * Person, und die steht im Anschriftenfeld oben. Deshalb zählt nur der Kopf des
   * Dokuments – weiter unten stehen die Namen der behandelten Kinder.
   */
  const kopf = args.text.split(/\r?\n/).slice(0, 25).join('\n');
  const zugang =
    args.konten.find((k) => hasWord(kopf, k)) ??
    args.konten.find((k) => hasWord(args.text, k)) ??
    args.konten[0] ??
    '';

  const betroffene = [
    ...new Set(parsed.items.map((i) => i.member_name).filter((n): n is string => Boolean(n))),
  ];

  const vorschau: DecisionPreview = {
    target: parsed.target_hint ?? null,
    account: zugang,
    decision_date: parsed.decision_date,
    total_paid: parsed.total_paid,
    item_count: parsed.items.length,
    members: betroffene,
    format: args.format,
  };

  const hints: string[] = [];
  if (args.warning) hints.push(args.warning);
  if (!parsed.target_hint) {
    hints.push('Der Absender war nicht eindeutig – bitte Beihilfe oder DBV selbst auswählen.');
  }
  if (parsed.items.length === 0) {
    hints.push(
      'Es wurden keine Positionen erkannt. Der Bescheid wird erfasst, aber nichts automatisch zugeordnet.',
    );
  }
  hints.push(...(parsed.notes ?? []));

  // Datei in den App-Ordner übernehmen, damit der überwachte Ordner leer bleibt.
  const ziel = freeName(INBOX_DIR, args.fileName);
  try {
    fs.renameSync(args.quelle, ziel);
  } catch {
    fs.copyFileSync(args.quelle, ziel);
    fs.rmSync(args.quelle, { force: true });
  }

  const info = db
    .prepare(
      `INSERT INTO inbox
         (kind, decision, file_path, original_name, content_hash, source, ocr_source, ocr_text,
          suggestion, hints)
       VALUES ('bescheid', ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
    )
    .run(
      JSON.stringify(vorschau),
      ziel,
      args.fileName,
      args.hash,
      'ordner',
      args.source,
      args.text.slice(0, 200_000),
      JSON.stringify(hints),
    );

  return toEntry(
    db.prepare('SELECT * FROM inbox WHERE id = ?').get(Number(info.lastInsertRowid)) as InboxRow,
  );
}

/** Dieselben Hinweise wie beim Hochladen von Hand – hier nur ohne Anzeige. */
function buildHints(
  text: string,
  fileName: string,
  s: InvoiceSuggestion,
  pattern: ReturnType<typeof patternSummary> | null,
): string[] {
  const hints: string[] = [];
  const format = detectDecisionFormat(text);
  if (format !== 'generisch') {
    hints.push(
      `Das sieht nach einem Bescheid ${format === 'dbv' ? 'der DBV' : 'der Beihilfe'} aus, nicht nach einer Rechnung. Bitte über "Bescheid prüfen" einlesen und diesen Entwurf verwerfen.`,
    );
  }
  if (text.trim().length < 120) {
    hints.push('Aus dem Beleg ließ sich kaum Text gewinnen – bitte alle Felder selbst ausfüllen.');
  }
  if (s.member_candidates.length > 1 && !s.member_from_label) {
    hints.push(`Mehrere Familienmitglieder im Beleg (${s.member_candidates.join(', ')}) – bitte prüfen.`);
  }
  if (s.treatment_date && !s.confidence.treatment_date) {
    hints.push('Das Behandlungsdatum ist geschätzt – bitte gegenprüfen.');
  }
  if (s.amount !== null && s.amount_source !== 'endsumme') {
    hints.push(
      s.amount_source === 'summenzeile'
        ? `Der Betrag stammt aus einer Zeile mit „${s.amount_label}" – keine ausdrückliche Endsumme gefunden.`
        : 'Der Betrag ist der höchste im Beleg gefundene – keine bezeichnete Endsumme erkannt.',
    );
  }
  if (s.amount === null) {
    const wieRezept = /(rezept|verordnung|apotheken-?nummer|arztbericht|befund)/i.test(
      `${text}\n${fileName}`,
    );
    hints.push(
      wieRezept
        ? 'Kein Betrag gefunden – sieht nach einem Rezept oder Bericht aus, nicht nach einer Rechnung.'
        : 'Kein Rechnungsbetrag gefunden – bitte selbst eintragen.',
    );
  }
  if (s.payment_due.source === 'frist' && s.payment_due.days !== null) {
    hints.push(
      s.payment_due_date
        ? `Zahlbar innerhalb von ${s.payment_due.days} Tagen – das ergibt den ${s.payment_due_date.split('-').reverse().join('.')}.`
        : `Zahlungsfrist von ${s.payment_due.days} Tagen genannt, aber kein Rechnungsdatum – bitte Fälligkeit selbst eintragen.`,
    );
  }
  if (pattern) hints.push(`Muster "${pattern.name}" angewandt (${pattern.samples} Rechnungen gelernt).`);
  return hints;
}

/* ------------------------------------------------------------------ */
/*  Verwerfen                                                          */
/* ------------------------------------------------------------------ */

/**
 * Entwurf verwerfen. Die Datei wird nicht gelöscht, sondern in den Unterordner
 * "verworfen" des Überwachungsordners gelegt – sie stammt aus der Ablage des
 * Nutzers und darf nicht einfach verschwinden.
 */
export function discardInbox(id: number): { ok: boolean; moved_to: string | null } {
  const row = db.prepare('SELECT * FROM inbox WHERE id = ?').get(id) as InboxRow | undefined;
  if (!row) return { ok: false, moved_to: null };

  let ziel: string | null = null;
  const folder = (getSettings().inbox_folder ?? '').trim();
  const quelle = resolveStoredPath(row.file_path);

  if (folder && fs.existsSync(quelle)) {
    try {
      const abgelegt = path.join(folder, 'verworfen');
      fs.mkdirSync(abgelegt, { recursive: true });
      ziel = freeName(abgelegt, row.original_name || path.basename(quelle));
      fs.renameSync(quelle, ziel);
    } catch {
      ziel = null; // Datei bleibt liegen, wo sie ist – besser als verloren
    }
  }

  db.prepare('DELETE FROM inbox WHERE id = ?').run(id);
  return { ok: true, moved_to: ziel };
}

export function getInboxRow(id: number): InboxRow | undefined {
  return db.prepare('SELECT * FROM inbox WHERE id = ?').get(id) as InboxRow | undefined;
}

export function removeInboxRow(id: number): void {
  db.prepare('DELETE FROM inbox WHERE id = ?').run(id);
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
