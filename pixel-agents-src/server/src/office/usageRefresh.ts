/**
 * Consumo de la cuenta al día sin terminales.
 *
 * `usage.json` lo escribe la statusline de Claude Code, que solo corre en una terminal. Con las
 * sesiones en la app de Claude deja de actualizarse y la barra y la pantalla externa se quedaban
 * sin dato de la semana ni de Fable. `claude -p /usage` es un comando local (no llama al modelo
 * ni guarda sesión) que consulta los límites del plan y los deja en `~/.claude.json`
 * (`cachedUsageUtilization`), que es lo que lee statsRoutes.ts.
 *
 * Se corre solo si `usage.json` está viejo, como mucho cada REFRESH_MS.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

import { usageFile } from '../officePaths.js';

/** Cada cuánto se refresca como mucho. */
export const REFRESH_MS = 10 * 60_000;
/** usage.json más nuevo que esto = hay una terminal con statusline: no hace falta. */
const FRESH_MS = 10 * 60_000;
const RUN_TIMEOUT_MS = 60_000;
const FIRST_DELAY_MS = 30_000;

let running = false;

/** ¿Hace falta refrescar? Solo si usage.json no existe o tiene más de FRESH_MS. */
export function needsRefresh(now = Date.now(), file = usageFile()): boolean {
  try {
    return now - fs.statSync(file).mtimeMs > FRESH_MS;
  } catch {
    return true;
  }
}

/** Corre `claude -p /usage` desde el shell de inicio (pone `claude` en el PATH). */
export function refreshUsage(): Promise<boolean> {
  if (running || process.env.OFICINA_NO_USAGE_REFRESH === '1') return Promise.resolve(false);
  running = true;
  return new Promise((resolve) => {
    const flags = ['-p', '/usage', '--no-session-persistence', '--output-format', 'text'];
    const win = process.platform === 'win32';
    const child = win
      ? spawn('claude', flags, { cwd: os.tmpdir(), stdio: 'ignore', shell: true })
      : spawn(process.env.SHELL ?? '/bin/bash', ['-lc', 'exec claude "$@"', 'claude', ...flags], { cwd: os.tmpdir(), stdio: 'ignore' });
    const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      running = false;
      resolve(ok);
    };
    child.on('error', () => done(false));
    child.on('close', (code) => done(code === 0));
  });
}

/** Arranca el refresco periódico. Devuelve una función para pararlo. */
export function startUsageRefresh(): () => void {
  const tick = () => {
    if (needsRefresh()) void refreshUsage();
  };
  const first = setTimeout(tick, FIRST_DELAY_MS);
  const every = setInterval(tick, REFRESH_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
