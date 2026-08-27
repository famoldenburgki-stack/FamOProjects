import fs from 'node:fs/promises';
import path from 'node:path';
import { OCR_CACHE_DIR } from '../paths.js';

export interface ExtractResult {
  text: string;
  /** 'pdf-text' = Textebene im PDF, 'ocr' = Texterkennung, 'none' = kein Text gewonnen */
  source: 'pdf-text' | 'ocr' | 'none';
  warning?: string;
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp']);

/** Ab wie vielen Zeichen wir der PDF-Textebene trauen (sonst: gescanntes PDF). */
const MIN_PDF_TEXT = 120;

export async function extractText(filePath: string): Promise<ExtractResult> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    let pdfText = '';
    let pdfError: string | null = null;
    try {
      pdfText = await extractPdfText(filePath);
    } catch (err) {
      pdfError = errMessage(err);
    }
    if (pdfText.trim().length >= MIN_PDF_TEXT) {
      return { text: pdfText, source: 'pdf-text' };
    }

    // Zu wenig Text -> gescanntes PDF: Seiten rendern und per OCR lesen
    try {
      const images = await renderPdfPages(filePath);
      const ocr = await ocrImages(images);
      if (ocr.trim().length > pdfText.trim().length) return { text: ocr, source: 'ocr' };
    } catch (err) {
      return {
        text: pdfText,
        source: pdfText.trim() ? 'pdf-text' : 'none',
        warning: `Texterkennung für gescanntes PDF fehlgeschlagen: ${errMessage(err)}`,
      };
    }
    return {
      text: pdfText,
      source: pdfText.trim() ? 'pdf-text' : 'none',
      warning: pdfError
        ? `PDF konnte nicht gelesen werden: ${pdfError}`
        : 'Im PDF wurde kaum Text gefunden – bitte Felder manuell prüfen.',
    };
  }

  if (IMAGE_EXT.has(ext)) {
    try {
      const buf = await fs.readFile(filePath);
      const text = await ocrImages([buf]);
      return text.trim()
        ? { text, source: 'ocr' }
        : { text: '', source: 'none', warning: 'Auf dem Bild wurde kein Text erkannt.' };
    } catch (err) {
      return { text: '', source: 'none', warning: `Texterkennung fehlgeschlagen: ${errMessage(err)}` };
    }
  }

  return { text: '', source: 'none', warning: `Dateityp ${ext} wird nicht ausgelesen.` };
}

/* ------------------------------------------------------------------ */
/*  PDF                                                                */
/* ------------------------------------------------------------------ */

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsPromise: Promise<PdfjsModule> | null = null;
const loadPdfjs = (): Promise<PdfjsModule> => {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
};

async function openPdf(filePath: string) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await fs.readFile(filePath));
  return pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
}

/**
 * Liest die Textebene eines PDFs aus und stellt dabei die Zeilenstruktur
 * wieder her – die Parser für Rechnungen und Bescheide arbeiten zeilenweise.
 */
async function extractPdfText(filePath: string, maxPages = 20): Promise<string> {
  const doc = await openPdf(filePath);
  try {
    const pages: string[] = [];
    const count = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();

      // Textstücke nach y-Position zu Zeilen gruppieren, innerhalb der Zeile
      // nach x sortieren.
      const lines: { y: number; parts: { x: number; str: string }[] }[] = [];
      for (const item of content.items) {
        if (!('str' in item) || item.str === '') continue;
        const x = item.transform[4] as number;
        const y = item.transform[5] as number;
        const line = lines.find((l) => Math.abs(l.y - y) <= 2);
        if (line) line.parts.push({ x, str: item.str });
        else lines.push({ y, parts: [{ x, str: item.str }] });
      }
      lines.sort((a, b) => b.y - a.y);
      pages.push(
        lines
          .map((l) =>
            l.parts
              .sort((a, b) => a.x - b.x)
              .map((p) => p.str)
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim(),
          )
          .filter((l) => l.length > 0)
          .join('\n'),
      );
      page.cleanup();
    }
    return pages.join('\n\n');
  } finally {
    await doc.destroy();
  }
}

/** Rendert die ersten Seiten eines PDFs als PNG-Buffer (Grundlage für OCR). */
async function renderPdfPages(filePath: string, maxPages = 5): Promise<Buffer[]> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const doc = await openPdf(filePath);
  try {
    const out: Buffer[] = [];
    const pages = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      // Skalierung 2 entspricht ca. 150 dpi – guter Kompromiss aus OCR-Qualität und Tempo
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // pdfjs erwartet einen Browser-Canvas; der napi-Canvas ist API-kompatibel.
      await page.render({
        canvasContext: ctx,
        viewport,
        canvas,
      } as unknown as Parameters<typeof page.render>[0]).promise;
      out.push(canvas.toBuffer('image/png'));
      page.cleanup();
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

/* ------------------------------------------------------------------ */
/*  OCR                                                                */
/* ------------------------------------------------------------------ */

interface OcrWorker {
  recognize: (img: Buffer) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<void>;
}

/**
 * Beendet den Texterkennungs-Arbeitsprozess. Ohne das bleiben Kommandozeilen-
 * werkzeuge nach getaner Arbeit hängen, weil der Prozess offen gehalten wird.
 */
export async function shutdownOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}

let workerPromise: Promise<OcrWorker> | null = null;

async function getOcrWorker(): Promise<OcrWorker> {
  workerPromise ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    await fs.mkdir(OCR_CACHE_DIR, { recursive: true });
    // Die deutschen Sprachdaten werden beim ersten Lauf einmalig geladen und
    // im Cache-Ordner abgelegt (ca. 15 MB, danach offline nutzbar).
    return (await createWorker('deu', undefined, {
      cachePath: OCR_CACHE_DIR,
    })) as unknown as OcrWorker;
  })();
  return workerPromise;
}

async function ocrImages(images: Buffer[]): Promise<string> {
  const worker = await getOcrWorker();
  const parts: string[] = [];
  for (const img of images) {
    const { data } = await worker.recognize(img);
    parts.push(data.text ?? '');
  }
  return parts.join('\n');
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
