/* eslint-disable pixel-agents/no-inline-colors, react-refresh/only-export-components --
   tabla de colores del tema de iconos (como LEVEL_COLOR en ActivityPanel) y helpers junto a los glifos */
/**
 * Iconos y colores por tipo de archivo para la pestaña Cambios, al estilo del
 * tema de iconos de VS Code (Seti): un glifo SVG de 16x16 por extensión, sin
 * caracteres especiales ni emojis.
 */
import type { ReactNode } from 'react';

/** Colores del tema (centralizados aquí, como LEVEL_COLOR en ActivityPanel). */
const COLORS = {
  ts: '#3178c6',
  tsx: '#519aba',
  js: '#e8d44d',
  json: '#cbcb41',
  md: '#519aba',
  css: '#a074c4',
  html: '#e37933',
  py: '#3572a5',
  pyAccent: '#ffd43b',
  sh: '#89e051',
  yaml: '#cb171e',
  image: '#d7b0d0',
  svg: '#a074c4',
  lock: '#9e9e9e',
  docker: '#2496ed',
  env: '#e8d44d',
  txt: '#a0a0a0',
  pdf: '#d14b4b',
  sql: '#dad8d8',
  go: '#00add8',
  rs: '#dea584',
  default: '#c5c5c5',
  folder: '#dcb67a',
  label: '#1e1e2e',
} as const;

interface Kind {
  color: string;
  /** Etiqueta corta (2-3 letras) dentro de la pastilla; sin etiqueta → glifo de hoja. */
  label?: string;
  /** Glifo especial en vez de la pastilla. */
  glyph?: 'image' | 'lock' | 'docker' | 'md' | 'pdf';
}

const BY_EXT: Record<string, Kind> = {
  ts: { color: COLORS.ts, label: 'TS' },
  mts: { color: COLORS.ts, label: 'TS' },
  cts: { color: COLORS.ts, label: 'TS' },
  tsx: { color: COLORS.tsx, label: 'TSX' },
  js: { color: COLORS.js, label: 'JS' },
  mjs: { color: COLORS.js, label: 'JS' },
  cjs: { color: COLORS.js, label: 'JS' },
  jsx: { color: COLORS.js, label: 'JSX' },
  json: { color: COLORS.json, label: '{ }' },
  jsonc: { color: COLORS.json, label: '{ }' },
  md: { color: COLORS.md, glyph: 'md' },
  mdx: { color: COLORS.md, glyph: 'md' },
  css: { color: COLORS.css, label: 'CSS' },
  scss: { color: COLORS.css, label: 'SCS' },
  less: { color: COLORS.css, label: 'LES' },
  html: { color: COLORS.html, label: '<>' },
  htm: { color: COLORS.html, label: '<>' },
  vue: { color: '#41b883', label: 'VUE' },
  py: { color: COLORS.py, label: 'PY' },
  sh: { color: COLORS.sh, label: '$_' },
  zsh: { color: COLORS.sh, label: '$_' },
  bash: { color: COLORS.sh, label: '$_' },
  yaml: { color: COLORS.yaml, label: 'YML' },
  yml: { color: COLORS.yaml, label: 'YML' },
  png: { color: COLORS.image, glyph: 'image' },
  jpg: { color: COLORS.image, glyph: 'image' },
  jpeg: { color: COLORS.image, glyph: 'image' },
  gif: { color: COLORS.image, glyph: 'image' },
  webp: { color: COLORS.image, glyph: 'image' },
  ico: { color: COLORS.image, glyph: 'image' },
  svg: { color: COLORS.svg, glyph: 'image' },
  lock: { color: COLORS.lock, glyph: 'lock' },
  toml: { color: COLORS.lock, label: 'TML' },
  ini: { color: COLORS.lock, label: 'INI' },
  env: { color: COLORS.env, label: 'ENV' },
  txt: { color: COLORS.txt },
  log: { color: COLORS.txt },
  pdf: { color: COLORS.pdf, glyph: 'pdf' },
  sql: { color: COLORS.sql, label: 'SQL' },
  go: { color: COLORS.go, label: 'GO' },
  rs: { color: COLORS.rs, label: 'RS' },
  java: { color: '#b07219', label: 'JAV' },
  kt: { color: '#a97bff', label: 'KT' },
  swift: { color: '#f05138', label: 'SW' },
  rb: { color: '#cc342d', label: 'RB' },
  php: { color: '#7377ad', label: 'PHP' },
  c: { color: '#555555', label: 'C' },
  h: { color: '#a074c4', label: 'H' },
  cpp: { color: '#f34b7d', label: 'C++' },
  tf: { color: '#7b42bc', label: 'TF' },
  csv: { color: '#89e051', label: 'CSV' },
  xml: { color: COLORS.html, label: 'XML' },
};

const BY_NAME: Record<string, Kind> = {
  dockerfile: { color: COLORS.docker, glyph: 'docker' },
  'docker-compose.yml': { color: COLORS.docker, glyph: 'docker' },
  'docker-compose.yaml': { color: COLORS.docker, glyph: 'docker' },
  'package.json': { color: '#8bc34a', label: 'npm' },
  'package-lock.json': { color: COLORS.lock, glyph: 'lock' },
  'yarn.lock': { color: COLORS.lock, glyph: 'lock' },
  'pnpm-lock.yaml': { color: COLORS.lock, glyph: 'lock' },
  '.gitignore': { color: '#f05032', label: 'git' },
  '.gitattributes': { color: '#f05032', label: 'git' },
  'claude.md': { color: '#d97757', glyph: 'md' },
  license: { color: COLORS.txt },
  makefile: { color: '#6d8086', label: 'MK' },
};

function kindOf(name: string): Kind {
  const base = name.split('/').pop() ?? name;
  const lower = base.toLowerCase();
  const byName = BY_NAME[lower];
  if (byName) return byName;
  if (lower.startsWith('.env')) return BY_EXT.env;
  const dot = lower.lastIndexOf('.');
  if (dot <= 0) return { color: COLORS.default };
  return BY_EXT[lower.slice(dot + 1)] ?? { color: COLORS.default };
}

/** Color CSS del nombre de un archivo (por extensión), como el tema de iconos de VS Code. */
export function fileColor(name: string): string {
  return kindOf(name).color;
}

const SIZE = 16;

function FolderGlyph({ open }: { open: boolean }) {
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      {open ? (
        <>
          <path d="M1.5 3.5h4l1.5 1.5h7.5v2h-11l-2 5.5z" fill={COLORS.folder} opacity="0.55" />
          <path d="M3 7h12.5l-2 6H1z" fill={COLORS.folder} />
        </>
      ) : (
        <>
          <path d="M1.5 3.5h4l1.5 1.5h7.5v8h-13z" fill={COLORS.folder} />
          <path d="M1.5 6.5h13v6.5h-13z" fill={COLORS.folder} opacity="0.75" />
        </>
      )}
    </svg>
  );
}

/** Hoja de archivo con la esquina doblada, en el color del tipo. */
function SheetGlyph({ color, children }: { color: string; children?: ReactNode }) {
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <path d="M3 1.5h6.5l3.5 3.5v9.5H3z" fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9.5 1.5v3.5H13" fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
      {children}
    </svg>
  );
}

function LabelGlyph({ color, label }: { color: string; label: string }) {
  const fontSize = label.length >= 3 ? 5.6 : 7;
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <rect x="1" y="2.5" width="14" height="11" rx="2" fill={color} />
      <text
        x="8"
        y="8.5"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={fontSize}
        fontWeight="700"
        fontFamily="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
        fill={COLORS.label}
      >
        {label}
      </text>
    </svg>
  );
}

/** Icono SVG 16x16 de un archivo o carpeta, estilo tema de iconos de VS Code. */
export function FileIcon({ name, isDir = false, open = false }: { name: string; isDir?: boolean; open?: boolean }) {
  if (isDir) return <FolderGlyph open={open} />;
  const k = kindOf(name);
  switch (k.glyph) {
    case 'image':
      return (
        <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke={k.color} strokeWidth="1.2" />
          <circle cx="5.5" cy="6" r="1.5" fill={k.color} />
          <path d="M2.5 12.5l4-4 2.5 2.5 2-2 2.5 3.5z" fill={k.color} />
        </svg>
      );
    case 'lock':
      return (
        <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
          <rect x="3" y="7" width="10" height="7" rx="1.5" fill={k.color} />
          <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke={k.color} strokeWidth="1.4" />
        </svg>
      );
    case 'docker':
      return (
        <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
          <path d="M1 8h13.5c.5 0 .5 1 0 1.5-1 3-3.5 4.5-7 4.5S1.5 12 1 8z" fill={k.color} />
          <rect x="3" y="5" width="2" height="2" fill={k.color} />
          <rect x="6" y="5" width="2" height="2" fill={k.color} />
          <rect x="6" y="2" width="2" height="2" fill={k.color} />
          <rect x="9" y="5" width="2" height="2" fill={k.color} />
        </svg>
      );
    case 'md':
      return (
        <SheetGlyph color={k.color}>
          <path d="M5 11V7l1.5 2 1.5-2v4" fill="none" stroke={k.color} strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M9.5 9h2M10.5 7v4" fill="none" stroke={k.color} strokeWidth="1.1" />
        </SheetGlyph>
      );
    case 'pdf':
      return (
        <SheetGlyph color={k.color}>
          <rect x="4.5" y="7.5" width="7" height="4.5" rx="0.8" fill={k.color} />
        </SheetGlyph>
      );
    default:
      break;
  }
  if (k.label) return <LabelGlyph color={k.color} label={k.label} />;
  return (
    <SheetGlyph color={k.color}>
      <path d="M5.5 8h5M5.5 10.5h5" stroke={k.color} strokeWidth="1" />
    </SheetGlyph>
  );
}

/** Chevron de 10px (carpetas y secciones): abajo = abierto, derecha = cerrado. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      className="shrink-0"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 80ms' }}
    >
      <path d="M3 1.5l4 3.5-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Flecha izquierda de 16px (botón "volver"). */
export function ArrowLeft() {
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <path d="M13 8H3.5M7 3.5L2.5 8 7 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
