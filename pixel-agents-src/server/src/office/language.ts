/**
 * Idioma de la oficina (el que el usuario eligió en la webview). Todos los
 * prompts automáticos que la oficina manda a una sesión (capacidades, ficha
 * de proyecto, informe/conflictos de PR) se piden en este idioma.
 * Persistido en `<oficina>/idioma.json`; por defecto inglés.
 */
import * as fs from 'fs';
import * as path from 'path';

import { officeDir } from '../officePaths.js';

export type OfficeLang = 'es' | 'en';

const file = (): string => path.join(officeDir(), 'idioma.json');

export function getOfficeLang(): OfficeLang {
  try {
    const v = (JSON.parse(fs.readFileSync(file(), 'utf8')) as { lang?: string }).lang;
    if (v === 'es' || v === 'en') return v;
  } catch {
    /* sin archivo */
  }
  return 'en';
}

export function setOfficeLang(lang: OfficeLang): void {
  fs.mkdirSync(officeDir(), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ lang }));
}

/** Entorno para los scripts de la oficina: `OFICINA_LANG` elige el idioma de la pregunta. */
export function langEnv(): NodeJS.ProcessEnv {
  return { ...process.env, OFICINA_LANG: getOfficeLang() };
}
