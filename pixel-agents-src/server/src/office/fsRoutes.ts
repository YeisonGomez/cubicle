/** Explorador de carpetas (para "+ Proyecto" / "+ Agent"): solo dentro del home. */
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';

import { readConfig } from '../configPersistence.js';
import type { HttpServerOptions } from '../httpServer.js';
import { bearerAuth, HOME, insideHome } from './shared.js';

const ICLOUD = path.join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');

/** Atajos: Inicio, Escritorio, Documentos, iCloud (si existe) y los extra de
 *  `config.standalone.folderShortcuts`. Solo los que existen. */
function shortcuts(): Array<{ label: string; path: string }> {
  const base = [
    { label: 'Inicio', path: HOME },
    { label: 'Escritorio', path: path.join(HOME, 'Desktop') },
    { label: 'Documentos', path: path.join(HOME, 'Documents') },
    { label: 'iCloud', path: ICLOUD },
  ];
  const extra = readConfig().standalone.folderShortcuts.map((p) => {
    const abs = path.resolve(p.replace(/^~(?=$|\/)/, HOME));
    return { label: path.basename(abs) || abs, path: abs };
  });
  const seen = new Set<string>();
  return [...base, ...extra].filter((s) => {
    if (seen.has(s.path) || !insideHome(s.path) || !fs.existsSync(s.path)) return false;
    seen.add(s.path);
    return true;
  });
}

export function displayPath(raw: string): string {
  return raw.startsWith(ICLOUD) ? 'iCloud' + raw.slice(ICLOUD.length) : raw.replace(HOME, '~');
}

export function registerFsRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  // Ocultas, node_modules y Library no se listan.
  app.get<{ Querystring: { path?: string } }>(
    '/api/fs',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const raw = request.query.path ? path.resolve(request.query.path) : HOME;
      if (!insideHome(raw) || !fs.existsSync(raw) || !fs.statSync(raw).isDirectory()) {
        reply.code(400).send({ error: 'carpeta inválida' });
        return;
      }
      let dirs: Array<{ name: string; path: string; isRepo: boolean }> = [];
      try {
        dirs = fs
          .readdirSync(raw, { withFileTypes: true })
          .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'Library')
          .map((e) => ({ name: e.name, path: path.join(raw, e.name), isRepo: fs.existsSync(path.join(raw, e.name, '.git')) }))
          .sort((a, b) => a.name.localeCompare(b.name, 'es'));
      } catch {
        dirs = [];
      }
      const registered = new Set(readConfig().directories.map((d) => path.resolve(d.path)));
      reply.send({
        path: raw,
        parent: raw === HOME ? null : path.dirname(raw),
        display: displayPath(raw),
        dirs: dirs.map((d) => ({ ...d, registered: registered.has(d.path) })),
        shortcuts: shortcuts(),
        isRepo: fs.existsSync(path.join(raw, '.git')),
        registered: registered.has(raw),
      });
    },
  );

  app.post<{ Body: { path?: string; name?: string } }>(
    '/api/fs/mkdir',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const parent = request.body?.path ? path.resolve(request.body.path) : '';
      const name = (request.body?.name ?? '').trim();
      if (!parent || !insideHome(parent) || !name || /[\/\\\0]/.test(name) || name.startsWith('.')) {
        reply.code(400).send({ error: 'nombre o carpeta inválidos' });
        return;
      }
      const target = path.join(parent, name);
      try {
        fs.mkdirSync(target, { recursive: true });
        reply.send({ path: target });
      } catch (e) {
        reply.code(500).send({ error: String(e) });
      }
    },
  );
}
