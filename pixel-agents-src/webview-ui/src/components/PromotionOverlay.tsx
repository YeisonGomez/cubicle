import type { MutableRefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

import { EVOLUTION_CHECK_MS, PROMOTION_CONFETTI } from '../constants.js';
import { useT } from '../i18n/index.js';
import { playDoneSound } from '../notificationSound.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { ackPromotion, clearPrompted, getSkin, RANK_KEYS, wasPrompted } from '../skin.js';
import { spotlightAgent } from './spotlightAgent.js';

const CONFETTI_COLORS = ['bg-xp', 'bg-accent-bright', 'bg-status-success', 'bg-status-permission', 'bg-danger'];

/**
 * Ascenso de rango en el tema clásico: la cámara se centra en el personaje, cae confeti y
 * una tarjeta anuncia el rango. Como la evolución, espera a que haya pestaña visible y
 * personaje: un ascenso no se pierde.
 */
export function PromotionOverlay({ getOfficeState, panRef, paused }: { getOfficeState: () => OfficeState; panRef: MutableRefObject<{ x: number; y: number }>; paused: boolean }) {
  const { t } = useT();
  const [current, setCurrent] = useState<{ agent: string; rank: number } | null>(null);
  const played = useRef(new Set<string>());

  useEffect(() => {
    if (current || paused) return;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      const os = getOfficeState();
      for (const [agent, a] of Object.entries(getSkin().ranks ?? {})) {
        if (!a.promoted || !wasPrompted(agent) || played.current.has(`${agent}:${a.promoted.rank}`)) continue;
        if ([...os.characters.values()].some((c) => c.directoryName === agent && !c.isSubagent)) {
          played.current.add(`${agent}:${a.promoted.rank}`);
          clearPrompted(agent);
          setCurrent({ agent, rank: a.promoted.rank });
          return;
        }
      }
    };
    check();
    const id = setInterval(check, EVOLUTION_CHECK_MS);
    return () => clearInterval(id);
  }, [current, paused, getOfficeState]);

  useEffect(() => {
    if (!current) return;
    const restore = spotlightAgent(getOfficeState(), panRef, current.agent);
    void playDoneSound();
    void ackPromotion(current.agent, current.rank);
    // Queda abierta hasta cerrarla: el confeti cae unos segundos y la tarjeta se queda.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCurrent(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      restore();
    };
  }, [current, getOfficeState, panRef]);

  if (!current) return null;
  return (
    <div className="absolute inset-0 z-[120] pointer-events-none overflow-hidden flex flex-col items-center justify-end bg-black/40" role="status">
      {Array.from({ length: PROMOTION_CONFETTI }, (_, i) => (
        <span
          key={i}
          className={`confetti ${CONFETTI_COLORS[i % CONFETTI_COLORS.length]}`}
          style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i * 113) % 1500}ms`, animationDuration: `${2500 + ((i * 71) % 1500)}ms` }}
        />
      ))}
      <div className="mb-[10%] max-w-[90%] bg-bg-dark border-2 border-border px-24 py-16 text-text text-center text-[24px] leading-snug" style={{ boxShadow: 'var(--shadow-pixel)' }}>
        <div className="text-text-muted text-[16px] mb-6">{current.agent}</div>
        {t('promotion.done', { rank: t(RANK_KEYS[current.rank]) })}
        <button type="button" className="pointer-events-auto mt-14 block mx-auto px-16 py-6 bg-accent text-white text-[16px] hover:bg-accent-bright" onClick={() => setCurrent(null)}>
          {t('evolution.close')}
        </button>
      </div>
    </div>
  );
}
