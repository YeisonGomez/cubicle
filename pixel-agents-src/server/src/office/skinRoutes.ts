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

import { readConfig } from '../configPersistence.js';
import type { HttpServerOptions } from '../httpServer.js';
import { officeDir, scriptsDir } from '../officePaths.js';
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
interface PokeData {
  order: string[];
  types: Record<string, PokeType>;
  sprite: string;
}
interface SkinFile {
  theme: Theme;
  rooms: Record<string, string>;
  agents: Record<string, number>;
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
    return { theme: j.theme === 'pokemon' ? 'pokemon' : 'classic', rooms: j.rooms ?? {}, agents: j.agents ?? {} };
  } catch {
    return { theme: 'classic', rooms: {}, agents: {} };
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

/** Estado resuelto para la webview y Ajustes. Sortea (y guarda) los agentes sin Pokémon. */
function resolve(): {
  theme: Theme;
  types: Array<{ id: string; es: string; en: string; color: string }>;
  rooms: Record<string, string>;
  agents: Record<string, { type: string; id: number; name: string; sprite: string; walk: string }>;
} {
  const skin = readSkin();
  const data = readData();
  if (!data) return { theme: 'classic', types: [], rooms: {}, agents: {} };
  const types = data.order.map((id) => ({ id, es: data.types[id].es, en: data.types[id].en, color: data.types[id].color }));
  const rooms = roomTypes(skin, data);
  const agents: Record<string, { type: string; id: number; name: string; sprite: string; walk: string }> = {};
  if (skin.theme === 'pokemon') {
    const cfg = readConfig();
    const usedByType = new Map<string, Set<number>>();
    let changed = false;
    for (const d of cfg.directories) {
      const room = cfg.standalone.areaMappings[d.name]?.[0];
      const type = (room && rooms[room]) || data.order[0];
      const list = data.types[type].pokemon;
      const used = usedByType.get(type) ?? new Set<number>();
      usedByType.set(type, used);
      let id = skin.agents[d.name];
      if (!id || !list.some((p) => p.id === id)) {
        const free = list.filter((p) => !used.has(p.id));
        const pool = free.length > 0 ? free : list;
        id = pool[Math.floor(Math.random() * pool.length)].id;
        skin.agents[d.name] = id;
        changed = true;
      }
      used.add(id);
      const pk = list.find((p) => p.id === id);
      const name = pk?.name ?? `#${id}`;
      // Sprites animados (GIF 32x32, 8 fps) del proyecto vscode-pokemon: quieto y caminando.
      const url = (anim: string) => data.sprite.replace('{gen}', String(pk?.gen ?? 1)).replace('{slug}', pk?.slug ?? '').replace('{anim}', anim);
      agents[d.name] = { type, id, name, sprite: url('idle'), walk: url('walk') };
    }
    if (changed) writeSkin(skin);
  }
  return { theme: skin.theme, types, rooms, agents };
}

export function registerSkinRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  app.get('/api/skin', async () => resolve());
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
          for (const d of cfg.directories) if (cfg.standalone.areaMappings[d.name]?.[0] === label) delete skin.agents[d.name];
        }
      }
      if (b.reshuffle === 'all') skin.agents = {};
      else if (Array.isArray(b.reshuffle)) for (const n of b.reshuffle) delete skin.agents[n];
      writeSkin(skin);
      const out = resolve();
      void runProyecto(options, ['aplicar']).then((r) => {
        if (!r.ok) console.warn('[skin] aplicar falló:', r.log.slice(-400));
      });
      return reply.send(out);
    },
  );
}
