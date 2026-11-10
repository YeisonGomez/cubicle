/**
 * Experiencia y niveles (tema Pokémon y rangos del clásico). Solo cuentan los prompts
 * humanos, todos, sin tope diario: cada prompt suma. Lo que hace lento subir es la curva,
 * calibrada con uso real (un agente intenso hace unos 1.300 prompts en 4 meses).
 * Máximo nivel 100, como en Game Boy.
 */
export const XP_PER_PROMPT = 20;
export const MAX_LEVEL = 100;
/** Prompts para llegar al nivel 100 (≈ un año de un agente muy usado). */
export const PROMPTS_TO_MAX = 4000;
const CURVE = 5 / 3;

/** Experiencia total para llegar a un nivel. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(XP_PER_PROMPT * PROMPTS_TO_MAX * ((Math.min(level, MAX_LEVEL) - 1) / (MAX_LEVEL - 1)) ** CURVE);
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** Experiencia de un historial { día: prompts }. */
export function xpFromDays(days: Record<string, number> | undefined): number {
  let xp = 0;
  for (const n of Object.values(days ?? {})) xp += Math.max(0, n) * XP_PER_PROMPT;
  return xp;
}

// Niveles de evolución: unos 350, 670 y 1.000 prompts.
const LEVEL_MONTH_1 = 24;
const LEVEL_MONTH_2 = 35;
const LEVEL_MONTH_3 = 44;

/** Nivel en que se pasa a cada forma siguiente, según las formas de la cadena. */
export function evolutionLevels(forms: number): number[] {
  if (forms <= 1) return [];
  if (forms === 2) return [LEVEL_MONTH_2]; // con una sola evolución: al menos 2 meses en total
  if (forms === 3) return [LEVEL_MONTH_1, LEVEL_MONTH_2];
  return [LEVEL_MONTH_1, LEVEL_MONTH_2, LEVEL_MONTH_3];
}

/** Índice de la forma que corresponde a un nivel (0 = la inicial). */
export function stageForLevel(level: number, forms: number): number {
  return evolutionLevels(forms).filter((l) => level >= l).length;
}
