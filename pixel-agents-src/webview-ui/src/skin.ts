/**
 * Skin de personajes (clásico o Pokémon), resuelto por el servidor (`GET /api/skin`):
 * tema, tipos disponibles, tipo de cada sala y Pokémon de cada agente con la URL de
 * su sprite. Se carga al arrancar y cada vez que Ajustes lo cambia.
 */
import { useSyncExternalStore } from 'react';

import { authHeaders } from './components/panel/api.js';

export interface SkinState {
  theme: 'classic' | 'pokemon';
  types: Array<{ id: string; es: string; en: string; color: string }>;
  rooms: Record<string, string>;
  agents: Record<string, { type: string; id: number; name: string; sprite: string; walk: string }>;
}

let current: SkinState = { theme: 'classic', types: [], rooms: {}, agents: {} };
const listeners = new Set<() => void>();
function emit(): void {
  listeners.forEach((f) => f());
}

export async function loadSkin(): Promise<SkinState> {
  try {
    const r = await fetch('./api/skin', { cache: 'no-store' });
    if (r.ok) {
      current = (await r.json()) as SkinState;
      emit();
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
