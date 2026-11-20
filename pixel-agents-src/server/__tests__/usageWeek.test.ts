import { describe, expect, it } from 'vitest';

import { pickWeek } from '../src/office/statsRoutes.js';

const now = Date.parse('2026-11-20T12:00:00Z');
const s = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe('consumo de la semana', () => {
  it('usa la medida más reciente: la statusline si hay terminal, el caché de Claude Code si no', () => {
    const file = { percent: 16, resetsAt: s('2026-11-27T07:00:00Z'), at: s('2026-11-20T11:59:00Z') };
    const cache = { percent: 49, resetsAt: Date.parse('2026-11-27T07:00:00Z'), fetchedAt: Date.parse('2026-11-20T11:00:00Z') };
    expect(pickWeek(file, cache, now).percent).toBe(16);
    expect(pickWeek({ ...file, at: s('2026-11-11T19:35:00Z') }, cache, now)).toEqual({ percent: 49, resetsAt: s('2026-11-27T07:00:00Z'), at: s('2026-11-20T11:00:00Z') });
  });

  it('sin caché ni statusline al día: si la semana ya reinició no hay dato', () => {
    const old = { percent: 16, resetsAt: s('2026-11-13T07:00:00Z'), at: s('2026-11-11T19:35:00Z') };
    expect(pickWeek(old, null, now).percent).toBeNull();
    expect(pickWeek(null, null, now)).toEqual({ percent: null, resetsAt: null, at: 0 });
  });
});
