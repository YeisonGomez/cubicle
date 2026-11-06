import { describe, expect, it } from 'vitest';

import { fableLeft } from '../src/modelUsage.js';

const H = 3_600_000;
const resetsAt = 1_000_000; // segundos
const start = (resetsAt - 7 * 86400) * 1000;
const now = start + 24 * H;

describe('cuánto queda de Fable', () => {
  it('sin usarlo desde el reinicio queda 100%', () => {
    expect(fableLeft({ reachedAt: 0, lastReplyAt: start - H, resetsAt }, now)).toMatchObject({ remaining: 100, source: 'unused' });
  });
  it('con aviso de límite queda 0%', () => {
    expect(fableLeft({ reachedAt: now - H, lastReplyAt: now - 2 * H, resetsAt }, now)).toMatchObject({ remaining: 0, source: 'notice' });
  });
  it('una respuesta posterior al aviso lo libera', () => {
    expect(fableLeft({ reachedAt: now - 2 * H, lastReplyAt: now - H, resetsAt }, now).source).not.toBe('notice');
  });
  it('un aviso de la semana anterior no cuenta', () => {
    expect(fableLeft({ reachedAt: start - H, lastReplyAt: start - 2 * H, resetsAt }, now)).toMatchObject({ remaining: 100, source: 'unused' });
  });
  it('usa el caché de Claude Code si es de esta ventana', () => {
    const cached = { percent: 30, resetsAt: resetsAt * 1000, fetchedAt: now - H };
    expect(fableLeft({ reachedAt: 0, lastReplyAt: now - H, resetsAt, cached }, now)).toEqual({ remaining: 70, source: 'cache', at: now - H });
  });
  it('nunca da por bueno el caché de la semana anterior', () => {
    const cached = { percent: 99, resetsAt: start, fetchedAt: start - 2 * H };
    expect(fableLeft({ reachedAt: 0, lastReplyAt: start - H, resetsAt, cached }, now)).toMatchObject({ remaining: 100, source: 'unused' });
    expect(fableLeft({ reachedAt: 0, lastReplyAt: now - H, resetsAt, cached }, now)).toEqual({ remaining: null, source: null, at: null });
  });
  it('usado y sin dato nuevo: no se inventa un porcentaje', () => {
    expect(fableLeft({ reachedAt: 0, lastReplyAt: now - H, resetsAt }, now).remaining).toBeNull();
  });
  it('pasado el reinicio sin dato nuevo de la statusline, tampoco', () => {
    expect(fableLeft({ reachedAt: now - H, lastReplyAt: 0, resetsAt }, resetsAt * 1000 + 1).remaining).toBeNull();
  });
});
