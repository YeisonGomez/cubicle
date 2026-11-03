import { Check, Minus } from 'lucide-react';

import { cn } from './cn.js';

interface CheckMarkProps {
  on: boolean;
  /** Parcial (algunos hijos marcados): muestra un guion. */
  mixed?: boolean;
  disabled?: boolean;
  title?: string;
  onChange: (v: boolean) => void;
}

/**
 * Casilla de selección múltiple: esquinas redondeadas, sin borde duro; apagada es
 * un fondo tenue, encendida se rellena con el acento y muestra la marca de lucide.
 */
export function CheckMark({ on, mixed = false, disabled, title, onChange }: CheckMarkProps) {
  const filled = on || mixed;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : on}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!on)}
      className={cn(
        'inline-flex items-center justify-center size-18 shrink-0 rounded-[5px] transition-colors',
        filled ? 'bg-accent text-white hover:bg-accent-bright' : 'bg-white/10 text-transparent hover:bg-white/20',
        'disabled:opacity-35 disabled:cursor-default',
      )}
    >
      {mixed && !on ? <Minus size={13} strokeWidth={3} /> : <Check size={13} strokeWidth={3} />}
    </button>
  );
}
