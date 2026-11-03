import type { ReactNode } from 'react';
import { useState } from 'react';

/** Tooltip inmediato (el title nativo tarda un segundo): aparece debajo del botón. */
export function Tip({ text, children }: { text: string; children: ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span className="absolute right-0 top-full mt-4 z-50 whitespace-nowrap bg-bg-dark border-2 border-border px-8 py-4 text-[12px] text-text shadow-[2px_2px_0px_#0a0a14]">
          {text}
        </span>
      )}
    </span>
  );
}
