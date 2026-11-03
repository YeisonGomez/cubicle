import type { MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useRef, useState } from 'react';

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
export function usePanelWidth(expanded = false): { width: number; onResizeStart: (e: ReactMouseEvent) => void } {
  const [width, setWidth] = useState<number>(readWidth);
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  const onResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      dragRef.current = { x: e.clientX, w: width };
      const move = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        setWidth(Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, dragRef.current.w + ev.clientX - dragRef.current.x)));
      };
      const up = () => {
        dragRef.current = null;
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setWidth((w) => {
          try {
            localStorage.setItem(WIDTH_KEY, String(w));
          } catch {
            /* sin almacenamiento */
          }
          return w;
        });
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [width],
  );
  const expandedWidth = Math.max(width, Math.min(EXPANDED_MIN, (typeof window !== 'undefined' ? window.innerWidth : 1600) - 420));
  return { width: expanded ? expandedWidth : width, onResizeStart };
}
