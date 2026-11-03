/**
 * Proyectos y dashboards de cada agente de la oficina (clave = nombre del
 * Directorio). Combina config.directories con config.standalone.agentSettings:
 *
 *  - kind: 'code' muestra la pestaña Cambios (git). Si no está configurado se
 *    deduce: el directorio es un repo o contiene repos → code.
 *  - projects: repos a vigilar. Vacío → el directorio si es repo; si no, sus
 *    subcarpetas de primer nivel que sean repo (p. ej. `empresa/*`).
 *  - dashboardDirs: carpetas relativas a cada proyecto con *.html que se
 *    muestran en la pestaña Dashboard (convención: `oficina/`). Además siempre
 *    se incluye ~/.pixel-agents/dashboards/<Nombre>.html si existe.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { DEFAULT_DASHBOARD_DIRS, readConfig, writeConfig } from './configPersistence.js';
import type { AgentSettings } from './configPersistence.js';
import { dashboardsDir } from './dashboards.js';

export interface ProjectRef {
  /** Nombre corto (basename). */
  name: string;
  /** Ruta absoluta de la raíz del repo. */
  path: string;
  /** Rama actual (leída de .git/HEAD; null si no es repo o está en detached). */
  branch?: string | null;
}

export interface DashboardRef {
  /** Clave opaca para la URL (/api/dash/<key>/<file>). */
  key: string;
  /** Etiqueta de la sub-pestaña. */
  label: string;
  /** Proyecto (repo) al que pertenece y subcarpeta dentro de él: para agrupar en el selector. */
  project?: string;
  sub?: string;
  /** Carpeta servida estáticamente. */
  dir: string;
  /** Archivo HTML dentro de la carpeta. */
  file: string;
  mtime: number;
  url: string;
}

export interface AgentInfo {
  name: string;
  path: string | null;
  settings: AgentSettings;
  /** Si `settings.kind` venía de la config o se dedujo. */
  kindInferred: boolean;
  projects: ProjectRef[];
  dashboards: DashboardRef[];
  /** Carpetas con *.html que aún no están en dashboardDirs (para ofrecerlas). */
  dashboardSuggestions: DashboardDirSuggestion[];
}

function isRepo(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch {
    return false;
  }
}

function childRepos(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && isRepo(path.join(dir, e.name)))
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/** Clave corta y estable de una carpeta (los parámetros de ruta de Fastify
 *  admiten máx. 100 caracteres, así que no sirve base64 de la ruta). */
export function encodeKey(dir: string): string {
  return createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 20);
}

/** Directorio registrado por nombre, o null. */
export function directoryPath(name: string): string | null {
  return readConfig().directories.find((d) => d.name === name)?.path ?? null;
}

export function agentSettingsOf(name: string): { settings: AgentSettings; stored: boolean } {
  const stored = readConfig().standalone.agentSettings[name];
  if (stored) return { settings: stored, stored: true };
  return {
    settings: { kind: 'personal', projects: [], dashboardDirs: [...DEFAULT_DASHBOARD_DIRS] },
    stored: false,
  };
}

/** Repos del agente (configurados o deducidos). */
export function agentProjects(name: string): ProjectRef[] {
  const dir = directoryPath(name);
  const { settings } = agentSettingsOf(name);
  let paths: string[];
  if (settings.projects.length > 0) paths = settings.projects.map((p) => path.resolve(p));
  else if (dir && isRepo(dir)) paths = [dir];
  else if (dir) paths = childRepos(dir);
  else paths = [];
  const seen = new Set<string>();
  const out: ProjectRef[] = [];
  for (const p of paths) {
    if (seen.has(p) || !fs.existsSync(p)) continue;
    seen.add(p);
    out.push({ name: path.basename(p), path: p, branch: readBranch(p) });
  }
  return out;
}

/** Rama actual sin ejecutar git: .git/HEAD → "ref: refs/heads/<rama>" (worktrees: .git es un archivo con gitdir). */
export function readBranch(root: string): string | null {
  try {
    let gitDir = path.join(root, '.git');
    const st = fs.statSync(gitDir);
    if (st.isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitDir, 'utf8'));
      if (!m) return null;
      gitDir = path.resolve(root, m[1].trim());
    }
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const m = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    return m ? m[1] : head.slice(0, 7);
  } catch {
    return null;
  }
}

/** ¿Está `root` entre los repos permitidos para este agente? */
export function isAgentProject(name: string, root: string): boolean {
  const norm = path.resolve(root);
  return agentProjects(name).some((p) => p.path === norm);
}

function listHtml(dir: string): Array<{ file: string; mtime: number }> {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.html?$/i.test(e.name) && !e.name.startsWith('.'))
      .map((e) => ({ file: e.name, mtime: fs.statSync(path.join(dir, e.name)).mtimeMs }))
      .sort((a, b) => a.file.localeCompare(b.file));
  } catch {
    return [];
  }
}

/** Dashboards visibles del agente: global (~/.pixel-agents/dashboards/<Nombre>.html)
 *  y los *.html de cada <proyecto>/<dashboardDir>/. */
export function agentDashboards(name: string): DashboardRef[] {
  const out: DashboardRef[] = [];
  const globalDir = dashboardsDir();
  const globalFile = `${name}.html`;
  if (fs.existsSync(path.join(globalDir, globalFile))) {
    const mtime = fs.statSync(path.join(globalDir, globalFile)).mtimeMs;
    const key = encodeKey(globalDir);
    out.push({ key, label: name, project: name, sub: '', dir: globalDir, file: globalFile, mtime, url: `./api/dash/${key}/${encodeURIComponent(globalFile)}` });
  }
  const { settings } = agentSettingsOf(name);
  const projects = dashboardBases(name);
  const multi = projects.length > 1;
  for (const p of projects) {
    for (const rel of settings.dashboardDirs) {
      for (const dir of expandDashboardDir(p.path, rel)) {
        const sub = path.relative(p.path, dir);
        for (const { file, mtime } of listHtml(dir)) {
          const key = encodeKey(dir);
          const base = file.replace(/\.html?$/i, '');
          const name = sub && sub !== 'docs/reports' ? `${path.basename(sub)} · ${base}` : base;
          out.push({
            key,
            label: multi ? `${p.name} · ${name}` : name,
            project: p.name,
            sub: sub && sub !== 'docs/reports' ? sub : '',
            dir,
            file,
            mtime,
            url: `./api/dash/${key}/${encodeURIComponent(file)}`,
          });
        }
      }
    }
  }
  return out;
}

/** Carpetas donde se buscan dashboards: los proyectos del agente y, además, su
 *  propio directorio (p. ej. una carpeta `empresa/docs` que no es repo). */
function dashboardBases(name: string): ProjectRef[] {
  const dir = directoryPath(name);
  const projects = agentProjects(name);
  if (!dir) return projects;
  if (projects.some((p) => p.path === dir)) return projects;
  return [...projects, { name: path.basename(dir), path: dir }];
}

const SUGGEST_SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'public', 'static', 'src', 'vendor', 'target', '__pycache__', 'storybook-static']);
const SUGGEST_DEPTH = 2;

export interface DashboardDirSuggestion {
  /** Patrón relativo listo para dashboardDirs ('docs', 'ClaudePlan', '.'). */
  dir: string;
  /** Cuántos *.html hay en las carpetas que coinciden. */
  html: number;
  /** Bases (proyecto o directorio) donde existe. */
  bases: string[];
}

/** Carpetas con *.html dentro de los proyectos (hasta 2 niveles) que aún no
 *  están en dashboardDirs: para que Configuración ofrezca agregarlas. */
export function suggestDashboardDirs(name: string): DashboardDirSuggestion[] {
  const { settings } = agentSettingsOf(name);
  const current = new Set(settings.dashboardDirs);
  const found = new Map<string, DashboardDirSuggestion>();
  // Al recorrer el directorio del agente no se entra a sus repos: ya son bases propias.
  const projectRoots = new Set(agentProjects(name).map((p) => p.path));
  const walk = (base: ProjectRef, dir: string, depth: number) => {
    if (dir !== base.path && projectRoots.has(dir)) return;
    const n = listHtml(dir).length;
    if (n > 0) {
      const rel = path.relative(base.path, dir) || '.';
      if (!current.has(rel)) {
        const e = found.get(rel) ?? { dir: rel, html: 0, bases: [] };
        e.html += n;
        if (!e.bases.includes(base.name)) e.bases.push(base.name);
        found.set(rel, e);
      }
    }
    if (depth >= SUGGEST_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SUGGEST_SKIP.has(e.name)) continue;
      walk(base, path.join(dir, e.name), depth + 1);
    }
  };
  for (const b of dashboardBases(name)) walk(b, b.path, 0);
  return [...found.values()].sort((a, b) => b.html - a.html || a.dir.localeCompare(b.dir));
}

/** Carpeta relativa a un proyecto: '.' = el proyecto; 'cursos/*' = cada
 *  subcarpeta de cursos/. Nunca sale del proyecto. */
function expandDashboardDir(project: string, rel: string): string[] {
  const inside = (d: string) => d === project || d.startsWith(project + path.sep);
  if (rel.endsWith('/*') || rel === '*') {
    const parent = path.resolve(project, rel.slice(0, -1) || '.');
    if (!inside(parent)) return [];
    try {
      return fs
        .readdirSync(parent, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => path.join(parent, e.name))
        .sort();
    } catch {
      return [];
    }
  }
  const dir = path.resolve(project, rel);
  return inside(dir) ? [dir] : [];
}

/**
 * Última vez que EL USUARIO escribió en una sesión (según su transcript).
 * Cuentan solo prompts humanos: se ignoran los inyectados por el harness
 * (<task-notification>, <system-reminder>, comandos locales), los mensajes de
 * otras sesiones de Claude y el resumen de continuación. null = nunca.
 */
interface ActivityCache {
  size: number;
  last: number | null;
}
const activityCache = new Map<string, ActivityCache>();

/**
 * Lee el transcript de forma incremental: la primera vez completo (los
 * transcripts pueden pesar decenas de MB por las imágenes), después solo lo
 * que se añadió desde la última llamada. Se guarda la fecha del último prompt
 * humano encontrado.
 */
export function transcriptLastActivity(file: string): number | null {
  try {
    const st = fs.statSync(file);
    const cached = activityCache.get(file);
    if (cached && cached.size === st.size) return cached.last;
    let from = cached && st.size > cached.size ? cached.size : 0;
    let last = from > 0 ? (cached?.last ?? null) : null;
    const fd = fs.openSync(file, 'r');
    try {
      const CHUNK = 8 * 1024 * 1024;
      let carry = '';
      while (from < st.size) {
        const len = Math.min(CHUNK, st.size - from);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, from);
        from += len;
        const text = carry + buf.toString('utf8');
        const lines = text.split('\n');
        carry = from < st.size ? (lines.pop() ?? '') : '';
        for (const line of lines) {
          const at = humanPromptAt(line);
          if (at !== null) last = at;
        }
      }
      if (carry) {
        const at = humanPromptAt(carry);
        if (at !== null) last = at;
      }
    } finally {
      fs.closeSync(fd);
    }
    activityCache.set(file, { size: st.size, last });
    return last;
  } catch {
    return null;
  }
}

/** Fecha (ms) si la línea es un prompt humano; null si no. */
function humanPromptAt(line: string): number | null {
  if (!line.includes('"type":"user"') && !line.includes('"type": "user"')) return null;
  if (!line.includes('"timestamp"')) return null;
  let rec: { type?: string; timestamp?: string; isSidechain?: boolean; message?: { content?: unknown } };
  try {
    rec = JSON.parse(line);
  } catch {
    return null;
  }
  if (rec.type !== 'user' || !rec.timestamp || rec.isSidechain) return null;
  const c = rec.message?.content;
  let text = '';
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    const t = (c as Array<{ type?: string; text?: string }>).find((b) => b.type === 'text');
    if (!t) return null; // tool_result: no es un prompt
    text = t.text ?? '';
  } else return null;
  if (!isHumanPrompt(text)) return null;
  const ms = Date.parse(rec.timestamp);
  return Number.isNaN(ms) ? null : ms;
}

export function isHumanPrompt(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith('<')) return false; // task-notification, system-reminder, command-name, local-command-*
  if (/^Another Claude session sent a message/i.test(t)) return false;
  if (/^This session is being continued from a previous conversation/i.test(t)) return false;
  if (/^\[Request interrupted/i.test(t)) return false;
  // La pregunta de capacidades la manda la oficina como prompt inicial: no es actividad tuya.
  if (/^(Oficina|Cubicle) \(pixel agents\)/i.test(t)) return false;
  return true;
}

/** Carpetas que se pueden servir como dashboard (global + las de cada agente). */
function servableDashboardDirs(): string[] {
  const out = new Set<string>([path.resolve(dashboardsDir())]);
  for (const d of readConfig().directories) {
    for (const ref of agentDashboards(d.name)) out.add(path.resolve(ref.dir));
  }
  return [...out];
}

/** Carpeta de dashboards a la que apunta una clave, o null si no es servible. */
export function resolveDashboardDir(key: string): string | null {
  if (!/^[0-9a-f]{20}$/.test(key)) return null;
  return servableDashboardDirs().find((d) => encodeKey(d) === key) ?? null;
}

export function agentInfo(name: string): AgentInfo | null {
  const dir = directoryPath(name);
  if (!dir) return null;
  const { settings, stored } = agentSettingsOf(name);
  const projects = agentProjects(name);
  let kind = settings.kind;
  const kindInferred = !stored;
  if (!stored) kind = projects.length > 0 ? 'code' : 'personal';
  return {
    name,
    path: dir,
    settings: { ...settings, kind },
    kindInferred,
    projects,
    dashboards: agentDashboards(name),
    dashboardSuggestions: suggestDashboardDirs(name),
  };
}

export function saveAgentSettings(name: string, raw: unknown): AgentSettings | null {
  if (!directoryPath(name)) return null;
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<AgentSettings>;
  const strs = (a: unknown): string[] =>
    Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : [];
  const next: AgentSettings = {
    kind: o.kind === 'code' ? 'code' : 'personal',
    projects: strs(o.projects),
    dashboardDirs: Array.isArray(o.dashboardDirs) ? strs(o.dashboardDirs) : [...DEFAULT_DASHBOARD_DIRS],
    prReview: o.prReview === true,
  };
  const cfg = readConfig();
  cfg.standalone.agentSettings = { ...cfg.standalone.agentSettings, [name]: next };
  if (!writeConfig(cfg)) return null;
  return next;
}
