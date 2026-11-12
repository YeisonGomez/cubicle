/**
 * Fondo de la vista de reposo de la pantalla externa. El usuario deja imágenes PNG en
 * `<oficina>/reposo/` (datos suyos: nunca van al repo) y cada 10 minutos toca una al azar.
 * Se compone al tamaño de la pantalla: la propia imagen, ampliada, desenfocada y oscurecida,
 * cubre todo el lienzo, y encima va la imagen entera a la derecha, con los bordes fundidos;
 * la izquierda queda libre para la hora y las barras. Sale en RGB565 (little endian), listo
 * para dibujar: la placa no decodifica PNG.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

import { officeDir } from '../officePaths.js';

/** Ancho de la caja de la derecha donde cabe la figura entera. */
const FIGURE_BOX_W = 232;
/** Franja en que los bordes de la figura se funden con el fondo. */
const FEATHER_PX = 26;
/** Brillo del fondo desenfocado (la información se lee encima). */
const BACKDROP_GAIN = 0.42;
/** Miniatura de la que sale el desenfoque. */
const BLUR_W = 24;
const BLUR_H = 16;
/** Cada cuánto cambia la imagen. */
const ROTATE_MS = 10 * 60 * 1000;

const dir = (): string => path.join(officeDir(), 'reposo');
let cached: { key: string; data: Buffer } | null = null;

type Rgba = { width: number; height: number; data: Uint8Array };

function files(): string[] {
  try {
    return fs
      .readdirSync(dir())
      .filter((f) => /\.png$/i.test(f))
      .sort();
  } catch {
    return [];
  }
}

/** Elección de un tramo de tiempo: pseudoaleatoria pero fija dentro del tramo. */
function pickFor(slot: number, n: number): number {
  let x = (slot * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return x % n;
}

/** Imagen que toca ahora y su versión (cambia con el tramo o con el archivo); null si no hay. */
export function currentRestBg(now = Date.now()): { file: string; version: number } | null {
  const list = files();
  if (list.length === 0) return null;
  const slot = Math.floor(now / ROTATE_MS);
  let i = pickFor(slot, list.length);
  // Nunca la misma dos tramos seguidos.
  if (list.length > 1 && i === pickFor(slot - 1, list.length)) i = (i + 1) % list.length;
  const file = path.join(dir(), list[i]);
  let mtime = 0;
  try {
    mtime = Math.floor(fs.statSync(file).mtimeMs / 1000);
  } catch {
    return null;
  }
  return { file, version: ((slot % 100000) * 1000 + i * 37 + (mtime % 997)) % 1_000_000_000 || 1 };
}

/** Versión del fondo que toca; 0 si no hay. */
export function restBgVersion(): number {
  return currentRestBg()?.version ?? 0;
}

/** Media de una caja de la imagen. */
function boxAvg(img: Rgba, x0: number, y0: number, x1: number, y1: number): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(img.height, Math.max(Math.floor(y0) + 1, Math.ceil(y1))); y++)
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(img.width, Math.max(Math.floor(x0) + 1, Math.ceil(x1))); x++) {
      const i = (y * img.width + x) * 4;
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      n++;
    }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

/** Compone la imagen (RGBA) sobre un lienzo w×h y lo devuelve en RGB565. */
export function composeRestBg(img: Rgba, w: number, h: number): Buffer {
  // Fondo: la imagen cubriendo todo el lienzo, a muy baja resolución (eso la desenfoca).
  const cover = Math.max(w / img.width, h / img.height);
  const cw = w / cover, ch = h / cover;
  const cx0 = (img.width - cw) / 2, cy0 = (img.height - ch) / 2;
  const thumb: Array<[number, number, number]> = [];
  for (let ty = 0; ty < BLUR_H; ty++)
    for (let tx = 0; tx < BLUR_W; tx++) thumb.push(boxAvg(img, cx0 + (tx * cw) / BLUR_W, cy0 + (ty * ch) / BLUR_H, cx0 + ((tx + 1) * cw) / BLUR_W, cy0 + ((ty + 1) * ch) / BLUR_H));
  // Dos pasadas de suavizado: sin ellas se nota la cuadrícula de la miniatura.
  for (let pass = 0; pass < 2; pass++) {
    const src = thumb.map((t) => [...t]);
    for (let ty = 0; ty < BLUR_H; ty++)
      for (let tx = 0; tx < BLUR_W; tx++)
        for (let k = 0; k < 3; k++) {
          let sum = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const q = src[(ty + dy) * BLUR_W + tx + dx];
              if (tx + dx < 0 || tx + dx >= BLUR_W || ty + dy < 0 || ty + dy >= BLUR_H || !q) continue;
              sum += q[k];
              n++;
            }
          thumb[ty * BLUR_W + tx][k] = sum / n;
        }
  }
  const backdrop = (x: number, y: number): [number, number, number] => {
    const fx = Math.min(BLUR_W - 1.001, Math.max(0, ((x + 0.5) / w) * BLUR_W - 0.5));
    const fy = Math.min(BLUR_H - 1.001, Math.max(0, ((y + 0.5) / h) * BLUR_H - 0.5));
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const ease = (t: number) => t * t * (3 - 2 * t);
    const ax = ease(fx - ix), ay = ease(fy - iy);
    const p = (dx: number, dy: number) => thumb[(iy + dy) * BLUR_W + ix + dx];
    const a = p(0, 0), b = p(1, 0), c = p(0, 1), d = p(1, 1);
    return [0, 1, 2].map((k) => ((a[k] * (1 - ax) + b[k] * ax) * (1 - ay) + (c[k] * (1 - ax) + d[k] * ax) * ay) * BACKDROP_GAIN) as [number, number, number];
  };
  // Figura: la imagen entera dentro de la caja de la derecha.
  const boxW = Math.min(FIGURE_BOX_W, w);
  const scale = Math.min(boxW / img.width, h / img.height);
  const fw = Math.round(img.width * scale), fh = Math.round(img.height * scale);
  const fx0 = w - boxW + Math.floor((boxW - fw) / 2), fy0 = Math.floor((h - fh) / 2);
  const out = Buffer.alloc(w * h * 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let [r, g, b] = backdrop(x, y);
      const u = x - fx0, v = y - fy0;
      if (u >= 0 && u < fw && v >= 0 && v < fh) {
        // Bordes fundidos, salvo los que tocan el borde del lienzo.
        let a = Math.min(1, (u + 1) / FEATHER_PX);
        if (fx0 + fw < w) a = Math.min(a, (fw - u) / FEATHER_PX);
        if (fy0 > 0) a = Math.min(a, (v + 1) / FEATHER_PX);
        if (fy0 + fh < h) a = Math.min(a, (fh - v) / FEATHER_PX);
        a = a * a * (3 - 2 * a);
        const [pr, pg, pb] = boxAvg(img, u / scale, v / scale, (u + 1) / scale, (v + 1) / scale);
        r = r * (1 - a) + pr * a;
        g = g * (1 - a) + pg * a;
        b = b * (1 - a) + pb * a;
      }
      out.writeUInt16LE(((Math.round(r) & 0xf8) << 8) | ((Math.round(g) & 0xfc) << 3) | (Math.round(b) >> 3), (y * w + x) * 2);
    }
  }
  return out;
}

/** Fondo de reposo ya compuesto, o null si el usuario no ha puesto imágenes. */
export function restBackground(w: number, h: number): Buffer | null {
  const cur = currentRestBg();
  if (!cur) return null;
  const key = `${cur.file}:${cur.version}:${w}x${h}`;
  if (cached?.key === key) return cached.data;
  try {
    cached = { key, data: composeRestBg(PNG.sync.read(fs.readFileSync(cur.file)), w, h) };
    return cached.data;
  } catch {
    return null;
  }
}
