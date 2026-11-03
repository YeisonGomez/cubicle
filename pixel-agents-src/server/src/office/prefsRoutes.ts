/**
 * Preferencias de la interfaz (fichas fijadas, orden de salas y fichas, salas
 * plegadas, descansos forzados, anchos de panel, idioma…). Antes vivían solo en
 * el localStorage del navegador y se perdían al cambiar de origen (localhost vs
 * 127.0.0.1), de navegador o al limpiar datos; ahora se guardan también en
 * `<oficina>/ui-prefs.json` y la webview las restaura al arrancar.
 */
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';

import type { HttpServerOptions } from '../httpServer.js';
import { officeDir } from '../officePaths.js';
import { bearerAuth } from './shared.js';

const prefsFile = (): string => path.join(officeDir(), 'ui-prefs.json');
const KEY_RE = /^pixel-agents\.[A-Za-z]{1,40}$/;

function readPrefs(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

export function registerPrefsRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  app.get('/api/ui-prefs', async () => readPrefs());
  // Cuerpo: { clave: valor | null } (null borra). Solo claves pixel-agents.* y valores de hasta 64 KB.
  app.put<{ Body: Record<string, string | null> }>('/api/ui-prefs', { preHandler: bearerAuth(options.token) }, async (request, reply) => {
    const body = request.body ?? {};
    const prefs = readPrefs();
    for (const [k, v] of Object.entries(body)) {
      if (!KEY_RE.test(k)) continue;
      if (v === null) delete prefs[k];
      else if (typeof v === 'string' && v.length <= 65_536) prefs[k] = v;
    }
    fs.mkdirSync(officeDir(), { recursive: true });
    fs.writeFileSync(prefsFile(), JSON.stringify(prefs, null, 1));
    return reply.send({ ok: true });
  });
}
