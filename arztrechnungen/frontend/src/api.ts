import type {
  AnalyzeResult,
  ArchiveCheck,
  CategoryInfo,
  DecisionResult,
  DecisionSummary,
  Invoice,
  InboxEntry,
  InboxResponse,
  IssuerPattern,
  Member,
  Overview,
  Reminders,
  Stats,
  SubmitGroup,
} from './types';

/**
 * Fehler einer API-Antwort. Trägt die Zusatzfelder mit, die das Backend liefert –
 * etwa `needs_choice`, wenn eine Angabe wirklich fehlt und nachgefragt werden muss.
 */
export class ApiError extends Error {
  needs_choice?: boolean;
  suggestion?: { account?: string };
  constructor(message: string, extra?: { needs_choice?: boolean; suggestion?: { account?: string } }) {
    super(message);
    this.name = 'ApiError';
    this.needs_choice = extra?.needs_choice;
    this.suggestion = extra?.suggestion;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers:
      init?.body instanceof FormData
        ? init?.headers
        : { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Fehler ${res.status}`;
    let extra: { needs_choice?: boolean; suggestion?: { account?: string } } = {};
    try {
      const body = (await res.json()) as {
        error?: string;
        needs_choice?: boolean;
        suggestion?: { account?: string };
      };
      if (body.error) message = body.error;
      extra = { needs_choice: body.needs_choice, suggestion: body.suggestion };
    } catch {
      /* keine JSON-Antwort */
    }
    throw new ApiError(message, extra);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });
const patch = (body: unknown) => ({ method: 'PATCH', body: JSON.stringify(body) });

export const api = {
  /* Rechnungen */
  listInvoices: (params: Record<string, string | number | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
    return request<Invoice[]>(`/api/invoices?${q}`);
  },
  getInvoice: (id: number) => request<Invoice>(`/api/invoices/${id}`),
  years: () => request<number[]>('/api/invoices/years'),
  analyzeInvoice: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<AnalyzeResult>('/api/invoices/analyze', { method: 'POST', body: fd });
  },
  createInvoice: (body: unknown) => request<Invoice>('/api/invoices', json(body)),
  updateInvoice: (id: number, body: unknown) => request<Invoice>(`/api/invoices/${id}`, patch(body)),
  /** Zahlung an den Arzt bestätigen (ohne Datum: heute) oder zurücknehmen. */
  markPaid: (id: number, date?: string | null) =>
    request<Invoice>(`/api/invoices/${id}/paid`, json({ date: date ?? undefined })),
  /** Mehrere Rechnungen auf einmal ablegen oder zurückholen. */
  archiveMany: (ids: number[], archived: boolean) =>
    request<{ changed: number; archived: boolean }>('/api/invoices/archive-many', json({ ids, archived })),
  archiveInvoice: (id: number, archived: boolean) =>
    request<Invoice>(`/api/invoices/${id}/archive`, json({ archived })),
  deleteInvoice: (id: number) => request<{ ok: boolean }>(`/api/invoices/${id}`, { method: 'DELETE' }),

  /* Einreichungen */
  submit: (id: number, date?: string) => request<Invoice>(`/api/submissions/${id}/submit`, json({ date })),
  resetSubmission: (id: number) => request<Invoice>(`/api/submissions/${id}/reset`, json({})),
  updateSubmission: (id: number, body: unknown) => request<Invoice>(`/api/submissions/${id}`, patch(body)),
  acceptShare: (id: number, note?: string) =>
    request<Invoice>(`/api/submissions/${id}/accept`, json({ note })),

  /* Bescheide */
  /**
   * Bescheid hochladen. Absender und Zugang sind optional – ohne Angabe bestimmt
   * die App sie aus dem Dokument und fragt nur nach, wenn das nicht geht.
   */
  uploadDecision: (file: File, target?: string, account?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    if (target) fd.append('target', target);
    if (account) fd.append('account', account);
    return request<DecisionResult>('/api/decisions/upload', { method: 'POST', body: fd });
  },
  listDecisions: () => request<DecisionSummary[]>('/api/decisions'),
  getDecision: (id: number) => request<Record<string, unknown>>(`/api/decisions/${id}`),
  assignItem: (itemId: number, submissionId: number) =>
    request<{ evaluation: { message: string }; invoice: Invoice | null }>(
      `/api/decisions/items/${itemId}/assign`,
      json({ submission_id: submissionId }),
    ),
  deleteDecision: (id: number) => request<{ ok: boolean }>(`/api/decisions/${id}`, { method: 'DELETE' }),

  /* Auswertungen */
  reminders: () => request<Reminders>('/api/reminders'),
  overview: () => request<Overview>('/api/reminders/overview'),
  stats: () => request<Stats>('/api/stats'),

  /* Stammdaten */
  members: () => request<Member[]>('/api/members'),
  createMember: (body: unknown) => request<Member>('/api/members', json(body)),
  updateMember: (id: number, body: unknown) => request<Member>(`/api/members/${id}`, patch(body)),
  deleteMember: (id: number) => request<{ ok: boolean }>(`/api/members/${id}`, { method: 'DELETE' }),
  settings: () =>
    request<{ settings: Record<string, string>; members: Member[]; categories: string[] }>(
      '/api/settings',
    ),
  updateSettings: (body: Record<string, string>) =>
    request<Record<string, string>>('/api/settings', patch(body)),
  /** Ablageordner im Explorer öffnen – ohne id den Wurzelordner. */
  openArchive: (invoiceId?: number) =>
    request<{ opened: string; selected: boolean }>(
      '/api/settings/archive/open',
      json(invoiceId ? { invoice_id: invoiceId } : {}),
    ),

  /* Einreichen */
  submitGroups: () => request<{ groups: SubmitGroup[]; today: string }>('/api/einreichen'),
  prepareSubmission: (ids: number[]) =>
    request<{ folder: string; copied: number; missing: string[]; total: number }>(
      '/api/einreichen/vorbereiten',
      json({ submission_ids: ids }),
    ),
  markSubmitted: (ids: number[]) =>
    request<{ marked: number; date: string; groups: SubmitGroup[] }>(
      '/api/einreichen/erledigt',
      json({ submission_ids: ids }),
    ),

  /* Rechnungseingang */
  inbox: () => request<InboxResponse>('/api/inbox'),
  scanInbox: () =>
    request<{ added: InboxEntry[]; skipped: { file: string; reason: string }[]; folder: string; entries: InboxEntry[] }>(
      '/api/inbox/scan',
      json({}),
    ),
  setInboxFolder: (path: string, create = false) =>
    request<{ path: string; saved: boolean }>('/api/inbox/folder', json({ path, create })),
  confirmInbox: (id: number, body: unknown) =>
    request<Invoice & { archive_note?: string | null; remaining: number }>(
      `/api/inbox/${id}/confirm`,
      json(body),
    ),
  /** Bescheid-Entwurf prüfen lassen und übernehmen. */
  checkInboxDecision: (id: number, target?: string, account?: string) =>
    request<DecisionResult & { remaining: number }>(
      `/api/inbox/${id}/pruefen`,
      json({ target, account }),
    ),
  discardInbox: (id: number) =>
    request<{ ok: boolean; moved_to: string | null; remaining: number }>(`/api/inbox/${id}`, {
      method: 'DELETE',
    }),

  /* Behandlungsarten */
  categories: () => request<CategoryInfo[]>('/api/categories'),
  addCategory: (name: string) => request<{ name: string }>('/api/categories', json({ name })),
  renameCategory: (alt: string, name: string) =>
    request<{ name: string; invoices_updated: number }>(
      `/api/categories/${encodeURIComponent(alt)}`,
      patch({ name }),
    ),
  deleteCategory: (name: string) =>
    request<{ ok: boolean; invoices_moved: number }>(`/api/categories/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  /* Ablageordner */
  checkArchive: (path: string, create = false) =>
    request<ArchiveCheck>('/api/settings/archive/check', json({ path, create })),
  setArchive: (path: string, create = false) =>
    request<ArchiveCheck>('/api/settings/archive/root', json({ path, create })),

  /* Gelernte Aussteller-Muster */
  patterns: () => request<IssuerPattern[]>('/api/patterns'),
  deletePattern: (id: number) =>
    request<{ ok: boolean }>(`/api/patterns/${id}`, { method: 'DELETE' }),
};
