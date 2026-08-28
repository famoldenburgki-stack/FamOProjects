import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from './api';
import { setTargetLabels, targetLabel } from './format';
import ArchiveSetup from './pages/ArchiveSetup';
import HouseholdSetup from './pages/HouseholdSetup';
import PortalSetup from './pages/PortalSetup';
import { Spinner } from './components/ui';

const NAV = [
  { to: '/', label: 'Übersicht', end: true },
  { to: '/eingang', label: 'Eingang' },
  { to: '/rechnung-neu', label: 'Rechnung hochladen' },
  { to: '/einreichen', label: 'Einreichen' },
  { to: '/bescheid', label: 'Bescheid prüfen' },
  { to: '/aufgaben', label: 'Aufgaben' },
  { to: '/statistik', label: 'Statistik' },
  { to: '/einstellungen', label: 'Einstellungen' },
];

export default function App() {
  const [openTasks, setOpenTasks] = useState<number | null>(null);
  const [inboxCount, setInboxCount] = useState<number>(0);
  /* Einrichtung beim ersten Start: erst der Haushalt, dann die Ablage. */
  const [braucht, setBraucht] = useState<'haushalt' | 'stellen' | 'ablage' | null | 'fertig'>(null);
  const [portale, setPortale] = useState({ beihilfe: '', dbv: '', nameBeihilfe: '', nameDbv: '' });
  const [openError, setOpenError] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    api
      .overview()
      .then((o) => {
        setOpenTasks(
          (o.counts.payment_due ?? 0) + (o.counts.deadlines ?? 0) + (o.counts.needs_decision ?? 0),
        );
        setInboxCount(o.counts.inbox ?? 0);
      })
      .catch(() => setOpenTasks(null));
  }, [location.pathname]);

  // Beim ersten Start fehlen Haushalt, Stellen und Ablageordner noch.
  const ladeEinstellungen = useCallback(() => {
    api
      .settings()
      .then((s) => {
        setBraucht(
          s.members.length === 0
            ? 'haushalt'
            : !(s.settings.link_beihilfe ?? '').trim() && !(s.settings.link_versicherung ?? '').trim()
              ? 'stellen'
              : !(s.settings.archive_root ?? '').trim()
                ? 'ablage'
                : 'fertig',
        );
        /*
         * Die Namen der beiden Stellen einmal setzen, bevor Unterseiten
         * gezeichnet werden – die greifen über targetLabel darauf zu.
         */
        setTargetLabels({
          beihilfe: s.settings.label_beihilfe,
          dbv: s.settings.label_versicherung,
        });
        setPortale({
          beihilfe: (s.settings.link_beihilfe ?? '').trim(),
          dbv: (s.settings.link_versicherung ?? '').trim(),
          nameBeihilfe: (s.settings.label_beihilfe ?? 'Beihilfe').trim(),
          nameDbv: (s.settings.label_versicherung ?? 'Versicherung').trim(),
        });
      })
      .catch(() => setBraucht('fertig'));
  }, []);

  useEffect(ladeEinstellungen, [ladeEinstellungen]);

  /*
   * Solange die Einstellungen nicht da sind, wird nichts gezeichnet. Sonst
   * erschiene für einen Moment die fertige App – auch beim allerersten Start,
   * wo eigentlich die Einrichtung dran ist – und die Unterseiten trügen die
   * Standardnamen der beiden Stellen statt der eingestellten.
   */
  if (braucht === null) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Einstellungen werden geladen …" />
      </div>
    );
  }

  if (braucht === 'haushalt' || braucht === 'stellen' || braucht === 'ablage') {
    return (
      <div className="min-h-screen">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
            <img src="/icon.svg" alt="" className="h-7 w-7" />
            <span className="text-lg font-semibold tracking-tight">Arztrechnungen</span>
            <span className="text-sm text-slate-500">
              Einrichtung · Schritt {braucht === 'haushalt' ? '1' : braucht === 'stellen' ? '2' : '3'} von 3
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4">
          {braucht === 'haushalt' ? (
            <HouseholdSetup onDone={() => setBraucht('stellen')} />
          ) : braucht === 'stellen' ? (
            <PortalSetup
              onDone={(namen) => {
                setTargetLabels(namen);
                // Erneut laden, damit die frisch eingetragenen Portale sofort
                // als Knöpfe erscheinen und nicht erst nach einem Neuladen.
                ladeEinstellungen();
                setBraucht('ablage');
              }}
            />
          ) : (
            <>
              <ArchiveSetup onDone={() => setBraucht('fertig')} />
              <p className="mx-auto max-w-2xl px-1 text-center text-sm text-slate-500">
                <button className="underline hover:text-slate-700" onClick={() => setBraucht('fertig')}>
                  Vorerst ohne Ablage fortfahren
                </button>
              </p>
            </>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <img src="/icon.svg" alt="" className="h-7 w-7" />
            Arztrechnungen
          </span>
          <nav className="flex flex-wrap gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {item.label}
                {item.to === '/aufgaben' && openTasks ? (
                  <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                    {openTasks}
                  </span>
                ) : null}
                {item.to === '/eingang' && inboxCount ? (
                  <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                    {inboxCount}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </nav>

          {/*
            Schnellzugriff zum Einreichen: Portal öffnen, Beleg im Explorer holen,
            hochladen. Die Adressen stehen in den Einstellungen.
          */}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50"
              onClick={() =>
                api
                  .openArchive()
                  .then(() => setOpenError(null))
                  .catch((e: Error) => setOpenError(e.message))
              }
              title="Ablageordner im Explorer öffnen"
            >
              📁 Ablage
            </button>
            {portale.beihilfe ? (
              <a
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50"
                href={portale.beihilfe}
                target="_blank"
                rel="noreferrer"
              >
                {portale.nameBeihilfe} ↗
              </a>
            ) : null}
            {portale.dbv ? (
              <a
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50"
                href={portale.dbv}
                target="_blank"
                rel="noreferrer"
              >
                {portale.nameDbv} ↗
              </a>
            ) : null}
          </div>
        </div>
        {openError ? (
          <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            {openError}
          </div>
        ) : null}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
