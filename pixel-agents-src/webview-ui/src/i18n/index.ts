/**
 * i18n de la oficina: diccionarios planos (es/en), `t(key, vars)` con
 * interpolación `{x}` y plurales `tn(key, n)` (claves `_one` / `_other`).
 * El idioma se guarda en localStorage (`pixel-agents.lang`); si no hay, se
 * es inglés (se cambia en el onboarding o en Ajustes). `useT()` re-renderiza al cambiar de idioma.
 */
import { useSyncExternalStore } from 'react';

import { en } from './en.js';
import { es } from './es.js';

export type Lang = 'es' | 'en';
export const LANGS: Array<{ id: Lang; label: string }> = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'English' },
];

const LANG_KEY = 'pixel-agents.lang';
const DICTS: Record<Lang, Record<string, string>> = { es, en };

function readLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'es' || v === 'en') return v;
  } catch {
    /* sin almacenamiento */
  }
  // Por defecto inglés (repo público); el onboarding y Ajustes permiten cambiarlo.
  return 'en';
}

let current: Lang = readLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

/** Avisa al servidor del idioma para que los prompts automáticos (capacidades, ficha, PRs) salgan en él. */
export function syncLangToServer(): void {
  import('../transport/serverToken.js')
    .then(({ serverToken }) =>
      fetch('./api/lang', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(serverToken ? { Authorization: `Bearer ${serverToken}` } : {}) },
        body: JSON.stringify({ lang: current }),
      }),
    )
    .catch(() => undefined);
}

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  syncLangToServer();
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* sin almacenamiento */
  }
  listeners.forEach((f) => f());
}

function subscribe(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Idioma actual; re-renderiza al cambiar. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** Locale para fechas y números. */
export function locale(): string {
  return current === 'es' ? 'es-CO' : 'en-US';
}

type Vars = Record<string, string | number>;

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Texto traducido (cae al inglés y, si no existe, a la clave). */
export function t(key: string, vars?: Vars): string {
  const s = DICTS[current][key] ?? DICTS.en[key] ?? key;
  return interpolate(s, vars);
}

/** Plural: `key_one` para n = 1, `key_other` para el resto; `{n}` disponible. */
export function tn(key: string, n: number, vars?: Vars): string {
  return t(n === 1 ? `${key}_one` : `${key}_other`, { n, ...(vars ?? {}) });
}

/** Hook para componentes: `t`, `tn` y el idioma, con re-render al cambiar. */
export function useT(): { t: typeof t; tn: typeof tn; lang: Lang; locale: string } {
  const lang = useLang();
  return { t, tn, lang, locale: locale() };
}
