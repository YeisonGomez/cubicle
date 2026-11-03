/** Idioma de la oficina: la webview lo sincroniza al arrancar y al cambiarlo en Ajustes. */
import type { FastifyInstance } from 'fastify';

import type { HttpServerOptions } from '../httpServer.js';
import { getOfficeLang, setOfficeLang } from './language.js';
import { bearerAuth } from './shared.js';

export function registerLangRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  app.get('/api/lang', async () => ({ lang: getOfficeLang() }));
  app.put<{ Body: { lang?: string } }>('/api/lang', { preHandler: bearerAuth(options.token) }, async (request, reply) => {
    const lang = request.body?.lang;
    if (lang !== 'es' && lang !== 'en') return reply.code(400).send({ error: 'lang debe ser es o en' });
    setOfficeLang(lang);
    return reply.send({ lang });
  });
}
