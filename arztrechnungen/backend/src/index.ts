import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import { FRONTEND_DIST } from './paths.js';
import { invoicesRouter, submissionsRouter } from './routes/invoices.js';
import { decisionsRouter } from './routes/decisions.js';
import { remindersRouter } from './routes/reminders.js';
import { statsRouter } from './routes/stats.js';
import { excelRouter } from './routes/excel.js';
import { categoriesRouter, membersRouter, patternsRouter, settingsRouter } from './routes/settings.js';
import { inboxRouter } from './routes/inbox.js';
import { submitRouter } from './routes/submit.js';
import { getCategories } from './db.js';

const app = express();
// Eigene Variable statt PORT: so kollidiert das Backend nie mit dem Dev-Server
// des Frontends, wenn eine Umgebung PORT global vorgibt.
const PORT = Number(process.env.API_PORT ?? 4000);

app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, categories: getCategories() }));
app.use('/api/invoices', invoicesRouter);
app.use('/api/submissions', submissionsRouter);
app.use('/api/decisions', decisionsRouter);
app.use('/api/reminders', remindersRouter);
app.use('/api/stats', statsRouter);
app.use('/api/excel', excelRouter);
app.use('/api/members', membersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/patterns', patternsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/inbox', inboxRouter);
app.use('/api/einreichen', submitRouter);

// Produktionsbetrieb: gebautes Frontend mit ausliefern
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(`${FRONTEND_DIST}/index.html`));
}

// Fehler aus Uploads/Routen als JSON zurückgeben statt HTML-Stacktrace
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api]', err.message);
  res.status(400).json({ error: err.message });
});

/*
 * Nur auf diesem Rechner erreichbar. Ohne Angabe der Adresse bindet Node an alle
 * Netzwerkkarten – die App hat aber keine Benutzeranmeldung, und wer sie erreicht,
 * sieht die Gesundheitsdaten der Familie. In einem fremden WLAN wäre das offen.
 *
 * Wer die App bewusst im Heimnetz freigeben will (z.B. für das Handy), startet mit
 * ARZTRECHNUNGEN_HOST=0.0.0.0 – dann aber nur in einem Netz, dem man traut.
 */
const HOST = process.env.ARZTRECHNUNGEN_HOST ?? '127.0.0.1';

const server = app.listen(PORT, HOST, () => {
  console.log(`Arztrechnungen-Backend läuft auf http://localhost:${PORT}`);
  if (HOST !== '127.0.0.1') {
    console.log(`ACHTUNG: erreichbar für andere Geräte im Netz (${HOST}) – ohne Anmeldung.`);
  }
});

/*
 * Ist der Port belegt, endete das bisher mit einem Node-Stapelprotokoll – und der
 * Neustartversuch der Dienstschleife wiederholte das im Zehnsekundentakt. Meist
 * läuft die App schlicht schon; dann ist Abbrechen richtig, nicht Neustarten.
 */
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} ist belegt. Vermutlich läuft die App bereits – dann einfach ` +
        `http://localhost:${PORT} im Browser öffnen.`,
    );
    console.error(
      'Falls ein anderes Programm den Port nutzt, kann die App mit einem anderen ' +
        'Port gestartet werden: API_PORT=4001 setzen.',
    );
  } else {
    console.error('Der Server konnte nicht starten:', err.message);
  }
  process.exit(1);
});
