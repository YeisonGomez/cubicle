/** Primera vez / importar sesiones: carpetas con sesiones recientes → salas y agentes. */
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';

import { readConfig, writeConfig } from '../configPersistence.js';
import { listDirectories } from '../directories.js';
import { hostDirectory } from '../hostDirectory.js';
import type { HttpServerOptions } from '../httpServer.js';
import { scriptsDir } from '../officePaths.js';
import { recentSessions } from '../onboarding.js';
import { relaunchAll } from '../terminal/relaunch.js';
import { bearerAuth, insideHome, launchDeps, runProyecto } from './shared.js';

export function registerOnboardingRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  // Sesiones con prompts humanos en los últimos N días, agrupadas por carpeta.
  app.get<{ Querystring: { days?: string } }>('/api/onboarding', { preHandler: bearerAuth(options.token) }, async (request) => {
    const cfg = readConfig();
    const days = Math.max(1, Math.min(90, Number(request.query.days) || 7));
    return { needed: cfg.directories.length === 0 && !cfg.standalone.onboarded, days, items: recentSessions(days) };
  });

  // Crea un proyecto (= sala) por cada carpeta elegida, aplica el plano y relanza.
  app.post<{ Body: { items?: Array<{ name?: string; path?: string; room?: string }>; skip?: boolean } }>(
    '/api/onboarding',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const items = (request.body?.items ?? [])
        .map((i) => ({ name: (i.name ?? '').trim(), path: i.path ? path.resolve(i.path) : '', room: (i.room ?? '').trim() }))
        .filter((i) => i.name && i.path && insideHome(i.path) && fs.existsSync(i.path));
      const log: string[] = [];
      const cli = path.join(scriptsDir(), 'proyecto.py');
      if (items.length > 0 && !fs.existsSync(cli)) {
        reply.code(503).send({ error: `no existe ${cli}` });
        return;
      }
      for (const i of items) {
        const args = ['nuevo', i.name, i.path, '--sin-aplicar'];
        if (i.room) args.push('--sala', i.room);
        const r = await runProyecto(options, args);
        log.push(r.log.trim());
        if (!r.ok) {
          reply.code(500).send({ error: r.log, log });
          return;
        }
      }
      if (items.length > 0) log.push((await runProyecto(options, ['aplicar'])).log.trim());
      const cfg = readConfig();
      cfg.standalone.onboarded = true;
      writeConfig(cfg);
      options.store.broadcast({ type: 'directoriesLoaded', directories: listDirectories([hostDirectory()]) });
      options.store.broadcast({ type: 'areaMappingsLoaded', mappings: cfg.standalone.areaMappings });
      const deps = launchDeps(options);
      const launched =
        items.length > 0 && deps
          ? await relaunchAll(deps, { bypassPermissions: cfg.standalone.bypassPermissions, only: items.map((i) => i.name), delayMs: 500 })
          : null;
      return reply.send({ ok: true, created: items.length, log, launched });
    },
  );
}
