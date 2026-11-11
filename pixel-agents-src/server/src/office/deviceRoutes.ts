/**
 * Pantalla externa (p. ej. una ESP32 con LCD táctil) en la red local: ve los
 * agentes y su estado y, al tocar uno, lo abre en el computador.
 *
 * Es un servidor HTTP APARTE y mínimo, nunca el de la oficina: el de la oficina
 * lleva la terminal (una shell) y solo escucha en 127.0.0.1. Este solo expone
 * dos rutas, pide una clave propia (cabecera `X-Cubicle-Key`) y está apagado
 * hasta que `oficina/dispositivo.json` tenga `"enabled": true`.
 *
 *   GET  /device/agents          → { agents: [{ id, name, room, color, status, pokemon?, sprite? }] }
 *   GET  /device/sprite/:n       → sprite animado del Pokémon n, listo para dibujar (deviceSprites.ts)
 *   POST /device/open  {"id": n} → la webview abre ese agente y el navegador pasa al frente
 *
 * "Te necesita" (terminó o pregunta y aún no lo has mirado) lo decide la webview: lo
 * sube con PUT /api/device/attention (servidor de la oficina, con token) y aquí se marca.
 */
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

import { promptDaysByAgent } from '../agentPromptDays.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { readConfig } from '../configPersistence.js';
import type { HttpServerOptions } from '../httpServer.js';
import { activityFile, officeDir } from '../officePaths.js';
import { spriteFor } from './deviceSprites.js';
import { bearerAuth } from './shared.js';
import { resolveSkin } from './skinRoutes.js';

export const DEVICE_PORT_DEFAULT = 3101;
/** Color de una sala sin color propio (gris neutro). */
// eslint-disable-next-line pixel-agents/no-inline-colors -- color de datos (salas), no de la UI
const ROOM_COLOR_FALLBACK = '#888888';

interface DeviceConfig {
  enabled: boolean;
  key: string;
  port: number;
}

export type DeviceStatus = 'working' | 'permission' | 'question' | 'idle';

export interface DeviceAgent {
  id: number;
  name: string;
  room: string;
  color: string;
  status: DeviceStatus;
  pokemon?: string;
  /** Id del Pokémon: la placa pide su sprite a /device/sprite/:id. */
  sprite?: number;
  /** Seleccionado en la oficina. */
  selected?: boolean;
}

/** Agentes que la oficina muestra como "Te necesita" (pendientes de mirar). */
let attention = new Set<number>();
/** Agente seleccionado en la oficina (la pantalla lo resalta). */
let selectedId: number | null = null;
export function setDeviceAttention(ids: number[], selected: number | null = null): void {
  attention = new Set(ids.filter((n) => Number.isInteger(n)));
  selectedId = selected;
}

/** Estado para la pantalla: el del agente y, si está libre pero pendiente de mirar, "Te necesita". */
export function effectiveStatus(status: DeviceStatus, id: number, pending: ReadonlySet<number> = attention): DeviceStatus {
  return status === 'idle' && pending.has(id) ? 'question' : status;
}

/** PUT /api/device/attention {ids, selected}: la webview sube sus pendientes y el seleccionado. */
export function registerDeviceRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  app.put<{ Body: { ids?: unknown; selected?: unknown } }>('/api/device/attention', { preHandler: bearerAuth(options.token) }, async (request, reply) => {
    const ids = Array.isArray(request.body?.ids) ? (request.body.ids as unknown[]).filter((n): n is number => typeof n === 'number') : [];
    const sel = request.body?.selected;
    setDeviceAttention(ids, typeof sel === 'number' ? sel : null);
    return reply.send({ ok: true });
  });
}

const configFile = (): string => path.join(officeDir(), 'dispositivo.json');

/** Lee la config; si está activada y sin clave, genera una y la guarda. */
export function readDeviceConfig(): DeviceConfig | null {
  let raw: Partial<DeviceConfig>;
  try {
    raw = JSON.parse(fs.readFileSync(configFile(), 'utf8')) as Partial<DeviceConfig>;
  } catch {
    return null;
  }
  if (raw.enabled !== true) return null;
  const cfg: DeviceConfig = {
    enabled: true,
    key: typeof raw.key === 'string' && raw.key.length >= 16 ? raw.key : crypto.randomBytes(16).toString('hex'),
    port: Number.isInteger(raw.port) ? (raw.port as number) : DEVICE_PORT_DEFAULT,
  };
  if (cfg.key !== raw.key || cfg.port !== raw.port) fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2));
  return cfg;
}

/** Comparación en tiempo constante de la clave. */
export function keyMatches(given: string | string[] | undefined, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Estado de cada agente tal como lo ve la oficina: se deduce de los mismos mensajes
 * que recibe la webview (sin mensajes aún = Libre, como el punto vacío de la ficha).
 * Leer `isWaiting` del agente no sirve: al reanudar vale false y salían todos "Trabajando".
 */
export class DeviceStatusTracker {
  private readonly statuses = new Map<number, DeviceStatus>();

  onMessage(m: Record<string, unknown>): void {
    const id = m.id;
    if (typeof id !== 'number') return;
    switch (m.type) {
      case 'agentStatus':
        if (m.status === 'active') this.statuses.set(id, 'working');
        else if (m.status === 'waiting') this.statuses.set(id, 'idle');
        break;
      case 'agentToolStart':
        if (m.runInBackground !== true) this.statuses.set(id, m.permissionActive === true ? 'permission' : 'working');
        break;
      case 'agentToolPermission':
        this.statuses.set(id, 'permission');
        break;
      case 'agentToolPermissionClear':
        if (this.statuses.get(id) === 'permission') this.statuses.set(id, 'working');
        break;
      case 'agentClosed':
        this.statuses.delete(id);
        break;
    }
  }

  get(id: number): DeviceStatus {
    return this.statuses.get(id) ?? 'idle';
  }
}

function rooms(): Map<string, string> {
  try {
    const of = JSON.parse(fs.readFileSync(path.join(officeDir(), 'oficinas.json'), 'utf8')) as { salas?: Array<{ label: string; color?: string }> };
    return new Map((of.salas ?? []).map((s) => [s.label, s.color ?? ROOM_COLOR_FALLBACK]));
  } catch {
    return new Map();
  }
}

/** Uso de cada agente: prompts de los últimos 30 días y en total. */
export interface Usage {
  recent: number;
  total: number;
}
const USAGE_TTL_MS = 5 * 60_000;
const RECENT_DAYS = 30;
let usageCache: { at: number; usage: Map<string, Usage> } | null = null;

function usageByAgent(): Map<string, Usage> {
  if (usageCache && Date.now() - usageCache.at < USAGE_TTL_MS) return usageCache.usage;
  const usage = new Map<string, Usage>();
  try {
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
    const days = promptDaysByAgent(readConfig().directories, activityFile());
    for (const [name, byDay] of Object.entries(days)) {
      let recent = 0;
      let total = 0;
      for (const [day, n] of Object.entries(byDay)) {
        total += n;
        if (day >= since) recent += n;
      }
      usage.set(name, { recent, total });
    }
  } catch {
    /* sin actividad: todos a cero */
  }
  usageCache = { at: Date.now(), usage };
  return usage;
}

/**
 * Orden de la pantalla: salas de más a menos usadas (prompts recientes y luego totales)
 * y, dentro de cada sala, sus agentes igual; los agentes de una sala quedan juntos.
 */
export function sortByUsage<T extends { name: string; room: string }>(list: T[], usage: Map<string, Usage>): T[] {
  const zero: Usage = { recent: 0, total: 0 };
  const rooms = new Map<string, Usage>();
  for (const a of list) {
    const u = usage.get(a.name) ?? zero;
    const r = rooms.get(a.room) ?? { recent: 0, total: 0 };
    rooms.set(a.room, { recent: r.recent + u.recent, total: r.total + u.total });
  }
  const cmp = (x: Usage, y: Usage) => y.recent - x.recent || y.total - x.total;
  return [...list].sort(
    (a, b) =>
      cmp(rooms.get(a.room) ?? zero, rooms.get(b.room) ?? zero) ||
      a.room.localeCompare(b.room) ||
      cmp(usage.get(a.name) ?? zero, usage.get(b.name) ?? zero) ||
      a.name.localeCompare(b.name),
  );
}

/** Agentes con nombre (uno por Directorio: el de id más bajo), agrupados por sala y ordenados por uso. */
export function listDeviceAgents(store: AgentStateStore, tracker: DeviceStatusTracker, areaOf: (name: string) => string | undefined): DeviceAgent[] {
  const colors = rooms();
  let pokemon: Record<string, { name: string; id: number }> = {};
  try {
    const skin = resolveSkin();
    if (skin.theme === 'pokemon') pokemon = skin.agents;
  } catch {
    /* sin skin */
  }
  const byName = new Map<string, DeviceAgent>();
  for (const a of store.values()) {
    const name = a.directoryName;
    if (!name || (byName.get(name)?.id ?? Infinity) < a.id) continue;
    const room = areaOf(name) ?? '';
    byName.set(name, { id: a.id, name, room, color: colors.get(room) ?? ROOM_COLOR_FALLBACK, status: effectiveStatus(tracker.get(a.id), a.id), ...(pokemon[name] ? { pokemon: pokemon[name].name, sprite: pokemon[name].id } : {}), ...(a.id === selectedId ? { selected: true } : {}) });
  }
  return sortByUsage([...byName.values()], usageByAgent());
}

/** macOS: pone al frente la pestaña de Cubicle en Chrome (o lo abre en el navegador). */
function raiseBrowser(officePort: number): void {
  // OFICINA_NO_RAISE=1 en pruebas: no tocar el navegador del usuario.
  if (process.platform !== 'darwin' || process.env.OFICINA_NO_RAISE === '1') return;
  const script = `
    set found to false
    if application "Google Chrome" is running then
      tell application "Google Chrome"
        repeat with w in windows
          set i to 0
          repeat with t in tabs of w
            set i to i + 1
            if (URL of t contains "127.0.0.1:${officePort}") or (URL of t contains "localhost:${officePort}") then
              set active tab index of w to i
              set index of w to 1
              activate
              set found to true
              exit repeat
            end if
          end repeat
          if found then exit repeat
        end repeat
      end tell
    end if
    return found`;
  execFile('osascript', ['-e', script], { timeout: 5000 }, (err, stdout) => {
    if (err || stdout.trim() !== 'true') execFile('open', [`http://127.0.0.1:${officePort}/`], () => undefined);
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c: Buffer) => {
      body += c.toString();
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => resolve(body));
    req.on('error', () => resolve(''));
  });
}

/** Arranca el servidor de la pantalla si está activado. Devuelve el servidor o null. */
export function startDeviceServer(store: AgentStateStore, officePort: number, areaOf: (name: string) => string | undefined): http.Server | null {
  const cfg = readDeviceConfig();
  if (!cfg) return null;
  const tracker = new DeviceStatusTracker();
  store.on('broadcast', (m: Record<string, unknown>) => tracker.onMessage(m));
  const send = (res: http.ServerResponse, code: number, data: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer((req, res) => {
    void (async () => {
      if (!keyMatches(req.headers['x-cubicle-key'], cfg.key)) return send(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET' && req.url === '/device/agents') {
        return send(res, 200, { agents: listDeviceAgents(store, tracker, areaOf) });
      }
      const sprite = req.method === 'GET' ? /^\/device\/sprite\/(\d+)$/.exec(req.url ?? '') : null;
      if (sprite) {
        const id = Number(sprite[1]);
        const url = Object.values(resolveSkin().agents).find((a) => a.id === id)?.sprite;
        const data = url ? await spriteFor(url) : null;
        if (!data) return send(res, 404, { error: 'sprite not found' });
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'max-age=86400' });
        return res.end(data);
      }
      if (req.method === 'POST' && req.url === '/device/open') {
        let id: unknown;
        try {
          id = (JSON.parse(await readBody(req)) as { id?: unknown }).id;
        } catch {
          id = undefined;
        }
        if (typeof id !== 'number' || !store.has(id)) return send(res, 404, { error: 'agent not found' });
        store.broadcast({ type: 'deviceOpenAgent', id });
        raiseBrowser(officePort);
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'not found' });
    })();
  });
  server.on('error', (e) => console.error(`[Cubicle] Pantalla externa: no se pudo abrir el puerto ${cfg.port}: ${e.message}`));
  server.listen(cfg.port, '0.0.0.0', () => console.log(`[Cubicle] Pantalla externa escuchando en el puerto ${cfg.port}`));
  return server;
}
