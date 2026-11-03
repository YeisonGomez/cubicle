/**
 * Server-side palette assignment helper.
 *
 * Assigns palette and hueShift to agents when they're created, ensuring
 * consistent character appearance across all connected clients.
 */

import { readConfig } from './configPersistence.js';
import { pickDiversePalette } from '../../core/src/paletteUtils.js';
import type { AgentStateStore } from './agentStateStore.js';
import { PALETTE_COUNT } from './constants.js';
import type { AgentState } from './types.js';

/**
 * Runtime palette count. External asset directories can add char_N.png
 * beyond the bundled 6 (loadExternalCharacterSprites accepts any N), so the
 * count is dynamic. Defaults to PALETTE_COUNT until setPaletteCount is
 * called after assets load. Mirrors the setHookProvider / setTeamSwitch
 * module-level setter pattern in transcriptParser.ts.
 */
let currentPaletteCount = PALETTE_COUNT;

/** Set the palette count after asset loading (standalone + VS Code). */
export function setPaletteCount(count: number): void {
  currentPaletteCount = Math.max(1, Math.floor(count));
}

/**
 * Assign palette and hueShift to an agent if not already set.
 * Uses the diversity algorithm to pick a palette that's least used among
 * existing agents.
 *
 * @param agent - The agent to assign a palette to (mutated in place)
 * @param store - The agent state store (used to count existing palettes)
 */
/** Personajes originales de Pixel Agents (0..5): cada Directorio recibe uno fijo
 *  según su posición en config.directories (se repiten cada 6, sin cambiar el
 *  tono: un hueShift también tiñe la piel y se ve mal). Como las salas tienen
 *  ≤ 6 directorios consecutivos, dentro de una sala no se repiten. */
const BASE_COUNT = 6;
function paletteFor(dirName: string): { palette: number; hueShift: number } | null {
  if (!dirName) return null;
  const names = readConfig().directories.map((d) => d.name);
  let idx = names.indexOf(dirName);
  if (idx < 0) {
    let h = 0;
    for (const ch of dirName) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    idx = h % 60;
  }
  const count = Math.min(BASE_COUNT, currentPaletteCount);
  return { palette: idx % count, hueShift: 0 };
}

export function assignPaletteIfNeeded(agent: AgentState, store: AgentStateStore): void {
  // Paletas de packs anteriores (≥ 6) se reasignan a las figuras originales.
  if (agent.palette !== undefined && agent.palette < Math.min(BASE_COUNT, currentPaletteCount)) return;

  const dirName = String(agent.directoryName ?? '');
  const fixed = paletteFor(dirName);
  if (fixed !== null) {
    agent.palette = fixed.palette;
    agent.hueShift = fixed.hueShift;
    return;
  }

  const count = currentPaletteCount;
  const paletteCounts = new Array(count).fill(0);
  for (const existing of store.values()) {
    if (existing.palette !== undefined && existing.palette < count) {
      paletteCounts[existing.palette]++;
    }
  }

  const pick = pickDiversePalette(count, paletteCounts);
  agent.palette = pick.palette;
  agent.hueShift = pick.hueShift;
}
