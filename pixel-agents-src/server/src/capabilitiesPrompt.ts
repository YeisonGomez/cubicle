/**
 * Pregunta de capacidades: la primera vez que se lanza un agente cuyo Directorio
 * no tiene declaración en capacidades.json, se le pasa como PROMPT INICIAL
 * (`claude [--resume id] "<pregunta>"`), así la sesión responde sola al abrir y
 * ejecuta `capacidades.py set`. La pregunta vive en capacidades.py (única fuente).
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { capabilitiesFile, pythonBin, scriptsDir } from './officePaths.js';
import { langEnv } from './office/language.js';

function declared(): Record<string, unknown> {
  try {
    const raw = JSON.parse(fs.readFileSync(capabilitiesFile(), 'utf8')) as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function hasDeclaredCapabilities(name: string): boolean {
  return name in declared();
}

/** Borra la declaración de un Directorio (el próximo lanzamiento vuelve a preguntar). */
export function clearCapabilities(name: string): boolean {
  const all = declared();
  if (!(name in all)) return false;
  delete all[name];
  try {
    fs.writeFileSync(capabilitiesFile(), JSON.stringify(all, null, 2));
    return true;
  } catch {
    return false;
  }
}

/** Texto de la pregunta estándar, o null si el Directorio ya declaró (o no hay script). */
export function capabilitiesPromptFor(name: string): string | null {
  if (!name || hasDeclaredCapabilities(name)) return null;
  const cli = path.join(scriptsDir(), 'capacidades.py');
  if (!fs.existsSync(cli)) return null;
  try {
    const out = execFileSync(pythonBin(), [cli, 'pregunta', name], { encoding: 'utf8', timeout: 5000, env: langEnv() });
    const text = out.trim();
    return text ? text : null;
  } catch (e) {
    console.warn('[capacidades] no se pudo obtener la pregunta:', e instanceof Error ? e.message : e);
    return null;
  }
}
