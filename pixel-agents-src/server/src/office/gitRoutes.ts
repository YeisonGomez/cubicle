/** Cambios git sin commit: por directorio registrado y por agente (todos sus repos). */
import type { FastifyInstance } from 'fastify';

import { agentInfo, isAgentProject } from '../agentProjects.js';
import { fileVersions, fileVersionsAt, repoChanges, repoChangesAt } from '../gitChanges.js';
import type { HttpServerOptions } from '../httpServer.js';
import { bearerAuth } from './shared.js';

export function registerGitRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  // Cambios sin commit de un directorio registrado (solo con token).
  app.get<{ Querystring: { dir?: string } }>(
    '/api/git/changes',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const dir = request.query.dir ?? '';
      if (!dir) {
        reply.code(400).send({ error: 'dir requerido' });
        return;
      }
      const res = await repoChanges(dir);
      if ('error' in res) reply.code(422).send(res);
      else reply.send(res);
    },
  );

  // Versiones HEAD y actual de un archivo del repo (solo con token).
  app.get<{ Querystring: { dir?: string; file?: string } }>(
    '/api/git/file',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const dir = request.query.dir ?? '';
      const file = request.query.file ?? '';
      if (!dir || !file) {
        reply.code(400).send({ error: 'dir y file requeridos' });
        return;
      }
      const res = await fileVersions(dir, file);
      if ('error' in res) reply.code(422).send(res);
      else reply.send(res);
    },
  );

  // Cambios sin commit de TODOS los proyectos del agente: [{name, ...RepoChanges} | {name, error}]
  app.get<{ Params: { name: string } }>(
    '/api/agents/:name/changes',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const info = agentInfo(request.params.name);
      if (!info) {
        reply.code(404).send({ error: 'agente no registrado' });
        return;
      }
      const out = await Promise.all(
        info.projects.map(async (p) => ({ name: p.name, ...(await repoChangesAt(p.path)) })),
      );
      reply.send(out);
    },
  );

  app.get<{ Params: { name: string }; Querystring: { root?: string; file?: string } }>(
    '/api/agents/:name/file',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const root = request.query.root ?? '';
      const file = request.query.file ?? '';
      if (!root || !file) {
        reply.code(400).send({ error: 'root y file requeridos' });
        return;
      }
      if (!isAgentProject(request.params.name, root)) {
        reply.code(403).send({ error: 'proyecto no autorizado para este agente' });
        return;
      }
      const res = await fileVersionsAt(root, file);
      if ('error' in res) reply.code(422).send(res);
      else reply.send(res);
    },
  );
}
