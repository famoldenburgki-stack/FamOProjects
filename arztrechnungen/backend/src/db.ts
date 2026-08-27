import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';
import { Db } from './sqlite.js';
import { DEFAULT_CATEGORIES, FALLBACK_CATEGORY } from './types.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

/*
 * Der Ablageort ist überschreibbar, damit Prüfläufe nicht in die echte
 * Datenbank schreiben.
 */
const DB_FILE = process.env.ARZTRECHNUNGEN_DB || path.join(DATA_DIR, 'app.db');

export const db = new Db(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS family_members (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL UNIQUE,
  role           TEXT    NOT NULL DEFAULT 'kind',        -- 'erwachsener' | 'kind'
  beihilfe_rate  REAL    NOT NULL DEFAULT 0.5,           -- z.B. 0.65
  account        TEXT    NOT NULL DEFAULT 'Tim',         -- über welchen App-Zugang eingereicht wird
  bre_threshold  REAL,                                   -- Jahresschwelle Beitragsrückerstattung (DBV), NULL = aus
  active         INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  family_member_id INTEGER NOT NULL REFERENCES family_members(id),
  doctor           TEXT    NOT NULL DEFAULT '',
  invoice_number   TEXT    NOT NULL DEFAULT '',
  invoice_date     TEXT,                                 -- ISO yyyy-mm-dd
  treatment_date   TEXT,
  amount           REAL    NOT NULL DEFAULT 0,
  category         TEXT    NOT NULL DEFAULT 'Sonstiges',
  paid_to_doctor_date TEXT,                              -- wann ich den Arzt bezahlt habe
  note             TEXT    NOT NULL DEFAULT '',
  file_path        TEXT,
  ocr_text         TEXT,
  archived_at      TEXT,                                 -- gesetzt = Papierrechnung abgelegt
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_date   ON invoices(invoice_date);

CREATE TABLE IF NOT EXISTS submissions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id       INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  target           TEXT    NOT NULL,                     -- 'dbv' | 'beihilfe'
  status           TEXT    NOT NULL DEFAULT 'offen',     -- offen|eingereicht|teilweise_bezahlt|bezahlt|abgelehnt
  submitted_date   TEXT,
  decision_date    TEXT,
  paid_amount      REAL,
  rejection_reason TEXT    NOT NULL DEFAULT '',
  action_note      TEXT    NOT NULL DEFAULT '',
  decision_id      INTEGER REFERENCES decisions(id) ON DELETE SET NULL,
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (invoice_id, target)
);

CREATE TABLE IF NOT EXISTS decisions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  target           TEXT    NOT NULL,                     -- 'dbv' | 'beihilfe'
  account          TEXT    NOT NULL DEFAULT 'Tim',       -- Zugang, aus dem der Bescheid stammt
  decision_date    TEXT,
  file_path        TEXT,
  ocr_text         TEXT,
  total_paid       REAL,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decision_items (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id           INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  invoice_number        TEXT    NOT NULL DEFAULT '',
  invoice_date          TEXT,
  invoice_amount        REAL,
  paid_amount           REAL,
  reason                TEXT    NOT NULL DEFAULT '',
  matched_submission_id INTEGER REFERENCES submissions(id) ON DELETE SET NULL,
  match_kind            TEXT    NOT NULL DEFAULT 'unmatched', -- number|amount_date|manual|unmatched
  applied               INTEGER NOT NULL DEFAULT 0,
  raw_line              TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Belege aus dem überwachten Ordner, die noch nicht bestätigt sind. Bewusst
-- getrennt von invoices: ein unbestätigter Entwurf darf weder in Statistiken
-- noch in Summen oder Fristen auftauchen.
CREATE TABLE IF NOT EXISTS inbox (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path     TEXT    NOT NULL,              -- Ablage im App-Ordner, bis bestätigt
  original_name TEXT    NOT NULL DEFAULT '',
  content_hash  TEXT    NOT NULL DEFAULT '',   -- verhindert doppeltes Einlesen
  source        TEXT    NOT NULL DEFAULT 'ordner',
  ocr_source    TEXT    NOT NULL DEFAULT '',
  ocr_text      TEXT    NOT NULL DEFAULT '',
  suggestion    TEXT    NOT NULL DEFAULT '{}', -- erkannte Felder als JSON
  hints         TEXT    NOT NULL DEFAULT '[]', -- Hinweise zur Prüfung als JSON
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inbox_hash ON inbox(content_hash);

-- Behandlungsarten. Als Tabelle statt fester Liste, damit jeder Haushalt seine
-- eigenen Arzttypen pflegen kann.
CREATE TABLE IF NOT EXISTS categories (
  name       TEXT    NOT NULL PRIMARY KEY,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Gelerntes Muster je Rechnungsaussteller: wie dessen Rechnungen aufgebaut sind.
CREATE TABLE IF NOT EXISTS issuer_patterns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT    NOT NULL UNIQUE,          -- normalisierter Ausstellername
  display_name TEXT    NOT NULL DEFAULT '',      -- zuletzt bestätigte Schreibweise
  fingerprint  TEXT    NOT NULL DEFAULT '',      -- markante Wörter des Briefkopfs
  category     TEXT    NOT NULL DEFAULT '',      -- gelernte Behandlungsart
  samples      INTEGER NOT NULL DEFAULT 0,       -- Anzahl gelernter Rechnungen
  rules        TEXT    NOT NULL DEFAULT '{}',    -- gelernte Feldregeln als JSON
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Ein Excel-Import als Stapel, damit er als Ganzes zurückgenommen werden kann.
CREATE TABLE IF NOT EXISTS import_batches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name   TEXT    NOT NULL DEFAULT '',
  sheet       TEXT    NOT NULL DEFAULT '',
  row_count   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
`);

/* ---------- Migrationen ---------- */

/** Ergänzt fehlende Spalten, damit bestehende Datenbanken weiter nutzbar bleiben. */
function ensureColumns(table: string, columns: Record<string, string>): void {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name),
  );
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

// Herkunft einer Rechnung, damit ein Import wieder entfernt werden kann
ensureColumns('invoices', {
  import_batch_id: 'INTEGER REFERENCES import_batches(id) ON DELETE SET NULL',
});

// Zahlungsfrist gegenüber dem Arzt – steht auf der Rechnung, nicht zu verwechseln
// mit der Ausschlussfrist für die Einreichung bei Beihilfe/DBV.
ensureColumns('invoices', {
  payment_due_date: 'TEXT',
});

// Der Eingang nimmt auch Bescheide an, nicht nur Rechnungen.
ensureColumns('inbox', {
  kind: "TEXT NOT NULL DEFAULT 'rechnung'", // 'rechnung' | 'bescheid'
  decision: "TEXT NOT NULL DEFAULT '{}'",   // Vorschau des erkannten Bescheids als JSON
});

// Angaben, die echte Bescheide anstelle einer Rechnungsnummer liefern
ensureColumns('decision_items', {
  member_name: "TEXT NOT NULL DEFAULT ''",
  service_label: "TEXT NOT NULL DEFAULT ''",
  rejected_amount: 'REAL',
  rate: 'REAL',
  treatment_year: 'INTEGER',
});

/*
 * Die Mailbenachrichtigung ist entfallen. Ihre Merkliste und der Empfänger werden
 * aufgeräumt, damit keine Adresse in der Datenbank zurückbleibt.
 */
db.exec('DROP TABLE IF EXISTS notifications');
db.prepare("DELETE FROM settings WHERE key = 'notify_email'").run();

/* ---------- Seed ---------- */

const DEFAULT_SETTINGS: Record<string, string> = {
  deadline_beihilfe_months: '12',   // Ausschlussfrist Beihilfe Hessen
  deadline_dbv_months: '24',        // DBV/VVG-Verjährung, konservativ
  deadline_warn_days: '42',         // Warnung wenn Frist in < 42 Tagen abläuft
  remind_not_submitted_days: '30',  // Rechnung liegt X Tage unentreicht
  remind_decision_days: '45',       // eingereicht, aber X Tage kein Bescheid
  payment_warn_days: '7',           // Warnung X Tage vor Ablauf der Zahlungsfrist
  tolerance_eur: '1.00',            // Abweichung, die noch als "voll erstattet" gilt
  currency: 'EUR',
  // Anmeldeseiten der beiden Stellen – für den Sprung ins Portal beim Einreichen
  link_beihilfe: 'https://ebeihilfe.hessen.de/anmelden',
  // Weiterleitung der DBV auf die My-AXA-Anmeldung; sie erzeugt den nötigen
  // Sitzungstoken bei jedem Aufruf neu. Ein direkt kopierter entry.axa.de-Link
  // mit RequestedPage läuft ab und endet in einem 403.
  link_dbv: 'https://www.dbv.de/site/dbv-de/redirect/MyAxaLogin',
  inbox_folder: '',                 // überwachter Ordner, leer = Automatik aus
};

const insertSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
);
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

/*
 * Bewusst kein Startbestand an Personen: wer die App zum ersten Mal öffnet, legt
 * seinen eigenen Haushalt an (Einrichtungsdialog beim ersten Start). Ein
 * mitgelieferter Beispielhaushalt wäre für jeden anderen schlicht falsch – und
 * falsche Beihilfesätze fallen später kaum auf.
 */

/* ---------- Settings-Helfer ---------- */

/* ---------- Behandlungsarten ---------- */

const categoryCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number };
if (categoryCount.n === 0) {
  const ins = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
  DEFAULT_CATEGORIES.forEach((name, i) => ins.run(name, i));
}

export function getCategories(): string[] {
  const rows = db.prepare('SELECT name FROM categories ORDER BY sort_order, name').all() as {
    name: string;
  }[];
  const names = rows.map((r) => r.name);
  // Der Rückfall muss immer vorhanden sein, sonst laufen Zuordnungen ins Leere.
  return names.includes(FALLBACK_CATEGORY) ? names : [...names, FALLBACK_CATEGORY];
}

export function getSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function getSettingNumber(key: string, fallback: number): number {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
