/** Iconos SVG del panel IDE (nada de caracteres especiales en la UI). */

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export function IconChevronLeft({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M10 3 5 8l5 5" />
    </svg>
  );
}

export function IconGear({ size = 16, className }: IconProps) {
  // Deslizadores (ajustes), para no confundirlo con la marca de Claude.
  return (
    <svg {...base(size)} className={className} strokeWidth={1.8}>
      <path d="M2 4.5h12M2 8h12M2 11.5h12" />
      <circle cx="10.5" cy="4.5" r="1.6" fill="var(--color-bg)" />
      <circle cx="5.5" cy="8" r="1.6" fill="var(--color-bg)" />
      <circle cx="9" cy="11.5" r="1.6" fill="var(--color-bg)" />
    </svg>
  );
}

export function IconActivity({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2 13.5h12" />
      <path d="M3.5 11V7.5M7 11V4M10.5 11V6M14 11V2.5" />
    </svg>
  );
}

export function IconGrip({ size = 12, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={0} fill="currentColor">
      <circle cx="5" cy="3.5" r="1.2" />
      <circle cx="11" cy="3.5" r="1.2" />
      <circle cx="5" cy="8" r="1.2" />
      <circle cx="11" cy="8" r="1.2" />
      <circle cx="5" cy="12.5" r="1.2" />
      <circle cx="11" cy="12.5" r="1.2" />
    </svg>
  );
}

/** Marca tipo Claude: "splat" de radios desiguales con puntas redondeadas (relleno). */
export function IconClaude({ size = 16, className }: IconProps) {
  const spokes = [7.4, 5.2, 6.6, 4.8, 7.2, 5.6, 6.4, 4.6, 7.4, 5.4, 6.8, 5.0];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden fill="currentColor">
      {spokes.map((len, i) => (
        <rect key={i} x={8 - 1.05} y={8 - len} width={2.1} height={len - 1.2} rx={1.05} transform={`rotate(${i * 30} 8 8)`} />
      ))}
    </svg>
  );
}

/** "Zz" de descanso: letras claras, legibles sobre fondo oscuro (el emoji 💤 azul no se veía). */
export function IconSleep({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={2.2}>
      <path d="M2 6h5.5L2 12.5h5.5" />
      <path d="M9.5 2.5h4.5l-4.5 5h4.5" />
    </svg>
  );
}

export function IconHome({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2.5 7.5 8 2.8l5.5 4.7" />
      <path d="M4 6.8V13h3V9.5h2V13h3V6.8" />
    </svg>
  );
}

/** Gráfica de torta: consumo por porcentajes. */
export function IconPie({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 2.2a5.8 5.8 0 1 0 5.8 5.8H8V2.2Z" />
      <path d="M9.6 1.6a5.8 5.8 0 0 1 4.8 4.8H9.6V1.6Z" fill="currentColor" strokeWidth={0} />
    </svg>
  );
}

/** Chincheta: fijar una ficha al frente de la barra. */
export function IconPin({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={1.8}>
      <path d="M9.5 2.5 13.5 6.5 11 7.5 8.8 11.5 5.5 8.2 9 5.5Z" />
      <path d="M6.5 9.5 2.5 13.5" />
    </svg>
  );
}

export function IconChevronRight({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}
