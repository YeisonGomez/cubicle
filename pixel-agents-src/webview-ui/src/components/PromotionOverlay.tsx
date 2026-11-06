import type { MutableRefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

import { EVOLUTION_CHECK_MS, PROMOTION_CONFETTI, PROMOTION_MS } from '../constants.js';
import { useT } from '../i18n/index.js';
import { playDoneSound } from '../notificationSound.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { ackPromotion, getSkin, RANK_KEYS } from '../skin.js';
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
        if (!a.promoted || played.current.has(`${agent}:${a.promoted.rank}`)) continue;
        if ([...os.characters.values()].some((c) => c.directoryName === agent && !c.isSubagent)) {
          played.current.add(`${agent}:${a.promoted.rank}`);
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
    const end = setTimeout(() => {
      void ackPromotion(current.agent, current.rank);
      setCurrent(null);
    }, PROMOTION_MS);
    return () => {
      clearTimeout(end);
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
      <div className="mb-[12%] max-w-[90%] bg-bg-dark border-2 border-border px-16 py-10 text-text text-center text-[16px]" style={{ boxShadow: 'var(--shadow-pixel)' }}>
        <div className="text-text-muted text-[12px] mb-4">{current.agent}</div>
        {t('promotion.done', { rank: t(RANK_KEYS[current.rank]) })}
      </div>
    </div>
  );
}
