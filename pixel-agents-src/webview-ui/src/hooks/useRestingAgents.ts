import { useCallback, useEffect, useState } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';

/** Días sin prompt humano tras los cuales un agente se va al sofá de su sala. */
export const REST_AFTER_DAYS = 14;
const POLL_MS = 60_000;
const TICK_MS = 5000;
/**
 * Zona de descanso: cada minuto se consulta la última actividad real de cada
 * sesión (/api/activity); más de REST_AFTER_DAYS sin trabajar → al sofá, hasta
 * que vuelva. Expone el estado y las acciones manuales (💤 / ☀️).
 */
export function useRestingAgents(enabled: boolean, getOfficeState: () => OfficeState) {
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch('./api/activity', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as Record<number, { lastActivityAt: number | null }>;
        if (!alive) return;
        const map: Record<number, number | null> = {};
        for (const [id, v] of Object.entries(data)) map[Number(id)] = v.lastActivityAt;
        getOfficeState().applyActivity(map, REST_AFTER_DAYS * 86_400_000);
      } catch {
        /* servidor viejo: sin zona de descanso */
      }
    };
    void poll();
    const t = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [enabled, getOfficeState]);

  // Las tarjetas releen isResting con cada tick (el estado vive en OfficeState).
  const [restTick, setRestTick] = useState(0);
  const isResting = useCallback(
    (id: number) => getOfficeState().isResting(id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [restTick, getOfficeState],
  );
  const rest = useCallback((id: number) => {
    getOfficeState().forceRest(id);
    setRestTick((t) => t + 1);
  }, [getOfficeState]);
  const wake = useCallback((id: number) => {
    getOfficeState().wakeUp(id);
    setRestTick((t) => t + 1);
  }, [getOfficeState]);
  useEffect(() => {
    const t = window.setInterval(() => setRestTick((x) => x + 1), TICK_MS);
    return () => window.clearInterval(t);
  }, []);

  return { isResting, rest, wake };
}
