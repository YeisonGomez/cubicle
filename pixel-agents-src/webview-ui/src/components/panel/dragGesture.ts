import type { PointerEvent as ReactPointerEvent } from 'react';

/** Arrastre robusto para los bordes redimensionables. Con mousemove/mouseup en
 *  window, soltar encima de un iframe (reportes) o fuera de la ventana no llegaba:
 *  el arrastre quedaba "pegado" al cursor y no dejaba hacer clic. Aquí el borde
 *  captura el puntero (todos los eventos le llegan, haya iframe o no) y el
 *  arrastre termina también si un movimiento llega sin botón pulsado. */
export function startDrag(e: ReactPointerEvent<HTMLElement>, onMove: (dx: number) => void, onEnd: () => void): void {
  if (e.button !== 0) return;
  e.preventDefault();
  const el = e.currentTarget;
  const id = e.pointerId;
  const startX = e.clientX;
  try {
    el.setPointerCapture(id);
  } catch {
    /* sin captura: siguen valiendo las salidas de abajo */
  }
  document.body.style.userSelect = 'none';
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
    el.removeEventListener('lostpointercapture', end);
    window.removeEventListener('blur', end);
    try {
      el.releasePointerCapture(id);
    } catch {
      /* ya liberada */
    }
    document.body.style.userSelect = '';
    onEnd();
  };
  const move = (ev: PointerEvent) => {
    if (ev.buttons === 0) return end();
    onMove(ev.clientX - startX);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  window.addEventListener('blur', end);
}
