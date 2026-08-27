import { useState } from 'react';
import { api } from '../api';
import { Alert, Field } from '../components/ui';
import type { ArchiveCheck } from '../types';

/**
 * Einrichtung der Ablage. Erscheint beim ersten Start, solange kein Ordner
 * festgelegt ist, und ist später über die Einstellungen wieder erreichbar.
 */
export default function ArchiveSetup({
  current,
  onDone,
  compact = false,
}: {
  current?: string;
  onDone: (path: string) => void;
  compact?: boolean;
}) {
  const [path, setPath] = useState(current ?? '');
  const [check, setCheck] = useState<ArchiveCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pruefen(create: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.checkArchive(path, create);
      setCheck(result);
      if (result.error) setError(result.error);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function uebernehmen() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.setArchive(path, true);
      onDone(result.path);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const bereit = check?.exists && check.writable && !check.error;

  return (
    <div className={compact ? '' : 'mx-auto max-w-2xl py-10'}>
      <div className="card space-y-4">
        {!compact ? (
          <>
            <h1 className="text-lg font-semibold">Wo sollen deine Rechnungen abgelegt werden?</h1>
            <p className="text-sm text-slate-600">
              Die App legt jede hochgeladene Rechnung und jeden geprüften Bescheid als Datei in
              einem Ordner deiner Wahl ab – Rechnungen nach Patient und Jahr, Bescheide nach
              Zugang und Jahr. Die Datei liegt danach nur dort, die App führt keine zweite Kopie.
              Am besten wählst du einen neuen, leeren Ordner.
            </p>
          </>
        ) : null}

        <Field
          label="Vollständiger Pfad zum Ablageordner"
          hint="Zum Beispiel G:\Privat\Arztrechnungen – am einfachsten im Explorer aus der Adresszeile kopieren."
        >
          <input
            className="input"
            value={path}
            placeholder="G:\Privat\Arztrechnungen"
            onChange={(e) => {
              setPath(e.target.value);
              setCheck(null);
            }}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={busy || !path.trim()} onClick={() => pruefen(false)}>
            {busy ? 'Prüfe …' : 'Ordner prüfen'}
          </button>
          {check && !check.exists && !busy ? (
            <button className="btn-secondary" onClick={() => pruefen(true)}>
              Ordner anlegen
            </button>
          ) : null}
          <button className="btn-primary" disabled={busy || !bereit} onClick={uebernehmen}>
            Ablage einrichten
          </button>
        </div>

        {error ? <Alert kind="warning">{error}</Alert> : null}

        {bereit ? (
          <Alert kind="success" title={check!.created ? 'Ordner angelegt' : 'Ordner ist nutzbar'}>
            <p>
              {check!.entries === 0
                ? 'Der Ordner ist leer – ideal für eine frische Ablage.'
                : `Der Ordner enthält bereits ${check!.entries} Einträge. Die App legt ihre Unterordner daneben an und verändert nichts Vorhandenes.`}
            </p>
            {check!.example ? (
              <div className="mt-2 space-y-1">
                <p>So würde abgelegt:</p>
                <code className="block break-all rounded bg-white px-2 py-1 text-xs">
                  {check!.example}
                </code>
                {check!.example_decision ? (
                  <code className="block break-all rounded bg-white px-2 py-1 text-xs">
                    {check!.example_decision}
                  </code>
                ) : null}
              </div>
            ) : null}
          </Alert>
        ) : null}

        {!compact ? (
          <p className="text-xs text-slate-500">
            Du kannst diesen Schritt später in den Einstellungen ändern. Ohne Ablageordner bleiben
            die Dateien im Ordner der App und werden nicht einsortiert.
          </p>
        ) : null}
      </div>
    </div>
  );
}
