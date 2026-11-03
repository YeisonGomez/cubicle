import { serverToken } from './transport/serverToken.js';

/**
 * Sincroniza con el servidor (`/api/ui-prefs`, en <oficina>/ui-prefs.json) las
 * preferencias de la interfaz que antes vivían solo en localStorage y se perdían
 * al cambiar de origen o de navegador. Al arrancar, lo del servidor se copia a
 * localStorage (el código sigue leyendo de ahí); cada escritura de una clave
 * sincronizada se envía al servidor agrupada (300 ms).
 */
const SYNCED = new Set([
  'pixel-agents.pinnedAgents',
  'pixel-agents.cardOrder',
  'pixel-agents.groupOrder',
  'pixel-agents.collapsedGroups',
  'pixel-agents.forcedRest',
  'pixel-agents.panelWidth',
  'pixel-agents.terminalWidth',
  'pixel-agents.panelTab',
  'pixel-agents.lang',
]);

const pending: Record<string, string | null> = {};
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  timer = null;
  const body = { ...pending };
  for (const k of Object.keys(pending)) delete pending[k];
  if (!serverToken || Object.keys(body).length === 0) return;
  void fetch('./api/ui-prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serverToken}` },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

function queue(key: string, value: string | null): void {
  if (!SYNCED.has(key)) return;
  pending[key] = value;
  if (!timer) timer = setTimeout(flush, 300);
}

export async function initPrefsSync(): Promise<void> {
  let remote: Record<string, string> = {};
  try {
    const r = await fetch('./api/ui-prefs', { cache: 'no-store' });
    if (r.ok) remote = (await r.json()) as Record<string, string>;
  } catch {
    /* sin servidor (modo dev): solo localStorage */
  }
  try {
    for (const k of SYNCED) {
      if (typeof remote[k] === 'string') localStorage.setItem(k, remote[k]);
      else {
        // Primera vez: lo que ya había en este navegador sube al servidor.
        const local = localStorage.getItem(k);
        if (local !== null) queue(k, local);
      }
    }
    const proto = Storage.prototype;
    const set = proto.setItem;
    const remove = proto.removeItem;
    proto.setItem = function (this: Storage, key: string, value: string) {
      set.call(this, key, value);
      if (this === window.localStorage) queue(key, String(value));
    };
    proto.removeItem = function (this: Storage, key: string) {
      remove.call(this, key);
      if (this === window.localStorage) queue(key, null);
    };
  } catch {
    /* localStorage bloqueado */
  }
}
