import { describe, expect, it } from 'vitest';

import { toNextLevel } from '../src/office/skinRoutes.js';
import { xpForLevel } from '../src/pokemonXp.js';

describe('toNextLevel: prompts que faltan con el tope diario', () => {
  const need = xpForLevel(24);
  it('falta 1 prompt y hoy aún hay tope: se puede hoy', () => {
    expect(toNextLevel(need - 5, 24, 2)).toEqual({ prompts: 1, days: 0, tomorrow: false });
  });
  it('tope de hoy lleno: los prompts de hoy no suman, cuenta desde mañana', () => {
    expect(toNextLevel(need - 5, 24, 9)).toEqual({ prompts: 1, days: 1, tomorrow: true });
  });
  it('muchos prompts: días mínimos después de hoy', () => {
    expect(toNextLevel(need - 500, 24, 0)).toEqual({ prompts: 25, days: 4, tomorrow: false });
  });
  it('sin próximo nivel', () => {
    expect(toNextLevel(100, null)).toBeNull();
  });
});
