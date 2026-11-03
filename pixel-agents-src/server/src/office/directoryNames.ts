/**
 * Nombre de Directorio para sesiones EXTERNAS (abiertas fuera de la oficina y
 * observadas por el watcher). Sin esto, una sesión externa se llama como su
 * carpeta ("api") y no coincide con el Directorio registrado ("Empresa API"),
 * así que caía en "Otros". Upstream solo lo resuelve en VS Code; aquí, para el
 * standalone, se resuelve contra config.directories: por cwd (carpeta más
 * específica que lo contenga) o por el directorio de proyecto de Claude
 * (`~/.claude/projects/<cwd con / → ->`), admitiendo subcarpetas.
 */
import * as path from 'path';

import { readConfig } from '../configPersistence.js';
import { setDirectoryNameResolver, setGlobalProjectDirFilter } from '../fileWatcher.js';
import { claudeProvider } from '../providers/index.js';

/** Nombre del Directorio registrado para una carpeta de proyecto de Claude (o undefined). */
function nameForProjectDir(projectDir: string): string | undefined {
  const dirs = readConfig().directories;
  const target = path.basename(projectDir);
  const owning = dirs
    .map((d) => {
      const sessionDir = claudeProvider.getSessionDirs?.(d.path)?.[0];
      return { d, h: sessionDir ? path.basename(sessionDir) : '' };
    })
    .filter(({ h }) => h && (target === h || target.startsWith(h + '-')))
    .sort((a, b) => b.h.length - a.h.length)[0];
  return owning?.d.name;
}

export function installDirectoryNameResolver(): void {
  // Solo se observan sesiones de carpetas registradas (o sus subcarpetas).
  setGlobalProjectDirFilter((projectDir) => nameForProjectDir(projectDir) !== undefined);
  setDirectoryNameResolver(({ cwd, projectDir }) => {
    const dirs = readConfig().directories;
    if (dirs.length === 0) return undefined;
    if (cwd) {
      const owning = dirs
        .filter((d) => cwd === d.path || cwd.startsWith(d.path + path.sep))
        .sort((a, b) => b.path.length - a.path.length)[0];
      if (owning) return owning.name;
    }
    if (projectDir) {
      const target = path.basename(projectDir);
      const hashOf = (p: string) => {
        const sessionDir = claudeProvider.getSessionDirs?.(p)?.[0];
        return sessionDir ? path.basename(sessionDir) : '';
      };
      const owning = dirs
        .map((d) => ({ d, h: hashOf(d.path) }))
        .filter(({ h }) => h && (target === h || target.startsWith(h + '-')))
        .sort((a, b) => b.h.length - a.h.length)[0];
      if (owning) return owning.d.name;
    }
    return undefined;
  });
}
