/**
 * Ficha de proyecto (sala/oficina): lo automático (subcarpetas, repos, ramas,
 * último commit, qué carpetas tienen agente) + lo que la sesión escribe una
 * sola vez con proyecto_info.py (descripción de una línea, subproyectos, roles).
 */
import { execFile, execFileSync } from 'child_process';
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import { agentInfo, readBranch } from '../agentProjects.js';
import { readConfig } from '../configPersistence.js';
import type { HttpServerOptions } from '../httpServer.js';
import { officeDir, scriptsDir } from '../officePaths.js';
import { langEnv } from './language.js';
import { bearerAuth, writePromptToAgent, launchDeps } from './shared.js';

const run = promisify(execFile);
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', 'venv', '.venv', '__pycache__', '.cache', 'docs', 'oficina']);

interface SubProject {
  name: string;
  path: string;
  isRepo: boolean;
  branch: string | null;
  lastCommitAt: number | null;
  lastCommit: string | null;
  hasClaudeMd: boolean;
  kind: string | null;
  /** Directorios (agentes) cuya carpeta es esta o está dentro. */
  agents: string[];
}
interface Saved {
  descripcion?: string;
  subproyectos?: Record<string, string>;
  roles?: Record<string, string>;
  actualizado?: number;
}

function savedFor(label: string): Saved | null {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(officeDir(), 'proyectos.json'), 'utf8')) as Record<string, Saved>;
    return all[label] ?? null;
  } catch {
    return null;
  }
}

function roomBase(label: string): { base: string | null; color: string | null } {
  try {
    const of = JSON.parse(fs.readFileSync(path.join(officeDir(), 'oficinas.json'), 'utf8')) as { salas?: Array<{ label: string; base?: string; color?: string }> };
    const s = of.salas?.find((x) => x.label === label);
    const base = s?.base ? s.base.replace(/^~/, process.env.HOME ?? '') : null;
    return { base: base && fs.existsSync(base) ? base : null, color: s?.color ?? null };
  } catch {
    return { base: null, color: null };
  }
}

function kindOf(dir: string): string | null {
  const has = (f: string) => fs.existsSync(path.join(dir, f));
  if (has('package.json')) return 'node';
  if (has('pyproject.toml') || has('requirements.txt')) return 'python';
  if (has('go.mod')) return 'go';
  if (has('Cargo.toml')) return 'rust';
  if (has('pom.xml') || has('build.gradle')) return 'java';
  if (has('Package.swift') || fs.readdirSync(dir).some((f) => f.endsWith('.xcodeproj'))) return 'swift';
  if (has('main.tf')) return 'terraform';
  return null;
}

async function lastCommit(dir: string): Promise<{ at: number | null; msg: string | null }> {
  try {
    const { stdout } = await run('git', ['log', '-1', '--format=%ct%x09%s'], { cwd: dir, timeout: 5000 });
    const [ts, msg] = stdout.trim().split('\t');
    return { at: ts ? Number(ts) * 1000 : null, msg: msg ?? null };
  } catch {
    return { at: null, msg: null };
  }
}

async function subprojects(base: string, agents: Array<{ name: string; path: string }>): Promise<SubProject[]> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)).map((e) => path.join(base, e.name));
  const out = await Promise.all(
    dirs.map(async (dir): Promise<SubProject> => {
      const isRepo = fs.existsSync(path.join(dir, '.git'));
      const lc = isRepo ? await lastCommit(dir) : { at: null, msg: null };
      return {
        name: path.basename(dir),
        path: dir,
        isRepo,
        branch: isRepo ? readBranch(dir) : null,
        lastCommitAt: lc.at,
        lastCommit: lc.msg,
        hasClaudeMd: fs.existsSync(path.join(dir, 'CLAUDE.md')) || fs.existsSync(path.join(dir, 'AGENTS.md')),
        kind: kindOf(dir),
        agents: agents.filter((a) => a.path === dir || a.path.startsWith(dir + path.sep)).map((a) => a.name),
      };
    }),
  );
  return out.sort((a, b) => (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0) || a.name.localeCompare(b.name));
}

export function registerProjectRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  app.get<{ Params: { label: string } }>('/api/rooms/:label/project', async (request) => {
    const label = request.params.label;
    const cfg = readConfig();
    const agents = cfg.directories.filter((d) => (cfg.standalone.areaMappings[d.name] ?? []).includes(label));
    const { base, color } = roomBase(label);
    const root = base ?? (agents.length === 1 ? agents[0].path : null);
    const subs = root ? await subprojects(root, agents) : [];
    const rootInfo = root
      ? { isRepo: fs.existsSync(path.join(root, '.git')), branch: readBranch(root), hasClaudeMd: fs.existsSync(path.join(root, 'CLAUDE.md')) || fs.existsSync(path.join(root, 'AGENTS.md')), kind: kindOf(root) }
      : null;
    const deps = launchDeps(options);
    const live = new Set(deps ? [...options.store.values()].filter((a) => !a.isExternal && deps.ptyManager.has(a.id)).map((a) => a.directoryName) : []);
    return {
      label,
      color,
      base: root,
      root: rootInfo,
      agents: agents.map((a) => ({ name: a.name, path: a.path, live: live.has(a.name), info: agentInfo(a.name) })),
      subprojects: subs,
      saved: savedFor(label),
    };
  });

  // Pide a una sesión viva de la sala que escriba la ficha (una vez; o al pulsar "Actualizar").
  app.post<{ Params: { label: string } }>('/api/rooms/:label/project/ask', { preHandler: bearerAuth(options.token) }, async (request, reply) => {
    const label = request.params.label;
    const cfg = readConfig();
    const agents = cfg.directories.filter((d) => (cfg.standalone.areaMappings[d.name] ?? []).includes(label));
    const { base } = roomBase(label);
    const root = base ?? agents[0]?.path;
    if (!root) return reply.code(404).send({ error: 'sala sin carpeta' });
    const subs = (await subprojects(root, agents)).map((s) => s.name);
    const cli = path.join(scriptsDir(), 'proyecto_info.py');
    let text: string;
    try {
      text = execFileSync('python3', [cli, 'pregunta', label, ...subs], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...langEnv(), OFICINA_BASE: root, OFICINA_AGENTES: agents.map((a) => a.name).join('|') },
      }).replace(/\s*\n+\s*/g, ' ').trim();
    } catch (e) {
      return reply.code(503).send({ error: `no pude armar la pregunta: ${e instanceof Error ? e.message : String(e)}` });
    }
    const deps = launchDeps(options);
    const liveNames = deps ? new Set([...options.store.values()].filter((a) => !a.isExternal && deps.ptyManager.has(a.id)).map((a) => a.directoryName)) : new Set<string>();
    const target = agents.find((a) => liveNames.has(a.name));
    if (!target) return reply.code(409).send({ error: 'ningún agente de esta sala tiene una terminal abierta' });
    const r = await writePromptToAgent(options, target.name, text);
    if (!r.ok) return reply.code(409).send({ error: r.error });
    return reply.send({ ok: true, agent: target.name });
  });
}
