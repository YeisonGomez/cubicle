/** Utilidades compartidas por las rutas de la oficina (server/src/office/*). */
import { execFile } from 'child_process';
import type { FastifyReply, FastifyRequest } from 'fastify';
import * as os from 'os';
import * as path from 'path';

import type { HttpServerOptions } from '../httpServer.js';
import { scriptsDir } from '../officePaths.js';
import { claudeProvider } from '../providers/index.js';
import type { LaunchStandaloneAgentDeps } from '../terminal/standaloneAgentLauncher.js';
import { bearerTokenValid } from '../wsAuth.js';

export const HOME = os.homedir();

/** Solo se opera dentro del home del usuario. */
export const insideHome = (p: string): boolean => p === HOME || p.startsWith(HOME + path.sep);

export function bearerAuth(expectedToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!bearerTokenValid(request.headers.authorization, expectedToken)) {
      reply.code(401).send('unauthorized');
    }
  };
}

/** Puerto real en escucha (proyecto.py empuja el layout a ESTE servidor). */
let listeningPort = 0;
export function setListeningPort(port: number): void {
  listeningPort = port;
}

/** Escritorios de una sala según sus agentes (misma regla que gen_layout.py). */
export const desksFor = (n: number): number => (n <= 3 ? Math.max(2, Math.min(3, n)) : Math.min(6, n));

/** Ejecuta `scripts/proyecto.py <args>` apuntando a este servidor. */
export function runProyecto(options: HttpServerOptions, args: string[]): Promise<{ ok: boolean; log: string }> {
  return new Promise((resolve) => {
    const cli = path.join(scriptsDir(), 'proyecto.py');
    const env = { ...process.env, OFICINA_URL: `http://127.0.0.1:${listeningPort || options.port || 3100}` };
    execFile('python3', [cli, ...args], { env, timeout: 120_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, log: `${stdout}${stderr}${err ? `\n${err.message}` : ''}` });
    });
  });
}

/** Dependencias para lanzar/relanzar agentes, o null si no hay terminal. */
export function launchDeps(options: HttpServerOptions): LaunchStandaloneAgentDeps | null {
  if (!options.runtime || !options.ptyManager) return null;
  return { store: options.store, runtime: options.runtime, ptyManager: options.ptyManager, provider: claudeProvider };
}

/** Escribe un prompt en la terminal viva de un agente (texto + Enter). */
export async function writePromptToAgent(options: HttpServerOptions, name: string, text: string): Promise<{ ok: boolean; error?: string; agentId?: number }> {
  const clean = text.replace(/\r?\n/g, ' ').trim();
  if (!clean) return { ok: false, error: 'prompt vacío' };
  const deps = launchDeps(options);
  const agent = deps ? [...options.store.values()].find((a) => !a.isExternal && a.directoryName === name && deps.ptyManager.has(a.id)) : undefined;
  const session = agent && deps ? deps.ptyManager.get(agent.id) : undefined;
  if (!session || !agent) return { ok: false, error: 'ese agente no tiene una terminal abierta en la oficina' };
  session.write(clean);
  await new Promise<void>((r) => setTimeout(r, 250));
  session.write('\r');
  return { ok: true, agentId: agent.id };
}
