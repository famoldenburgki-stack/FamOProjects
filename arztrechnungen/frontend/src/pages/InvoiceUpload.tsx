import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { money, targetLabel, todayIso } from '../format';
import { Alert, Field, Spinner } from '../components/ui';
import { LocalPreview } from '../components/DocumentView';
import type { AnalyzeResult, Member } from '../types';

const FIELD_LABEL: Record<string, string> = {
  invoice_number: 'Rechnungsnummer',
  amount: 'Betrag',
  invoice_date: 'Rechnungsdatum',
  treatment_date: 'Behandlungsdatum',
};

interface FormState {
  family_member_id: string;
  doctor: string;
  invoice_number: string;
  invoice_date: string;
  treatment_date: string;
  amount: string;
  category: string;
  paid_to_doctor_date: string;
  payment_due_date: string;
  note: string;
  submit_dbv: boolean;
  submit_beihilfe: boolean;
}

const emptyForm: FormState = {
  family_member_id: '',
  doctor: '',
  invoice_number: '',
  invoice_date: '',
  treatment_date: '',
  amount: '',
  category: 'Sonstiges',
  paid_to_doctor_date: '',
  payment_due_date: '',
  note: '',
  submit_dbv: false,
  submit_beihilfe: false,
};

export default function InvoiceUpload() {
  const [members, setMembers] = useState<Member[]>([]);
  const [queue, setQueue] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: number; label: string }[]>([]);
  const [showText, setShowText] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.members().then((m) => setMembers(m.filter((x) => x.active))).catch(() => undefined);
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function analyzeNext(files: File[]) {
    const [next, ...rest] = files;
    setQueue(rest);
    if (!next) {
      setAnalysis(null);
      setCurrentFile(null);
      setForm(emptyForm);
      return;
    }
    setBusy(true);
    setError(null);
    // Die Datei sofort anzeigen – die Texterkennung dauert bei Scans mehrere Sekunden.
    setCurrentFile(next);
    try {
      const result = await api.analyzeInvoice(next);
      setAnalysis(result);
      const s = result.suggestion;
      setForm({
        ...emptyForm,
        family_member_id: s.family_member_id ? String(s.family_member_id) : '',
        doctor: s.doctor ?? '',
        invoice_number: s.invoice_number ?? '',
        invoice_date: s.invoice_date ?? '',
        treatment_date: s.treatment_date ?? '',
        amount: s.amount !== null ? String(s.amount) : '',
        category: s.category ?? 'Sonstiges',
        payment_due_date: s.payment_due_date ?? '',
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    await analyzeNext(Array.from(files));
  }

  async function save() {
    if (!analysis) return;
    setBusy(true);
    setError(null);
    try {
      const submitNow: string[] = [];
      if (form.submit_dbv) submitNow.push('dbv');
      if (form.submit_beihilfe) submitNow.push('beihilfe');
      const invoice = await api.createInvoice({
        family_member_id: Number(form.family_member_id),
        doctor: form.doctor,
        invoice_number: form.invoice_number,
        invoice_date: form.invoice_date || null,
        treatment_date: form.treatment_date || null,
        amount: Number(form.amount.replace(',', '.')),
        category: form.category,
        paid_to_doctor_date: form.paid_to_doctor_date || null,
        payment_due_date: form.payment_due_date || null,
        note: form.note,
        file_path: analysis.file_path,
        ocr_text: analysis.ocr_text,
        submit_now: submitNow,
      });
      setSaved((s) => [
        ...s,
        { id: invoice.id, label: `${invoice.member_name} · ${money(invoice.amount)}` },
      ]);
      const note = (invoice as { archive_note?: string | null }).archive_note;
      if (note) setError(note);
      if (queue.length > 0) {
        await analyzeNext(queue);
      } else {
        setAnalysis(null);
        setCurrentFile(null);
        setForm(emptyForm);
        if (fileInput.current) fileInput.current.value = '';
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const member = members.find((m) => String(m.id) === form.family_member_id);
  const amountNum = Number(form.amount.replace(',', '.'));
  const preview =
    member && Number.isFinite(amountNum) && amountNum > 0
      ? {
          beihilfe: amountNum * member.beihilfe_rate,
          dbv: amountNum * (1 - member.beihilfe_rate),
        }
      : null;

  const ocrHint = (key: string) =>
    analysis?.suggestion.confidence[key] ? 'automatisch erkannt' : 'bitte prüfen';

  return (
    <div className="space-y-6">
      <div className="card space-y-3">
        <h1 className="text-lg font-semibold">Rechnung hochladen</h1>
        <p className="text-sm text-slate-600">
          PDF oder Foto auswählen – die Angaben werden ausgelesen und vorausgefüllt. Mehrere Dateien
          werden nacheinander abgearbeitet.
        </p>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp"
          className="input"
          onChange={(e) => onFiles(e.target.files)}
        />
        {queue.length > 0 ? (
          <p className="text-sm text-slate-500">Noch {queue.length} Datei(en) in der Warteschlange.</p>
        ) : null}
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}

      {saved.length > 0 ? (
        <Alert kind="success" title={`${saved.length} Rechnung(en) gespeichert`}>
          <ul className="space-y-0.5">
            {saved.map((s) => (
              <li key={s.id}>
                <Link className="text-brand-700 hover:underline" to={`/rechnung/${s.id}`}>
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {/*
        Beleg und Formular nebeneinander: die Vorschau erscheint sofort nach der
        Dateiauswahl, das Formular sobald die Texterkennung durch ist.
      */}
      <div className={currentFile ? 'grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}>
        <div className="space-y-6">
      {busy && !analysis ? <Spinner label="Datei wird ausgelesen (bei Scans kann das etwas dauern) …" /> : null}

      {analysis ? (
        <div className="card space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">{analysis.original_name}</h2>
              <p className="text-xs text-slate-500">
                Textquelle:{' '}
                {analysis.ocr_source === 'pdf-text'
                  ? 'PDF-Textebene'
                  : analysis.ocr_source === 'ocr'
                    ? 'Texterkennung (OCR)'
                    : 'kein Text gefunden'}
              </p>
            </div>
            <button className="btn-ghost" onClick={() => setShowText((v) => !v)}>
              {showText ? 'Erkannten Text ausblenden' : 'Erkannten Text anzeigen'}
            </button>
          </div>

          {analysis.pattern ? (
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm">
              <p className="font-medium text-brand-800">
                Muster erkannt: {analysis.pattern.name}
                <span className="ml-2 font-normal text-brand-700">
                  aus {analysis.pattern.samples}{' '}
                  {analysis.pattern.samples === 1 ? 'Rechnung' : 'Rechnungen'} gelernt
                </span>
              </p>
              {analysis.pattern_fields.length > 0 ? (
                <p className="mt-1 text-brand-700">
                  Aus dem Muster ergänzt:{' '}
                  {analysis.pattern_fields
                    .map((f) => FIELD_LABEL[f] ?? f)
                    .join(', ')}
                </p>
              ) : null}
              {analysis.pattern.learned.length > 0 ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-brand-700">Was gelernt wurde</summary>
                  <ul className="mt-1 list-inside list-disc text-brand-800">
                    {analysis.pattern.learned.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}

          {analysis.ocr_warning ? <Alert kind="warning">{analysis.ocr_warning}</Alert> : null}

          {analysis.document_kind === 'bescheid' ? (
            <Alert kind="warning" title="Das ist vermutlich ein Bescheid">
              <p>{analysis.hints[0]}</p>
              <Link className="mt-2 inline-block font-medium text-brand-700 hover:underline" to="/bescheid">
                Zur Bescheidprüfung wechseln
              </Link>
            </Alert>
          ) : analysis.hints.length > 0 ? (
            <Alert kind="info" title="Bitte prüfen">
              <ul className="list-inside list-disc">
                {analysis.hints.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          {showText ? (
            <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
              {analysis.ocr_text || '(kein Text)'}
            </pre>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Patient *" hint={ocrHint('member_name')}>
              <select
                className="input"
                value={form.family_member_id}
                onChange={(e) => set('family_member_id', e.target.value)}
              >
                <option value="">bitte wählen</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({Math.round(m.beihilfe_rate * 100)} % Beihilfe, Zugang {m.account})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Rechnungsbetrag (€) *" hint={ocrHint('amount')}>
              <input className="input" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
            </Field>
            <Field label="Behandlungsart">
              <select className="input" value={form.category} onChange={(e) => set('category', e.target.value)}>
                {analysis.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Arzt / Aussteller">
              <input className="input" value={form.doctor} onChange={(e) => set('doctor', e.target.value)} />
            </Field>
            <Field label="Rechnungsnummer" hint={`${ocrHint('invoice_number')} – wichtig für die Bescheid-Zuordnung`}>
              <input
                className="input"
                value={form.invoice_number}
                onChange={(e) => set('invoice_number', e.target.value)}
              />
            </Field>
            <Field label="Rechnungsdatum" hint={ocrHint('invoice_date')}>
              <input
                type="date"
                className="input"
                value={form.invoice_date}
                onChange={(e) => set('invoice_date', e.target.value)}
              />
            </Field>
            <Field label="Behandlungsdatum" hint={ocrHint('treatment_date')}>
              <input
                type="date"
                className="input"
                value={form.treatment_date}
                onChange={(e) => set('treatment_date', e.target.value)}
              />
            </Field>
            <Field label="Zahlbar bis" hint={ocrHint('payment_due_date')}>
              <input
                type="date"
                className="input"
                value={form.payment_due_date}
                onChange={(e) => set('payment_due_date', e.target.value)}
              />
            </Field>
            <Field label="Zahlung an Arzt">
              <input
                type="date"
                className="input"
                value={form.paid_to_doctor_date}
                onChange={(e) => set('paid_to_doctor_date', e.target.value)}
              />
            </Field>
            <Field label="Bemerkung">
              <input className="input" value={form.note} onChange={(e) => set('note', e.target.value)} />
            </Field>
          </div>

          {preview ? (
            <Alert kind="info" title="Erwartete Erstattung">
              {targetLabel('beihilfe')} {Math.round((member?.beihilfe_rate ?? 0) * 100)} %: {money(preview.beihilfe)} ·
              {targetLabel('dbv')}: {money(preview.dbv)} · Einreichung über Zugang <strong>{member?.account}</strong>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-6 rounded-lg bg-slate-50 px-4 py-3">
            <span className="text-sm font-medium text-slate-700">Heute schon eingereicht bei:</span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.submit_beihilfe}
                onChange={(e) => set('submit_beihilfe', e.target.checked)}
              />
              {targetLabel('beihilfe')} ({todayIso().split('-').reverse().join('.')})
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.submit_dbv}
                onChange={(e) => set('submit_dbv', e.target.checked)}
              />
              {targetLabel('dbv')}
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary"
              onClick={save}
              disabled={busy || !form.family_member_id || !form.amount}
            >
              {busy ? 'Speichern …' : queue.length > 0 ? 'Speichern & nächste Datei' : 'Rechnung speichern'}
            </button>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() =>
                queue.length > 0
                  ? analyzeNext(queue)
                  : (setAnalysis(null), setCurrentFile(null), setForm(emptyForm))
              }
            >
              Diese Datei überspringen
            </button>
            {saved.length > 0 && queue.length === 0 ? (
              <button className="btn-ghost" onClick={() => navigate('/')}>
                Zur Übersicht
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
        </div>

        {currentFile ? (
          <aside className="xl:sticky xl:top-6 xl:self-start">
            <div className="card space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">Beleg</h2>
                <span className="truncate text-xs text-slate-500" title={currentFile.name}>
                  {currentFile.name}
                </span>
              </div>
              <LocalPreview file={currentFile} height="h-[34rem]" />
              <p className="text-xs text-slate-500">
                Vergleiche die Felder links direkt mit dem Beleg. Zum Vergrößern in einem eigenen
                Tab öffnen, sobald die Rechnung gespeichert ist.
              </p>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
