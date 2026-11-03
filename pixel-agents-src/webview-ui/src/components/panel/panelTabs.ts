/** Pestañas del panel y la regla de "pestaña preferida": la última que eligió el
 *  usuario se recuerda (localStorage) al cambiar de agente/sala; si no aplica al
 *  nuevo objetivo (Cambios sin repo, Dashboard sin HTML, Configuración en una
 *  sala) se muestra la mejor alternativa sin perder la preferencia. */
export type RoomTab = 'notas' | 'cambios' | 'dashboard' | 'prs' | 'actividad' | 'capacidades' | 'ajustes';

export const TAB_KEY = 'pixel-agents.panelTab';
export const TABS: RoomTab[] = ['notas', 'cambios', 'dashboard', 'prs', 'actividad', 'capacidades', 'ajustes'];

/** Pestañas "de inicio" (las de la fila de pestañas, no las de los botones de la cabecera). */
export const HOME_TABS: RoomTab[] = ['notas', 'cambios', 'dashboard', 'prs'];

export function readPrefTab(): RoomTab {
  try {
    const v = localStorage.getItem(TAB_KEY) as RoomTab | null;
    if (v && TABS.includes(v)) return v;
  } catch {
    /* sin almacenamiento */
  }
  return 'notas';
}

export function writePrefTab(t: RoomTab): void {
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    /* sin almacenamiento */
  }
}

export interface TabContext {
  agent: boolean;
  code: boolean;
  dash: boolean;
  /** Revisión de PRs activada en Configuración. */
  prs?: boolean;
}

/** La pestaña preferida si aplica al objetivo; si no, la mejor alternativa. */
export function resolveTab(pref: RoomTab, ctx: TabContext): RoomTab {
  const ok: Record<RoomTab, boolean> = {
    notas: true,
    cambios: ctx.code,
    dashboard: true,
    prs: ctx.agent && ctx.prs === true,
    actividad: true,
    capacidades: true,
    ajustes: ctx.agent,
  };
  if (ok[pref]) return pref;
  if (pref === 'cambios' && ok.dashboard) return 'dashboard';
  if (pref === 'dashboard' && ok.cambios) return 'cambios';
  if (pref === 'ajustes' && ok.cambios) return 'cambios';
  if (pref === 'prs') return ok.cambios ? 'cambios' : 'dashboard';
  return 'notas';
}

/** Pestaña de inicio para un objetivo: Cambios si hay repo, Dashboard si hay HTML, si no Notas. */
export function homeTab(ctx: TabContext): RoomTab {
  if (!ctx.agent) return 'notas'; // tablero de la sala: siempre Notas
  return ctx.code ? 'cambios' : ctx.dash ? 'dashboard' : 'notas';
}
