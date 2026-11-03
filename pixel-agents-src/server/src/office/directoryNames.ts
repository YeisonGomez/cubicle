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
import { setDirectoryNameResolver } from '../fileWatcher.js';
import { claudeProvider } from '../providers/index.js';

export function installDirectoryNameResolver(): void {
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
