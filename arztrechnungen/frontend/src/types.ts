export type Target = 'dbv' | 'beihilfe';

export type SubmissionStatus =
  | 'offen'
  | 'eingereicht'
  | 'teilweise_bezahlt'
  | 'bezahlt'
  | 'abgelehnt';

export type OverallStatus =
  | 'offen'
  | 'teilweise_eingereicht'
  | 'eingereicht'
  | 'in_bearbeitung'
  | 'abgeschlossen'
  | 'eigenanteil_offen'
  | 'abgelegt';

export interface Member {
  id: number;
  name: string;
  role: 'erwachsener' | 'kind';
  beihilfe_rate: number;
  account: string;
  bre_threshold: number | null;
  active: number;
  sort_order: number;
}

export interface Submission {
  id: number;
  invoice_id: number;
  target: Target;
  status: SubmissionStatus;
  submitted_date: string | null;
  decision_date: string | null;
  paid_amount: number | null;
  rejection_reason: string;
  action_note: string;
  decision_id: number | null;
  expected_amount: number;
}

export interface Invoice {
  id: number;
  family_member_id: number;
  member_name: string;
  member_account: string;
  beihilfe_rate: number;
  doctor: string;
  invoice_number: string;
  invoice_date: string | null;
  treatment_date: string | null;
  amount: number;
  category: string;
  paid_to_doctor_date: string | null;
  /** Frist, bis zu der die Rechnung an den Arzt zu zahlen ist. */
  payment_due_date: string | null;
  note: string;
  file_path: string | null;
  archived_at: string | null;
  created_at: string;
  submissions: Submission[];
  expected_beihilfe: number;
  expected_dbv: number;
  paid_total: number;
  open_amount: number;
  overall_status: OverallStatus;
  ready_to_archive: boolean;
  decision_items?: DecisionItem[];
}

export interface DecisionItem {
  id: number;
  decision_id: number;
  invoice_number: string;
  invoice_date: string | null;
  invoice_amount: number | null;
  paid_amount: number | null;
  reason: string;
  matched_submission_id: number | null;
  match_kind: 'number' | 'amount_date' | 'manual' | 'unmatched';
  applied: number;
  raw_line: string;
  /** Patient laut Bescheid – echte Bescheide nennen keine Rechnungsnummer. */
  member_name: string;
  service_label: string;
  rejected_amount: number | null;
  rate: number | null;
  treatment_year: number | null;
  target?: Target;
  /** Datum des Bescheids (aus der verknüpften decisions-Zeile) */
  d_date?: string | null;
  matched_member?: string;
  matched_doctor?: string;
  matched_invoice_number?: string;
  matched_invoice_date?: string | null;
  matched_amount?: number;
  invoice_id?: number;
}

export interface Evaluation {
  status: SubmissionStatus;
  expected: number;
  paid: number;
  difference: number;
  needs_action: boolean;
  message: string;
}

export interface ProcessedItem {
  item: DecisionItem;
  match: {
    submission_id: number;
    invoice_id: number;
    invoice_number: string;
    invoice_date: string | null;
    invoice_amount: number;
    doctor: string;
    member_name: string;
  } | null;
  ambiguous: { submission_id: number; invoice_id: number; label: string }[];
  evaluation: Evaluation | null;
}

export interface DecisionResult {
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
  ocr_source: string;
  options: { submission_id: number; invoice_id: number; status: string; label: string }[];
}

export interface InvoiceSuggestion {
  doctor: string;
  invoice_number: string;
  invoice_date: string | null;
  treatment_date: string | null;
  amount: number | null;
  category: string;
  member_name: string | null;
  family_member_id: number | null;
  member_candidates: string[];
  member_from_label: boolean;
  amount_source: 'endsumme' | 'summenzeile' | 'groesster-betrag' | 'keiner';
  amount_label: string | null;
  payment_due_date: string | null;
  payment_due: {
    date: string | null;
    source: 'datum' | 'frist' | 'sofort' | 'keine';
    days: number | null;
    line: string | null;
  };
  confidence: Record<string, boolean>;
}

export interface DecisionSummary {
  id: number;
  target: Target;
  account: string;
  decision_date: string | null;
  file_path: string | null;
  total_paid: number | null;
  created_at: string;
  item_count: number;
  unmatched_count: number;
}

export interface DecisionPreview {
  target: Target | null;
  account: string;
  decision_date: string | null;
  total_paid: number | null;
  item_count: number;
  members: string[];
  format: string;
}

export interface InboxEntry {
  id: number;
  /** 'rechnung' oder 'bescheid' – bestimmt, was beim Bestätigen passiert. */
  kind: string;
  decision: DecisionPreview | null;
  file_path: string;
  original_name: string;
  source: string;
  ocr_source: string;
  created_at: string;
  suggestion: InvoiceSuggestion;
  hints: string[];
  /** Fehlt etwas, ohne das keine Rechnung entstehen kann? */
  incomplete: boolean;
  missing: string[];
}

export interface InboxResponse {
  entries: InboxEntry[];
  folder: string;
  categories: string[];
  members: Member[];
}

export interface CategoryInfo {
  name: string;
  /** Wie viele Rechnungen diese Behandlungsart nutzen. */
  in_use: number;
  /** Der Rückfall "Sonstiges" lässt sich nicht löschen. */
  fixed: boolean;
}

export interface ArchiveCheck {
  path: string;
  exists: boolean;
  writable: boolean;
  created: boolean;
  entries: number;
  error?: string;
  /** Beispielpfade, wie eine abgelegte Rechnung bzw. ein Bescheid aussehen würde. */
  example?: string | null;
  example_decision?: string | null;
  saved?: boolean;
}

export interface IssuerPattern {
  id: number;
  name: string;
  samples: number;
  category: string;
  /** Was die App über diesen Aussteller gelernt hat, in Worten. */
  learned: string[];
}

export interface AnalyzeResult {
  file_path: string;
  original_name: string;
  ocr_source: 'pdf-text' | 'ocr' | 'none';
  ocr_warning: string | null;
  ocr_text: string;
  /** Sieht das Dokument nach einer Rechnung oder nach einem Bescheid aus? */
  document_kind: 'rechnung' | 'bescheid';
  /** Hinweise, worauf beim Prüfen der Vorschläge zu achten ist. */
  hints: string[];
  /** Gelerntes Muster des Ausstellers, sofern eines passt. */
  pattern: IssuerPattern | null;
  /** Welche Felder aus dem Muster stammen. */
  pattern_fields: string[];
  suggestion: InvoiceSuggestion;
  categories: string[];
}

export interface ReminderEntry {
  invoice_id: number;
  submission_id: number | null;
  target: Target | null;
  member_name: string;
  doctor: string;
  invoice_number: string;
  invoice_date: string | null;
  amount: number;
  detail: string;
  days: number | null;
  severity: 'kritisch' | 'warnung' | 'info';
}

export interface Reminders {
  payment_due: ReminderEntry[];
  deadlines: ReminderEntry[];
  needs_decision: ReminderEntry[];
  not_submitted: ReminderEntry[];
  decision_overdue: ReminderEntry[];
  not_paid: ReminderEntry[];
  ready_to_archive: ReminderEntry[];
  counts: Record<string, number>;
}

export interface Overview {
  counts: Record<string, number>;
  open_invoices: number;
  open_amount: number;
  year: number;
  year_total: number;
  year_reimbursed: number;
}

export interface Stats {
  years: {
    year: string;
    total: number;
    paid_beihilfe: number;
    paid_dbv: number;
    paid_total: number;
    own_share: number;
    count: number;
  }[];
  by_member: { year: string; member: string; total: number; paid_total: number }[];
  by_category: { year: string; category: string; total: number; count: number }[];
  bre: {
    member_id: number;
    member: string;
    year: string;
    submitted_dbv: number;
    invoice_count: number;
    threshold: number | null;
    remaining: number | null;
    state: 'unbekannt' | 'ok' | 'knapp' | 'ueberschritten';
  }[];
  rejections: {
    by_reason: { reason: string; count: number; missing: number }[];
    by_doctor: { doctor: string; count: number; missing: number; reasons: string[] }[];
    by_year: { year: string; missing: number }[];
    affected_submissions: number;
    total_decided_submissions: number;
  };
}

/* ---------- Einreich-Assistent ---------- */

export interface SubmitItem {
  submission_id: number;
  invoice_id: number;
  member_name: string;
  doctor: string;
  invoice_number: string;
  invoice_date: string | null;
  amount: number;
  expected_amount: number;
  has_file: boolean;
  file_name: string | null;
  deadline: string | null;
  paid_to_doctor: boolean;
  archived: boolean;
}

export interface SubmitGroup {
  target: Target;
  target_label: string;
  /** Zugang, über den eingereicht wird. */
  account: string;
  count: number;
  total: number;
  expected_total: number;
  without_file: number;
  items: SubmitItem[];
}
