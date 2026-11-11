import { authHeaders } from './components/panel/api.js';

/**
 * Sube a Cubicle, para la pantalla externa, los agentes "Te necesita" (pendientes de
 * mirar) y el agente seleccionado en la oficina. Solo manda cuando algo cambia.
 */
let ids: number[] = [];
let selected: number | null = null;
let last = '';

function push(): void {
  const key = `${[...ids].sort((a, b) => a - b).join(',')}|${selected ?? ''}`;
  if (key === last) return;
  last = key;
  void fetch('./api/device/attention', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ids, selected }),
  }).catch(() => {
    last = ''; // se reintenta en el siguiente cambio
  });
}

export function pushDeviceAttention(next: number[]): void {
  ids = next;
  push();
}

export function pushDeviceSelected(id: number | null | undefined): void {
  selected = id ?? null;
  push();
}
