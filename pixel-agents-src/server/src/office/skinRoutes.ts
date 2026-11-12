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

import { promptDaysByAgent } from '../agentPromptDays.js';
import { readConfig } from '../configPersistence.js';
import type { HttpServerOptions } from '../httpServer.js';
import { activityFile, officeDir, scriptsDir } from '../officePaths.js';
import { evolutionLevels, levelForXp, MAX_LEVEL, XP_PER_PROMPT, xpForLevel, xpFromDays } from '../pokemonXp.js';
import { nextRankLevel, rankForLevel } from '../ranks.js';
import { bearerAuth, runProyecto } from './shared.js';

type Theme = 'classic' | 'pokemon' | 'yugioh';
const DATA_FILE: Record<Theme, string> = { classic: 'pokemon.json', pokemon: 'pokemon.json', yugioh: 'yugioh.json' };
/** Iniciales de 1.ª y 2.ª generación. */
const POKEMON_STARTERS = [1, 4, 7, 152, 155, 158];
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
  /** Sprites de una sola imagen (PNG): la webview los anima por código. */
  static?: boolean;
  /** Primeras formas que se reparten al primer agente de cada sala (por defecto, los iniciales de Pokémon). */
  starters?: number[];
  /** Formas que flotan en vez de saltar (solo sprites estáticos). */
  fly?: number[];
  /** Prompts para el nivel 100 en este tema (por defecto, PROMPTS_TO_MAX). */
  promptsToMax?: number;
  /** Niveles de evolución por nº de formas de la cadena, p. ej. { "2": [50], "3": [40, 70] }. */
  evoLevels?: Record<string, number[]>;
}
/** Reparto de un tema: tipo de cada sala y personaje de cada agente. */
export interface Assign {
  rooms: Record<string, string>;
  agents: Record<string, number>;
  paths: Record<string, number[]>;
  seen: Record<string, number>;
  assignVersion?: number;
}
export interface SkinFile {
  theme: Theme;
  /** Reparto del tema Yu-Gi-Oh, aparte: cambiar de tema no toca el de Pokémon. */
  yugioh?: Assign;
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
  /** Prompts humanos de este agente en total (el logro que se muestra al ascender). */
  prompts: number;
  levelXp: number;
  nextXp: number;
  rank: number;
  nextRankAt: number | null;
  /** Prompts (y días, por el tope diario) que faltan para el próximo rango; null si no hay más. */
  toNext: ToNext | null;
  promoted?: { rank: number };
}
export interface ToNext {
  prompts: number;
}
/** Prompts que faltan hasta un nivel (sin tope diario: cada prompt suma). */
export function toNextLevel(xp: number, level: number | null | undefined, promptsToMax?: number): ToNext | null {
  if (!level) return null;
  return { prompts: Math.ceil(Math.max(0, xpForLevel(level, promptsToMax) - xp) / XP_PER_PROMPT) };
}
export interface AgentSkin {
  type: string;
  id: number;
  name: string;
  sprite: string;
  walk: string;
  level: number;
  xp: number;
  /** Prompts humanos de este agente en total (el logro que se muestra al evolucionar). */
  prompts: number;
  /** Experiencia al empezar este nivel y para el siguiente (igual a xp en el nivel 100). */
  levelXp: number;
  nextXp: number;
  /** Nivel de la próxima evolución y su forma; null si ya no evoluciona más. */
  evolvesAt: number | null;
  /** Prompts (y días) que faltan para la próxima evolución; null si ya no evoluciona. */
  toNext: ToNext | null;
  evolving?: { fromName: string; from: string; toName: string; to: string; toId: number; stage: number };
  /** Sprite de una sola imagen: se anima por código (respira, salta al caminar). */
  still?: boolean;
  /** Flota en vez de saltar. */
  fly?: boolean;
}

const skinFile = (): string => path.join(officeDir(), 'skin.json');

function readData(theme: Theme = 'pokemon'): PokeData | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(scriptsDir(), DATA_FILE[theme]), 'utf8')) as PokeData;
  } catch {
    return null;
  }
}
export function readSkin(): SkinFile {
  try {
    const j = JSON.parse(fs.readFileSync(skinFile(), 'utf8')) as Partial<SkinFile>;
    return { theme: j.theme === 'pokemon' || j.theme === 'yugioh' ? j.theme : 'classic', yugioh: j.yugioh, rooms: j.rooms ?? {}, agents: j.agents ?? {}, paths: j.paths ?? {}, seen: j.seen ?? {}, rankSeen: j.rankSeen ?? {}, assignVersion: j.assignVersion };
  } catch {
    return { theme: 'classic', rooms: {}, agents: {}, paths: {}, seen: {}, rankSeen: {} };
  }
}
function writeSkin(s: SkinFile): void {
  fs.mkdirSync(officeDir(), { recursive: true });
  fs.writeFileSync(skinFile(), JSON.stringify(s, null, 2));
}
/** Reparto del tema activo (el de Pokémon vive en la raíz del archivo, también con clásico). */
function assignOf(skin: SkinFile): Assign {
  if (skin.theme !== 'yugioh') return skin;
  skin.yugioh ??= { rooms: {}, agents: {}, paths: {}, seen: {} };
  skin.yugioh.rooms ??= {};
  skin.yugioh.agents ??= {};
  skin.yugioh.paths ??= {};
  skin.yugioh.seen ??= {};
  return skin.yugioh;
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
export function freezeRoomTypes(skin: Assign, data: PokeData, labels: string[]): boolean {
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

function forget(skin: Assign, name: string): void {
  delete skin.agents[name];
  delete skin.paths[name];
  delete skin.seen[name];
}

/** El Pokémon (y su progreso mostrado) acompaña al agente al renombrarlo. */
export function renameSkinAgent(from: string, to: string): void {
  const skin = readSkin();
  for (const st of [skin, skin.yugioh]) {
    if (!st?.agents) continue;
    if (st.agents[from] !== undefined) st.agents[to] = st.agents[from];
    if (st.paths?.[from]) st.paths[to] = st.paths[from];
    if (st.seen?.[from] !== undefined) st.seen[to] = st.seen[from];
    forget(st, from);
  }
  if (skin.rankSeen[from] !== undefined) skin.rankSeen[to] = skin.rankSeen[from];
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
  skin: Assign,
  data: PokeData,
  dirs: Array<{ name: string; room?: string }>,
  rooms: Record<string, string>,
  roomOrder: string[],
  random: () => number = Math.random,
): boolean {
  const parents = parentsOf(data);
  const STARTERS = data.starters ?? POKEMON_STARTERS;
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
    // Un tipo sin primeras formas (datos incompletos): cualquiera de las demás.
    const any = Object.values(data.types).flatMap((t) => t.pokemon.filter((p) => !parents.has(p.id)));
    const pool = others.length > 0 ? others : firsts.length > 0 ? firsts : any;
    const free = pool.filter((p) => !used.has(p.id));
    const from = free.length > 0 ? free : pool;
    give(d.name, from[Math.floor(random() * from.length)].id);
  }
  return changed;
}

/** Estado resuelto para la webview y Ajustes. Asigna (y guarda) lo que falte. */
export function resolveSkin(): {
  theme: Theme;
  types: Array<{ id: string; es: string; en: string; color: string }>;
  rooms: Record<string, string>;
  agents: Record<string, AgentSkin>;
  ranks: Record<string, AgentRank>;
} {
  const file = readSkin();
  const data = readData(file.theme);
  const skin = assignOf(file);
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
  const prompts = promptDaysByAgent(cfg.directories, activityFile());
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
    // Cada tema puede poner sus metas (Yu-Gi-Oh las lleva mucho más altas que Pokémon).
    const toMax = data.promptsToMax;
    const evoAt = data.evoLevels?.[String(path.length)] ?? evolutionLevels(path.length);
    const level = levelForXp(xp, toMax);
    const progress = { level, xp, prompts: Math.round(xp / XP_PER_PROMPT), levelXp: xpForLevel(level, toMax), nextXp: level >= MAX_LEVEL ? xp : xpForLevel(level + 1, toMax) };
    const stage = evoAt.filter((l) => level >= l).length;
    // La primera vez se parte de la forma y el rango que ya corresponden, sin animación.
    const seen = Math.min(skin.seen[d.name] ?? stage, stage);
    if (skin.seen[d.name] !== seen) {
      skin.seen[d.name] = seen;
      changed = true;
    }
    const rank = rankForLevel(level);
    const rankSeen = Math.min(file.rankSeen[d.name] ?? rank, rank);
    if (file.rankSeen[d.name] !== rankSeen) {
      file.rankSeen[d.name] = rankSeen;
      changed = true;
    }
    if (file.theme === 'classic') {
      ranks[d.name] = { ...progress, rank, nextRankAt: nextRankLevel(rank), toNext: toNextLevel(xp, nextRankLevel(rank)), ...(rank > rankSeen ? { promoted: { rank } } : {}) };
      continue;
    }
    const id = path[seen];
    const nextLevel = evoAt[seen];
    agents[d.name] = {
      type,
      id,
      name: data.evo[id].name,
      // Sprites animados (GIF 32x32, 8 fps) del proyecto vscode-pokemon: quieto y caminando.
      sprite: url(id, 'idle'),
      walk: url(id, 'walk'),
      ...(data.static ? { still: true } : {}),
      ...(data.fly?.includes(id) ? { fly: true } : {}),
      ...progress,
      evolvesAt: nextLevel ?? null,
      toNext: toNextLevel(xp, nextLevel, toMax),
      ...(stage > seen
        ? { evolving: { fromName: data.evo[id].name, from: url(id, 'idle'), toName: data.evo[path[seen + 1]].name, to: url(path[seen + 1], 'idle'), toId: path[seen + 1], stage: seen + 1 } }
        : {}),
    };
  }
  if (changed) writeSkin(file);
  return { theme: file.theme, types, rooms, agents, ranks };
}

/** La evolución ya se mostró (en la oficina o en la pantalla externa): el agente pasa a esa forma. */
export function markEvolved(agent: string, stage: number): void {
  const file = readSkin();
  const skin = assignOf(file);
  skin.seen[agent] = Math.max(skin.seen[agent] ?? 0, stage);
  writeSkin(file);
}

export function registerSkinRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  app.get('/api/skin', async () => resolveSkin());
  // La animación de evolución ya se mostró: el agente pasa a esa forma.
  app.post<{ Body: { agent?: string; stage?: number } }>('/api/skin/evolved', { preHandler: bearerAuth(options.token) }, async (request, reply) => {
    const { agent, stage } = request.body ?? {};
    if (!agent || typeof stage !== 'number') return reply.code(400).send({ error: 'falta agent o stage' });
    markEvolved(agent, stage);
    return reply.send(resolveSkin());
  });
  // La animación de ascenso ya se mostró.
  app.post<{ Body: { agent?: string; rank?: number } }>('/api/skin/promoted', { preHandler: bearerAuth(options.token) }, async (request, reply) => {
    const { agent, rank } = request.body ?? {};
    if (!agent || typeof rank !== 'number') return reply.code(400).send({ error: 'falta agent o rank' });
    const skin = readSkin();
    skin.rankSeen[agent] = Math.max(skin.rankSeen[agent] ?? 0, rank);
    writeSkin(skin);
    return reply.send(resolveSkin());
  });
  // Cambiar tema, tipo de una sala, volver a sortear agentes o elegir a mano (`assign`). Luego `proyecto.py aplicar`
  // recolorea las salas (colores y pisos por tipo) y lo empuja a la oficina en vivo.
  app.put<{ Body: { theme?: string; rooms?: Record<string, string>; reshuffle?: string[] | 'all'; assign?: Record<string, number> } }>(
    '/api/skin',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const b = request.body ?? {};
      const file = readSkin();
      if (b.theme !== undefined) {
        if (b.theme !== 'classic' && b.theme !== 'pokemon' && b.theme !== 'yugioh') return reply.code(400).send({ error: 'theme debe ser classic, pokemon o yugioh' });
        file.theme = b.theme;
      }
      const data = readData(file.theme);
      if (!data) return reply.code(503).send({ error: `falta scripts/${DATA_FILE[file.theme]}` });
      const skin = assignOf(file);
      // Reparto de una versión anterior (o recién creado): se vacía aquí, antes de aplicar lo pedido;
      // si no, resolveSkin lo vaciaría después y se perdería la elección a mano.
      if (skin.assignVersion !== ASSIGN_VERSION) {
        skin.assignVersion = ASSIGN_VERSION;
        skin.agents = {};
        skin.paths = {};
        skin.seen = {};
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
      // Elección a mano: el agente queda con esa forma exacta (y su cadena); evoluciona desde ahí.
      if (b.assign) {
        const parents = parentsOf(data);
        for (const [name, id] of Object.entries(b.assign)) {
          if (!data.evo[id]) return reply.code(400).send({ error: `forma desconocida: ${id}` });
          const root = rootOf(id, parents);
          const chain = choosePath(root, id, [], data);
          skin.agents[name] = root;
          skin.paths[name] = chain;
          skin.seen[name] = Math.max(0, chain.indexOf(id));
        }
      }
      writeSkin(file);
      const out = resolveSkin();
      void runProyecto(options, ['aplicar']).then((r) => {
        if (!r.ok) console.warn('[skin] aplicar falló:', r.log.slice(-400));
      });
      return reply.send(out);
    },
  );
}
