/**
 * Ablage der Belege im Dateisystem.
 *
 * Die App legt hochgeladene Rechnungen in einem vom Nutzer bestimmten Ordner ab,
 * nach Person und Jahr sortiert:
 *
 *   <Ablageordner>/2 Nora/Belege 2026/2026-05-29 Fröhlich 63,01 EUR.pdf
 *
 * Die Datei liegt danach nur noch dort – die App hält keine zweite Kopie. Solange
 * kein Ablageordner eingerichtet ist, bleiben die Dateien im App-Ordner.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getSettings, setSetting } from './db.js';
import { BACKEND_ROOT } from './paths.js';

export const ARCHIVE_ROOT_KEY = 'archive_root';

export const getArchiveRoot = (): string => (getSettings()[ARCHIVE_ROOT_KEY] ?? '').trim();

export const setArchiveRoot = (dir: string): void => setSetting(ARCHIVE_ROOT_KEY, dir.trim());

/**
 * Ein gespeicherter Pfad kann relativ zum Projekt (App-Ordner) oder absolut
 * (Ablageordner) sein.
 */
export function resolveStoredPath(stored: string): string {
  // Relative Pfade beziehen sich auf den backend-Ordner ("uploads/rechnungen/…"),
  // so wie relativeUploadPath sie erzeugt.
  return path.isAbsolute(stored) ? stored : path.resolve(BACKEND_ROOT, stored);
}

/* ------------------------------------------------------------------ */
/*  Prüfen und Einrichten                                              */
/* ------------------------------------------------------------------ */

export interface ArchiveCheck {
  path: string;
  exists: boolean;
  writable: boolean;
  created: boolean;
  entries: number;
  error?: string;
}

/** Prüft einen Ablageordner und legt ihn auf Wunsch an. */
export function checkArchiveRoot(dir: string, create = false): ArchiveCheck {
  const target = dir.trim();
  const result: ArchiveCheck = {
    path: target,
    exists: false,
    writable: false,
    created: false,
    entries: 0,
  };

  if (!target) return { ...result, error: 'Bitte einen Ordner angeben.' };
  if (!path.isAbsolute(target)) {
    return { ...result, error: 'Bitte den vollständigen Pfad angeben, z.B. G:\\Privat\\Arztrechnungen.' };
  }

  try {
    if (!fs.existsSync(target)) {
      if (!create) return { ...result, error: 'Der Ordner existiert noch nicht.' };
      fs.mkdirSync(target, { recursive: true });
      result.created = true;
    }
    if (!fs.statSync(target).isDirectory()) {
      return { ...result, error: 'Der angegebene Pfad ist kein Ordner.' };
    }
    result.exists = true;
    result.entries = fs.readdirSync(target).length;

    // Schreibrecht tatsächlich ausprobieren – Rechte auf Netz- und Cloudlaufwerken
    // lassen sich nicht zuverlässig vorab ablesen.
    const probe = path.join(target, `.schreibtest-${Date.now()}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    result.writable = true;
    return result;
  } catch (err) {
    return { ...result, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ------------------------------------------------------------------ */
/*  Ablegen                                                            */
/* ------------------------------------------------------------------ */

/** Zeichen, die Windows in Dateinamen nicht erlaubt, ersetzen. */
function safeName(part: string): string {
  return part
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export interface ArchiveTarget {
  member: string;
  memberOrder: number;
  invoiceDate: string | null;
  doctor: string;
  amount: number;
  extension: string;
}

/** Ordner einer Person, mit der bei mehreren Personen üblichen Nummerierung. */
export function personFolder(member: string, order: number): string {
  return safeName(order > 0 ? `${order} ${member}` : member);
}

/** Der vollständige Zielpfad, unter dem eine Rechnung abgelegt wird. */
export function archivePathFor(root: string, t: ArchiveTarget): string {
  const year = (t.invoiceDate ?? new Date().toISOString().slice(0, 10)).slice(0, 4);
  const datePart = t.invoiceDate ?? 'ohne Datum';
  const doctorPart = safeName(t.doctor || 'Unbekannter Aussteller').slice(0, 60);
  const amountPart = `${t.amount.toFixed(2).replace('.', ',')} EUR`;

  const fileName = `${datePart} ${doctorPart} ${amountPart}${t.extension}`;
  return path.join(root, personFolder(t.member, t.memberOrder), `Belege ${year}`, safeName(fileName));
}

export interface DecisionArchiveTarget {
  /** Zugang, aus dem der Bescheid stammt – eine der erwachsenen Personen. */
  account: string;
  accountOrder: number;
  target: 'dbv' | 'beihilfe';
  decisionDate: string | null;
  totalPaid: number | null;
  extension: string;
}

/**
 * Bescheide liegen beim Zugang, über den sie eingegangen sind – parallel zu den
 * Belegen desselben Jahres:
 *
 *   <Ablageordner>/1 Ali/Bescheide 2026/2026-06-22 Beihilfe 394,84 EUR.pdf
 *
 * Ein Bescheid betrifft oft mehrere Familienmitglieder, deshalb wird er nicht
 * nach Patient abgelegt.
 */
export function decisionArchivePathFor(root: string, t: DecisionArchiveTarget): string {
  const year = (t.decisionDate ?? new Date().toISOString().slice(0, 10)).slice(0, 4);
  const datePart = t.decisionDate ?? 'ohne Datum';
  const absender = t.target === 'dbv' ? 'DBV' : 'Beihilfe';
  const betrag = t.totalPaid !== null ? ` ${t.totalPaid.toFixed(2).replace('.', ',')} EUR` : '';

  const fileName = `${datePart} ${absender}${betrag}${t.extension}`;
  return path.join(root, personFolder(t.account, t.accountOrder), `Bescheide ${year}`, safeName(fileName));
}

/** Verschiebt einen Bescheid in die Ablage. Fehlschläge sind unkritisch. */
export function archiveDecisionFile(storedPath: string, t: DecisionArchiveTarget): ArchiveResult {
  const root = getArchiveRoot();
  if (!root) return { archived: false, path: storedPath, reason: 'Kein Ablageordner eingerichtet.' };

  const source = resolveStoredPath(storedPath);
  if (!fs.existsSync(source)) {
    return { archived: false, path: storedPath, reason: 'Die hochgeladene Datei wurde nicht gefunden.' };
  }
  return moveInto(source, decisionArchivePathFor(root, t), storedPath);
}

/** Hängt " (2)", " (3)" an, falls der Name schon vergeben ist. */
function uniquePath(target: string): string {
  if (!fs.existsSync(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let n = 2; n < 200; n++) {
    const candidate = path.join(dir, `${base} (${n})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base} (${Date.now()})${ext}`);
}

export interface ArchiveResult {
  archived: boolean;
  path: string;
  reason?: string;
}

/**
 * Verschiebt eine hochgeladene Datei in die Ablage. Schlägt das fehl, bleibt die
 * Datei liegen, wo sie ist – eine Rechnung darf daran nie scheitern.
 */
export function archiveFile(storedPath: string, t: ArchiveTarget): ArchiveResult {
  const root = getArchiveRoot();
  if (!root) return { archived: false, path: storedPath, reason: 'Kein Ablageordner eingerichtet.' };

  const source = resolveStoredPath(storedPath);
  if (!fs.existsSync(source)) {
    return { archived: false, path: storedPath, reason: 'Die hochgeladene Datei wurde nicht gefunden.' };
  }

  return moveInto(source, archivePathFor(root, t), storedPath);
}

/** Verschiebt eine Datei an ihren Platz in der Ablage, ohne je zu überschreiben. */
function moveInto(source: string, wanted: string, fallbackPath: string): ArchiveResult {
  try {
    const target = uniquePath(wanted);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.renameSync(source, target);
    } catch {
      // Über Laufwerksgrenzen hinweg kann nicht umbenannt werden.
      fs.copyFileSync(source, target);
      fs.rmSync(source, { force: true });
    }
    return { archived: true, path: target };
  } catch (err) {
    return {
      archived: false,
      path: fallbackPath,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Benennt eine bereits abgelegte Datei um, wenn sich Datum, Arzt oder Betrag
 * geändert haben. Fehlschläge sind unkritisch – die Rechnung bleibt gültig.
 */
export function reArchiveFile(storedPath: string, t: ArchiveTarget): ArchiveResult {
  const root = getArchiveRoot();
  if (!root || !path.isAbsolute(storedPath)) {
    return { archived: false, path: storedPath };
  }
  const current = resolveStoredPath(storedPath);
  if (!fs.existsSync(current)) return { archived: false, path: storedPath, reason: 'Datei nicht gefunden.' };

  const wanted = archivePathFor(root, t);
  if (path.resolve(current) === path.resolve(wanted)) return { archived: true, path: storedPath };

  try {
    const target = uniquePath(wanted);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(current, target);
    return { archived: true, path: target };
  } catch (err) {
    return { archived: false, path: storedPath, reason: err instanceof Error ? err.message : String(err) };
  }
}
