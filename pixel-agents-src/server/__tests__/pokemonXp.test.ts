import { describe, expect, it } from 'vitest';

import { evolutionLevels, levelForXp, MAX_LEVEL, stageForLevel, XP_PER_PROMPT, xpForLevel, xpFromDays } from '../src/pokemonXp.js';

const prompts = (level: number) => Math.ceil(xpForLevel(level) / XP_PER_PROMPT);

describe('experiencia Pokémon', () => {
  it('evolucionar cuesta cientos de prompts y el nivel 100 unos 4.000', () => {
    const [a, b] = evolutionLevels(3);
    expect(prompts(a)).toBeGreaterThanOrEqual(300);
    expect(prompts(b)).toBeGreaterThanOrEqual(600);
    expect(prompts(evolutionLevels(2)[0])).toBeGreaterThanOrEqual(600);
    expect(prompts(evolutionLevels(4)[2])).toBeGreaterThanOrEqual(900);
    expect(prompts(MAX_LEVEL)).toBe(4000);
  });
  it('sin tope diario: cada prompt suma', () => {
    expect(xpFromDays({ '2026-01-01': 500 })).toBe(500 * XP_PER_PROMPT);
    expect(xpFromDays({ '2026-01-01': 1, '2026-01-02': 2 })).toBe(60);
    expect(xpFromDays(undefined)).toBe(0);
  });
  it('el nivel va de 1 a 100 y no se pasa', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(xpForLevel(MAX_LEVEL))).toBe(MAX_LEVEL);
    expect(levelForXp(xpForLevel(MAX_LEVEL) * 10)).toBe(MAX_LEVEL);
    expect(levelForXp(xpForLevel(24) - 1)).toBe(23);
    expect(levelForXp(xpForLevel(24))).toBe(24);
  });
  it('la forma depende del nivel y de la cadena', () => {
    expect(stageForLevel(100, 1)).toBe(0); // no evoluciona: solo sube de nivel
    expect(stageForLevel(34, 2)).toBe(0);
    expect(stageForLevel(35, 2)).toBe(1);
    expect(stageForLevel(23, 3)).toBe(0);
    expect(stageForLevel(24, 3)).toBe(1);
    expect(stageForLevel(35, 3)).toBe(2);
    expect(stageForLevel(44, 4)).toBe(3);
  });
});
