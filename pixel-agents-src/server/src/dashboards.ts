/**
 * Dashboards por sesión: archivos HTML autocontenidos que cada sesión de Claude
 * genera en ~/.pixel-agents/dashboards/<Nombre>.html (Nombre = directorio de la
 * oficina, p. ej. "Finanzas", "Gym", "Empresa"). El panel izquierdo
 * los muestra en un iframe y los recarga cuando cambian.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR } from './constants.js';

export function dashboardsDir(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, 'dashboards');
}

function safeName(name: string): string | null {
  const n = name.trim();
  if (!n || n.length > 80 || /[\/\\\0]/.test(n) || n.startsWith('.')) return null;
  return n;
}

export interface DashboardInfo {
  name: string;
  exists: boolean;
  mtime: number | null;
  path: string;
}

export function dashboardInfo(name: string): DashboardInfo | null {
  const n = safeName(name);
  if (!n) return null;
  const file = path.join(dashboardsDir(), `${n}.html`);
  try {
    const st = fs.statSync(file);
    return { name: n, exists: st.isFile(), mtime: st.mtimeMs, path: file };
  } catch {
    return { name: n, exists: false, mtime: null, path: file };
  }
}

export function readDashboard(name: string): string | null {
  const info = dashboardInfo(name);
  if (!info || !info.exists) return null;
  try {
    return fs.readFileSync(info.path, 'utf8');
  } catch {
    return null;
  }
}

export function ensureDashboardsDir(): void {
  fs.mkdirSync(dashboardsDir(), { recursive: true });
}
