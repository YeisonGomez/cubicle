import { describe, expect, it } from 'vitest';

import { evolutionLevels, levelForXp, MAX_LEVEL, stageForLevel, XP_DAILY_CAP, xpForLevel, xpFromDays } from '../src/pokemonXp.js';

const minDays = (level: number) => Math.ceil(xpForLevel(level) / XP_DAILY_CAP);

describe('experiencia Pokémon', () => {
  it('respeta el tiempo mínimo para evolucionar aunque se use cada día al tope', () => {
    const [a, b] = evolutionLevels(3);
    expect(minDays(a)).toBeGreaterThanOrEqual(30);
    expect(minDays(b)).toBeGreaterThanOrEqual(60);
    expect(minDays(evolutionLevels(2)[0])).toBeGreaterThanOrEqual(60);
    expect(minDays(evolutionLevels(4)[2])).toBeGreaterThanOrEqual(90);
  });
  it('el tope diario limita a quien manda muchos prompts', () => {
    expect(xpFromDays({ '2026-01-01': 500 })).toBe(XP_DAILY_CAP);
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
