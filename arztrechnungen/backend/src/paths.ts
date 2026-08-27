import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/ (dev via tsx) bzw. dist/ (nach build) -> jeweils ein Verzeichnis hoch
export const BACKEND_ROOT = path.resolve(here, '..');

export const DATA_DIR = path.join(BACKEND_ROOT, 'data');
export const OCR_CACHE_DIR = path.join(DATA_DIR, 'ocr-cache');
export const UPLOAD_DIR = path.join(BACKEND_ROOT, 'uploads');
export const INVOICE_DIR = path.join(UPLOAD_DIR, 'rechnungen');
/** Belege aus dem überwachten Ordner, die noch auf Bestätigung warten. */
export const INBOX_DIR = path.join(UPLOAD_DIR, 'eingang');
export const DECISION_DIR = path.join(UPLOAD_DIR, 'bescheide');
export const FRONTEND_DIST = path.resolve(BACKEND_ROOT, '..', 'frontend', 'dist');
