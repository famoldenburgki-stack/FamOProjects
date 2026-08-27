import { useEffect, useState } from 'react';
import { api } from '../api';
import { money } from '../format';
import { Alert, Field, Spinner } from '../components/ui';
import type { CategoryInfo, IssuerPattern, Member } from '../types';
import ArchiveSetup from './ArchiveSetup';

const SETTING_FIELDS: { key: string; label: string; hint: string }[] = [
  {
    key: 'deadline_beihilfe_months',
    label: 'Ausschlussfrist Beihilfe (Monate)',
    hint: 'In Hessen üblich: 12 Monate ab Rechnungsdatum. 0 = keine Frist überwachen.',
  },
  {
    key: 'deadline_dbv_months',
    label: 'Frist DBV (Monate)',
    hint: 'Konservativ 24 Monate. 0 = keine Frist überwachen.',
  },
  {
    key: 'deadline_warn_days',
    label: 'Vorwarnzeit für Fristen (Tage)',
    hint: 'Ab wann eine ablaufende Frist in den Aufgaben erscheint.',
  },
  {
    key: 'remind_not_submitted_days',
    label: 'Erinnerung „nicht eingereicht“ (Tage)',
    hint: 'Ab wann eine noch nicht eingereichte Rechnung gemeldet wird.',
  },
  {
    key: 'remind_decision_days',
    label: 'Erinnerung „Bescheid überfällig“ (Tage)',
    hint: 'Ab wann eine Einreichung ohne Bescheid gemeldet wird.',
  },
  {
    key: 'payment_warn_days',
    label: 'Vorwarnzeit für Zahlungsfristen (Tage)',
    hint: 'Ab wann eine fällige Zahlung an den Arzt in den Aufgaben erscheint.',
  },
  {
    key: 'tolerance_eur',
    label: 'Toleranz bei der Bescheidprüfung (€)',
    hint: 'Abweichungen bis zu diesem Betrag gelten noch als vollständig erstattet (Rundungen).',
  },
];

export default function Settings() {
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [newMember, setNewMember] = useState({ name: '', role: 'kind', beihilfe_rate: '0.8', account: 'Tim' });

  const [patterns, setPatterns] = useState<IssuerPattern[]>([]);
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [neueArt, setNeueArt] = useState('');
  const [eingangOrdner, setEingangOrdner] = useState('');

  async function speichereEingang(create: boolean, wert?: string) {
    try {
      const pfad = wert ?? eingangOrdner;
      const r = await api.setInboxFolder(pfad, create);
      load();
      flash(pfad ? `Überwachter Ordner: ${r.path}` : 'Überwachung abgeschaltet.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function anlegen() {
    try {
      await api.addCategory(neueArt.trim());
      setNeueArt('');
      load();
      flash(`"${neueArt.trim()}" hinzugefügt.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function umbenennen(c: CategoryInfo) {
    const neu = window.prompt(`"${c.name}" umbenennen in:`, c.name)?.trim();
    if (!neu || neu === c.name) return;
    try {
      const res = await api.renameCategory(c.name, neu);
      load();
      flash(
        `"${c.name}" heißt jetzt "${neu}"` +
          (res.invoices_updated > 0 ? ` – ${res.invoices_updated} Rechnungen mitgeändert.` : '.'),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loeschen(c: CategoryInfo) {
    const hinweis =
      c.in_use > 0
        ? `\n\n${c.in_use} Rechnungen nutzen diese Art – sie werden auf "Sonstiges" gesetzt.`
        : '';
    if (!window.confirm(`Behandlungsart "${c.name}" löschen?${hinweis}`)) return;
    try {
      const res = await api.deleteCategory(c.name);
      load();
      flash(
        `"${c.name}" gelöscht` +
          (res.invoices_moved > 0 ? ` – ${res.invoices_moved} Rechnungen auf "Sonstiges" gesetzt.` : '.'),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function load() {
    api
      .settings()
      .then((s) => {
        setSettings(s.settings);
        setMembers(s.members);
        setEingangOrdner(s.settings.inbox_folder ?? '');
      })
      .catch((e: Error) => setError(e.message));
    api.patterns().then(setPatterns).catch(() => undefined);
    api.categories().then(setCategories).catch(() => undefined);
  }
  useEffect(load, []);

  async function removePattern(p: IssuerPattern) {
    if (!window.confirm(`Gelerntes Muster für "${p.name}" verwerfen?`)) return;
    try {
      await api.deletePattern(p.id);
      load();
      flash(`Muster für ${p.name} verworfen.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function flash(msg: string) {
    setSaved(msg);
    setTimeout(() => setSaved(null), 2500);
  }

  async function saveMember(m: Member, patch: Partial<Member>) {
    try {
      await api.updateMember(m.id, patch);
      load();
      flash(`${m.name} gespeichert.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!settings) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Einstellungen</h1>
        <p className="text-sm text-slate-600">
          Beihilfesätze, Zugänge, Fristen und die Schwelle für die Beitragsrückerstattung.
        </p>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}
      {saved ? <Alert kind="success">{saved}</Alert> : null}

      <div className="card">
        <h2 className="font-semibold">Familie &amp; Beihilfesätze</h2>
        <p className="mb-4 text-sm text-slate-500">
          Der Beihilfesatz bestimmt die erwartete Erstattung: Beihilfe zahlt diesen Anteil, die DBV
          den Rest. Der Zugang legt fest, über welche App-Anmeldung eingereicht wird – danach werden
          auch Bescheide zugeordnet.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead>
              <tr>
                <th className="th">Name</th>
                <th className="th">Rolle</th>
                <th className="th">Beihilfesatz</th>
                <th className="th">DBV-Anteil</th>
                <th className="th">Zugang</th>
                <th className="th">BRE-Schwelle (€)</th>
                <th className="th">Aktiv</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="td font-medium">{m.name}</td>
                  <td className="td">
                    <select
                      className="input w-36"
                      value={m.role}
                      onChange={(e) => saveMember(m, { role: e.target.value as Member['role'] })}
                    >
                      <option value="erwachsener">Erwachsener</option>
                      <option value="kind">Kind</option>
                    </select>
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-1">
                      <input
                        className="input w-20"
                        defaultValue={String(Math.round(m.beihilfe_rate * 100))}
                        onBlur={(e) => {
                          const pct = Number(e.target.value);
                          if (Number.isFinite(pct) && Math.abs(pct / 100 - m.beihilfe_rate) > 0.0001) {
                            saveMember(m, { beihilfe_rate: pct / 100 });
                          }
                        }}
                      />
                      <span className="text-sm text-slate-500">%</span>
                    </div>
                  </td>
                  <td className="td text-slate-500">{Math.round((1 - m.beihilfe_rate) * 100)} %</td>
                  <td className="td">
                    <input
                      className="input w-28"
                      defaultValue={m.account}
                      onBlur={(e) => e.target.value !== m.account && saveMember(m, { account: e.target.value })}
                    />
                  </td>
                  <td className="td">
                    <input
                      className="input w-28"
                      placeholder="–"
                      defaultValue={m.bre_threshold === null ? '' : String(m.bre_threshold)}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const value = raw === '' ? null : Number(raw.replace(',', '.'));
                        if (value !== m.bre_threshold) saveMember(m, { bre_threshold: value });
                      }}
                    />
                  </td>
                  <td className="td">
                    <input
                      type="checkbox"
                      checked={m.active === 1}
                      onChange={(e) => saveMember(m, { active: e.target.checked ? 1 : 0 })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-5">
          <Field label="Neue Person">
            <input
              className="input"
              value={newMember.name}
              onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
              placeholder="Name"
            />
          </Field>
          <Field label="Rolle">
            <select
              className="input"
              value={newMember.role}
              onChange={(e) => setNewMember({ ...newMember, role: e.target.value })}
            >
              <option value="kind">Kind</option>
              <option value="erwachsener">Erwachsener</option>
            </select>
          </Field>
          <Field label="Beihilfesatz (%)">
            <input
              className="input"
              value={String(Number(newMember.beihilfe_rate) * 100)}
              onChange={(e) => setNewMember({ ...newMember, beihilfe_rate: String(Number(e.target.value) / 100) })}
            />
          </Field>
          <Field label="Zugang">
            <input
              className="input"
              value={newMember.account}
              onChange={(e) => setNewMember({ ...newMember, account: e.target.value })}
            />
          </Field>
          <div className="flex items-end">
            <button
              className="btn-primary w-full"
              disabled={!newMember.name.trim()}
              onClick={() =>
                api
                  .createMember({ ...newMember, beihilfe_rate: Number(newMember.beihilfe_rate) })
                  .then(() => {
                    setNewMember({ name: '', role: 'kind', beihilfe_rate: '0.8', account: 'Tim' });
                    load();
                    flash('Person hinzugefügt.');
                  })
                  .catch((e: Error) => setError(e.message))
              }
            >
              Hinzufügen
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold">Fristen &amp; Erinnerungen</h2>
        <p className="mb-4 text-sm text-slate-500">
          Diese Werte steuern, was in den Aufgaben auftaucht. Die Fristangaben sind Voreinstellungen –
          maßgeblich ist immer die Regelung deines Dienstherrn bzw. Tarifs.
        </p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {SETTING_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <input
                className="input"
                defaultValue={settings[f.key] ?? ''}
                onBlur={(e) => {
                  if (e.target.value === settings[f.key]) return;
                  api
                    .updateSettings({ [f.key]: e.target.value })
                    .then((s) => {
                      setSettings(s);
                      flash('Einstellung gespeichert.');
                    })
                    .catch((err: Error) => setError(err.message));
                }}
              />
            </Field>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold">Rechnungseingang</h2>
        <p className="mt-1 text-sm text-slate-600">
          Rechnungen und Bescheide, die in diesen Ordner gelegt werden – etwa von der Scan-App
          aufs Handy oder über einen Cloud-Ordner –, liest die App beim Start des Rechners ein und
          legt sie als Entwurf im <em>Eingang</em> ab. Erst deine Bestätigung macht daraus eine
          Rechnung bzw. einen geprüften Bescheid. Der Ordner wird dabei geleert; verworfene Belege
          landen in seinem Unterordner „verworfen".
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-72 flex-1">
            <label className="label">Überwachter Ordner</label>
            <input
              className="input"
              value={eingangOrdner}
              placeholder="z.B. C:\Users\timbe\OneDrive\Rechnungen-Eingang"
              onChange={(e) => setEingangOrdner(e.target.value)}
            />
          </div>
          <button className="btn-secondary" onClick={() => speichereEingang(true)}>
            Übernehmen &amp; ggf. anlegen
          </button>
          {settings.inbox_folder ? (
            <button className="btn-ghost" onClick={() => { setEingangOrdner(''); speichereEingang(false, ''); }}>
              Abschalten
            </button>
          ) : null}
        </div>

      </div>

      <div className="card">
        <h2 className="font-semibold">Behandlungsarten</h2>
        <p className="mt-1 text-sm text-slate-600">
          Diese Arten stehen im Formular und in der Statistik zur Auswahl. Neue Arzttypen kannst du
          jederzeit ergänzen – beim Hochladen erkennt die App den Namen dann auch selbst im Beleg.
          Umbenennen zieht bestehende Rechnungen mit; Löschen setzt sie auf „Sonstiges".
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {categories.map((c) => (
            <span
              key={c.name}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              <button
                className="hover:underline"
                title="Umbenennen"
                onClick={() => umbenennen(c)}
              >
                {c.name}
              </button>
              <span className="text-xs text-slate-400">{c.in_use}</span>
              {c.fixed ? (
                <span className="text-xs text-slate-300" title="Rückfall, nicht löschbar">
                  ●
                </span>
              ) : (
                <button
                  className="text-slate-400 hover:text-red-700"
                  title="Löschen"
                  onClick={() => loeschen(c)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="w-56">
            <label className="label">Neue Behandlungsart</label>
            <input
              className="input"
              value={neueArt}
              placeholder="z.B. Kinderarzt"
              onChange={(e) => setNeueArt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && anlegen()}
            />
          </div>
          <button className="btn-secondary" disabled={neueArt.trim().length < 2} onClick={anlegen}>
            Hinzufügen
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold">Ablageordner</h2>
        <p className="mt-1 text-sm text-slate-600">
          Hier legt die App hochgeladene Rechnungen ab – nach Person und Jahr sortiert, benannt
          nach Datum, Arzt und Betrag. Änderst du den Ordner, bleiben bereits abgelegte Dateien
          liegen, wo sie sind.
        </p>
        <p className="mt-2 text-sm">
          Aktuell:{' '}
          {settings.archive_root ? (
            <code className="rounded bg-slate-100 px-1.5 py-0.5">{settings.archive_root}</code>
          ) : (
            <span className="text-amber-700">
              nicht eingerichtet – Dateien bleiben im Ordner der App
            </span>
          )}
        </p>
        <p className="mt-2">
          <button
            className="btn-secondary"
            onClick={() =>
              api.openArchive().catch((e: Error) => setError(e.message))
            }
          >
            📁 Ordner im Explorer öffnen
          </button>
        </p>
        <div className="mt-3">
          <ArchiveSetup
            compact
            current={settings.archive_root ?? ''}
            onDone={(p) => {
              load();
              flash(`Ablageordner auf ${p} gesetzt.`);
            }}
          />
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold">Portale zum Einreichen</h2>
        <p className="mt-1 text-sm text-slate-600">
          Die Anmeldeseiten von Beihilfe und DBV. Sie stehen oben rechts in der Kopfzeile als
          Knopf bereit – zusammen mit dem Sprung in den Ablageordner, aus dem du die Belege
          hochlädst. Ändert sich eine Adresse, kannst du sie hier anpassen.
        </p>
        <div className="mt-3 space-y-3">
          {[
            { key: 'link_beihilfe', label: 'Beihilfe (Anmeldung)' },
            { key: 'link_dbv', label: 'DBV / AXA (Anmeldung)' },
          ].map((feld) => (
            <Field key={feld.key} label={feld.label}>
              <div className="flex flex-wrap gap-2">
                <input
                  className="input min-w-0 flex-1"
                  value={settings[feld.key] ?? ''}
                  onChange={(e) => setSettings({ ...settings, [feld.key]: e.target.value })}
                  onBlur={(e) => {
                    api
                      .updateSettings({ [feld.key]: e.target.value.trim() })
                      .then((neu) => {
                        setSettings(neu);
                        flash('Adresse gespeichert.');
                      })
                      .catch((err: Error) => setError(err.message));
                  }}
                  placeholder="https://…"
                />
                {settings[feld.key] ? (
                  <a
                    className="btn-secondary"
                    href={settings[feld.key]}
                    target="_blank"
                    rel="noreferrer"
                  >
                    öffnen ↗
                  </a>
                ) : null}
              </div>
            </Field>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold">Gelernte Aussteller-Muster</h2>
        <p className="mt-1 text-sm text-slate-600">
          Für jeden Arzt merkt sich die App beim Speichern, wie dessen Rechnungen aufgebaut
          sind – zum Beispiel welche Form die Rechnungsnummer hat. Beim nächsten Beleg
          desselben Ausstellers werden damit die Felder gefüllt, die sonst leer blieben. Ein
          unbekannter Aussteller bekommt automatisch ein neues Muster.
        </p>
        {patterns.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Noch keine Muster gelernt – sie entstehen beim Speichern der ersten Rechnungen.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Aussteller</th>
                  <th className="th text-right">Rechnungen</th>
                  <th className="th">Behandlungsart</th>
                  <th className="th">Gelernt</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {patterns.map((p) => (
                  <tr key={p.id}>
                    <td className="td font-medium">{p.name}</td>
                    <td className="td text-right">{p.samples}</td>
                    <td className="td">{p.category || '–'}</td>
                    <td className="td text-slate-600">
                      {p.learned.length > 0 ? p.learned.join(' · ') : 'noch zu wenig Belege'}
                    </td>
                    <td className="td text-right">
                      <button
                        className="text-sm text-red-700 hover:underline"
                        onClick={() => removePattern(p)}
                      >
                        verwerfen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="font-semibold">Daten &amp; Sicherung</h2>
        <p className="mt-1 text-sm text-slate-600">
          Alle Daten liegen ausschließlich lokal in <code className="rounded bg-slate-100 px-1">backend/data/app.db</code>,
          die hochgeladenen Dateien in <code className="rounded bg-slate-100 px-1">backend/uploads/</code>. Für ein
          Backup genügt es, diese beiden Ordner zu kopieren.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="btn-secondary" href="/api/excel/export">
            Alles als Excel exportieren
          </a>
        </div>
      </div>
    </div>
  );
}
