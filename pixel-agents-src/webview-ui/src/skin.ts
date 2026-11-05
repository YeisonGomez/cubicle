/**
 * Skin de personajes (clásico o Pokémon), resuelto por el servidor (`GET /api/skin`):
 * tema, tipos disponibles, tipo de cada sala y Pokémon de cada agente con la URL de
 * su sprite, nivel y experiencia. Se carga al arrancar, cada 30 s y cuando Ajustes lo cambia.
 */
import { useSyncExternalStore } from 'react';

import { authHeaders } from './components/panel/api.js';

export interface AgentSkin {
  type: string;
  id: number;
  name: string;
  sprite: string;
  walk: string;
  level: number;
  xp: number;
  levelXp: number;
  nextXp: number;
  evolvesAt: number | null;
  evolving?: { fromName: string; from: string; toName: string; to: string; stage: number };
}

export interface SkinState {
  theme: 'classic' | 'pokemon';
  types: Array<{ id: string; es: string; en: string; color: string }>;
  rooms: Record<string, string>;
  agents: Record<string, AgentSkin>;
}

let lastLoaded = '';
let current: SkinState = { theme: 'classic', types: [], rooms: {}, agents: {} };
const listeners = new Set<() => void>();
function emit(): void {
  listeners.forEach((f) => f());
}

export async function loadSkin(): Promise<SkinState> {
  try {
    const r = await fetch('./api/skin', { cache: 'no-store' });
    if (r.ok) {
      const text = await r.text();
      if (text !== lastLoaded) {
        lastLoaded = text;
        current = JSON.parse(text) as SkinState;
        emit();
      }
    }
  } catch {
    /* servidor viejo o apagado: se queda el clásico */
  }
  return current;
}

export async function updateSkin(body: { theme?: 'classic' | 'pokemon'; rooms?: Record<string, string>; reshuffle?: string[] | 'all' }): Promise<SkinState> {
  const r = await fetch('./api/skin', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
  const b = (await r.json()) as SkinState & { error?: string };
  if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
  current = b;
  emit();
  return current;
}

/** La animación de evolución ya se mostró: el agente pasa a su nueva forma. */
export async function ackEvolution(agent: string, stage: number): Promise<void> {
  try {
    const r = await fetch('./api/skin/evolved', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ agent, stage }) });
    if (r.ok) {
      current = (await r.json()) as SkinState;
      emit();
    }
  } catch {
    /* se reintenta con la próxima carga */
  }
}

export function getSkin(): SkinState {
  return current;
}
export function useSkin(): SkinState {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => current,
  );
}
