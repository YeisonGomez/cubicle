/**
 * Estadísticas de actividad por Directorio (pestaña "Actividad" del panel):
 * prompts humanos por día (mapa de calor tipo GitHub), respuestas, llamadas a
 * herramientas, horas más activas, racha y herramientas más usadas. Se leen
 * TODOS los transcripts de la carpeta (y su realpath) con caché por tamaño.
 */

import * as fs from 'fs';
import * as path from 'path';

import { isHumanPrompt } from './agentProjects.js';
import { claudeProvider } from './providers/index.js';

export interface DayStats {
  prompts: number;
  replies: number;
  tools: number;
}
/** Tokens consumidos (message.usage de cada respuesta, subagentes incluidos). */
export interface TokenCounts {
  in: number;
  out: number;
  cacheW: number;
  cacheR: number;
}
export const zeroTokens = (): TokenCounts => ({ in: 0, out: 0, cacheW: 0, cacheR: 0 });
export const addTokens = (a: TokenCounts, b: TokenCounts): TokenCounts => ({ in: a.in + b.in, out: a.out + b.out, cacheW: a.cacheW + b.cacheW, cacheR: a.cacheR + b.cacheR });
export const totalTokens = (t: TokenCounts): number => t.in + t.out + t.cacheW + t.cacheR;
interface FileStats {
  size: number;
  days: Record<string, DayStats>;
  tools: Record<string, number>;
  /** Servidores MCP usados (id crudo del nombre de herramienta) → llamadas. */
  mcp: Record<string, number>;
  /** Skills invocadas con la herramienta Skill → veces. */
  skills: Record<string, number>;
  /** Tokens por día (YYYY-MM-DD) y por hora del día. */
  tokens: Record<string, TokenCounts>;
  tokHours: number[];
  hours: number[];
  /** Prompts y tokens por hora, por día (YYYY-MM-DD): para las gráficas filtradas por ventana. */
  dayHours: Record<string, number[]>;
  dayTokHours: Record<string, number[]>;
  firstAt: number | null;
  lastAt: number | null;
}
const cache = new Map<string, FileStats>();

function dayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function scanFile(file: string): FileStats | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const cached = cache.get(file);
  if (cached && cached.size === st.size) return cached;
  const out: FileStats = { size: st.size, days: {}, tools: {}, mcp: {}, skills: {}, tokens: {}, tokHours: new Array<number>(24).fill(0), hours: new Array<number>(24).fill(0), dayHours: {}, dayTokHours: {}, firstAt: null, lastAt: null };
  const fd = fs.openSync(file, 'r');
  try {
    const CHUNK = 8 * 1024 * 1024;
    let from = 0;
    let carry = '';
    const handle = (line: string) => {
      if (!line.includes('"timestamp"')) return;
      let rec: {
        type?: string;
        timestamp?: string;
        isSidechain?: boolean;
        message?: { content?: unknown; usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } };
      };
      try {
        rec = JSON.parse(line);
      } catch {
        return;
      }
      if (!rec.timestamp) return;
      const ms = Date.parse(rec.timestamp);
      if (Number.isNaN(ms)) return;
      const key = dayKey(ms);
      // Consumo de tokens: también los subagentes (sidechain), que gastan igual.
      const u = rec.type === 'assistant' ? rec.message?.usage : undefined;
      if (u) {
        const t = (out.tokens[key] ??= zeroTokens());
        t.in += u.input_tokens ?? 0;
        t.out += u.output_tokens ?? 0;
        t.cacheW += u.cache_creation_input_tokens ?? 0;
        t.cacheR += u.cache_read_input_tokens ?? 0;
        const tot = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        out.tokHours[new Date(ms).getHours()] += tot;
        (out.dayTokHours[key] ??= new Array<number>(24).fill(0))[new Date(ms).getHours()] += tot;
      }
      if (rec.isSidechain) return;
      const day = (out.days[key] ??= { prompts: 0, replies: 0, tools: 0 });
      if (rec.type === 'user') {
        const c = rec.message?.content;
        let text = '';
        if (typeof c === 'string') text = c;
        else if (Array.isArray(c)) {
          const t = (c as Array<{ type?: string; text?: string }>).find((b) => b.type === 'text');
          if (!t) return;
          text = t.text ?? '';
        } else return;
        if (!isHumanPrompt(text)) return;
        day.prompts++;
        out.hours[new Date(ms).getHours()]++;
        (out.dayHours[key] ??= new Array<number>(24).fill(0))[new Date(ms).getHours()]++;
        if (out.firstAt === null || ms < out.firstAt) out.firstAt = ms;
        if (out.lastAt === null || ms > out.lastAt) out.lastAt = ms;
      } else if (rec.type === 'assistant') {
        const c = rec.message?.content;
        if (!Array.isArray(c)) return;
        let hasText = false;
        for (const b of c as Array<{ type?: string; name?: string; input?: { skill?: unknown } }>) {
          if (b.type === 'tool_use') {
            day.tools++;
            const raw = b.name ?? '?';
            const m = /^mcp__(.+?)__/.exec(raw);
            if (m) out.mcp[m[1]] = (out.mcp[m[1]] ?? 0) + 1;
            if (raw === 'Skill' && typeof b.input?.skill === 'string') {
              const sk = b.input.skill.trim().slice(0, 60);
              if (sk) out.skills[sk] = (out.skills[sk] ?? 0) + 1;
            }
            const name = raw.replace(/^mcp__([^_]+)__.*$/, 'mcp:$1');
            out.tools[name] = (out.tools[name] ?? 0) + 1;
          } else if (b.type === 'text') hasText = true;
        }
        if (hasText) day.replies++;
      }
    };
    while (from < st.size) {
      const len = Math.min(CHUNK, st.size - from);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, from);
      from += len;
      const lines = (carry + buf.toString('utf8')).split('\n');
      carry = from < st.size ? (lines.pop() ?? '') : '';
      for (const l of lines) handle(l);
    }
    if (carry) handle(carry);
  } finally {
    fs.closeSync(fd);
  }
  cache.set(file, out);
  return out;
}

function sessionFiles(cwd: string): string[] {
  const candidates = new Set<string>([cwd]);
  try {
    candidates.add(fs.realpathSync(cwd));
  } catch {
    /* solo cwd */
  }
  const files: string[] = [];
  for (const c of candidates) {
    for (const dir of claudeProvider.getSessionDirs?.(c) ?? []) {
      let names: string[];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const n of names) if (n.endsWith('.jsonl')) files.push(path.join(dir, n));
    }
  }
  return [...new Set(files)];
}

export interface ActivityStats {
  days: Record<string, DayStats>;
  sessions: number;
  prompts: number;
  replies: number;
  tools: number;
  topTools: Array<{ name: string; count: number }>;
  hours: number[];
  firstAt: number | null;
  lastAt: number | null;
  /** Días seguidos con prompts terminando hoy o ayer. */
  streak: number;
  /** Prompts en los últimos 7 y 30 días. */
  last7: number;
  last30: number;
  busiestDay: { day: string; prompts: number } | null;
  /** Detectado en los transcripts: MCP y skills usados de verdad. */
  detected: DetectedCapabilities;
  /** Tokens por día y total. */
  tokensByDay: Record<string, TokenCounts>;
  tokens: TokenCounts;
  /** Tokens totales por hora del día. */
  tokensByHour: number[];
}

export interface DetectedCapabilities {
  mcp: Array<{ id: string; name: string; count: number }>;
  skills: Array<{ name: string; count: number }>;
}

/** Nombre corto para mostrar de un servidor MCP (id crudo del tool name). */
export function mcpDisplayName(id: string): string {
  const PRETTY: Record<string, string> = {
    'claude-in-chrome': 'Chrome',
    'aws-api': 'AWS',
    garmin: 'Garmin',
    easel: 'Easel',
    github: 'GitHub',
  };
  if (PRETTY[id]) return PRETTY[id];
  const n = id.replace(/^claude_ai_/, '').replace(/^plugin_[a-z-]+?_/, '');
  const PRETTY2: Record<string, string> = { Customer_io: 'Customer.io', Google_Drive: 'Google Drive', Claude_Docs: 'Claude Docs' };
  return PRETTY2[n] ?? n.replace(/_/g, ' ');
}

function mergeDetected(parts: Array<{ mcp: Record<string, number>; skills: Record<string, number> }>): DetectedCapabilities {
  const mcp: Record<string, number> = {};
  const skills: Record<string, number> = {};
  for (const p of parts) {
    for (const [k, v] of Object.entries(p.mcp)) mcp[k] = (mcp[k] ?? 0) + v;
    for (const [k, v] of Object.entries(p.skills)) skills[k] = (skills[k] ?? 0) + v;
  }
  return {
    mcp: Object.entries(mcp).sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, name: mcpDisplayName(id), count })),
    skills: Object.entries(skills).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  };
}

/** Estadísticas agregadas de una o varias carpetas de trabajo. */
export function activityStats(cwds: string[]): ActivityStats {
  const days: Record<string, DayStats> = {};
  const tools: Record<string, number> = {};
  const hours = new Array<number>(24).fill(0);
  let sessions = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  const parts: FileStats[] = [];
  const tokensByDay: Record<string, TokenCounts> = {};
  const tokensByHour = new Array<number>(24).fill(0);
  for (const cwd of cwds) {
    for (const f of sessionFiles(cwd)) {
      const s = scanFile(f);
      if (!s) continue;
      parts.push(s);
      for (const [k, t] of Object.entries(s.tokens)) tokensByDay[k] = addTokens(tokensByDay[k] ?? zeroTokens(), t);
      for (let h = 0; h < 24; h++) tokensByHour[h] += s.tokHours[h];
      if (s.firstAt !== null) sessions++;
      for (const [k, v] of Object.entries(s.days)) {
        const d = (days[k] ??= { prompts: 0, replies: 0, tools: 0 });
        d.prompts += v.prompts;
        d.replies += v.replies;
        d.tools += v.tools;
      }
      for (const [k, v] of Object.entries(s.tools)) tools[k] = (tools[k] ?? 0) + v;
      for (let h = 0; h < 24; h++) hours[h] += s.hours[h];
      if (s.firstAt !== null && (firstAt === null || s.firstAt < firstAt)) firstAt = s.firstAt;
      if (s.lastAt !== null && (lastAt === null || s.lastAt > lastAt)) lastAt = s.lastAt;
    }
  }
  let prompts = 0;
  let replies = 0;
  let toolCalls = 0;
  let busiest: { day: string; prompts: number } | null = null;
  const now = Date.now();
  let last7 = 0;
  let last30 = 0;
  for (const [k, v] of Object.entries(days)) {
    prompts += v.prompts;
    replies += v.replies;
    toolCalls += v.tools;
    if (!busiest || v.prompts > busiest.prompts) busiest = { day: k, prompts: v.prompts };
    const age = (now - Date.parse(k)) / 86_400_000;
    if (age <= 7) last7 += v.prompts;
    if (age <= 30) last30 += v.prompts;
  }
  // racha: días consecutivos con prompts, empezando hoy (o ayer si hoy aún no)
  let streak = 0;
  let cursor = new Date();
  if (!(days[dayKey(cursor.getTime())]?.prompts > 0)) cursor = new Date(cursor.getTime() - 86_400_000);
  while (days[dayKey(cursor.getTime())]?.prompts > 0) {
    streak++;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  const topTools = Object.entries(tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));
  const tokens = Object.values(tokensByDay).reduce(addTokens, zeroTokens());
  return { days, sessions, prompts, replies, tools: toolCalls, topTools, hours, firstAt, lastAt, streak, last7, last30, busiestDay: busiest, detected: mergeDetected(parts), tokensByDay, tokens, tokensByHour };
}

// ── Persistencia en <oficina>/actividad.json ───────────────────
// { "<Directorio>": { days: { "YYYY-MM-DD": prompts }, hours: number[24], sessions, firstAt, lastAt, updatedAt } }
// Se guarda el MÁXIMO entre lo leído de los transcripts y lo guardado, así la
// historia no se pierde si un transcript desaparece o se compacta.

interface StoredDir {
  days: Record<string, number>;
  /** Tokens por día (máximo entre guardado y transcripts). */
  tokens?: Record<string, TokenCounts>;
  tokHours?: number[];
  hours: number[];
  sessions: number;
  firstAt: number | null;
  lastAt: number | null;
  updatedAt: number;
}
type ActivityStore = Record<string, StoredDir>;

function readStore(file: string): ActivityStore {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return raw && typeof raw === 'object' ? (raw as ActivityStore) : {};
  } catch {
    return {};
  }
}

function writeStore(file: string, store: ActivityStore): void {
  try {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, file);
  } catch (e) {
    console.warn('[activity] no se pudo guardar', file, e instanceof Error ? e.message : e);
  }
}

function mergeDir(stored: StoredDir | undefined, live: ActivityStats): StoredDir {
  const days: Record<string, number> = { ...(stored?.days ?? {}) };
  for (const [k, v] of Object.entries(live.days)) days[k] = Math.max(days[k] ?? 0, v.prompts);
  const tokens: Record<string, TokenCounts> = { ...(stored?.tokens ?? {}) };
  for (const [k, t] of Object.entries(live.tokensByDay)) {
    const o = tokens[k] ?? zeroTokens();
    tokens[k] = { in: Math.max(o.in, t.in), out: Math.max(o.out, t.out), cacheW: Math.max(o.cacheW, t.cacheW), cacheR: Math.max(o.cacheR, t.cacheR) };
  }
  const hours = new Array<number>(24).fill(0).map((_, h) => Math.max(stored?.hours?.[h] ?? 0, live.hours[h] ?? 0));
  const tokHours = new Array<number>(24).fill(0).map((_, h) => Math.max(stored?.tokHours?.[h] ?? 0, live.tokensByHour[h] ?? 0));
  const min = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
  const max = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
  return {
    days,
    tokens,
    tokHours,
    hours,
    sessions: Math.max(stored?.sessions ?? 0, live.sessions),
    firstAt: min(stored?.firstAt ?? null, live.firstAt),
    lastAt: max(stored?.lastAt ?? null, live.lastAt),
    updatedAt: Date.now(),
  };
}

/** Estadísticas de uno o varios Directorios, fusionadas con la historia guardada en `file`. */
/** Por Directorio: lo vivo (transcripts) y lo fusionado con la historia; guarda si cambió. */
function persistedPerDir(dirs: Array<{ name: string; path: string }>, file: string): Array<{ name: string; live: ActivityStats; merged: StoredDir }> {
  const store = readStore(file);
  let changed = false;
  const out: Array<{ name: string; live: ActivityStats; merged: StoredDir }> = [];
  for (const d of dirs) {
    const s = activityStats([d.path]);
    const before = JSON.stringify(store[d.name] ? { ...store[d.name], updatedAt: 0 } : null);
    const m = mergeDir(store[d.name], s);
    if (JSON.stringify({ ...m, updatedAt: 0 }) !== before) {
      store[d.name] = m;
      changed = true;
    }
    out.push({ name: d.name, live: s, merged: m });
  }
  if (changed) writeStore(file, store);
  return out;
}

/** Tokens por Directorio en una ventana de días (0 = todo), con la historia guardada. */
export function tokenUsageByDir(dirs: Array<{ name: string; path: string }>, file: string, days: number): Array<{ name: string; tokens: TokenCounts; prompts: number }> {
  const since = days > 0 ? Date.now() - days * 86_400_000 : 0;
  return persistedPerDir(dirs, file).map(({ name, merged }) => {
    let tokens = zeroTokens();
    let prompts = 0;
    for (const [k, t] of Object.entries(merged.tokens ?? {})) if (Date.parse(k) + 86_400_000 >= since) tokens = addTokens(tokens, t);
    for (const [k, n] of Object.entries(merged.days)) if (Date.parse(k) + 86_400_000 >= since) prompts += n;
    return { name, tokens, prompts };
  });
}

/** Prompts humanos por día de cada Directorio, con la historia guardada. */
export function promptDaysByDir(dirs: Array<{ name: string; path: string }>, file: string): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const { name, merged } of persistedPerDir(dirs, file)) out[name] = merged.days;
  return out;
}

/** Prompts humanos por día de cada conversación de una carpeta. */
export function promptDaysBySession(cwd: string): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const f of sessionFiles(cwd)) {
    const stats = scanFile(f);
    if (!stats) continue;
    const days: Record<string, number> = {};
    for (const [k, v] of Object.entries(stats.days)) if (v.prompts > 0) days[k] = v.prompts;
    out[path.basename(f, '.jsonl')] = days;
  }
  return out;
}

export function persistedActivityStats(dirs: Array<{ name: string; path: string }>, file: string): ActivityStats {
  const per = persistedPerDir(dirs, file);
  const live = per.map((x) => x.live);
  const merged = per.map((x) => x.merged);

  // Agregado: prompts por día desde la historia; respuestas/herramientas solo de lo vivo.
  const days: Record<string, DayStats> = {};
  const hours = new Array<number>(24).fill(0);
  const tools: Record<string, number> = {};
  let sessions = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  let replies = 0;
  let toolCalls = 0;
  merged.forEach((m, i) => {
    for (const [k, v] of Object.entries(m.days)) (days[k] ??= { prompts: 0, replies: 0, tools: 0 }).prompts += v;
    for (let h = 0; h < 24; h++) hours[h] += m.hours[h];
    sessions += m.sessions;
    if (m.firstAt !== null && (firstAt === null || m.firstAt < firstAt)) firstAt = m.firstAt;
    if (m.lastAt !== null && (lastAt === null || m.lastAt > lastAt)) lastAt = m.lastAt;
    const l = live[i];
    replies += l.replies;
    toolCalls += l.tools;
    for (const [k, v] of Object.entries(l.days)) {
      const d = (days[k] ??= { prompts: 0, replies: 0, tools: 0 });
      d.replies += v.replies;
      d.tools += v.tools;
    }
    for (const t of l.topTools) tools[t.name] = (tools[t.name] ?? 0) + t.count;
  });
  let prompts = 0;
  let busiest: { day: string; prompts: number } | null = null;
  const now = Date.now();
  let last7 = 0;
  let last30 = 0;
  for (const [k, v] of Object.entries(days)) {
    prompts += v.prompts;
    if (!busiest || v.prompts > busiest.prompts) busiest = { day: k, prompts: v.prompts };
    const age = (now - Date.parse(k)) / 86_400_000;
    if (age <= 7) last7 += v.prompts;
    if (age <= 30) last30 += v.prompts;
  }
  let streak = 0;
  let cursor = new Date();
  if (!(days[dayKey(cursor.getTime())]?.prompts > 0)) cursor = new Date(cursor.getTime() - 86_400_000);
  while (days[dayKey(cursor.getTime())]?.prompts > 0) {
    streak++;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  const topTools = Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));
  const detected = mergeDetected(
    live.map((l) => ({
      mcp: Object.fromEntries(l.detected.mcp.map((m) => [m.id, m.count])),
      skills: Object.fromEntries(l.detected.skills.map((k) => [k.name, k.count])),
    })),
  );
  const tokensByDay: Record<string, TokenCounts> = {};
  for (const m of merged) for (const [k, t] of Object.entries(m.tokens ?? {})) tokensByDay[k] = addTokens(tokensByDay[k] ?? zeroTokens(), t);
  const tokens = Object.values(tokensByDay).reduce(addTokens, zeroTokens());
  const tokensByHour = new Array<number>(24).fill(0);
  for (const m of merged) for (let h = 0; h < 24; h++) tokensByHour[h] += m.tokHours?.[h] ?? 0;
  return { days, sessions, prompts, replies, tools: toolCalls, topTools, hours, firstAt, lastAt, streak, last7, last30, busiestDay: busiest, detected, tokensByDay, tokens, tokensByHour };
}


/** Prompts y tokens por hora dentro de los últimos `days` días (0 = todo), sumando los
 *  transcripts de las carpetas dadas. Para que las gráficas de horas/días respeten el filtro. */
export function windowedHours(cwds: string[], days: number): { hours: number[]; tokensByHour: number[] } {
  const hours = new Array<number>(24).fill(0);
  const tokensByHour = new Array<number>(24).fill(0);
  const cutoff = days > 0 ? dayKey(new Date(Date.now() - (days - 1) * 86_400_000)) : '';
  for (const cwd of cwds) {
    for (const f of sessionFiles(cwd)) {
      const s = scanFile(f);
      if (!s) continue;
      for (const [k, hs] of Object.entries(s.dayHours)) if (k >= cutoff) for (let h = 0; h < 24; h++) hours[h] += hs[h];
      for (const [k, hs] of Object.entries(s.dayTokHours)) if (k >= cutoff) for (let h = 0; h < 24; h++) tokensByHour[h] += hs[h];
    }
  }
  return { hours, tokensByHour };
}
