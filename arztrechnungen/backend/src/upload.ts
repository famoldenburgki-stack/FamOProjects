import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { DECISION_DIR, INVOICE_DIR } from './paths.js';

fs.mkdirSync(INVOICE_DIR, { recursive: true });
fs.mkdirSync(DECISION_DIR, { recursive: true });

const ALLOWED = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp',
]);

function makeUploader(dir: string) {
  return multer({
    storage: multer.diskStorage({
      // Ordner bei jedem Upload sicherstellen: er kann zwischenzeitlich
      // verschwinden, etwa weil die Dateien in die Ablage verschoben wurden.
      destination: (_req, _file, cb) => {
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const base = path
          .basename(file.originalname, ext)
          .replace(/[^\p{L}\p{N}._-]+/gu, '_')
          .slice(0, 60);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        cb(null, `${stamp}_${base || 'datei'}${ext}`);
      },
    }),
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED.has(ext)) {
        cb(new Error(`Dateityp ${ext || '(unbekannt)'} wird nicht unterstützt (PDF oder Bild).`));
        return;
      }
      cb(null, true);
    },
  });
}

export const invoiceUpload = makeUploader(INVOICE_DIR);
export const decisionUpload = makeUploader(DECISION_DIR);

/** Speichert Pfade relativ zum Backend-Root, damit die DB portabel bleibt. */
export function relativeUploadPath(absolute: string): string {
  return path.relative(path.resolve(INVOICE_DIR, '..', '..'), absolute).replace(/\\/g, '/');
}
