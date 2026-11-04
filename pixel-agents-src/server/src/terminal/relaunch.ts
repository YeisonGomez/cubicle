/**
 * Relanzar las sesiones de la oficina tras reiniciar el servidor: para cada
 * Directorio registrado, reanuda (`claude --resume`) la conversación más
 * reciente de esa carpeta. Así un reinicio no obliga a abrir 9 terminales y
 * elegir cada conversación a mano.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { capabilitiesPromptFor, ensureProjectContext } from '../capabilitiesPrompt.js';
import { transcriptLastActivity } from '../agentProjects.js';
import { readConfig } from '../configPersistence.js';
import type { LaunchStandaloneAgentDeps } from './standaloneAgentLauncher.js';
import { launchStandaloneAgent } from './standaloneAgentLauncher.js';

export interface RelaunchResult {
  directory: string;
  sessionId: string | null;
  agentId: number | null;
  skipped?: string;
}

/** Sesión más reciente (por fecha de modificación) de una carpeta de trabajo. */
export function latestSessionId(deps: LaunchStandaloneAgentDeps, cwd: string): string | null {
  // Claude guarda el transcript bajo la ruta REAL del cwd (p. ej. /tmp → /private/tmp),
  // así que se consultan la ruta dada y su realpath.
  const candidates = new Set<string>([cwd]);
  try {
    candidates.add(fs.realpathSync(cwd));
  } catch {
    /* se queda solo cwd */
  }
  const dirs = [...candidates].flatMap((c) => deps.provider.getSessionDirs?.(c) ?? []);
  // Se prefiere la conversación más reciente CON prompts humanos: una terminal
  // abierta y cerrada sin escribir deja un transcript nuevo pero vacío.
  const all: Array<{ id: string; mtime: number; file: string }> = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      if (!st.isFile() || st.size < 200) continue; // transcripts vacíos o abortados
      all.push({ id: name.slice(0, -'.jsonl'.length), mtime: st.mtimeMs, file });
    }
  }
  all.sort((a, b) => b.mtime - a.mtime);
  const withPrompts = all.find((c) => transcriptLastActivity(c.file) !== null);
  return (withPrompts ?? all[0])?.id ?? null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Procesos `claude` vivos en esta máquina (sin los de nuestras terminales): pid, argv y cwd.
 *  Es la prueba real de "conversación abierta en otra terminal"; el mtime del transcript
 *  no sirve, porque justo tras reiniciar la oficina todos los transcripts son recientes. */
function liveClaudeProcesses(ownPids: Set<number>): Array<{ pid: number; argv: string; cwd: string | null; ppid?: number }> {
  const procs: Array<{ pid: number; argv: string; cwd: string | null; ppid?: number }> = [];
  if (process.platform === 'win32') {
    // Windows: lista de procesos por PowerShell (sin cwd: solo se reconoce por --resume <id>).
    try {
      const out = execFileSync(
        'powershell',
        ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*claude*' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"],
        { encoding: 'utf8', timeout: 8000 },
      );
      const parsed = out.trim() ? (JSON.parse(out) as { ProcessId: number; CommandLine: string | null } | Array<{ ProcessId: number; CommandLine: string | null }>) : [];
      for (const p of Array.isArray(parsed) ? parsed : [parsed]) {
        const argv = p.CommandLine ?? '';
        if (!/claude(\.exe|\.cmd|")?\s/.test(argv + ' ') || /chrome-native-host/.test(argv) || ownPids.has(p.ProcessId)) continue;
        procs.push({ pid: p.ProcessId, argv, cwd: null });
      }
    } catch {
      /* sin PowerShell: no se puede saber */
    }
    return procs;
  }
  let ps: string;
  try {
    ps = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', timeout: 5000 });
  } catch {
    return [];
  }
  for (const line of ps.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const argv = m[3];
    if (!/(^|\/)claude(\s|$)/.test(argv) || /chrome-native-host/.test(argv) || ownPids.has(pid)) continue;
    procs.push({ pid, argv, cwd: null, ppid: Number(m[2]) });
  }
  if (procs.length === 0) return procs;
  try {
    const out = execFileSync('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', procs.map((p) => p.pid).join(',')], { encoding: 'utf8', timeout: 5000 });
    let cur: number | null = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('p')) cur = Number(line.slice(1));
      else if (line.startsWith('n') && cur !== null) {
        const proc = procs.find((p) => p.pid === cur);
        if (proc) proc.cwd = line.slice(1);
      }
    }
  } catch {
    // Sin lsof (Linux): el cwd está en /proc/<pid>/cwd.
    for (const p of procs) {
      try {
        p.cwd = fs.readlinkSync(`/proc/${p.pid}/cwd`);
      } catch {
        /* solo se podrá reconocer por --resume <id> */
      }
    }
  }
  return procs;
}

/**
 * Terminales huérfanas de la oficina: procesos `claude` hijos de ESTE servidor que ya no
 * pertenecen a ningún agente (p. ej. el de un agente borrado). No son "otra terminal":
 * se cierran, para que no bloqueen el lanzamiento de un agente nuevo en esa carpeta.
 * `paths` limita a las que trabajan en esas carpetas (o subcarpetas).
 */
export function killStrayOfficeClaude(deps: LaunchStandaloneAgentDeps, paths?: string[]): number {
  if (process.platform === 'win32') return 0;
  const ownPids = new Set<number>();
  for (const a of deps.store.values()) {
    const pid = deps.ptyManager.get(a.id)?.pid;
    if (typeof pid === 'number') ownPids.add(pid);
  }
  const roots = (paths ?? []).flatMap((p) => {
    try {
      return [p, fs.realpathSync(p)];
    } catch {
      return [p];
    }
  });
  let n = 0;
  for (const pr of liveClaudeProcesses(ownPids)) {
    if (pr.ppid !== process.pid) continue;
    if (roots.length > 0 && !(pr.cwd && roots.some((r) => pr.cwd === r || pr.cwd!.startsWith(r + path.sep)))) continue;
    try {
      process.kill(pr.pid, 'SIGTERM');
      n++;
      console.log(`[Pixel Agents] Terminal huérfana cerrada (pid ${pr.pid}, ${pr.cwd ?? '?'})`);
    } catch {
      /* ya terminó */
    }
  }
  return n;
}

/** ¿La conversación sigue abierta en otra terminal? Hay un proceso `claude` ajeno a la
 *  oficina reanudando ese id, o trabajando en esa carpeta. */
function isLiveElsewhere(deps: LaunchStandaloneAgentDeps, cwd: string, sessionId: string, procs: ReturnType<typeof liveClaudeProcesses>): boolean {
  void deps;
  const targets = new Set<string>([cwd]);
  try {
    targets.add(fs.realpathSync(cwd));
  } catch {
    /* solo cwd */
  }
  return procs.some((p) => p.argv.includes(sessionId) || (p.cwd !== null && targets.has(p.cwd)));
}

/**
 * Reanuda una sesión por Directorio. Omite directorios que ya tienen un agente
 * de terminal vivo. Si la conversación ya estaba adoptada como externa (la
 * sesión vieja aún corría en otra terminal), se retira ese agente externo para
 * que no quede un gemelo.
 */
export async function relaunchAll(
  deps: LaunchStandaloneAgentDeps,
  options: { bypassPermissions?: boolean; delayMs?: number; only?: string[]; launchNew?: boolean; askCapabilities?: boolean } = {},
): Promise<RelaunchResult[]> {
  const { store, runtime, ptyManager } = deps;
  const results: RelaunchResult[] = [];
  if (!ptyManager.isAvailable()) {
    console.error('[Pixel Agents] Relaunch: terminal no disponible');
    return results;
  }
  const dirs = readConfig().directories.filter(
    (d) => !options.only || options.only.includes(d.name) || options.only.includes(d.path),
  );
  // Terminales de la oficina sin agente en estas carpetas (p. ej. de un agente borrado): se cierran antes.
  killStrayOfficeClaude(deps, dirs.map((d) => d.path));
  const ownPids = new Set<number>();
  for (const a of store.values()) {
    const pid = ptyManager.get(a.id)?.pid;
    if (typeof pid === 'number') ownPids.add(pid);
  }
  // Los hijos de este servidor no son "otra terminal" (son terminales de la oficina sin agente).
  const procs = liveClaudeProcesses(ownPids).filter((p) => p.ppid !== process.pid);
  for (const d of dirs) {
    const cwd = d.path;
    if (!fs.existsSync(cwd)) {
      results.push({ directory: d.name, sessionId: null, agentId: null, skipped: 'carpeta inexistente' });
      continue;
    }
    const alreadyLive = [...store.values()].some(
      (a) => !a.isExternal && a.directoryName === d.name && ptyManager.has(a.id),
    );
    if (alreadyLive) {
      results.push({ directory: d.name, sessionId: null, agentId: null, skipped: 'ya tiene terminal' });
      continue;
    }
    const sessionId = latestSessionId(deps, cwd);
    // Otro Directorio con la misma carpeta ya reanudó esa conversación → este abre una nueva.
    const takenBy = sessionId ? [...store.values()].find((a) => !a.isExternal && a.sessionId === sessionId && ptyManager.has(a.id)) : undefined;
    // Conversación VIVA en otra terminal (fuera de la oficina): su transcript cambió hace
    // poco y la observamos como externa → reanudarla crearía un gemelo; se abre una nueva.
    const liveElsewhere = sessionId ? isLiveElsewhere(deps, cwd, sessionId, procs) : false;
    if (liveElsewhere) {
      // La oficina ya la observa como sesión externa: abrir otra terminal crearía un
      // gemelo y llenaría los escritorios. Se deja esa y no se lanza nada.
      console.log(`[Pixel Agents] Relaunch: ${d.name} tiene su conversación abierta en otra terminal; se observa esa`);
      results.push({ directory: d.name, sessionId, agentId: null, skipped: 'conversación abierta fuera de la oficina' });
      continue;
    }
    const resumeId = takenBy ? null : sessionId;
    if (!resumeId && options.launchNew === false) {
      results.push({ directory: d.name, sessionId: null, agentId: null, skipped: 'sin sesiones previas' });
      continue;
    }
    // Retirar el agente externo que ya observe esa misma conversación (solo si la vamos a reanudar).
    for (const a of [...store.values()]) {
      if (resumeId && a.isExternal && a.sessionId === resumeId) {
        runtime.unregisterAgent(a.sessionId);
        runtime.closeAgent(a.id);
      }
    }
    // Sin sesiones previas (proyecto recién creado): se abre una conversación nueva.
    // Primera vez sin declaración de capacidades: la pregunta va como prompt inicial.
    ensureProjectContext(d.name);
    const initialPrompt = options.askCapabilities === false ? null : capabilitiesPromptFor(d.name);
    const agentId = launchStandaloneAgent(deps, {
      directoryPath: cwd,
      directoryName: d.name,
      bypassPermissions: options.bypassPermissions,
      ...(resumeId ? { resumeSessionId: resumeId } : {}),
      ...(initialPrompt ? { initialPrompt } : {}),
    });
    results.push({ directory: d.name, sessionId: resumeId, agentId });
    console.log(
      `[Pixel Agents] Relaunch: ${d.name} -> ${agentId === null ? 'FALLÓ' : `agente ${agentId}`} (${resumeId ? `sesión ${resumeId.slice(0, 8)}…` : 'conversación nueva'})`,
    );
    await sleep(options.delayMs ?? 1500);
  }
  return results;
}
