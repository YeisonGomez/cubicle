/**
 * Primera vez (repo recién clonado, sin proyectos registrados): sesiones de
 * Claude Code con prompts humanos en los últimos N días, agrupadas por carpeta
 * de trabajo, para que el usuario les ponga nombre y elija cuáles entran a la
 * oficina. También sirve después como "Importar sesiones".
 */
import * as fs from 'fs';
import * as path from 'path';

import { activityStats } from './activityStats.js';
import { isHumanPrompt } from './agentProjects.js';
import { readConfig } from './configPersistence.js';
import { claudeProvider } from './providers/index.js';

export interface RecentSession {
  path: string;
  /** Nombre sugerido (carpeta). */
  name: string;
  isGit: boolean;
  /** Prompts humanos en los últimos `days` días y en total. */
  promptsRecent: number;
  prompts: number;
  sessions: number;
  lastAt: number | null;
  /** Primer prompt humano de la sesión más reciente (pista de qué trata). */
  firstPrompt: string | null;
  /** Ya es un Directorio de la oficina. */
  registered: boolean;
}

const HEAD_BYTES = 256 * 1024;

/** cwd y primer prompt humano leyendo solo la cabecera del transcript. */
function headInfo(file: string): { cwd: string | null; firstPrompt: string | null } {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return { cwd: null, firstPrompt: null };
  }
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    const lines = buf.toString('utf8', 0, n).split('\n');
    let cwd: string | null = null;
    let firstPrompt: string | null = null;
    for (const line of lines) {
      if (cwd && firstPrompt) break;
      if (!line.includes('"cwd"') && !line.includes('"type":"user"')) continue;
      let rec: { cwd?: string; type?: string; isSidechain?: boolean; message?: { content?: unknown } };
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (!cwd && typeof rec.cwd === 'string' && rec.cwd) cwd = rec.cwd;
      if (!firstPrompt && rec.type === 'user' && !rec.isSidechain) {
        const c = rec.message?.content;
        let text = '';
        if (typeof c === 'string') text = c;
        else if (Array.isArray(c)) {
          const t = (c as Array<{ type?: string; text?: string }>).find((b) => b.type === 'text');
          text = t?.text ?? '';
        }
        // La pregunta de capacidades de la propia oficina no sirve como pista de qué trata la carpeta.
        if (isHumanPrompt(text) && !/^Oficina \(pixel agents\)/i.test(text)) firstPrompt = text.trim().replace(/\s+/g, ' ').slice(0, 160);
      }
    }
    return { cwd, firstPrompt };
  } finally {
    fs.closeSync(fd);
  }
}

export function recentSessions(days = 7): RecentSession[] {
  const since = Date.now() - days * 86_400_000;
  const cfg = readConfig();
  const registered = new Set(cfg.directories.map((d) => path.resolve(d.path)));
  // cwd → transcript más reciente (para el primer prompt)
  const byCwd = new Map<string, { mtime: number; file: string }>();
  for (const root of claudeProvider.getAllSessionRoots?.() ?? []) {
    let dirs: string[];
    try {
      dirs = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const d of dirs) {
      const dir = path.join(root, d);
      let names: string[];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const n of names) {
        if (!n.endsWith('.jsonl')) continue;
        const file = path.join(dir, n);
        let st: fs.Stats;
        try {
          st = fs.statSync(file);
        } catch {
          continue;
        }
        if (!st.isFile() || st.size < 200 || st.mtimeMs < since) continue;
        const { cwd } = headInfo(file);
        if (!cwd || !fs.existsSync(cwd)) continue;
        const key = path.resolve(cwd);
        const cur = byCwd.get(key);
        if (!cur || st.mtimeMs > cur.mtime) byCwd.set(key, { mtime: st.mtimeMs, file });
      }
    }
  }
  const out: RecentSession[] = [];
  for (const [cwd, { file }] of byCwd) {
    const s = activityStats([cwd]);
    const recent = Object.entries(s.days)
      .filter(([k]) => Date.parse(k) >= since - 86_400_000)
      .reduce((n, [, v]) => n + v.prompts, 0);
    if (recent === 0) continue;
    out.push({
      path: cwd,
      name: path.basename(cwd),
      isGit: fs.existsSync(path.join(cwd, '.git')),
      promptsRecent: recent,
      prompts: s.prompts,
      sessions: s.sessions,
      lastAt: s.lastAt,
      firstPrompt: headInfo(file).firstPrompt,
      registered: registered.has(cwd),
    });
  }
  return out.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
}
