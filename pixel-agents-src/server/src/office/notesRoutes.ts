/** Notas por sala (tableros): ~/.pixel-agents/notes.json. */
import type { FastifyInstance } from 'fastify';

import type { HttpServerOptions } from '../httpServer.js';
import { readNotes, sanitizeNotesDoc, writeNotes } from '../notesPersistence.js';
import { bearerAuth } from './shared.js';

export function registerNotesRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  // Lectura: cualquier cliente de la misma máquina (la página sin token también observa).
  app.get('/api/notes', async () => readNotes());
  // Escritura: solo con el token (igual que lanzar agentes).
  app.put<{ Body: Record<string, unknown> }>(
    '/api/notes',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const doc = sanitizeNotesDoc(request.body);
      if (!writeNotes(doc)) {
        reply.code(500).send('write failed');
        return;
      }
      reply.send(doc);
    },
  );
}
