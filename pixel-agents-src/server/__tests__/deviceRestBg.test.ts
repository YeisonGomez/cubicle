import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { currentRestBg, pickFor } from '../src/office/deviceRestBg.js';

describe('fondo de reposo de la pantalla externa', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reposo-'));
    process.env.OFICINA_DIR = tmp;
    fs.mkdirSync(path.join(tmp, 'reposo'));
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) fs.writeFileSync(path.join(tmp, 'reposo', `${n}.png`), PNG.sync.write(new PNG({ width: 2, height: 2 })));
  });
  afterEach(() => {
    delete process.env.OFICINA_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('elige siempre un archivo que existe, en cualquier tramo de tiempo y con cualquier salto', () => {
    const start = Date.UTC(2026, 10, 11);
    for (let slot = 0; slot < 5000; slot++) {
      for (const skip of [0, 1, 7, 9]) {
        const cur = currentRestBg(skip, start + slot * 10 * 60 * 1000);
        expect(cur, `tramo ${slot}, salto ${skip}`).not.toBeNull();
        expect(fs.existsSync(cur!.file)).toBe(true);
        expect(cur!.version).toBeGreaterThan(0);
      }
    }
  });

  it('no repite la misma imagen dos tramos seguidos', () => {
    const start = Date.UTC(2026, 10, 11);
    for (let slot = 1; slot < 2000; slot++) {
      expect(currentRestBg(0, start + slot * 600000)!.file).not.toBe(currentRestBg(0, start + (slot - 1) * 600000)!.file);
    }
  });

  it('en cada vuelta salen todas las imágenes una vez', () => {
    for (let round = 0; round < 300; round++) {
      const seen = new Set<number>();
      for (let k = 0; k < 8; k++) seen.add(pickFor(round * 8 + k, 8));
      expect(seen.size).toBe(8);
    }
  });

  it('sin imágenes no hay fondo', () => {
    fs.rmSync(path.join(tmp, 'reposo'), { recursive: true });
    expect(currentRestBg()).toBeNull();
  });
});
