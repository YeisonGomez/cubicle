import { cn } from './cn.js';

interface SegmentedProps<T extends string> {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (id: T) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Selector de opciones excluyentes (idioma, skin…): una pastilla sin bordes; la
 * opción elegida se rellena con el acento. Sustituye a las filas de botones con borde.
 */
export function Segmented<T extends string>({ value, options, onChange, disabled, className }: SegmentedProps<T>) {
  return (
    <span role="radiogroup" className={cn('inline-flex items-center gap-2 p-2 rounded-md bg-bg-dark', className)}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => !on && onChange(o.id)}
            className={cn(
              'px-10 py-3 rounded text-[13px] transition-colors disabled:opacity-50',
              on ? 'bg-accent text-white' : 'text-text-muted hover:text-text hover:bg-btn-hover',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}
