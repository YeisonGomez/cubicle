import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Tip } from '../panel/Tip.js';
import { cn } from './cn.js';

const sizes = { sm: 'size-24', md: 'size-28', lg: 'size-32' } as const;

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Texto del tooltip (y aria-label). */
  label: string;
  /** Resaltado (pestaña o modo activo): fondo de acento, sin borde. */
  active?: boolean;
  size?: keyof typeof sizes;
  children: ReactNode;
}

/**
 * Botón de icono del panel: sin borde, fondo solo al pasar el ratón o cuando
 * está activo. Todos los iconos de cabecera y de la barra usan este componente
 * para que la interfaz sea consistente.
 */
export function IconButton({ label, active = false, size = 'md', className, children, ...props }: IconButtonProps) {
  return (
    <Tip text={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active || undefined}
        className={cn(
          'flex items-center justify-center shrink-0 rounded-none transition-colors',
          sizes[size],
          active ? 'bg-active-bg text-text' : 'text-text-muted hover:text-text hover:bg-btn-hover',
          'disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </Tip>
  );
}
