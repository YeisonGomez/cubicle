import type { ReactNode } from 'react';
import { useState } from 'react';

/** Tooltip inmediato (el title nativo tarda un segundo): aparece debajo del botón. */
export function Tip({ text, children }: { text: string; children: ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span className="absolute right-0 top-full mt-4 z-50 whitespace-nowrap bg-bg-dark px-8 py-4 text-[12px] text-text shadow-[0_2px_8px_rgba(0,0,0,0.5)]">
          {text}
        </span>
      )}
    </span>
  );
}
