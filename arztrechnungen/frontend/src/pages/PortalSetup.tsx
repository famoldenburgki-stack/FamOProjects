import { useState } from 'react';
import { api } from '../api';
import { Alert, Field } from '../components/ui';

/**
 * Zweiter Schritt der Einrichtung: an welche zwei Stellen eingereicht wird.
 *
 * Beides ist frei wählbar, weil es sich von Haushalt zu Haushalt unterscheidet:
 * die Beihilfestelle hängt vom Dienstherrn ab, die Versicherung sowieso. Der
 * Name erscheint später auf den Knöpfen, in den Listen und in den Dateinamen
 * der Ablage – deshalb wird er hier mitgefragt und nicht angenommen.
 */
export default function PortalSetup({
  onDone,
}: {
  onDone: (namen: { beihilfe: string; dbv: string }) => void;
}) {
  const [beihilfeName, setBeihilfeName] = useState('Beihilfe');
  const [beihilfeLink, setBeihilfeLink] = useState('');
  const [versName, setVersName] = useState('');
  const [versLink, setVersLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Eine Adresse ohne Schema führt beim Anklicken ins Leere. */
  const ergaenze = (u: string) => {
    const t = u.trim();
    if (!t) return '';
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  };

  const namenOk = beihilfeName.trim().length >= 2 && versName.trim().length >= 2;

  async function speichern() {
    setBusy(true);
    setError(null);
    try {
      const namen = { beihilfe: beihilfeName.trim(), dbv: versName.trim() };
      await api.updateSettings({
        label_beihilfe: namen.beihilfe,
        label_versicherung: namen.dbv,
        link_beihilfe: ergaenze(beihilfeLink),
        link_versicherung: ergaenze(versLink),
      });
      onDone(namen);
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
          <h1 className="text-lg font-semibold">Wohin wird eingereicht?</h1>
          <p className="mt-1 text-sm text-slate-600">
            Jede Rechnung geht an zwei Stellen: an deine <strong>Beihilfestelle</strong> und an
            deine <strong>private Krankenversicherung</strong>. Wie die beiden heißen, steht
            später auf den Knöpfen, in den Listen und in den Namen der abgelegten Dateien.
          </p>
        </div>

        {error ? <Alert kind="error">{error}</Alert> : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-slate-200 p-4">
            <h2 className="font-semibold">Beihilfestelle</h2>
            <Field label="Name *" hint="z.B. Beihilfe, Regierungspräsidium, Bezügestelle">
              <input
                className="input"
                value={beihilfeName}
                onChange={(e) => setBeihilfeName(e.target.value)}
              />
            </Field>
            <Field label="Anmeldeseite" hint="Adresse des Portals – kann später ergänzt werden">
              <input
                className="input"
                value={beihilfeLink}
                placeholder="z.B. ebeihilfe.hessen.de/anmelden"
                onChange={(e) => setBeihilfeLink(e.target.value)}
              />
            </Field>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-200 p-4">
            <h2 className="font-semibold">Krankenversicherung</h2>
            <Field label="Name *" hint="z.B. DBV, Debeka, Signal Iduna">
              <input
                className="input"
                value={versName}
                placeholder="Name deiner Versicherung"
                onChange={(e) => setVersName(e.target.value)}
              />
            </Field>
            <Field label="Anmeldeseite" hint="Adresse des Kundenportals">
              <input
                className="input"
                value={versLink}
                placeholder="z.B. meine.versicherung.de/login"
                onChange={(e) => setVersLink(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <Alert kind="info" title="Zu den Adressen">
          Nimm die <strong>Anmeldeseite</strong>, nicht die Adresse aus der Adressleiste des
          bereits angemeldeten Portals. Letztere enthält oft einen Sitzungsschlüssel, der nach
          kurzer Zeit abläuft und danach nur noch eine Fehlermeldung zeigt.
        </Alert>

        <div className="flex items-center gap-3 border-t border-slate-200 pt-4">
          <button className="btn-primary" disabled={!namenOk || busy} onClick={speichern}>
            {busy ? 'Wird gespeichert …' : 'Weiter'}
          </button>
          <span className="text-sm text-slate-500">
            Adressen kannst du auch später in den Einstellungen eintragen.
          </span>
        </div>
      </div>
    </div>
  );
}
