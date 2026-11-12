/**
 * Skin de personajes (clásico o Pokémon), resuelto por el servidor (`GET /api/skin`):
 * tema, tipos disponibles, tipo de cada sala y Pokémon de cada agente con la URL de
 * su sprite, nivel y experiencia. Se carga al arrancar, cada 30 s y cuando Ajustes lo cambia.
 */
import { useSyncExternalStore } from 'react';

import { authHeaders } from './components/panel/api.js';

/** Prompts que faltan para la próxima evolución o rango (cada prompt suma, sin tope). */
export interface ToNext {
  prompts: number;
}

export interface AgentSkin {
  type: string;
  room?: string;
  id: number;
  name: string;
  sprite: string;
  walk: string;
  level: number;
  xp: number;
  prompts?: number;
  levelXp: number;
  nextXp: number;
  evolvesAt: number | null;
  toNext?: ToNext | null;
  evolving?: { fromName: string; from: string; toName: string; to: string; stage: number };
  /** Sprite de una sola imagen (Yu-Gi-Oh): se anima por código. */
  still?: boolean;
  /** Flota en vez de saltar. */
  fly?: boolean;
}

/** Progreso del agente en el tema clásico: nivel, experiencia y rango (índice de RANK_KEYS). */
export interface AgentRank {
  level: number;
  xp: number;
  prompts?: number;
  levelXp: number;
  nextXp: number;
  rank: number;
  nextRankAt: number | null;
  toNext?: ToNext | null;
  promoted?: { rank: number };
}

export const RANK_KEYS = ['rank.intern', 'rank.junior', 'rank.mid', 'rank.senior', 'rank.lead', 'rank.principal', 'rank.partner'] as const;

export type SkinTheme = 'classic' | 'pokemon' | 'yugioh';

export interface SkinState {
  theme: SkinTheme;
  types: Array<{ id: string; es: string; en: string; color: string }>;
  rooms: Record<string, string>;
  agents: Record<string, AgentSkin>;
  ranks: Record<string, AgentRank>;
}

let lastLoaded = '';
let current: SkinState = { theme: 'classic', types: [], rooms: {}, agents: {}, ranks: {} };
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

export async function updateSkin(body: { theme?: SkinTheme; rooms?: Record<string, string>; reshuffle?: string[] | 'all'; assign?: Record<string, number> }): Promise<SkinState> {
  const r = await fetch('./api/skin', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
  const b = (await r.json()) as SkinState & { error?: string };
  if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
  current = b;
  emit();
  return current;
}

/** Todos los personajes del tema activo, por grupo y cadena de evolución (mapa para elegir). */
export interface SkinCatalog {
  theme: SkinTheme;
  groups: Array<{ id: string; es: string; en: string; color: string; chains: Array<Array<{ id: number; name: string; sprite: string }>> }>;
}
export async function loadSkinCatalog(): Promise<SkinCatalog> {
  const r = await fetch('./api/skin/catalog', { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as SkinCatalog;
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

/** La animación de ascenso ya se mostró. */
export async function ackPromotion(agent: string, rank: number): Promise<void> {
  try {
    const r = await fetch('./api/skin/promoted', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ agent, rank }) });
    if (r.ok) {
      current = (await r.json()) as SkinState;
      emit();
    }
  } catch {
    /* se reintenta con la próxima carga */
  }
}

/** Agentes que acaban de recibir un prompt en esta pestaña. Una evolución o un ascenso solo
 *  se muestran al enviar el prompt que los completa, nunca al cargar o reiniciar la oficina:
 *  los pendientes esperan al siguiente prompt de ese agente. */
const prompted = new Set<string>();
export function markPrompted(agent: string): void {
  prompted.add(agent);
}
export function wasPrompted(agent: string): boolean {
  return prompted.has(agent);
}
export function clearPrompted(agent: string): void {
  prompted.delete(agent);
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
