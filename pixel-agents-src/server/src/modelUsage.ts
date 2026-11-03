/**
 * Uso por modelo en una ventana de días, leído de TODOS los transcripts de Claude
 * Code (~/.claude/projects, subagentes incluidos): el límite semanal es de la cuenta,
 * no solo de la oficina. Claude Code no envía a la statusline el límite por modelo,
 * así que esto da la proporción real de tokens de cada modelo en la semana.
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
  if (cache && cache.key === key && Date.now() - cache.at < 300_000) return cache.data;
  const since = Date.now() - days * 86_400_000;
  const root = path.join(os.homedir(), '.claude', 'projects');
  const seen = new Set<string>();
  const by = new Map<string, ModelUsage>();
  for (const file of jsonlFiles(root, since)) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
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
  return data;
}
