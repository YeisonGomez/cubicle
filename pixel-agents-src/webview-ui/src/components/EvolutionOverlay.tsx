import type { MutableRefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

import { EVOLUTION_CHECK_MS, EVOLUTION_FLASH_MS, EVOLUTION_FLICKER_MS, EVOLUTION_INTRO_MS, EVOLUTION_SPRITE_PX, EVOLUTION_SWAPS } from '../constants.js';
import { useT } from '../i18n/index.js';
import { playDoneSound } from '../notificationSound.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { ackEvolution, getSkin, type AgentSkin } from '../skin.js';
import { spotlightAgent } from './spotlightAgent.js';

type Evolving = NonNullable<AgentSkin['evolving']> & { agent: string };
type Phase = 'intro' | 'flicker' | 'flash' | 'done';

function load(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = url;
  });
}

/**
 * Evolución de un Pokémon, como en Game Boy: la cámara se centra en el personaje, la
 * oficina se oscurece y la silueta alterna entre las dos formas cada vez más rápido
 * hasta un destello (unos 6 s). Al terminar queda abierta hasta que la cierras (botón o
 * Esc): si enviaste el prompt y no estabas mirando, no te la pierdes. No bloquea el resto
 * de la interfaz. Si no hay pestaña visible o su personaje no está, espera.
 */
export function EvolutionOverlay({ getOfficeState, panRef, paused }: { getOfficeState: () => OfficeState; panRef: MutableRefObject<{ x: number; y: number }>; paused: boolean }) {
  const { t } = useT();
  const [current, setCurrent] = useState<Evolving | null>(null);
  const [phase, setPhase] = useState<Phase>('intro');
  const [showNew, setShowNew] = useState(false);
  const played = useRef(new Set<string>());

  // Busca la siguiente evolución pendiente.
  useEffect(() => {
    if (current || paused) return;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      const os = getOfficeState();
      for (const [agent, a] of Object.entries(getSkin().agents)) {
        if (!a.evolving || played.current.has(`${agent}:${a.evolving.stage}`)) continue;
        if ([...os.characters.values()].some((c) => c.directoryName === agent && !c.isSubagent)) {
          played.current.add(`${agent}:${a.evolving.stage}`);
          setCurrent({ ...a.evolving, agent });
          return;
        }
      }
    };
    check();
    const id = setInterval(check, EVOLUTION_CHECK_MS);
    return () => clearInterval(id);
  }, [current, paused, getOfficeState]);

  // Reproduce la que toca, ya con los dos sprites cargados.
  useEffect(() => {
    if (!current) return;
    const os = getOfficeState();
    const restore = spotlightAgent(os, panRef, current.agent);
    let raf = 0;
    let cancelled = false;
    setPhase('intro');
    setShowNew(false);
    void Promise.all([load(current.from), load(current.to)]).then(() => {
      if (cancelled) return;
      const start = performance.now();
      const flickerAt = EVOLUTION_INTRO_MS;
      const flashAt = flickerAt + EVOLUTION_FLICKER_MS;
      const doneAt = flashAt + EVOLUTION_FLASH_MS;
      let acked = false;
      const tick = (now: number) => {
        const e = now - start;
        if (e < flickerAt) setPhase('intro');
        else if (e < flashAt) {
          setPhase('flicker');
          const p = (e - flickerAt) / EVOLUTION_FLICKER_MS;
          setShowNew(Math.floor(EVOLUTION_SWAPS * p * p) % 2 === 1); // cada vez más rápido
        } else if (e < doneAt) setPhase('flash');
        else {
          setPhase('done');
          setShowNew(true);
          if (!acked) {
            acked = true;
            void playDoneSound();
            void ackEvolution(current.agent, current.stage);
          }
        }
        if (e < doneAt) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCurrent(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      restore();
    };
  }, [current, getOfficeState, panRef]);

  if (!current) return null;
  const silhouette = phase === 'flicker' || phase === 'flash';
  const sprite = (url: string, visible: boolean) => (
    <img
      src={url}
      alt=""
      className="absolute inset-0 size-full"
      style={{ imageRendering: 'pixelated', opacity: visible ? 1 : 0, filter: silhouette ? 'brightness(0) invert(1)' : undefined }}
    />
  );
  return (
    <div className="absolute inset-0 z-[120] pointer-events-none flex flex-col items-center justify-center bg-black/75" role="status">
      <div className="relative" style={{ width: EVOLUTION_SPRITE_PX, height: EVOLUTION_SPRITE_PX }}>
        {sprite(current.from, !showNew)}
        {sprite(current.to, showNew)}
      </div>
      <div className="absolute inset-0 bg-white transition-opacity duration-300" style={{ opacity: phase === 'flash' ? 1 : 0 }} />
      <div className="absolute bottom-[12%] max-w-[90%] bg-bg-dark border-2 border-border px-16 py-10 text-text text-center text-[16px]" style={{ boxShadow: 'var(--shadow-pixel)' }}>
        <div className="text-text-muted text-[12px] mb-4">{current.agent}</div>
        {phase === 'done' ? t('evolution.done', { from: current.fromName, to: current.toName }) : t('evolution.start', { from: current.fromName })}
        {phase === 'done' && (
          <button type="button" className="pointer-events-auto mt-10 block mx-auto px-12 py-4 bg-accent text-white text-[13px] hover:bg-accent-bright" onClick={() => setCurrent(null)}>
            {t('evolution.close')}
          </button>
        )}
      </div>
    </div>
  );
}
