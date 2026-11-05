/**
 * Skins de personajes. Tema "classic" (muñecos de Pixel Agents) o "pokemon":
 * cada sala es un tipo (fuego, agua…) con su color y su piso, y cada agente es
 * un Pokémon al azar de ese tipo (1.ª y 2.ª generación), fijo mientras no se
 * vuelva a sortear. Datos en scripts/pokemon.json; elección y sorteos en
 * `<oficina>/skin.json`. Los sprites se cargan en el navegador desde el
 * repositorio público de PokeAPI (no se guardan en Cubicle).
 */
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';

import { promptDaysByDir } from '../activityStats.js';
import { readConfig } from '../configPersistence.js';
import type { HttpServerOptions } from '../httpServer.js';
import { activityFile, officeDir, scriptsDir } from '../officePaths.js';
import { evolutionLevels, levelForXp, MAX_LEVEL, stageForLevel, xpForLevel, xpFromDays } from '../pokemonXp.js';
import { bearerAuth, runProyecto } from './shared.js';

type Theme = 'classic' | 'pokemon';
interface PokeType {
  es: string;
  en: string;
  color: string;
  hue: number;
  sat: number;
  pokemon: Array<{ id: number; name: string; slug: string; gen: number }>;
}
interface PokeForm {
  name: string;
  slug: string;
  gen: number;
  next: number[];
}
interface PokeData {
  order: string[];
  types: Record<string, PokeType>;
  sprite: string;
  /** Cadenas de evolución: id -> forma y sus siguientes. */
  evo: Record<string, PokeForm>;
}
interface SkinFile {
  theme: Theme;
  rooms: Record<string, string>;
  /** Pokémon inicial de cada agente (siempre la primera forma de su cadena). */
  agents: Record<string, number>;
  /** Formas que recorre, fijadas una vez (Eevee y otros tienen varias ramas). */
  paths: Record<string, number[]>;
  /** Forma que ya se mostró; si el nivel da más, toca la animación de evolución. */
  seen: Record<string, number>;
}
export interface AgentSkin {
  type: string;
  id: number;
  name: string;
  sprite: string;
  walk: string;
  level: number;
  xp: number;
  /** Experiencia al empezar este nivel y para el siguiente (igual a xp en el nivel 100). */
  levelXp: number;
  nextXp: number;
  /** Nivel de la próxima evolución y su forma; null si ya no evoluciona más. */
  evolvesAt: number | null;
  evolving?: { fromName: string; from: string; toName: string; to: string; stage: number };
}

const skinFile = (): string => path.join(officeDir(), 'skin.json');

function readData(): PokeData | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(scriptsDir(), 'pokemon.json'), 'utf8')) as PokeData;
  } catch {
    return null;
  }
}
export function readSkin(): SkinFile {
  try {
    const j = JSON.parse(fs.readFileSync(skinFile(), 'utf8')) as Partial<SkinFile>;
    return { theme: j.theme === 'pokemon' ? 'pokemon' : 'classic', rooms: j.rooms ?? {}, agents: j.agents ?? {}, paths: j.paths ?? {}, seen: j.seen ?? {} };
  } catch {
    return { theme: 'classic', rooms: {}, agents: {}, paths: {}, seen: {} };
  }
}
function writeSkin(s: SkinFile): void {
  fs.mkdirSync(officeDir(), { recursive: true });
  fs.writeFileSync(skinFile(), JSON.stringify(s, null, 2));
}
function roomLabels(): string[] {
  try {
    const of = JSON.parse(fs.readFileSync(path.join(officeDir(), 'oficinas.json'), 'utf8')) as { salas?: Array<{ label: string }> };
    return (of.salas ?? []).map((s) => s.label);
  } catch {
    return [];
  }
}

/** Tipo de cada sala: el elegido, o uno por orden (fuego, agua, planta…) para las que no tienen. */
export function roomTypes(skin: SkinFile, data: PokeData): Record<string, string> {
  const out: Record<string, string> = {};
  const labels = roomLabels();
  labels.forEach((label, i) => {
    const chosen = skin.rooms[label];
    out[label] = chosen && data.types[chosen] ? chosen : data.order[i % data.order.length];
  });
  return out;
}

function forget(skin: SkinFile, name: string): void {
  delete skin.agents[name];
  delete skin.paths[name];
  delete skin.seen[name];
}

/** El Pokémon (y su progreso mostrado) acompaña al agente al renombrarlo. */
export function renameSkinAgent(from: string, to: string): void {
  const skin = readSkin();
  if (skin.agents[from] === undefined) return;
  skin.agents[to] = skin.agents[from];
  if (skin.paths[from]) skin.paths[to] = skin.paths[from];
  if (skin.seen[from] !== undefined) skin.seen[to] = skin.seen[from];
  forget(skin, from);
  writeSkin(skin);
}

function parentsOf(data: PokeData): Map<number, number> {
  const parents = new Map<number, number>();
  for (const [id, form] of Object.entries(data.evo)) for (const n of form.next) parents.set(n, Number(id));
  return parents;
}

function rootOf(id: number, parents: Map<number, number>): number {
  let cur = id;
  while (parents.has(cur)) cur = parents.get(cur)!;
  return cur;
}

function leadsTo(from: number, target: number, data: PokeData): boolean {
  if (from === target) return true;
  return (data.evo[from]?.next ?? []).some((n) => leadsTo(n, target, data));
}

/** Formas que recorrerá: pasa por `through` si se indica; en una rama, la de su tipo o una al azar. */
function choosePath(root: number, through: number, list: PokeType['pokemon'], data: PokeData): number[] {
  const path = [root];
  let cur = root;
  for (;;) {
    const next = data.evo[cur]?.next ?? [];
    if (next.length === 0) return path;
    const sameType = next.filter((n) => list.some((p) => p.id === n));
    const pick = next.find((n) => leadsTo(n, through, data)) ?? (sameType.length > 0 ? sameType : next)[Math.floor(Math.random() * (sameType.length || next.length))];
    path.push(pick);
    cur = pick;
  }
}

/** Estado resuelto para la webview y Ajustes. Sortea (y guarda) los agentes sin Pokémon. */
function resolve(): {
  theme: Theme;
  types: Array<{ id: string; es: string; en: string; color: string }>;
  rooms: Record<string, string>;
  agents: Record<string, AgentSkin>;
} {
  const skin = readSkin();
  const data = readData();
  if (!data) return { theme: 'classic', types: [], rooms: {}, agents: {} };
  const types = data.order.map((id) => ({ id, es: data.types[id].es, en: data.types[id].en, color: data.types[id].color }));
  const rooms = roomTypes(skin, data);
  const agents: Record<string, AgentSkin> = {};
  if (skin.theme === 'pokemon') {
    const cfg = readConfig();
    const parents = parentsOf(data);
    const prompts = promptDaysByDir(cfg.directories, activityFile());
    const usedByType = new Map<string, Set<number>>();
    let changed = false;
    const url = (id: number, anim: string) => {
      const f = data.evo[id];
      return data.sprite.replace('{gen}', String(f?.gen ?? 1)).replace('{slug}', f?.slug ?? '').replace('{anim}', anim);
    };
    for (const d of cfg.directories) {
      const room = cfg.standalone.areaMappings[d.name]?.[0];
      const type = (room && rooms[room]) || data.order[0];
      const list = data.types[type].pokemon;
      const used = usedByType.get(type) ?? new Set<number>();
      usedByType.set(type, used);
      // Al azar solo salen primeras formas; quien ya tenía una evolucionada vuelve a la inicial de su familia.
      const stored = skin.agents[d.name];
      let root = stored ? rootOf(stored, parents) : 0;
      let through = stored ?? 0;
      const firsts = list.filter((p) => !parents.has(p.id));
      const free = firsts.filter((p) => !used.has(p.id));
      // Dos agentes que eran de la misma familia: el segundo recibe otra.
      if (!root || !list.some((p) => p.id === root) || (used.has(root) && free.length > 0)) {
        const pool = free.length > 0 ? free : firsts;
        root = pool[Math.floor(Math.random() * pool.length)].id;
        through = root;
        delete skin.paths[d.name];
        delete skin.seen[d.name];
      }
      if (stored !== root) {
        skin.agents[d.name] = root;
        changed = true;
      }
      used.add(root);
      let path = skin.paths[d.name];
      if (path?.[0] !== root || !path.every((id) => data.evo[id])) {
        path = choosePath(root, through, list, data);
        skin.paths[d.name] = path;
        changed = true;
      }
      const xp = xpFromDays(prompts[d.name]);
      const level = levelForXp(xp);
      const stage = stageForLevel(level, path.length);
      // La primera vez se parte de la forma que ya corresponde, sin animación.
      const seen = Math.min(skin.seen[d.name] ?? stage, stage);
      if (skin.seen[d.name] !== seen) {
        skin.seen[d.name] = seen;
        changed = true;
      }
      const id = path[seen];
      const nextLevel = evolutionLevels(path.length)[seen];
      agents[d.name] = {
        type,
        id,
        name: data.evo[id].name,
        // Sprites animados (GIF 32x32, 8 fps) del proyecto vscode-pokemon: quieto y caminando.
        sprite: url(id, 'idle'),
        walk: url(id, 'walk'),
        level,
        xp,
        levelXp: xpForLevel(level),
        nextXp: level >= MAX_LEVEL ? xp : xpForLevel(level + 1),
        evolvesAt: nextLevel ?? null,
        ...(stage > seen
          ? { evolving: { fromName: data.evo[id].name, from: url(id, 'idle'), toName: data.evo[path[seen + 1]].name, to: url(path[seen + 1], 'idle'), stage: seen + 1 } }
          : {}),
      };
    }
    if (changed) writeSkin(skin);
  }
  return { theme: skin.theme, types, rooms, agents };
}

export function registerSkinRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  app.get('/api/skin', async () => resolve());
  // La animación de evolución ya se mostró: el agente pasa a esa forma.
  app.post<{ Body: { agent?: string; stage?: number } }>('/api/skin/evolved', { preHandler: bearerAuth(options.token) }, async (request, reply) => {
    const { agent, stage } = request.body ?? {};
    if (!agent || typeof stage !== 'number') return reply.code(400).send({ error: 'falta agent o stage' });
    const skin = readSkin();
    skin.seen[agent] = Math.max(skin.seen[agent] ?? 0, stage);
    writeSkin(skin);
    return reply.send(resolve());
  });
  // Cambiar tema, tipo de una sala o volver a sortear agentes. Luego `proyecto.py aplicar`
  // recolorea las salas (colores y pisos por tipo) y lo empuja a la oficina en vivo.
  app.put<{ Body: { theme?: string; rooms?: Record<string, string>; reshuffle?: string[] | 'all' } }>(
    '/api/skin',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const b = request.body ?? {};
      const skin = readSkin();
      const data = readData();
      if (!data) return reply.code(503).send({ error: 'falta scripts/pokemon.json' });
      if (b.theme !== undefined) {
        if (b.theme !== 'classic' && b.theme !== 'pokemon') return reply.code(400).send({ error: 'theme debe ser classic o pokemon' });
        skin.theme = b.theme;
      }
      if (b.rooms) {
        for (const [label, type] of Object.entries(b.rooms)) {
          if (!data.types[type]) return reply.code(400).send({ error: `tipo desconocido: ${type}` });
          skin.rooms[label] = type;
          // Cambia el tipo de la sala: sus agentes se vuelven a sortear.
          const cfg = readConfig();
          for (const d of cfg.directories) if (cfg.standalone.areaMappings[d.name]?.[0] === label) forget(skin, d.name);
        }
      }
      if (b.reshuffle === 'all') {
        skin.agents = {};
        skin.paths = {};
        skin.seen = {};
      } else if (Array.isArray(b.reshuffle)) for (const n of b.reshuffle) forget(skin, n);
      writeSkin(skin);
      const out = resolve();
      void runProyecto(options, ['aplicar']).then((r) => {
        if (!r.ok) console.warn('[skin] aplicar falló:', r.log.slice(-400));
      });
      return reply.send(out);
    },
  );
}
