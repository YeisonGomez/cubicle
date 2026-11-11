import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useState } from 'react';

import { startDrag } from './dragGesture.js';

/** Ancho del panel: fijo (no cambia con la pestaña); el usuario lo ajusta
 *  arrastrando el borde derecho y se recuerda en localStorage. */
const WIDTH_KEY = 'pixel-agents.panelWidth';
const WIDTH_DEFAULT = 680;
const WIDTH_MIN = 360;
const WIDTH_MAX = 1200;
const EXPANDED_MIN = 1000;

function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(v) && v >= WIDTH_MIN && v <= WIDTH_MAX) return v;
  } catch {
    /* sin almacenamiento */
  }
  return WIDTH_DEFAULT;
}

/** `expanded`: mientras se ve un archivo (diff) el panel se ensancha solo; al volver recupera el ancho guardado. */
export function usePanelWidth(expanded = false): { width: number; onResizeStart: (e: ReactPointerEvent<HTMLElement>) => void } {
  const [width, setWidth] = useState<number>(readWidth);
  const onResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const w0 = width;
      document.body.style.cursor = 'col-resize';
      startDrag(
        e,
        (dx) => setWidth(Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, w0 + dx))),
        () => {
          document.body.style.cursor = '';
          setWidth((w) => {
            try {
              localStorage.setItem(WIDTH_KEY, String(w));
            } catch {
              /* sin almacenamiento */
            }
            return w;
          });
        },
      );
    },
    [width],
  );
  const expandedWidth = Math.max(width, Math.min(EXPANDED_MIN, (typeof window !== 'undefined' ? window.innerWidth : 1600) - 420));
  return { width: expanded ? expandedWidth : width, onResizeStart };
}
