import { db, getSettingNumber } from './db.js';
import { expectedAmount, round2 } from './calc.js';
import { normalizeInvoiceNumber, type DecisionItemSuggestion } from './ocr/parse.js';
import type { DecisionItemRow, SubmissionStatus, Target } from './types.js';

/** Einreichung + zugehörige Rechnungsdaten – Grundlage für Matching und Prüfung. */
interface Candidate {
  submission_id: number;
  invoice_id: number;
  target: Target;
  status: SubmissionStatus;
  invoice_number: string;
  invoice_date: string | null;
  treatment_date: string | null;
  amount: number;
  doctor: string;
  category: string;
  member_name: string;
  member_account: string;
  beihilfe_rate: number;
  paid_amount: number | null;
}

const candidateSql = `
  SELECT s.id AS submission_id, s.invoice_id, s.target, s.status, s.paid_amount,
         i.invoice_number, i.invoice_date, i.treatment_date, i.amount, i.doctor, i.category,
         m.name AS member_name, m.account AS member_account, m.beihilfe_rate
  FROM submissions s
  JOIN invoices i        ON i.id = s.invoice_id
  JOIN family_members m  ON m.id = i.family_member_id
  WHERE s.target = ?
`;

function loadCandidates(target: Target, account: string | null): Candidate[] {
  const rows = db.prepare(candidateSql).all(target) as Candidate[];
  if (!account) return rows;
  // Bescheide kommen immer aus genau einem App-Zugang – das schränkt sinnvoll ein.
  const scoped = rows.filter((r) => r.member_account === account);
  return scoped.length > 0 ? scoped : rows;
}

/** Offene Einreichungen zuerst: ein Bescheid betrifft normalerweise noch nicht beschiedene Vorgänge. */
const priority = (c: Candidate): number => {
  if (c.status === 'eingereicht') return 0;
  if (c.status === 'offen') return 1;
  return 2;
};

function daysApart(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.abs(ta - tb) / 86_400_000;
}

export interface MatchResult {
  candidate: Candidate | null;
  kind: DecisionItemRow['match_kind'];
  ambiguous: Candidate[];
}

/** Datum aus dem Bescheid gegen Rechnungs- und Behandlungsdatum prüfen. */
function dateFits(c: Candidate, iso: string, toleranceDays: number): boolean {
  const a = daysApart(c.invoice_date, iso);
  const b = daysApart(c.treatment_date, iso);
  return (a !== null && a <= toleranceDays) || (b !== null && b <= toleranceDays);
}

/** Nennt der Bescheid einen Arzt- oder Leistungsnamen, der zur Rechnung passt? */
function labelFits(c: Candidate, label: string): boolean {
  const words = label
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 4);
  if (words.length === 0) return false;
  const haystack = `${c.doctor} ${c.category}`.toLowerCase();
  return words.some((w) => haystack.includes(w));
}

/**
 * Ordnet eine Bescheid-Position einer Einreichung zu.
 *
 * Echte Bescheide nennen keine Rechnungsnummer, deshalb ist der Rechnungsbetrag
 * das tragende Merkmal – eingegrenzt über den im Bescheid genannten Patienten und
 * bei Mehrdeutigkeit weiter über Datum, Behandlungsjahr und Arztnamen.
 */
export function matchItem(
  item: DecisionItemSuggestion,
  candidates: Candidate[],
  used: Set<number>,
  /** Datum des Bescheids – begrenzt, welche Rechnungen überhaupt gemeint sein können. */
  decisionDate?: string | null,
): MatchResult {
  let free = candidates.filter((c) => !used.has(c.submission_id));

  /*
   * Eine Rechnung, die nach dem Bescheid ausgestellt wurde, kann darin nicht
   * abgerechnet sein. Ohne diese Schranke fand ein Bescheid von 2022 eine
   * betragsgleiche Rechnung von 2025.
   */
  if (decisionDate) {
    const grenze = new Date(decisionDate);
    grenze.setDate(grenze.getDate() + 14); // Toleranz für ungenaue Datumsangaben
    const spaeteste = grenze.toISOString().slice(0, 10);
    // Ohne Rückfall: bleibt nichts übrig, ist die Rechnung schlicht nicht erfasst.
    free = free.filter((c) => !c.invoice_date || c.invoice_date <= spaeteste);
  }

  /* Patient laut Bescheid – schränkt am stärksten und zuverlässigsten ein */
  if (item.member_name) {
    const scoped = free.filter(
      (c) => c.member_name.toLowerCase() === item.member_name!.toLowerCase(),
    );
    if (scoped.length > 0) free = scoped;
  }

  /* 1) Rechnungsnummer, falls der Bescheid eine nennt */
  if (item.invoice_number.trim()) {
    const needle = normalizeInvoiceNumber(item.invoice_number);
    if (needle.length >= 3) {
      const hits = free.filter((c) => {
        const hay = normalizeInvoiceNumber(c.invoice_number);
        return hay.length >= 3 && (hay === needle || hay.endsWith(needle) || needle.endsWith(hay));
      });
      if (hits.length === 1) return { candidate: hits[0], kind: 'number', ambiguous: [] };
      if (hits.length > 1) {
        const open = hits.filter((c) => priority(c) < 2);
        if (open.length === 1) return { candidate: open[0], kind: 'number', ambiguous: [] };
        return { candidate: null, kind: 'unmatched', ambiguous: sortForDisplay(hits) };
      }
    }
  }

  /* 2) Rechnungsbetrag, danach schrittweise eingrenzen */
  if (item.invoice_amount !== null) {
    let hits = free.filter((c) => Math.abs(c.amount - item.invoice_amount!) < 0.02);
    if (hits.length === 1) return { candidate: hits[0], kind: 'amount_date', ambiguous: [] };

    if (hits.length > 1) {
      const narrow = (fn: (c: Candidate) => boolean) => {
        const next = hits.filter(fn);
        if (next.length > 0) hits = next;
      };

      if (item.invoice_date) narrow((c) => dateFits(c, item.invoice_date!, 14));
      if (hits.length > 1 && item.treatment_year) {
        narrow(
          (c) =>
            (c.invoice_date ?? '').startsWith(String(item.treatment_year)) ||
            (c.treatment_date ?? '').startsWith(String(item.treatment_year)),
        );
      }
      if (hits.length > 1 && item.service_label) narrow((c) => labelFits(c, item.service_label!));
      if (hits.length > 1) narrow((c) => priority(c) < 2);

      if (hits.length === 1) return { candidate: hits[0], kind: 'amount_date', ambiguous: [] };
      return { candidate: null, kind: 'unmatched', ambiguous: sortForDisplay(hits) };
    }
  }

  /*
   * Kein Betragstreffer: die Rechnung ist vermutlich noch nicht erfasst. Zur
   * Auswahl werden die Einreichungen des genannten Patienten vorgeschlagen.
   */
  return {
    candidate: null,
    kind: 'unmatched',
    ambiguous: item.member_name ? sortForDisplay(free).slice(0, 15) : [],
  };
}

const sortForDisplay = (list: Candidate[]) =>
  [...list].sort(
    (a, b) => priority(a) - priority(b) || (b.invoice_date ?? '').localeCompare(a.invoice_date ?? ''),
  );

export interface Evaluation {
  status: SubmissionStatus;
  expected: number;
  paid: number;
  difference: number;
  needs_action: boolean;
  message: string;
}

/** Vergleicht die Erstattung aus dem Bescheid mit dem erwarteten Anteil. */
export function evaluate(
  target: Target,
  invoiceAmount: number,
  rate: number,
  paidAmount: number | null,
  reason: string,
): Evaluation {
  const tolerance = getSettingNumber('tolerance_eur', 1);
  const expected = expectedAmount(target, invoiceAmount, rate);
  const paid = round2(paidAmount ?? 0);
  const difference = round2(paid - expected);
  const label = target === 'beihilfe' ? 'Beihilfe' : 'DBV';

  if (paid <= 0.004) {
    return {
      status: 'abgelehnt',
      expected,
      paid,
      difference,
      needs_action: true,
      message: `${label}: keine Erstattung. ${reason || 'Kein Grund im Bescheid erkannt.'} Erwartet waren ${fmt(expected)}.`,
    };
  }
  if (difference >= -tolerance) {
    return {
      status: 'bezahlt',
      expected,
      paid,
      difference,
      needs_action: false,
      message: `${label}: vollständig erstattet (${fmt(paid)}, erwartet ${fmt(expected)}).`,
    };
  }
  return {
    status: 'teilweise_bezahlt',
    expected,
    paid,
    difference,
    needs_action: true,
    message: `${label}: gekürzt um ${fmt(-difference)} – erstattet ${fmt(paid)} statt ${fmt(expected)}. ${reason || 'Kein Grund im Bescheid erkannt.'}`,
  };
}

const fmt = (n: number) =>
  `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/* ------------------------------------------------------------------ */
/*  Verarbeitung eines kompletten Bescheids                            */
/* ------------------------------------------------------------------ */

export interface ProcessedItem {
  item: DecisionItemRow;
  match: {
    submission_id: number;
    invoice_id: number;
    invoice_number: string;
    invoice_date: string | null;
    invoice_amount: number;
    doctor: string;
    member_name: string;
  } | null;
  ambiguous: {
    submission_id: number;
    invoice_id: number;
    label: string;
  }[];
  evaluation: Evaluation | null;
}

export interface ProcessResult {
  decision_id: number;
  target: Target;
  account: string;
  decision_date: string | null;
  total_paid: number | null;
  items: ProcessedItem[];
  summary: {
    detected: number;
    applied: number;
    unmatched: number;
    fully_paid: number;
    reduced: number;
    rejected: number;
    needs_action: number;
    sum_paid: number;
    sum_expected: number;
    total_mismatch: number | null;
  };
  warnings: string[];
}

/**
 * Ordnet die erkannten Bescheid-Positionen den Einreichungen zu, prüft die
 * Beträge und schreibt das Ergebnis direkt in die Einreichungen (sofern
 * eindeutig zuordenbar).
 */
export interface SimulatedItem {
  member_name: string | null;
  service_label: string;
  invoice_number: string;
  invoice_date: string | null;
  invoice_amount: number | null;
  paid_amount: number | null;
  reason: string;
  match_kind: MatchResult['kind'];
  match: { invoice_id: number; doctor: string; member_name: string; amount: number } | null;
  /** Ist die getroffene Einreichung schon beschieden? Dann würde sie überschrieben. */
  match_already_decided: boolean;
  ambiguous: number;
  evaluation: Evaluation | null;
}

export interface SimulationResult {
  target: Target;
  account: string;
  decision_date: string | null;
  total_paid: number | null;
  items: SimulatedItem[];
  warnings: string[];
  summary: { detected: number; matched: number; unmatched: number; would_overwrite: number };
}

/**
 * Wie `processDecision`, aber ohne jede Änderung an der Datenbank. Damit lässt
 * sich ein ganzer Stapel alter Bescheide vorab prüfen.
 */
export function simulateDecision(
  target: Target,
  account: string,
  suggestions: DecisionItemSuggestion[],
  decisionDate: string | null,
  totalPaid: number | null,
  warnings: string[] = [],
): SimulationResult {
  const candidates = loadCandidates(target, account);
  const used = new Set<number>();
  const items: SimulatedItem[] = [];

  for (const s of suggestions) {
    const { candidate, kind, ambiguous } = matchItem(s, candidates, used, decisionDate);
    if (candidate) used.add(candidate.submission_id);

    items.push({
      member_name: s.member_name ?? null,
      service_label: s.service_label ?? '',
      invoice_number: s.invoice_number,
      invoice_date: s.invoice_date,
      invoice_amount: s.invoice_amount,
      paid_amount: s.paid_amount,
      reason: s.reason,
      match_kind: kind,
      match: candidate
        ? {
            invoice_id: candidate.invoice_id,
            doctor: candidate.doctor,
            member_name: candidate.member_name,
            amount: candidate.amount,
          }
        : null,
      match_already_decided: candidate ? candidate.paid_amount !== null : false,
      ambiguous: ambiguous.length,
      evaluation:
        candidate && s.paid_amount !== null
          ? evaluate(target, candidate.amount, candidate.beihilfe_rate, s.paid_amount, s.reason)
          : null,
    });
  }

  const matched = items.filter((i) => i.match).length;
  return {
    target,
    account,
    decision_date: decisionDate,
    total_paid: totalPaid,
    items,
    warnings,
    summary: {
      detected: items.length,
      matched,
      unmatched: items.length - matched,
      would_overwrite: items.filter((i) => i.match_already_decided).length,
    },
  };
}

export function processDecision(
  decisionId: number,
  target: Target,
  account: string,
  suggestions: DecisionItemSuggestion[],
  decisionDate: string | null,
  totalPaid: number | null,
  warnings: string[] = [],
  /**
   * Ohne `apply` werden Positionen nur erfasst und zugeordnet, aber die Status
   * und Beträge der Einreichungen bleiben unverändert. Das ist der richtige
   * Modus für Altbescheide zu Vorgängen, die bereits abgeschlossen sind.
   */
  options: { apply?: boolean } = {},
): ProcessResult {
  const apply = options.apply !== false;
  const candidates = loadCandidates(target, account);
  const used = new Set<number>();
  const processed: ProcessedItem[] = [];
  const rateMismatches = new Map<string, string>();

  const insertItem = db.prepare(
    `INSERT INTO decision_items
       (decision_id, invoice_number, invoice_date, invoice_amount, paid_amount, reason,
        matched_submission_id, match_kind, applied, raw_line,
        member_name, service_label, rejected_amount, rate, treatment_year)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const s of suggestions) {
    const { candidate, kind, ambiguous } = matchItem(s, candidates, used, decisionDate);
    let evaluation: Evaluation | null = null;
    let applied = 0;

    // Ohne erkannten Erstattungsbetrag wird nichts automatisch geschrieben –
    // "kein Betrag gefunden" ist nicht dasselbe wie "nichts erstattet".
    if (candidate && s.paid_amount !== null) {
      used.add(candidate.submission_id);

      // Der Bescheid nennt bei der Beihilfe den Bemessungssatz – weicht er von den
      // Einstellungen ab, rechnet die App dauerhaft mit falschen Erwartungswerten.
      if (s.rate !== null && s.rate !== undefined && Math.abs(s.rate - candidate.beihilfe_rate) > 0.005) {
        rateMismatches.set(
          candidate.member_name,
          `${candidate.member_name}: Der Bescheid rechnet mit ${(s.rate * 100).toFixed(0)} % Beihilfesatz, in den Einstellungen sind ${(candidate.beihilfe_rate * 100).toFixed(0)} % hinterlegt. Bitte in den Einstellungen anpassen.`,
        );
      }

      evaluation = evaluate(target, candidate.amount, candidate.beihilfe_rate, s.paid_amount, s.reason);
      applied = apply ? 1 : 0;
    } else if (candidate) {
      used.add(candidate.submission_id);
      warnings.push(
        `Zu der Position "${s.invoice_number || s.invoice_date || 'ohne Kennung'}" wurde kein Erstattungsbetrag erkannt – bitte den Betrag auf der Rechnungsdetailseite eintragen.`,
      );
    }

    const info = insertItem.run(
      decisionId,
      s.invoice_number,
      s.invoice_date,
      s.invoice_amount,
      s.paid_amount,
      s.reason,
      candidate?.submission_id ?? null,
      kind,
      applied,
      s.raw_line,
      s.member_name ?? '',
      s.service_label ?? '',
      s.rejected_amount ?? null,
      s.rate ?? null,
      s.treatment_year ?? null,
    );

    if (candidate && evaluation) {
      if (apply) applyToSubmission(candidate.submission_id, decisionId, decisionDate, s, evaluation);
    }

    processed.push({
      item: db.prepare('SELECT * FROM decision_items WHERE id = ?').get(info.lastInsertRowid) as DecisionItemRow,
      match: candidate
        ? {
            submission_id: candidate.submission_id,
            invoice_id: candidate.invoice_id,
            invoice_number: candidate.invoice_number,
            invoice_date: candidate.invoice_date,
            invoice_amount: candidate.amount,
            doctor: candidate.doctor,
            member_name: candidate.member_name,
          }
        : null,
      ambiguous: ambiguous.map((c) => ({
        submission_id: c.submission_id,
        invoice_id: c.invoice_id,
        label: labelFor(c),
      })),
      evaluation,
    });
  }

  const sumPaid = round2(processed.reduce((s, p) => s + (p.evaluation?.paid ?? 0), 0));
  const sumExpected = round2(processed.reduce((s, p) => s + (p.evaluation?.expected ?? 0), 0));
  const sumDetected = round2(processed.reduce((s, p) => s + (p.item.paid_amount ?? 0), 0));

  warnings.push(...rateMismatches.values());

  // Der Kontrollwert des Bescheids wird gegen alle erkannten Positionen geprüft –
  // auch gegen die, die noch keiner Rechnung zugeordnet werden konnten.
  if (totalPaid !== null && Math.abs(totalPaid - sumDetected) > 0.02) {
    warnings.push(
      `Der Bescheid weist ${fmt(totalPaid)} Erstattung aus, die erkannten Positionen ergeben ${fmt(sumDetected)}. Bitte prüfen, ob eine Position übersehen wurde.`,
    );
  }
  if (processed.length === 0) {
    warnings.push(
      'Im Bescheid konnten keine Rechnungspositionen erkannt werden. Bitte die Beträge auf der Rechnungsdetailseite manuell eintragen.',
    );
  }

  return {
    decision_id: decisionId,
    target,
    account,
    decision_date: decisionDate,
    total_paid: totalPaid,
    items: processed,
    summary: {
      detected: processed.length,
      applied: processed.filter((p) => p.item.applied === 1).length,
      unmatched: processed.filter((p) => !p.match).length,
      fully_paid: processed.filter((p) => p.evaluation?.status === 'bezahlt').length,
      reduced: processed.filter((p) => p.evaluation?.status === 'teilweise_bezahlt').length,
      rejected: processed.filter((p) => p.evaluation?.status === 'abgelehnt').length,
      needs_action: processed.filter((p) => p.evaluation?.needs_action || !p.match).length,
      sum_paid: sumPaid,
      sum_expected: sumExpected,
      total_mismatch: totalPaid === null ? null : round2(totalPaid - sumPaid),
    },
    warnings,
  };
}

export function labelFor(c: {
  member_name: string;
  doctor: string;
  invoice_number: string;
  invoice_date: string | null;
  amount: number;
}): string {
  const parts = [c.member_name, c.doctor?.slice(0, 40)];
  if (c.invoice_number) parts.push(`Nr. ${c.invoice_number}`);
  if (c.invoice_date) parts.push(c.invoice_date);
  parts.push(fmt(c.amount));
  return parts.filter(Boolean).join(' · ');
}

export function applyToSubmission(
  submissionId: number,
  decisionId: number | null,
  decisionDate: string | null,
  item: Pick<DecisionItemSuggestion, 'paid_amount' | 'reason'>,
  evaluation: Evaluation,
): void {
  db.prepare(
    `UPDATE submissions
        SET status = ?, paid_amount = ?, decision_date = COALESCE(?, decision_date, date('now')),
            rejection_reason = ?, decision_id = COALESCE(?, decision_id),
            submitted_date = COALESCE(submitted_date, ?),
            updated_at = datetime('now')
      WHERE id = ?`,
  ).run(
    evaluation.status,
    round2(item.paid_amount ?? 0),
    decisionDate,
    // Nur den tatsächlich erkannten Grund speichern – sonst landen ganze
    // Ergebnismeldungen in der Kürzungsmuster-Auswertung.
    evaluation.status === 'bezahlt' ? '' : item.reason,
    decisionId,
    decisionDate,
    submissionId,
  );
}

/** Nachträgliche manuelle Zuordnung einer Bescheid-Position. */
export function assignItemManually(itemId: number, submissionId: number): ProcessedItem {
  const item = db.prepare('SELECT * FROM decision_items WHERE id = ?').get(itemId) as
    | DecisionItemRow
    | undefined;
  if (!item) throw new Error('Bescheid-Position nicht gefunden');

  const decision = db.prepare('SELECT * FROM decisions WHERE id = ?').get(item.decision_id) as
    | { id: number; target: Target; decision_date: string | null }
    | undefined;
  if (!decision) throw new Error('Bescheid nicht gefunden');

  const cand = db
    .prepare(`${candidateSql} AND s.id = ?`)
    .get(decision.target, submissionId) as Candidate | undefined;
  if (!cand) throw new Error('Einreichung passt nicht zu diesem Bescheid');

  const evaluation = evaluate(
    decision.target,
    cand.amount,
    cand.beihilfe_rate,
    item.paid_amount,
    item.reason,
  );
  applyToSubmission(submissionId, decision.id, decision.decision_date, item, evaluation);
  db.prepare(
    `UPDATE decision_items SET matched_submission_id = ?, match_kind = 'manual', applied = 1 WHERE id = ?`,
  ).run(submissionId, itemId);

  return {
    item: db.prepare('SELECT * FROM decision_items WHERE id = ?').get(itemId) as DecisionItemRow,
    match: {
      submission_id: cand.submission_id,
      invoice_id: cand.invoice_id,
      invoice_number: cand.invoice_number,
      invoice_date: cand.invoice_date,
      invoice_amount: cand.amount,
      doctor: cand.doctor,
      member_name: cand.member_name,
    },
    ambiguous: [],
    evaluation,
  };
}

/** Auswahlliste für die manuelle Zuordnung. */
export function openSubmissionsFor(target: Target, account: string | null) {
  return loadCandidates(target, account)
    .sort((a, b) => priority(a) - priority(b) || (b.invoice_date ?? '').localeCompare(a.invoice_date ?? ''))
    .map((c) => ({
      submission_id: c.submission_id,
      invoice_id: c.invoice_id,
      status: c.status,
      label: labelFor(c),
    }));
}
