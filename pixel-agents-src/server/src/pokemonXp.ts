/**
 * Experiencia y niveles del tema Pokémon. Solo cuentan los prompts humanos, con un
 * tope diario: es lo que garantiza el tiempo mínimo para evolucionar por mucho que
 * se use un agente. Máximo nivel 100, como en Game Boy.
 */
export const XP_PER_PROMPT = 20;
export const XP_DAILY_CAP = 100; // 5 prompts al día dan el máximo
export const MAX_LEVEL = 100;
/** Días con el tope diario para llegar al nivel 100. */
const DAYS_TO_MAX = 365;
const CURVE = 5 / 3;

/** Experiencia total para llegar a un nivel. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(XP_DAILY_CAP * DAYS_TO_MAX * ((Math.min(level, MAX_LEVEL) - 1) / (MAX_LEVEL - 1)) ** CURVE);
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** Experiencia de un historial { día: prompts }. */
export function xpFromDays(days: Record<string, number> | undefined): number {
  let xp = 0;
  for (const n of Object.values(days ?? {})) xp += Math.min(Math.max(0, n) * XP_PER_PROMPT, XP_DAILY_CAP);
  return xp;
}

// Niveles de evolución: ≥32, ≥62 y ≥91 días con el tope diario (1, 2 y 3 meses).
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
