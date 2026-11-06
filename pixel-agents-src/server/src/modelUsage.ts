/**
 * Uso por modelo en una ventana de días, leído de TODOS los transcripts de Claude
 * Code (~/.claude/projects, subagentes incluidos): el límite semanal es de la cuenta,
 * no solo de la oficina. Da la proporción real de tokens de cada modelo en la semana.
 * También guarda el último aviso de límite de Fable y su última respuesta, para `fableLeft`.
 * Cada respuesta se cuenta una vez (varios registros comparten message.id).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ModelUsage {
  model: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  replies: number;
}

let cache: { key: string; at: number; data: ModelUsage[] } | null = null;
const FABLE_LIMIT = /(reached|hit) your Fable\b[^.]*\blimit/i;
const CACHE_MS = 300_000;
const WEEK_S = 7 * 86_400;
/** Último aviso de límite de Fable y última respuesta real de Fable (ms). */
let fableSeen: { at: number; reachedAt: number; lastReplyAt: number } | null = null;

export interface FableLeft {
  /** Porcentaje que queda; null si no se puede saber. */
  remaining: number | null;
  /** De dónde sale: aviso de límite, caché de Claude Code o sin uso desde el reinicio. */
  source: 'notice' | 'cache' | 'unused' | null;
  /** Cuándo se obtuvo el dato o llegó el aviso (ms). */
  at: number | null;
}

/**
 * Cuánto queda de Fable, que tiene un límite aparte con el mismo reinicio que el semanal.
 * Nunca da por bueno un dato de una ventana anterior. Tiempos en ms; `resetsAt` (el reinicio
 * semanal), en segundos.
 */
export function fableLeft(
  o: { reachedAt: number; lastReplyAt: number; resetsAt?: number; cached?: { percent: number; resetsAt: number; fetchedAt: number } | null },
  now: number,
): FableLeft {
  const windowStart = o.resetsAt ? (o.resetsAt - WEEK_S) * 1000 : now - WEEK_S * 1000;
  const inWindow = !o.resetsAt || now < o.resetsAt * 1000;
  if (o.reachedAt && o.reachedAt >= o.lastReplyAt && o.reachedAt >= windowStart && inWindow) return { remaining: 0, source: 'notice', at: o.reachedAt };
  const c = o.cached;
  if (c && c.resetsAt > now && c.fetchedAt >= windowStart) return { remaining: Math.max(0, 100 - c.percent), source: 'cache', at: c.fetchedAt };
  if (o.resetsAt && inWindow && o.lastReplyAt < windowStart) return { remaining: 100, source: 'unused', at: null };
  return { remaining: null, source: null, at: null };
}

/** Aviso y última respuesta de Fable de la última semana (se recalcula como mucho cada 5 min). */
export function fableLimitState(): { reachedAt: number; lastReplyAt: number } {
  if (!fableSeen || Date.now() - fableSeen.at >= CACHE_MS) {
    cache = null;
    usageByModel(7);
  }
  return { reachedAt: fableSeen?.reachedAt ?? 0, lastReplyAt: fableSeen?.lastReplyAt ?? 0 };
}

function* jsonlFiles(dir: string, since: number): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsonlFiles(p, since);
    else if (e.name.endsWith('.jsonl')) {
      try {
        if (fs.statSync(p).mtimeMs >= since) yield p;
      } catch {
        /* borrado mientras se lee */
      }
    }
  }
}

export function usageByModel(days: number): ModelUsage[] {
  const key = String(days);
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.data;
  const since = Date.now() - days * 86_400_000;
  const root = path.join(os.homedir(), '.claude', 'projects');
  const seen = new Set<string>();
  const by = new Map<string, ModelUsage>();
  let reachedAt = 0;
  let lastReplyAt = 0;
  for (const file of jsonlFiles(root, since)) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (line.includes('"rate_limit"') && FABLE_LIMIT.test(line)) {
        try {
          const r = JSON.parse(line) as { error?: string; timestamp?: string };
          if (r.error === 'rate_limit' && r.timestamp) reachedAt = Math.max(reachedAt, Date.parse(r.timestamp));
        } catch {
          /* línea incompleta */
        }
      }
      if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
      let rec: { type?: string; timestamp?: string; message?: { id?: string; model?: string; usage?: Record<string, number> } };
      try {
        rec = JSON.parse(line) as typeof rec;
      } catch {
        continue;
      }
      const m = rec.message;
      if (rec.type !== 'assistant' || !m?.usage || !m.model || m.model === '<synthetic>') continue;
      if (!rec.timestamp || Date.parse(rec.timestamp) < since) continue;
      if (m.model.startsWith('claude-fable')) lastReplyAt = Math.max(lastReplyAt, Date.parse(rec.timestamp));
      if (m.id) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
      }
      const u = m.usage;
      const row = by.get(m.model) ?? { model: m.model, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, replies: 0 };
      row.input += u.input_tokens ?? 0;
      row.output += u.output_tokens ?? 0;
      row.cacheWrite += u.cache_creation_input_tokens ?? 0;
      row.cacheRead += u.cache_read_input_tokens ?? 0;
      row.replies += 1;
      by.set(m.model, row);
    }
  }
  const data = [...by.values()].sort((a, b) => b.output - a.output);
  cache = { key, at: Date.now(), data };
  if (days >= 7) fableSeen = { at: Date.now(), reachedAt, lastReplyAt };
  return data;
}
