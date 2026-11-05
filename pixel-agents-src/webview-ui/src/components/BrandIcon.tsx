/**
 * Logo de una marca conocida (MCP, apps) a partir de su nombre, con Simple Icons
 * (CC0, ~3.400 marcas). La biblioteca se carga aparte y solo la primera vez que
 * se pide un icono. Si el nombre no se reconoce, no se dibuja nada.
 */
import { useEffect, useState } from 'react';

interface SimpleIcon {
  title: string;
  slug: string;
  hex: string;
  path: string;
}

// Nombres con los que Claude Code o las sesiones suelen llamar a cosas cuyo slug es otro.
const ALIASES: Record<string, string> = {
  claudeinchrome: 'googlechrome',
  chrome: 'googlechrome',
  claudedocs: 'claude',
  drive: 'googledrive',
  calendar: 'googlecalendar',
  sheets: 'googlesheets',
  gcp: 'googlecloud',
  gcloud: 'googlecloud',
  postgres: 'postgresql',
  atlas: 'mongodb',
  mongo: 'mongodb',
  node: 'nodedotjs',
  nodejs: 'nodedotjs',
  iterm: 'iterm2',
  safari: 'safari',
  k8s: 'kubernetes',
  gh: 'github',
  gemini: 'googlegemini',
  gke: 'kubernetes',
  vertex: 'googlegemini',
  cloudbuild: 'googlecloud',
};
// Palabras comunes que también son nombre de alguna marca: solas no cuentan.
const NOT_BRANDS = new Set(['api', 'cloud', 'mail', 'alto', 'ip', 'web', 'app', 'server', 'docs', 'data', 'preview', 'terminal']);

let index: Map<string, SimpleIcon> | null = null;
let loading: Promise<Map<string, SimpleIcon>> | null = null;
const listeners = new Set<() => void>();

function load(): Promise<Map<string, SimpleIcon>> {
  loading ??= import('simple-icons').then((mod) => {
    const m = new Map<string, SimpleIcon>();
    for (const v of Object.values(mod) as unknown[]) {
      const ic = v as SimpleIcon;
      if (!ic || typeof ic !== 'object' || !ic.slug || !ic.path) continue;
      m.set(ic.slug, ic);
      m.set(norm(ic.title), ic);
    }
    index = m;
    listeners.forEach((f) => f());
    return m;
  });
  return loading;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\./g, 'dot')
    .replace(/\+/g, 'plus')
    .replace(/[^a-z0-9]/g, '');
}

/** Busca el nombre completo y luego sus primeras palabras, de más a menos ("Mongo Atlas prod" → mongo). */
export function findBrand(name: string, m: Map<string, SimpleIcon>): SimpleIcon | null {
  const words = name
    .replace(/\(.*?\)/g, ' ')
    .split(/[\s_/\-]+/)
    .filter(Boolean);
  for (let n = words.length; n > 0; n--) {
    const key = norm(words.slice(0, n).join(' '));
    if (!key || (n === 1 && NOT_BRANDS.has(key))) continue;
    const hit = m.get(ALIASES[key] ?? key) ?? m.get(key.replace(/dot/g, ''));
    if (hit) return hit;
  }
  return null;
}

/** Color de la marca, o el del texto si es demasiado oscuro para el fondo del panel. */
function visibleColor(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 70 ? 'currentColor' : `#${hex}`;
}

export function BrandIcon({ name, size = 14 }: { name: string; size?: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (index) return;
    const f = () => force((v) => v + 1);
    listeners.add(f);
    void load();
    return () => {
      listeners.delete(f);
    };
  }, []);
  const ic = index ? findBrand(name, index) : null;
  if (!ic) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={ic.title} className="shrink-0" fill={visibleColor(ic.hex)}>
      <path d={ic.path} />
    </svg>
  );
}
