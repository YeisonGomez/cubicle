import { describe, expect, it } from 'vitest';

import { toNextLevel } from '../src/office/skinRoutes.js';
import { xpForLevel } from '../src/pokemonXp.js';

describe('toNextLevel: prompts que faltan', () => {
  it('falta 1 prompt: el siguiente lo completa, sin tope diario', () => {
    expect(toNextLevel(xpForLevel(24) - 5, 24)).toEqual({ prompts: 1 });
  });
  it('cuenta prompts enteros', () => {
    expect(toNextLevel(xpForLevel(24) - 500, 24)).toEqual({ prompts: 25 });
  });
  it('sin próximo nivel', () => {
    expect(toNextLevel(100, null)).toBeNull();
  });
});
