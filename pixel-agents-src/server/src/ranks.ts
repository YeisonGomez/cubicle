/**
 * Rangos del tema clásico: la misma experiencia que el tema Pokémon, con títulos en lugar
 * de evoluciones. Gracias al tope diario de XP, cada rango tiene un tiempo mínimo.
 */
/** Nivel en el que empieza cada rango: 1 semana, 1, 2, 5 y 8 meses, y 1 año como mínimo. */
export const RANK_LEVELS = [1, 10, 24, 35, 60, 80, 100];

export function rankForLevel(level: number): number {
  let rank = 0;
  RANK_LEVELS.forEach((l, i) => {
    if (level >= l) rank = i;
  });
  return rank;
}

export function nextRankLevel(rank: number): number | null {
  return RANK_LEVELS[rank + 1] ?? null;
}
