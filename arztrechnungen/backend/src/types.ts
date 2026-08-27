export type Target = 'dbv' | 'beihilfe';

export const TARGETS: Target[] = ['dbv', 'beihilfe'];

export type SubmissionStatus =
  | 'offen'
  | 'eingereicht'
  | 'teilweise_bezahlt'
  | 'bezahlt'
  | 'abgelehnt';

/**
 * Startbestand der Behandlungsarten. Gepflegt werden sie zur Laufzeit in der
 * Tabelle `categories`; diese Liste dient nur der Erstbefüllung.
 */
export const DEFAULT_CATEGORIES = [
  'Zahnarzt/KFO',
  'Allgemeinarzt',
  'Facharzt',
  'Krankenhaus',
  'Heilpraktiker',
  'Sehhilfe',
  'Medikamente',
  'Physiotherapie',
  'Labor',
  'Sonstiges',
] as const;

/** Diese Behandlungsart ist der Rückfall und lässt sich nicht entfernen. */
export const FALLBACK_CATEGORY = 'Sonstiges';

export interface FamilyMember {
  id: number;
  name: string;
  role: 'erwachsener' | 'kind';
  beihilfe_rate: number;
  account: string;
  bre_threshold: number | null;
  active: number;
  sort_order: number;
}

export interface InvoiceRow {
  id: number;
  family_member_id: number;
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
  ocr_text: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface SubmissionRow {
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
  updated_at: string;
}

/** Eine Rechnung mit beiden Einreichungen und allen abgeleiteten Beträgen. */
export interface InvoiceDetail extends InvoiceRow {
  member_name: string;
  member_account: string;
  beihilfe_rate: number;
  submissions: (SubmissionRow & { expected_amount: number })[];
  expected_beihilfe: number;
  expected_dbv: number;
  paid_total: number;
  open_amount: number;
  overall_status: OverallStatus;
  ready_to_archive: boolean;
}

export type OverallStatus =
  | 'offen'
  | 'teilweise_eingereicht'
  | 'eingereicht'
  | 'in_bearbeitung'
  | 'abgeschlossen'
  | 'eigenanteil_offen'
  | 'abgelegt';

export interface DecisionItemRow {
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
}
