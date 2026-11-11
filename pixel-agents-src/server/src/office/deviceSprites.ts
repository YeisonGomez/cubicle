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

/** Sprite codificado de una URL de GIF (cacheado en memoria; null si falla). */
export function spriteFor(url: string): Promise<Buffer | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? encodeGif(b) : null))
      .catch(() => null);
    cache.set(url, p);
    // Un fallo no se queda pegado: se reintenta en la siguiente petición.
    void p.then((v) => {
      if (!v) cache.delete(url);
    });
  }
  return p;
}
