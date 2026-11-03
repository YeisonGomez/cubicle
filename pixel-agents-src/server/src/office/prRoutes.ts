/**
 * Revisión de PRs (para quien lidera un equipo): PRs abiertos de los repos del
 * agente vía `gh` (CLI de GitHub, autenticada por el usuario), y dos acciones
 * que mandan un prompt a la terminal del agente: informe ejecutivo del PR y
 * resolver sus conflictos. Los prompts viven en <repo>/scripts/prompts/*.md.
 */
import { execFile } from 'child_process';
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import { agentInfo } from '../agentProjects.js';
import type { HttpServerOptions } from '../httpServer.js';
import { scriptsDir } from '../officePaths.js';
import { bearerAuth, writePromptToAgent } from './shared.js';

const run = promisify(execFile);
const CACHE_MS = 60_000;

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  head: string;
  base: string;
  updatedAt: string;
  url: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  isDraft: boolean;
  reviewDecision: string;
  mergeable: string;
  mergeStateStatus: string;
}
export interface RepoPrs {
  name: string;
  path: string;
  prs: PullRequest[];
  error?: string;
}

const cache = new Map<string, { at: number; value: RepoPrs }>();

async function listPrs(repoPath: string, name: string): Promise<RepoPrs> {
  const hit = cache.get(repoPath);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value: RepoPrs;
  try {
    const { stdout } = await run(
      'gh',
      ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,author,headRefName,baseRefName,updatedAt,url,additions,deletions,changedFiles,isDraft,reviewDecision,mergeable,mergeStateStatus'],
      { cwd: repoPath, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const raw = JSON.parse(stdout) as Array<Record<string, unknown>>;
    value = {
      name,
      path: repoPath,
      prs: raw.map((p) => ({
        number: Number(p.number),
        title: String(p.title ?? ''),
        author: String((p.author as { login?: string } | undefined)?.login ?? ''),
        head: String(p.headRefName ?? ''),
        base: String(p.baseRefName ?? ''),
        updatedAt: String(p.updatedAt ?? ''),
        url: String(p.url ?? ''),
        additions: Number(p.additions ?? 0),
        deletions: Number(p.deletions ?? 0),
        changedFiles: Number(p.changedFiles ?? 0),
        isDraft: p.isDraft === true,
        reviewDecision: String(p.reviewDecision ?? ''),
        mergeable: String(p.mergeable ?? 'UNKNOWN'),
        mergeStateStatus: String(p.mergeStateStatus ?? 'UNKNOWN'),
      })),
    };
  } catch (e) {
    // execFile adjunta stderr al error: es el mensaje útil (p. ej. "gh auth login" o "not a git repository").
    const err = e as { stderr?: string; message?: string; code?: string };
    const msg = (err.stderr ?? '').trim() || err.message || String(e);
    value = { name, path: repoPath, prs: [], error: err.code === 'ENOENT' ? 'gh no está instalado' : msg.split('\n').find((l) => l.trim()) ?? msg };
  }
  cache.set(repoPath, { at: Date.now(), value });
  return value;
}

function promptFor(action: string, vars: Record<string, string>): string | null {
  const file = path.join(scriptsDir(), 'prompts', `pr-${action}.md`);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '').replace(/\s*\n+\s*/g, ' ').trim();
}

export function registerPrRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  // PRs abiertos de cada repo del agente (solo si tiene activada la revisión de PRs).
  app.get<{ Params: { name: string }; Querystring: { fresh?: string } }>('/api/agents/:name/prs', { preHandler: bearerAuth(options.token) }, async (request, reply) => {
    const info = agentInfo(request.params.name);
    if (!info) return reply.code(404).send({ error: 'agente no registrado' });
    if (request.query.fresh) for (const p of info.projects) cache.delete(p.path);
    const repos = await Promise.all(info.projects.map((p) => listPrs(p.path, p.name)));
    return reply.send({ enabled: info.settings.prReview === true, repos });
  });

  // Acción sobre un PR: 'informe' (informe ejecutivo) o 'conflictos' (resolver), como prompt en su terminal.
  app.post<{ Params: { name: string; action: string }; Body: { repo?: string; number?: number } }>(
    '/api/agents/:name/prs/:action',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const info = agentInfo(request.params.name);
      if (!info) return reply.code(404).send({ error: 'agente no registrado' });
      const action = request.params.action;
      if (action !== 'informe' && action !== 'conflictos') return reply.code(400).send({ error: 'acción desconocida' });
      const repo = info.projects.find((p) => p.name === request.body?.repo || p.path === request.body?.repo);
      const n = Number(request.body?.number);
      if (!repo || !Number.isFinite(n)) return reply.code(400).send({ error: 'repo o número de PR inválidos' });
      const pr = (await listPrs(repo.path, repo.name)).prs.find((p) => p.number === n);
      if (!pr) return reply.code(404).send({ error: `no encuentro el PR #${n} en ${repo.name}` });
      const text = promptFor(action, {
        n: String(n),
        repo: repo.name,
        repoPath: repo.path,
        head: pr.head,
        base: pr.base,
        url: pr.url,
        reportsDir: path.join(repo.path, info.settings.dashboardDirs[0] ?? 'docs/reports'),
      });
      if (!text) return reply.code(503).send({ error: `falta scripts/prompts/pr-${action}.md` });
      const r = await writePromptToAgent(options, request.params.name, `cd ${JSON.stringify(repo.path)} && ${text}`);
      if (!r.ok) return reply.code(409).send({ error: r.error });
      return reply.send({ ok: true });
    },
  );
}
