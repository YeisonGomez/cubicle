/** Tipos y llamadas HTTP del panel izquierdo (espejo de server/src/agentProjects.ts). */
import { serverToken } from '../../transport/serverToken.js';

/** Qué muestra el panel izquierdo: una sala (tablero) o un agente (clic en el personaje). */
/** `tab` en una sala: pestaña con la que se abre (TV → 'dashboard'); si no, la preferida. */
export type PanelTarget = { kind: 'room'; area: string; tab?: 'notas' | 'cambios' | 'dashboard' } | { kind: 'agent'; name: string; area: string | null };

export interface AgentSettings {
  kind: 'code' | 'personal';
  projects: string[];
  dashboardDirs: string[];
  /** Pestaña PRs activada (revisión de pull requests con gh). */
  prReview?: boolean;
}
export interface ProjectRef {
  name: string;
  path: string;
  /** Rama actual (null si no es repo o está en detached). */
  branch?: string | null;
}
export interface DashboardRef {
  key: string;
  label: string;
  project?: string;
  sub?: string;
  dir: string;
  file: string;
  mtime: number;
  url: string;
}
export interface DashboardDirSuggestion {
  dir: string;
  html: number;
  bases: string[];
}
export interface AgentInfo {
  name: string;
  path: string | null;
  settings: AgentSettings;
  kindInferred: boolean;
  projects: ProjectRef[];
  dashboards: DashboardRef[];
  /** Carpetas con *.html que aún no están en dashboardDirs (para ofrecerlas). */
  dashboardSuggestions: DashboardDirSuggestion[];
}

export const authHeaders = (): Record<string, string> =>
  serverToken ? { Authorization: `Bearer ${serverToken}` } : {};

export async function fetchInfo(name: string): Promise<AgentInfo> {
  const res = await fetch(`./api/agents/${encodeURIComponent(name)}/info`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/agents/${name}/info ${res.status}`);
  return (await res.json()) as AgentInfo;
}

export async function putSettings(name: string, settings: AgentSettings): Promise<AgentInfo> {
  const res = await fetch(`./api/agents/${encodeURIComponent(name)}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`PUT settings ${res.status}`);
  return (await res.json()) as AgentInfo;
}

/** Borra un reporte (archivo HTML) de su carpeta. */
export async function deleteDashboard(d: DashboardRef): Promise<void> {
  const res = await fetch(`./api/dash/${d.key}/${encodeURIComponent(d.file)}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `HTTP ${res.status}`);
  }
}
