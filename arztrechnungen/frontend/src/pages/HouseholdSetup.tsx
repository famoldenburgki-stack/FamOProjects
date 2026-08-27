import { useState } from 'react';
import { api } from '../api';
import { Alert, Field } from '../components/ui';

/**
 * Erster Schritt der Einrichtung: wer gehört zum Haushalt.
 *
 * Ohne Personen kann die App nichts: der Beihilfesatz jeder Person bestimmt, wie
 * die erwartete Erstattung aufgeteilt wird, und der Zugang bestimmt, unter welcher
 * Anmeldung eingereicht wird. Ein mitgelieferter Beispielhaushalt wäre für jeden
 * anderen falsch – deshalb wird hier gefragt statt geraten.
 */

interface Zeile {
  name: string;
  role: 'erwachsener' | 'kind';
  /** Beihilfesatz in Prozent, wie er im Bescheid steht. */
  satz: string;
  /** Über wessen Anmeldung eingereicht wird – leer heißt: über sich selbst. */
  zugang: string;
}

const leereZeile = (): Zeile => ({ name: '', role: 'erwachsener', satz: '50', zugang: '' });

export default function HouseholdSetup({ onDone }: { onDone: () => void }) {
  const [zeilen, setZeilen] = useState<Zeile[]>([
    { name: '', role: 'erwachsener', satz: '50', zugang: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setze = (i: number, teil: Partial<Zeile>) =>
    setZeilen((z) => z.map((r, k) => (k === i ? { ...r, ...teil } : r)));

  /* Erwachsene können als Zugang dienen – Kinder laufen immer über einen davon. */
  const erwachsene = zeilen
    .filter((z) => z.role === 'erwachsener' && z.name.trim())
    .map((z) => z.name.trim());

  const gefuellt = zeilen.filter((z) => z.name.trim());
  const bereit =
    gefuellt.length > 0 &&
    erwachsene.length > 0 &&
    gefuellt.every((z) => {
      const s = Number(z.satz);
      return Number.isFinite(s) && s >= 0 && s <= 100;
    });

  async function speichern() {
    setBusy(true);
    setError(null);
    try {
      let nr = 0;
      for (const z of gefuellt) {
        nr++;
        await api.createMember({
          name: z.name.trim(),
          role: z.role,
          beihilfe_rate: Number(z.satz) / 100,
          // Ohne ausdrückliche Wahl reicht jeder über sich selbst ein; Kinder
          // bekommen den ersten Erwachsenen, sonst zeigt ihr Zugang ins Leere.
          account: z.zugang || (z.role === 'kind' ? erwachsene[0] : z.name.trim()),
          sort_order: nr,
        });
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl py-10">
      <div className="card space-y-5">
        <div>
          <h1 className="text-lg font-semibold">Wer gehört zum Haushalt?</h1>
          <p className="mt-1 text-sm text-slate-600">
            Für jede Person braucht die App den <strong>Beihilfesatz</strong> – den Prozentsatz,
            den die Beihilfe übernimmt. Er steht auf jedem Beihilfebescheid als
            „Bemessungssatz“. Den Rest übernimmt die private Krankenversicherung.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Der <strong>Zugang</strong> ist die Person, über deren Anmeldung eingereicht wird.
            Kinder laufen meist über ein Elternteil.
          </p>
        </div>

        {error ? <Alert kind="error">{error}</Alert> : null}

        <div className="space-y-3">
          {zeilen.map((z, i) => (
            <div key={i} className="grid gap-3 sm:grid-cols-[1.4fr_1fr_.8fr_1fr_auto]">
              <Field label={i === 0 ? 'Name' : ''}>
                <input
                  className="input"
                  value={z.name}
                  placeholder="Vorname"
                  onChange={(e) => setze(i, { name: e.target.value })}
                />
              </Field>
              <Field label={i === 0 ? 'Rolle' : ''}>
                <select
                  className="input"
                  value={z.role}
                  onChange={(e) => setze(i, { role: e.target.value as Zeile['role'] })}
                >
                  <option value="erwachsener">Erwachsener</option>
                  <option value="kind">Kind</option>
                </select>
              </Field>
              <Field label={i === 0 ? 'Beihilfe %' : ''}>
                <input
                  className="input"
                  value={z.satz}
                  inputMode="numeric"
                  onChange={(e) => setze(i, { satz: e.target.value })}
                />
              </Field>
              <Field label={i === 0 ? 'Zugang' : ''}>
                <select
                  className="input"
                  value={z.zugang}
                  onChange={(e) => setze(i, { zugang: e.target.value })}
                >
                  <option value="">über sich selbst</option>
                  {erwachsene.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
              <div className={i === 0 ? 'flex items-end pb-2' : 'flex items-center'}>
                {zeilen.length > 1 ? (
                  <button
                    className="text-sm text-slate-400 hover:text-red-600"
                    title="Zeile entfernen"
                    onClick={() => setZeilen((zz) => zz.filter((_, k) => k !== i))}
                  >
                    entfernen
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <button className="btn-secondary" onClick={() => setZeilen((z) => [...z, leereZeile()])}>
          + weitere Person
        </button>

        {gefuellt.length > 0 && erwachsene.length === 0 ? (
          <Alert kind="warning">
            Mindestens eine Person muss „Erwachsener“ sein – über sie läuft die Anmeldung bei
            Beihilfe und Versicherung.
          </Alert>
        ) : null}

        <div className="flex items-center gap-3 border-t border-slate-200 pt-4">
          <button className="btn-primary" disabled={!bereit || busy} onClick={speichern}>
            {busy ? 'Wird angelegt …' : 'Weiter'}
          </button>
          <span className="text-sm text-slate-500">
            Später jederzeit änderbar unter Einstellungen.
          </span>
        </div>
      </div>
    </div>
  );
}
