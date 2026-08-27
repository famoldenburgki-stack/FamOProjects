/**
 * Erzeugt das Windows-Icon (.ico) aus demselben Motiv wie icon.svg.
 *
 *   npm run --workspace backend icon
 *
 * Das Motiv wird direkt gezeichnet statt aus der SVG-Datei gerendert – so
 * braucht es keinen SVG-Rasterizer, und kleine Größen lassen sich vereinfachen,
 * damit sie noch lesbar sind.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { BACKEND_ROOT } from '../paths.js';

/** Zeichnet das Icon in der gewünschten Kantenlänge. */
function draw(size: number): Buffer {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = size / 64; // alle Maße sind für 64 px entworfen
  const klein = size < 32;

  /* Blaue Kachel mit Farbverlauf */
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#2563eb');
  grad.addColorStop(1, '#1e40af');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, 14 * s);
  ctx.fill();

  /* Rechnungsblatt – bei kleinen Größen etwas größer und ohne Details */
  const l = klein ? 14 * s : 18 * s;
  const r = klein ? 50 * s : 48 * s;
  const o = klein ? 11 * s : 13 * s;
  const u = klein ? 53 * s : 54 * s;
  const ecke = klein ? 12 * s : 10 * s;

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(l, o);
  ctx.lineTo(r - ecke, o);
  ctx.lineTo(r, o + ecke);
  ctx.lineTo(r, u);
  ctx.lineTo(l, u);
  ctx.closePath();
  ctx.fill();

  /* Umgeknickte Ecke */
  ctx.fillStyle = '#bfdbfe';
  ctx.beginPath();
  ctx.moveTo(r - ecke, o);
  ctx.lineTo(r, o + ecke);
  ctx.lineTo(r - ecke, o + ecke);
  ctx.closePath();
  ctx.fill();

  /* Rechnungszeilen – unter 32 px nur Grafikrauschen, deshalb weglassen */
  if (!klein) {
    ctx.fillStyle = '#93c5fd';
    for (const [y, w] of [
      [28, 18],
      [34, 14],
    ] as const) {
      ctx.beginPath();
      ctx.roundRect(24 * s, y * s, w * s, 2.6 * s, 1.3 * s);
      ctx.fill();
    }
  }

  /* Grünes Häkchen: geprüft und erstattet */
  const cx = klein ? 43 * s : 41 * s;
  const cy = klein ? 45 * s : 44 * s;
  const rad = klein ? 12 * s : 9.5 * s;

  ctx.fillStyle = '#16a34a';
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, (klein ? 3.2 : 2.6) * s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - rad * 0.46, cy + 0.02 * rad);
  ctx.lineTo(cx - rad * 0.14, cy + rad * 0.34);
  ctx.lineTo(cx + rad * 0.44, cy - rad * 0.38);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

/**
 * Packt PNG-Bilder in eine .ico-Datei. Windows akzeptiert seit Vista
 * PNG-Daten direkt in den Bildblöcken.
 */
function buildIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserviert
  header.writeUInt16LE(1, 2); // Typ 1 = Icon
  header.writeUInt16LE(images.length, 4);

  const dirSize = 16 * images.length;
  let offset = header.length + dirSize;

  const dir = Buffer.alloc(dirSize);
  images.forEach((img, i) => {
    const at = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, at); // 0 bedeutet 256
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, at + 1);
    dir.writeUInt8(0, at + 2); // Farbanzahl
    dir.writeUInt8(0, at + 3); // reserviert
    dir.writeUInt16LE(1, at + 4); // Ebenen
    dir.writeUInt16LE(32, at + 6); // Bit pro Pixel
    dir.writeUInt32LE(img.png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += img.png.length;
  });

  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => ({ size, png: draw(size) }));
const ico = buildIco(images);

const ziel = path.resolve(BACKEND_ROOT, '..', 'Arztrechnungen.ico');
fs.writeFileSync(ziel, ico);
console.log(`${ziel} geschrieben (${sizes.join(', ')} px, ${(ico.length / 1024).toFixed(1)} kB)`);
