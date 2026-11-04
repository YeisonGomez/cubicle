import { apiHeaders } from './components/FolderPicker.js';

/** Evento que avisa a la barra (fijados, orden) de que un agente cambió de nombre. */
export const AGENT_RENAMED_EVENT = 'cubicle:agent-renamed';

/** Las preferencias guardadas por nombre (fijados, orden de fichas, descanso forzado) pasan al nombre nuevo. */
function migratePrefs(from: string, to: string): void {
  const swap = (n: string) => (n === from ? to : n);
  try {
    const pinned = JSON.parse(localStorage.getItem('pixel-agents.pinnedAgents') ?? '[]') as string[];
    localStorage.setItem('pixel-agents.pinnedAgents', JSON.stringify(pinned.map(swap)));
    const order = JSON.parse(localStorage.getItem('pixel-agents.cardOrder') ?? '{}') as Record<string, string[]>;
    for (const k of Object.keys(order)) order[k] = order[k].map(swap);
    localStorage.setItem('pixel-agents.cardOrder', JSON.stringify(order));
    const rest = JSON.parse(localStorage.getItem('pixel-agents.forcedRest') ?? '{}') as Record<string, number>;
    if (rest[from] !== undefined) {
      rest[to] = rest[from];
      delete rest[from];
      localStorage.setItem('pixel-agents.forcedRest', JSON.stringify(rest));
    }
  } catch {
    /* sin almacenamiento */
  }
}

/**
 * Renombra un agente: config, sala, capacidades y actividad en el servidor, y
 * `/rename` en su terminal de Claude (la sesión se reinicia con la misma conversación).
 */
export async function renameAgent(from: string, to: string): Promise<string> {
  const r = await fetch(`./api/agents/${encodeURIComponent(from)}/rename`, {
    method: 'PUT',
    headers: apiHeaders(),
    body: JSON.stringify({ name: to }),
  });
  const b = (await r.json()) as { error?: string; name?: string };
  if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
  const name = b.name ?? to;
  migratePrefs(from, name);
  window.dispatchEvent(new CustomEvent(AGENT_RENAMED_EVENT, { detail: { from, to: name } }));
  return name;
}
