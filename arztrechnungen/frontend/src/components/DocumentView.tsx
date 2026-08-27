import { useEffect, useState } from 'react';

const isImage = (name: string) => /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(name);

/**
 * Zeigt einen Beleg an – PDFs eingebettet über die Anzeige des Browsers, Fotos
 * als Bild. Wird sowohl für die Vorschau beim Hochladen (Datei noch lokal) als
 * auch für gespeicherte Belege (über die Server-Adresse) verwendet.
 */
export function DocumentView({
  src,
  name,
  height = 'h-[32rem]',
}: {
  src: string;
  name: string;
  height?: string;
}) {
  if (isImage(name)) {
    return (
      <div className={`${height} overflow-auto rounded-lg border border-slate-200 bg-slate-50`}>
        <img src={src} alt={name} className="mx-auto max-w-full" />
      </div>
    );
  }
  return (
    <iframe
      src={src}
      title={name}
      className={`${height} w-full rounded-lg border border-slate-200 bg-slate-50`}
    />
  );
}

/** Vorschau einer noch nicht gespeicherten Datei aus der Dateiauswahl. */
export function LocalPreview({ file, height }: { file: File; height?: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!url) return null;
  return <DocumentView src={url} name={file.name} height={height} />;
}

/** Belegansicht als überlagertes Fenster, z.B. aus einer Tabelle heraus. */
export function DocumentDialog({
  src,
  name,
  title,
  onClose,
}: {
  src: string;
  name: string;
  title: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <div className="flex gap-2">
            <a className="btn-ghost" href={src} target="_blank" rel="noreferrer">
              In neuem Tab öffnen
            </a>
            <a className="btn-ghost" href={`${src}${src.includes('?') ? '&' : '?'}download=1`}>
              Herunterladen
            </a>
            <button className="btn-secondary" onClick={onClose}>
              Schließen
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <DocumentView src={src} name={name} height="h-[70vh]" />
        </div>
      </div>
    </div>
  );
}
