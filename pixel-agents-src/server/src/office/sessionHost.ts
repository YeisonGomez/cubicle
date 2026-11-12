/**
 * Dónde viven las sesiones: en las terminales de Cubicle (por defecto) o en la app de
 * escritorio de Claude. Con la app, Cubicle no abre terminales: observa las sesiones
 * (estado, actividad, pantalla externa) y "abrir un agente" es abrirlo en la app con
 * `claude://resume?session=<id>`, que importa la conversación de Claude Code tal cual
 * (mismo id y mismo transcript) y toma el nombre del título de la sesión.
 *
 *   GET /api/session-host          → { host, moving, results }
 *   PUT /api/session-host {host}   → cambia el modo y mueve las sesiones (en segundo plano)
 *
 * Una conversación no puede estar viva en los dos lados: al pasar a la app se cierra la
 * terminal de Cubicle (tras escribirle `/rename <nombre>` para que la app la muestre con
 * ese nombre); al volver a Cubicle se relanza lo que ya no esté abierto en la app.
 */
import { execFile } from 'child_process';
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';

import type { AgentStateStore } from '../agentStateStore.js';
import { readConfig } from '../configPersistence.js';
import type { HttpServerOptions } from '../httpServer.js';
import { officeDir } from '../officePaths.js';
import { readRememberedSessions, relaunchAll, rememberSessions } from '../terminal/relaunch.js';
import { bearerAuth, launchDeps } from './shared.js';

export type SessionHost = 'cubicle' | 'claude-app';

export interface MoveResult {
  directory: string;
  /** moved = abierta en el destino; skipped = se quedó donde estaba (motivo en `reason`). */
  outcome: 'moved' | 'skipped';
  reason?: 'working' | 'no-session' | 'open-elsewhere' | 'failed';
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Un transcript tocado hace menos de esto = el agente está a mitad de un turno. */
const BUSY_MS = 20_000;
const RENAME_SETTLE_MS = 1500;
const CLOSE_SETTLE_MS = 1000;
const IMPORT_GAP_MS = 2500;

const hostFile = (): string => path.join(officeDir(), 'sesiones-host.json');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function getSessionHost(): SessionHost {
  try {
    const raw = JSON.parse(fs.readFileSync(hostFile(), 'utf8')) as { host?: unknown };
    return raw.host === 'claude-app' ? 'claude-app' : 'cubicle';
  } catch {
    return 'cubicle';
  }
}

function setSessionHost(host: SessionHost): void {
  fs.mkdirSync(officeDir(), { recursive: true });
  fs.writeFileSync(hostFile(), JSON.stringify({ host }, null, 2));
}

/** Abre (e importa, la primera vez) una conversación en la app de Claude. */
export function openInClaudeApp(sessionId: string): boolean {
  // OFICINA_NO_RAISE=1 en pruebas: no tocar las apps del usuario.
  if (!SESSION_ID.test(sessionId) || process.env.OFICINA_NO_RAISE === '1') return false;
  const url = `claude://resume?session=${sessionId}`;
  if (process.platform === 'darwin') execFile('open', [url], () => undefined);
  else if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], () => undefined);
  else execFile('xdg-open', [url], () => undefined);
  return true;
}

/** Conversación de un Directorio: la del agente vivo (con terminal antes que observado) o la recordada. */
export function sessionIdFor(store: AgentStateStore, name: string): string | null {
  const live = [...store.values()].filter((a) => a.directoryName === name).sort((a, b) => Number(a.isExternal) - Number(b.isExternal) || a.id - b.id)[0];
  return live?.sessionId ?? readRememberedSessions()[name] ?? null;
}

let moving = false;
let lastResults: MoveResult[] = [];

/** Cierra cada terminal de Cubicle (con su nombre puesto) y abre su conversación en la app. */
async function moveToClaudeApp(options: HttpServerOptions): Promise<MoveResult[]> {
  const deps = launchDeps(options);
  const results: MoveResult[] = [];
  if (deps) rememberSessions(deps);
  for (const d of readConfig().directories) {
    const agent = deps ? [...options.store.values()].find((a) => !a.isExternal && a.directoryName === d.name && deps.ptyManager.has(a.id)) : undefined;
    let sessionId: string | null;
    if (agent && deps) {
      let mtime = 0;
      try {
        mtime = agent.jsonlFile ? fs.statSync(agent.jsonlFile).mtimeMs : 0;
      } catch {
        /* sin transcript aún */
      }
      if (Date.now() - mtime < BUSY_MS) {
        results.push({ directory: d.name, outcome: 'skipped', reason: 'working' });
        continue;
      }
      // El nombre lo guarda el propio Claude Code en su conversación; la app lo lee al importarla.
      const term = deps.ptyManager.get(agent.id);
      term?.write(`/rename ${d.name.replace(/[\r\n]/g, ' ')}`);
      await sleep(250);
      term?.write('\r');
      await sleep(RENAME_SETTLE_MS);
      sessionId = agent.sessionId;
      options.runtime?.closeAgent(agent.id);
      await sleep(CLOSE_SETTLE_MS);
    } else {
      sessionId = sessionIdFor(options.store, d.name);
    }
    if (!sessionId) {
      results.push({ directory: d.name, outcome: 'skipped', reason: 'no-session' });
      continue;
    }
    results.push(openInClaudeApp(sessionId) ? { directory: d.name, outcome: 'moved' } : { directory: d.name, outcome: 'skipped', reason: 'failed' });
    await sleep(IMPORT_GAP_MS);
  }
  return results;
}

/** Vuelve a abrir en Cubicle lo que ya no esté abierto en la app. */
async function moveToCubicle(options: HttpServerOptions): Promise<MoveResult[]> {
  const deps = launchDeps(options);
  if (!deps) return [];
  const done = await relaunchAll(deps, { bypassPermissions: readConfig().standalone.bypassPermissions, launchNew: false, askCapabilities: false });
  return done.map((r) =>
    r.agentId !== null || r.skipped === 'ya tiene terminal'
      ? { directory: r.directory, outcome: 'moved' as const }
      : { directory: r.directory, outcome: 'skipped' as const, reason: r.skipped === 'conversación abierta fuera de la oficina' ? ('open-elsewhere' as const) : r.skipped === 'sin sesiones previas' ? ('no-session' as const) : ('failed' as const) },
  );
}

export function registerSessionHostRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  app.get('/api/session-host', { preHandler: bearerAuth(options.token) }, async () => ({ host: getSessionHost(), moving, results: lastResults }));
  app.put<{ Body: { host?: unknown } }>('/api/session-host', { preHandler: bearerAuth(options.token) }, async (request, reply) => {
    const host = request.body?.host;
    if (host !== 'cubicle' && host !== 'claude-app') return reply.code(400).send({ error: 'host debe ser cubicle o claude-app' });
    if (moving) return reply.code(409).send({ error: 'ya se están moviendo las sesiones' });
    setSessionHost(host);
    moving = true;
    lastResults = [];
    void (host === 'claude-app' ? moveToClaudeApp(options) : moveToCubicle(options))
      .then((r) => {
        lastResults = r;
      })
      .catch((e) => console.error('[Cubicle] No se pudieron mover las sesiones:', e))
      .finally(() => {
        moving = false;
      });
    return reply.send({ host, moving: true, results: [] });
  });
}
