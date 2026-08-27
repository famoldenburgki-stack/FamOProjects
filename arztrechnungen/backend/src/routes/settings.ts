import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Router } from 'express';
import { db, getCategories, getSettings, setSetting } from '../db.js';
import {
  archivePathFor,
  checkArchiveRoot,
  decisionArchivePathFor,
  getArchiveRoot,
  resolveStoredPath,
  setArchiveRoot,
} from '../archive.js';
import { deletePattern, listPatterns, patternSummary } from '../patterns.js';
import { FALLBACK_CATEGORY, type FamilyMember } from '../types.js';

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  res.json({
    settings: getSettings(),
    members: db.prepare('SELECT * FROM family_members ORDER BY sort_order, id').all(),
    categories: getCategories(),
  });
});

settingsRouter.patch('/', (req, res) => {
  const body = req.body as Record<string, unknown>;
  for (const [key, value] of Object.entries(body)) {
    setSetting(key, String(value));
  }
  res.json(getSettings());
});

/* ---------- Behandlungsarten ---------- */

export const categoriesRouter = Router();

categoriesRouter.get('/', (_req, res) => {
  /*
   * Zu jeder Behandlungsart mitliefern, wie viele Rechnungen sie nutzen – damit
   * beim Löschen sichtbar ist, was davon betroffen wäre.
   */
  res.json(
    getCategories().map((name) => ({
      name,
      in_use: (
        db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE category = ?').get(name) as { n: number }
      ).n,
      fixed: name === FALLBACK_CATEGORY,
    })),
  );
});

categoriesRouter.post('/', (req, res) => {
  const name = String((req.body as { name?: string }).name ?? '').trim();
  if (name.length < 2) {
    res.status(400).json({ error: 'Bitte einen Namen mit mindestens zwei Zeichen angeben.' });
    return;
  }
  if (getCategories().some((c) => c.toLowerCase() === name.toLowerCase())) {
    res.status(400).json({ error: `"${name}" gibt es schon.` });
    return;
  }
  const max = (db.prepare('SELECT MAX(sort_order) AS m FROM categories').get() as { m: number | null }).m;
  db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)').run(name, (max ?? 0) + 1);
  res.status(201).json({ name });
});

categoriesRouter.patch('/:name', (req, res) => {
  const alt = decodeURIComponent(req.params.name);
  const neu = String((req.body as { name?: string }).name ?? '').trim();
  if (neu.length < 2) {
    res.status(400).json({ error: 'Bitte einen Namen mit mindestens zwei Zeichen angeben.' });
    return;
  }
  if (!getCategories().includes(alt)) {
    res.status(404).json({ error: 'Behandlungsart nicht gefunden.' });
    return;
  }
  if (alt !== neu && getCategories().some((c) => c.toLowerCase() === neu.toLowerCase())) {
    res.status(400).json({ error: `"${neu}" gibt es schon.` });
    return;
  }

  // Umbenennen nimmt die bestehenden Rechnungen mit, sonst zeigten sie ins Leere.
  const moved = db.transaction(() => {
    db.prepare('UPDATE categories SET name = ? WHERE name = ?').run(neu, alt);
    const n = db.prepare('UPDATE invoices SET category = ? WHERE category = ?').run(neu, alt).changes;
    db.prepare('UPDATE issuer_patterns SET category = ? WHERE category = ?').run(neu, alt);
    return Number(n);
  });
  res.json({ name: neu, invoices_updated: moved });
});

categoriesRouter.delete('/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  if (name === FALLBACK_CATEGORY) {
    res.status(400).json({ error: `"${FALLBACK_CATEGORY}" ist der Rückfall und bleibt bestehen.` });
    return;
  }
  if (!getCategories().includes(name)) {
    res.status(404).json({ error: 'Behandlungsart nicht gefunden.' });
    return;
  }

  // Betroffene Rechnungen behalten ihre Zuordnung nicht im Nichts, sondern fallen zurück.
  const moved = db.transaction(() => {
    const n = db
      .prepare('UPDATE invoices SET category = ? WHERE category = ?')
      .run(FALLBACK_CATEGORY, name).changes;
    db.prepare("UPDATE issuer_patterns SET category = '' WHERE category = ?").run(name);
    db.prepare('DELETE FROM categories WHERE name = ?').run(name);
    return Number(n);
  });
  res.json({ ok: true, invoices_moved: moved });
});

/* ---------- Ablageordner ---------- */

/** Prüft einen Ordner, ohne ihn zu übernehmen – für den Einrichtungsdialog. */
settingsRouter.post('/archive/check', (req, res) => {
  const { path: dir, create } = req.body as { path?: string; create?: boolean };
  const check = checkArchiveRoot(dir ?? '', Boolean(create));
  /*
   * Für die Beispielpfade die erste angelegte Person nehmen – ein fest
   * eingebauter Name wäre für jeden anderen Haushalt verwirrend.
   */
  const erste = db
    .prepare('SELECT name, sort_order FROM family_members ORDER BY sort_order, id LIMIT 1')
    .get() as { name: string; sort_order: number } | undefined;
  const beispielName = erste?.name ?? 'Person';
  const beispielOrder = erste?.sort_order ?? 1;

  res.json({
    ...check,
    // Beispiele, damit der Nutzer vor dem Übernehmen sieht, was entsteht.
    example: check.exists
      ? archivePathFor(check.path, {
          member: beispielName,
          memberOrder: beispielOrder,
          invoiceDate: new Date().toISOString().slice(0, 10),
          doctor: 'Praxis Dr. Fröhlich',
          amount: 63.01,
          extension: '.pdf',
        })
      : null,
    example_decision: check.exists
      ? decisionArchivePathFor(check.path, {
          account: beispielName,
          accountOrder: beispielOrder,
          target: 'beihilfe',
          decisionDate: new Date().toISOString().slice(0, 10),
          totalPaid: 394.84,
          extension: '.pdf',
        })
      : null,
  });
});

settingsRouter.post('/archive/root', (req, res) => {
  const { path: dir, create } = req.body as { path?: string; create?: boolean };
  const check = checkArchiveRoot(dir ?? '', Boolean(create));
  if (!check.exists || !check.writable) {
    res.status(400).json({ error: check.error ?? 'Der Ordner ist nicht beschreibbar.', check });
    return;
  }
  setArchiveRoot(check.path);
  res.json({ ...check, saved: true });
});

/**
 * Ablageordner im Explorer öffnen. Wahlweise den Ordner einer bestimmten
 * Rechnung – dann steht die Datei gleich markiert da und lässt sich sofort in
 * das Portal von Beihilfe oder DBV hochladen.
 *
 * Der Pfad kommt nie aus der Anfrage, sondern immer aus der Datenbank; die App
 * läuft lokal, öffnet aber trotzdem nur, was sie selbst abgelegt hat.
 */
settingsRouter.post('/archive/open', (req, res) => {
  const { invoice_id: invoiceId } = req.body as { invoice_id?: number };

  let ziel: string | null = null;
  let markieren = false;

  if (invoiceId) {
    const row = db.prepare('SELECT file_path FROM invoices WHERE id = ?').get(invoiceId) as
      | { file_path: string | null }
      | undefined;
    const datei = row?.file_path ? resolveStoredPath(row.file_path) : null;
    if (datei && fs.existsSync(datei)) {
      ziel = datei;
      markieren = true;
    } else if (datei) {
      // Datei verschoben oder Laufwerk getrennt – dann wenigstens den Ordner.
      const ordner = path.dirname(datei);
      if (fs.existsSync(ordner)) ziel = ordner;
    }
  }

  if (!ziel) {
    const root = getArchiveRoot();
    if (!root || !fs.existsSync(root)) {
      res.status(400).json({
        error: root
          ? `Der Ablageordner ist nicht erreichbar: ${root}`
          : 'Es ist noch kein Ablageordner eingerichtet.',
      });
      return;
    }
    ziel = root;
  }

  if (process.platform !== 'win32') {
    res.status(400).json({ error: 'Das Öffnen des Ordners ist nur unter Windows eingebaut.' });
    return;
  }

  // Ohne Shell aufrufen, damit Sonderzeichen im Pfad nichts anrichten können.
  const proc = spawn('explorer.exe', markieren ? [`/select,${ziel}`] : [ziel], {
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();
  res.json({ opened: ziel, selected: markieren });
});

/* ---------- Gelernte Aussteller-Muster ---------- */

export const patternsRouter = Router();

patternsRouter.get('/', (_req, res) => {
  res.json(listPatterns().map(patternSummary));
});

patternsRouter.delete('/:id', (req, res) => {
  if (!deletePattern(Number(req.params.id))) {
    res.status(404).json({ error: 'Muster nicht gefunden.' });
    return;
  }
  res.json({ ok: true });
});

/* ---------- Familienmitglieder ---------- */

export const membersRouter = Router();

membersRouter.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM family_members ORDER BY sort_order, id').all());
});

membersRouter.post('/', (req, res) => {
  const b = req.body as Partial<FamilyMember>;
  if (!b.name?.trim()) {
    res.status(400).json({ error: 'Bitte einen Namen angeben.' });
    return;
  }
  const info = db
    .prepare(
      `INSERT INTO family_members (name, role, beihilfe_rate, account, bre_threshold, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      b.name.trim(),
      b.role === 'erwachsener' ? 'erwachsener' : 'kind',
      Number(b.beihilfe_rate ?? 0.5),
      // Ohne Angabe reicht die Person über sich selbst ein.
      (b.account ?? b.name).trim(),
      b.bre_threshold ?? null,
      Number(b.sort_order ?? 99),
    );
  res.status(201).json(
    db.prepare('SELECT * FROM family_members WHERE id = ?').get(Number(info.lastInsertRowid)),
  );
});

const MEMBER_FIELDS = ['name', 'role', 'beihilfe_rate', 'account', 'bre_threshold', 'active', 'sort_order'] as const;

membersRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of MEMBER_FIELDS) {
    if (!(key in body)) continue;
    let value = body[key];
    if (key === 'beihilfe_rate') value = Number(value);
    if (key === 'bre_threshold') value = value === '' || value === null ? null : Number(value);
    if (key === 'active') value = value ? 1 : 0;
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (sets.length === 0) {
    res.status(400).json({ error: 'Keine Änderungen übergeben.' });
    return;
  }
  params.push(id);
  db.prepare(`UPDATE family_members SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM family_members WHERE id = ?').get(id));
});

membersRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE family_member_id = ?').get(id) as {
    n: number;
  };
  if (used.n > 0) {
    // Historie erhalten: nur deaktivieren, damit alte Rechnungen gültig bleiben
    db.prepare('UPDATE family_members SET active = 0 WHERE id = ?').run(id);
    res.json({ ok: true, deactivated: true, invoices: used.n });
    return;
  }
  db.prepare('DELETE FROM family_members WHERE id = ?').run(id);
  res.json({ ok: true, deactivated: false });
});
