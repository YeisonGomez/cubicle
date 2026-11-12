/**
 * Fondo de la vista de reposo de la pantalla externa. El usuario deja una imagen en
 * `<oficina>/reposo.png` (dato suyo: nunca va al repo) y aquí se compone al tamaño de la
 * pantalla: la figura a la derecha, a toda la altura, y a la izquierda un fondo oscuro que
 * se funde con ella, donde van la hora y las barras. Sale en RGB565 (little endian), listo
 * para dibujar: la placa no decodifica PNG.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

import { officeDir } from '../officePaths.js';

/** Ancho de la franja en que la imagen se funde con el fondo oscuro. */
const FADE_PX = 56;
/** La imagen se oscurece un poco para que no compita con la información. */
const IMAGE_GAIN = 0.9;

const file = (): string => path.join(officeDir(), 'reposo.png');
let cached: { key: string; data: Buffer } | null = null;

/** Versión del fondo (cambia al cambiar el archivo); 0 si no hay. */
export function restBgVersion(): number {
  try {
    return Math.floor(fs.statSync(file()).mtimeMs / 1000) % 1_000_000_000;
  } catch {
    return 0;
  }
}

/** Compone la imagen (RGBA) sobre un lienzo w×h y lo devuelve en RGB565. */
export function composeRestBg(img: { width: number; height: number; data: Uint8Array }, w: number, h: number): Buffer {
  // La figura ocupa toda la altura, pegada a la derecha.
  const scale = h / img.height;
  const fw = Math.min(w, Math.round(img.width * scale));
  const x0 = w - fw;
  // Color de fondo: la media del borde izquierdo de la imagen, oscurecida.
  let br = 0, bg = 0, bb = 0;
  for (let y = 0; y < img.height; y++) {
    const i = y * img.width * 4;
    br += img.data[i];
    bg += img.data[i + 1];
    bb += img.data[i + 2];
  }
  const base = [br, bg, bb].map((v) => Math.round((v / img.height) * 0.45));
  const out = Buffer.alloc(w * h * 2);
  const put = (x: number, y: number, r: number, g: number, b: number) => out.writeUInt16LE(((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3), (y * w + x) * 2);
  // Estrellas tenues y fijas a la izquierda, para que el fondo continúe el de la imagen.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const stars = new Map<number, number>();
  for (let n = 0; n < Math.round((x0 * h) / 900); n++) stars.set(Math.floor(rnd() * h) * w + Math.floor(rnd() * x0), 40 + Math.floor(rnd() * 70));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const star = stars.get(y * w + x) ?? 0;
      let r = Math.min(255, base[0] + star), g = Math.min(255, base[1] + star), b = Math.min(255, base[2] + star);
      if (x >= x0) {
        // Promedio de la caja de origen (reducción limpia, sin dientes).
        const sx0 = Math.floor((x - x0) / scale), sx1 = Math.max(sx0 + 1, Math.floor((x - x0 + 1) / scale));
        const sy0 = Math.floor(y / scale), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) / scale));
        let ar = 0, ag = 0, ab = 0, n = 0;
        for (let sy = sy0; sy < Math.min(sy1, img.height); sy++)
          for (let sx = sx0; sx < Math.min(sx1, img.width); sx++) {
            const i = (sy * img.width + sx) * 4;
            ar += img.data[i];
            ag += img.data[i + 1];
            ab += img.data[i + 2];
            n++;
          }
        if (n > 0) {
          const a = Math.min(1, (x - x0) / FADE_PX);
          r = Math.round(r * (1 - a) + (ar / n) * IMAGE_GAIN * a);
          g = Math.round(g * (1 - a) + (ag / n) * IMAGE_GAIN * a);
          b = Math.round(b * (1 - a) + (ab / n) * IMAGE_GAIN * a);
        }
      }
      put(x, y, r, g, b);
    }
  }
  return out;
}

/** Fondo de reposo ya compuesto, o null si el usuario no ha puesto imagen. */
export function restBackground(w: number, h: number): Buffer | null {
  const version = restBgVersion();
  if (!version) return null;
  const key = `${version}:${w}x${h}`;
  if (cached?.key === key) return cached.data;
  try {
    const png = PNG.sync.read(fs.readFileSync(file()));
    cached = { key, data: composeRestBg(png, w, h) };
    return cached.data;
  } catch {
    return null;
  }
}
