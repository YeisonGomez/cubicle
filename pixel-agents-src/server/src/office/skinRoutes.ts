/**
 * Skins de personajes. Tema "classic" (muñecos de Pixel Agents, con rangos) o "pokemon":
 * cada sala es un tipo (fuego, agua…) con su color y su piso. El primer agente de cada
 * proyecto recibe un inicial del juego (luego, cadenas de 3 formas, en orden) y los demás,
 * un Pokémon al azar del tipo de su sala. Datos en scripts/pokemon.json. La asignación se
 * guarda en `<oficina>/skin.json` y solo cambia si el usuario lo pide: ni cambiar de tema,
 * ni mover agentes o salas la vuelve a sortear. Los sprites se cargan en el navegador.
 */
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';

import { promptDaysByDir } from '../activityStats.js';
import { readConfig } from '../configPersistence.js';
import type { HttpServerOptions } from '../httpServer.js';
import { activityFile, officeDir, scriptsDir } from '../officePaths.js';
import { evolutionLevels, levelForXp, MAX_LEVEL, stageForLevel, xpForLevel, xpFromDays } from '../pokemonXp.js';
import { nextRankLevel, rankForLevel } from '../ranks.js';
import { bearerAuth, runProyecto } from './shared.js';

type Theme = 'classic' | 'pokemon';
/** Iniciales de 1.ª y 2.ª generación. */
const STARTERS = [1, 4, 7, 152, 155, 158];
/** Sube al cambiar las reglas de asignación: las asignaciones anteriores se rehacen una vez. */
const ASSIGN_VERSION = 2;
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
export interface PokeData {
  order: string[];
  types: Record<string, PokeType>;
  sprite: string;
  /** Cadenas de evolución: id -> forma y sus siguientes. */
  evo: Record<string, PokeForm>;
}
export interface SkinFile {
  theme: Theme;
  rooms: Record<string, string>;
  /** Pokémon inicial de cada agente (siempre la primera forma de su cadena). */
  agents: Record<string, number>;
  /** Formas que recorre, fijadas una vez (Eevee y otros tienen varias ramas). */
  paths: Record<string, number[]>;
  /** Forma que ya se mostró; si el nivel da más, toca la animación de evolución. */
  seen: Record<string, number>;
  /** Último rango mostrado (tema clásico); si el nivel da más, toca la animación de ascenso. */
  rankSeen: Record<string, number>;
  assignVersion?: number;
}
/** Progreso del agente en el tema clásico. */
export interface AgentRank {
  level: number;
  xp: number;
  levelXp: number;
  nextXp: number;
  rank: number;
  nextRankAt: number | null;
  promoted?: { rank: number };
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
    return { theme: j.theme === 'pokemon' ? 'pokemon' : 'classic', rooms: j.rooms ?? {}, agents: j.agents ?? {}, paths: j.paths ?? {}, seen: j.seen ?? {}, rankSeen: j.rankSeen ?? {}, assignVersion: j.assignVersion };
  } catch {
    return { theme: 'classic', rooms: {}, agents: {}, paths: {}, seen: {}, rankSeen: {} };
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

/**
 * Tipo de cada sala: el elegido o, la primera vez, el que le toca por orden (fuego, agua,
 * planta…). Se guarda: si dependiera de la posición, añadir una sala cambiaría las demás.
 * Devuelve si asignó alguno.
 */
export function freezeRoomTypes(skin: SkinFile, data: PokeData, labels: string[]): boolean {
  let changed = false;
  labels.forEach((label, i) => {
    if (data.types[skin.rooms[label]]) return;
    const taken = new Set(Object.values(skin.rooms));
    const byOrder = data.order[i % data.order.length];
    skin.rooms[label] = taken.has(byOrder) ? (data.order.find((t) => !taken.has(t)) ?? byOrder) : byOrder;
    changed = true;
  });
  return changed;
}

function forget(skin: SkinFile, name: string): void {
  delete skin.agents[name];
  delete skin.paths[name];
  delete skin.seen[name];
}

/** El Pokémon (y su progreso mostrado) acompaña al agente al renombrarlo. */
export function renameSkinAgent(from: string, to: string): void {
  const skin = readSkin();
  if (skin.agents[from] !== undefined) skin.agents[to] = skin.agents[from];
  if (skin.paths[from]) skin.paths[to] = skin.paths[from];
  if (skin.seen[from] !== undefined) skin.seen[to] = skin.seen[from];
  if (skin.rankSeen[from] !== undefined) skin.rankSeen[to] = skin.rankSeen[from];
  forget(skin, from);
  delete skin.rankSeen[from];
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

function chainLength(id: number, data: PokeData): number {
  const next = data.evo[id]?.next ?? [];
  return 1 + (next.length > 0 ? Math.max(...next.map((n) => chainLength(n, data))) : 0);
}

/**
 * Da Pokémon a los agentes que no lo tienen; a los demás no los toca. El primero de una sala
 * sin Pokémon recibe un inicial libre (de su tipo si queda alguno) y, agotados, una cadena de
 * 3 formas en orden (también de su tipo primero). El resto, al azar entre las primeras formas
 * de su tipo. Devuelve si asignó alguno.
 */
export function assignPokemon(
  skin: SkinFile,
  data: PokeData,
  dirs: Array<{ name: string; room?: string }>,
  rooms: Record<string, string>,
  roomOrder: string[],
  random: () => number = Math.random,
): boolean {
  const parents = parentsOf(data);
  const stored = (name: string) => (data.evo[skin.agents[name]] ? skin.agents[name] : undefined);
  const used = new Set<number>();
  for (const d of dirs) {
    const id = stored(d.name);
    if (id) used.add(rootOf(id, parents));
  }
  let changed = false;
  const give = (name: string, id: number) => {
    skin.agents[name] = id;
    delete skin.paths[name];
    delete skin.seen[name];
    used.add(id);
    changed = true;
  };
  const typeOf = (room?: string) => data.types[(room && rooms[room]) || data.order[0]];
  const roots = Object.keys(data.evo)
    .map(Number)
    .filter((id) => !parents.has(id))
    .sort((a, b) => a - b);
  for (const room of roomOrder) {
    const members = dirs.filter((d) => d.room === room);
    if (members.length === 0 || members.some((d) => stored(d.name))) continue;
    const inType = (id: number) => typeOf(room).pokemon.some((p) => p.id === id);
    const free = (id: number) => !used.has(id);
    const starters = STARTERS.filter((id) => data.evo[id] && free(id));
    const chains = roots.filter((id) => free(id) && !STARTERS.includes(id) && chainLength(id, data) >= 3);
    const pick = starters.find(inType) ?? starters[0] ?? chains.find(inType) ?? chains[0];
    if (pick) give(members[0].name, pick);
  }
  for (const d of dirs) {
    if (stored(d.name)) continue;
    const firsts = typeOf(d.room).pokemon.filter((p) => !parents.has(p.id));
    const others = firsts.filter((p) => !STARTERS.includes(p.id));
    const pool = others.length > 0 ? others : firsts;
    const free = pool.filter((p) => !used.has(p.id));
    const from = free.length > 0 ? free : pool;
    give(d.name, from[Math.floor(random() * from.length)].id);
  }
  return changed;
}

/** Estado resuelto para la webview y Ajustes. Asigna (y guarda) lo que falte. */
function resolve(): {
  theme: Theme;
  types: Array<{ id: string; es: string; en: string; color: string }>;
  rooms: Record<string, string>;
  agents: Record<string, AgentSkin>;
  ranks: Record<string, AgentRank>;
} {
  const skin = readSkin();
  const data = readData();
  if (!data) return { theme: 'classic', types: [], rooms: {}, agents: {}, ranks: {} };
  const types = data.order.map((id) => ({ id, es: data.types[id].es, en: data.types[id].en, color: data.types[id].color }));
  const labels = roomLabels();
  const cfg = readConfig();
  let changed = false;
  if (skin.assignVersion !== ASSIGN_VERSION) {
    skin.assignVersion = ASSIGN_VERSION;
    skin.agents = {};
    skin.paths = {};
    skin.seen = {};
    changed = true;
  }
  if (freezeRoomTypes(skin, data, labels)) changed = true;
  const rooms: Record<string, string> = {};
  for (const label of labels) rooms[label] = skin.rooms[label];
  // Se asigna con cualquier tema: así cambiar de tema nunca deja nada por decidir.
  const dirs = cfg.directories.map((d) => ({ name: d.name, room: cfg.standalone.areaMappings[d.name]?.[0] }));
  if (assignPokemon(skin, data, dirs, rooms, labels)) changed = true;
  const agents: Record<string, AgentSkin> = {};
  const ranks: Record<string, AgentRank> = {};
  const parents = parentsOf(data);
  const prompts = promptDaysByDir(cfg.directories, activityFile());
  const url = (id: number, anim: string) => {
    const f = data.evo[id];
    return data.sprite.replace('{gen}', String(f?.gen ?? 1)).replace('{slug}', f?.slug ?? '').replace('{anim}', anim);
  };
  for (const d of dirs) {
    const type = (d.room && rooms[d.room]) || data.order[0];
    const list = data.types[type].pokemon;
    const stored = skin.agents[d.name];
    // Quien tenía una forma evolucionada guardada vuelve a la inicial de su familia, por ese camino.
    const root = rootOf(stored, parents);
    if (stored !== root) {
      skin.agents[d.name] = root;
      changed = true;
    }
    let path = skin.paths[d.name];
    if (path?.[0] !== root || !path.every((id) => data.evo[id])) {
      path = choosePath(root, stored, list, data);
      skin.paths[d.name] = path;
      changed = true;
    }
    const xp = xpFromDays(prompts[d.name]);
    const level = levelForXp(xp);
    const progress = { level, xp, levelXp: xpForLevel(level), nextXp: level >= MAX_LEVEL ? xp : xpForLevel(level + 1) };
    const stage = stageForLevel(level, path.length);
    // La primera vez se parte de la forma y el rango que ya corresponden, sin animación.
    const seen = Math.min(skin.seen[d.name] ?? stage, stage);
    if (skin.seen[d.name] !== seen) {
      skin.seen[d.name] = seen;
      changed = true;
    }
    const rank = rankForLevel(level);
    const rankSeen = Math.min(skin.rankSeen[d.name] ?? rank, rank);
    if (skin.rankSeen[d.name] !== rankSeen) {
      skin.rankSeen[d.name] = rankSeen;
      changed = true;
    }
    if (skin.theme === 'classic') {
      ranks[d.name] = { ...progress, rank, nextRankAt: nextRankLevel(rank), ...(rank > rankSeen ? { promoted: { rank } } : {}) };
      continue;
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
      ...progress,
      evolvesAt: nextLevel ?? null,
      ...(stage > seen
        ? { evolving: { fromName: data.evo[id].name, from: url(id, 'idle'), toName: data.evo[path[seen + 1]].name, to: url(path[seen + 1], 'idle'), stage: seen + 1 } }
        : {}),
    };
  }
  if (changed) writeSkin(skin);
  return { theme: skin.theme, types, rooms, agents, ranks };
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
  // La animación de ascenso ya se mostró.
  app.post<{ Body: { agent?: string; rank?: number } }>('/api/skin/promoted', { preHandler: bearerAuth(options.token) }, async (request, reply) => {
    const { agent, rank } = request.body ?? {};
    if (!agent || typeof rank !== 'number') return reply.code(400).send({ error: 'falta agent o rank' });
    const skin = readSkin();
    skin.rankSeen[agent] = Math.max(skin.rankSeen[agent] ?? 0, rank);
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
