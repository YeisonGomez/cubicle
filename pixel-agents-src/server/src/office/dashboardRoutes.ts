/** Dashboards HTML: carpetas servidas estáticamente y el dashboard global por agente. */
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';

import { resolveDashboardDir } from '../agentProjects.js';
import { dashboardInfo, ensureDashboardsDir, readDashboard } from '../dashboards.js';
import type { HttpServerOptions } from '../httpServer.js';
import { bearerAuth } from './shared.js';

/** Página mínima cuando no hay dashboard global (sin colores inline: ver lint). */
const EMPTY_DASHBOARD_HTML =
  '<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;opacity:.6;padding:24px">Sin dashboard todavía.</body>';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export function registerDashboardRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  ensureDashboardsDir();

  // Carpeta de dashboards servida estáticamente (HTML + sus assets relativos).
  app.get<{ Params: { key: string; '*': string } }>('/api/dash/:key/*', async (request, reply) => {
    const dir = resolveDashboardDir(request.params.key);
    if (!dir) {
      reply.code(404).send('no encontrado');
      return;
    }
    const rel = decodeURIComponent(request.params['*'] ?? '');
    const abs = path.resolve(dir, rel);
    if (!abs.startsWith(path.resolve(dir) + path.sep)) {
      reply.code(403).send('ruta inválida');
      return;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      reply.code(404).send('no encontrado');
      return;
    }
    const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
    return reply.header('Cache-Control', 'no-store').type(type).send(fs.readFileSync(abs));
  });

  // Eliminar un reporte: solo un *.html directamente dentro de una carpeta de
  // reportes servible (nunca sus assets ni subcarpetas). Se mueve a la papelera
  // del sistema si se puede; si no, se borra.
  app.delete<{ Params: { key: string; file: string } }>(
    '/api/dash/:key/:file',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const dir = resolveDashboardDir(request.params.key);
      const file = decodeURIComponent(request.params.file ?? '');
      if (!dir || !/^[^\/\\\0]+\.html?$/i.test(file) || file.startsWith('.')) {
        return reply.code(400).send({ error: 'reporte inválido' });
      }
      const abs = path.join(dir, file);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return reply.code(404).send({ error: 'no encontrado' });
      }
      try {
        fs.unlinkSync(abs);
      } catch (e) {
        return reply.code(500).send({ error: String(e) });
      }
      return reply.send({ ok: true });
    },
  );

  // Estado de un dashboard global (existe / fecha) y su HTML para el iframe.
  app.get<{ Params: { name: string } }>('/api/dashboard/:name/info', async (request, reply) => {
    const info = dashboardInfo(request.params.name);
    if (!info) {
      reply.code(400).send({ error: 'nombre inválido' });
      return;
    }
    reply.send(info);
  });
  app.get<{ Params: { name: string } }>('/api/dashboard/:name', async (request, reply) => {
    const html = readDashboard(request.params.name);
    if (html === null) {
      reply.code(404).type('text/html; charset=utf-8').send(EMPTY_DASHBOARD_HTML);
      return;
    }
    reply.type('text/html; charset=utf-8').send(html);
  });
}
