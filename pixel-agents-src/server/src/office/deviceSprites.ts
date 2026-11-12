/**
 * Sprites de Pokémon para la pantalla externa, ya listos para dibujar: la placa no
 * decodifica GIF. Se baja el GIF animado (el mismo que usa la oficina), se componen
 * sus frames y se mandan en RGB565 con un color clave de transparencia.
 *
 * Formato (little endian): 'C','S', ancho, alto, nº de frames, y por frame
 * u16 duración en ms + ancho*alto u16 RGB565. Transparente = SPRITE_KEY.
 * Solo en memoria: los sprites nunca se guardan en disco (© The Pokémon Company).
 */
import { decompressFrames, parseGIF } from 'gifuct-js';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

import { officeDir } from '../officePaths.js';

/** Magenta puro: el color clave de transparencia (un píxel real con ese color se corre a 0xF81E). */
export const SPRITE_KEY = 0xf81f;
const MAX_FRAMES = 12;
const MAX_SIDE = 64;

const cache = new Map<string, Promise<Buffer | null>>();

function rgb565(r: number, g: number, b: number): number {
  const v = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
  return v === SPRITE_KEY ? SPRITE_KEY - 1 : v;
}

/** Compone los frames de un GIF (con su disposición) y los codifica para la placa. */
export function encodeGif(buf: ArrayBuffer): Buffer | null {
  const gif = parseGIF(buf);
  const frames = decompressFrames(gif, true);
  const w = gif.lsd.width;
  const h = gif.lsd.height;
  if (!frames.length || w > MAX_SIDE || h > MAX_SIDE) return null;
  const canvas = new Uint8ClampedArray(w * h * 4);
  const snaps: Array<{ delay: number; px: Uint8ClampedArray }> = [];
  let prev: (typeof frames)[number] | null = null;
  for (const f of frames) {
    if (prev && prev.disposalType === 2) {
      for (let y = prev.dims.top; y < prev.dims.top + prev.dims.height; y++)
        for (let x = prev.dims.left; x < prev.dims.left + prev.dims.width; x++) if (x < w && y < h) canvas.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 4);
    }
    for (let y = 0; y < f.dims.height; y++) {
      for (let x = 0; x < f.dims.width; x++) {
        const s = (y * f.dims.width + x) * 4;
        if (f.patch[s + 3] < 128) continue;
        const cx = f.dims.left + x;
        const cy = f.dims.top + y;
        if (cx >= w || cy >= h) continue;
        canvas.set(f.patch.subarray(s, s + 4), (cy * w + cx) * 4);
      }
    }
    snaps.push({ delay: Math.max(20, f.delay || 100), px: canvas.slice() });
    prev = f;
  }
  // Muchos frames: se toman repartidos y se suma la duración de los que se saltan.
  let chosen = snaps;
  if (snaps.length > MAX_FRAMES) {
    chosen = [];
    const step = snaps.length / MAX_FRAMES;
    for (let i = 0; i < MAX_FRAMES; i++) {
      const from = Math.floor(i * step);
      const to = Math.floor((i + 1) * step);
      const delay = snaps.slice(from, to).reduce((t, s) => t + s.delay, 0);
      chosen.push({ delay, px: snaps[from].px });
    }
  }
  const out = Buffer.alloc(5 + chosen.length * (2 + w * h * 2));
  out.write('CS', 0, 'latin1');
  out[2] = w;
  out[3] = h;
  out[4] = chosen.length;
  let o = 5;
  for (const f of chosen) {
    out.writeUInt16LE(Math.min(0xffff, f.delay), o);
    o += 2;
    for (let i = 0; i < w * h; i++) {
      const a = f.px[i * 4 + 3];
      out.writeUInt16LE(a < 128 ? SPRITE_KEY : rgb565(f.px[i * 4], f.px[i * 4 + 1], f.px[i * 4 + 2]), o);
      o += 2;
    }
  }
  return out;
}

/**
 * Sprite de una sola imagen (PNG de hasta 64 px, tema Yu-Gi-Oh): recortado a lo dibujado y a
 * resolución completa. Va con la marca 'CH' en vez de 'CS': la placa lo dibuja a la mitad de
 * escala, así ocupa lo que un Pokémon con el doble de detalle.
 */
export function encodePng(buf: ArrayBuffer): Buffer | null {
  const png = PNG.sync.read(Buffer.from(buf));
  let x0 = png.width, y0 = png.height, x1 = -1, y1 = -1;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++)
      if (png.data[(y * png.width + x) * 4 + 3] >= 128) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w > MAX_SIDE || h > MAX_SIDE) return null;
  const out = Buffer.alloc(5 + 2 + w * h * 2);
  out.write('CH', 0, 'latin1');
  out[2] = w;
  out[3] = h;
  out[4] = 1;
  out.writeUInt16LE(500, 5);
  let o = 7;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * png.width + x0 + x) * 4;
      out.writeUInt16LE(png.data[i + 3] < 128 ? SPRITE_KEY : rgb565(png.data[i], png.data[i + 1], png.data[i + 2]), o);
      o += 2;
    }
  return out;
}

/** Sprite codificado de una URL de GIF (cacheado en memoria; null si falla). */
export function spriteFor(url: string): Promise<Buffer | null> {
  let p = cache.get(url);
  if (!p) {
    // Sprite propio del usuario: está en disco, no en la red.
    const local = url.startsWith('./api/skin/sprite/') ? path.join(officeDir(), 'sprites', path.basename(url)) : null;
    p = (local ? fs.promises.readFile(local).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) : fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)))
      .then((b) => (b ? (/\.png(\?|$)/i.test(url) ? encodePng(b) : encodeGif(b)) : null))
      .catch(() => null);
    cache.set(url, p);
    // Un fallo no se queda pegado: se reintenta en la siguiente petición.
    void p.then((v) => {
      if (!v) cache.delete(url);
    });
  }
  return p;
}
