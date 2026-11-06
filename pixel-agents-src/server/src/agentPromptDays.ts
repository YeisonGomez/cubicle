/**
 * Prompts por día de cada agente, para la experiencia. Varios agentes pueden trabajar en
 * la misma carpeta con conversaciones distintas: cada uno suma solo las suyas. Lo que no
 * tiene dueño conocido (historia antigua, sesiones abiertas fuera de la oficina) es del
 * primer agente de la carpeta. Lo ganado se guarda: los transcripts pueden desaparecer.
 */
import * as fs from 'fs';
import * as path from 'path';

import { promptDaysByDir, promptDaysBySession } from './activityStats.js';
import { officeDir } from './officePaths.js';

type Days = Record<string, number>;
interface OwnersFile {
  /** Conversación → agente que la usa. */
  owners: Record<string, string>;
  /** Prompts ya atribuidos a cada agente secundario. */
  days: Record<string, Days>;
}

const file = (): string => path.join(officeDir(), 'prompts-por-agente.json');

function read(): OwnersFile {
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<OwnersFile>;
    return { owners: j.owners ?? {}, days: j.days ?? {} };
  } catch {
    return { owners: {}, days: {} };
  }
}

function write(data: OwnersFile): void {
  fs.mkdirSync(officeDir(), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(data, null, 2));
}

/** Registra de qué agente es cada conversación viva. */
export function claimSessions(claims: Array<{ sessionId: string; name: string }>): void {
  const data = read();
  let changed = false;
  for (const { sessionId, name } of claims) {
    if (data.owners[sessionId] !== name) {
      data.owners[sessionId] = name;
      changed = true;
    }
  }
  if (changed) write(data);
}

/** Lo atribuido acompaña al agente al renombrarlo. */
export function renameAgentPrompts(from: string, to: string): void {
  const data = read();
  let changed = false;
  for (const [id, name] of Object.entries(data.owners)) {
    if (name === from) {
      data.owners[id] = to;
      changed = true;
    }
  }
  if (data.days[from]) {
    data.days[to] = data.days[from];
    delete data.days[from];
    changed = true;
  }
  if (changed) write(data);
}

/**
 * Reparte los prompts de una carpeta entre sus agentes (`names[0]` es el primero). Devuelve
 * los días de cada uno y lo guardado actualizado, que nunca baja.
 */
export function splitFolderDays(
  names: string[],
  folderDays: Days,
  sessions: Record<string, Days>,
  owners: Record<string, string>,
  saved: Record<string, Days>,
): { days: Record<string, Days>; saved: Record<string, Days> } {
  const [first, ...rest] = names;
  const nextSaved: Record<string, Days> = { ...saved };
  const days: Record<string, Days> = {};
  const credited: Days = {};
  for (const name of rest) {
    const mine: Days = { ...(saved[name] ?? {}) };
    const live: Days = {};
    for (const [id, perDay] of Object.entries(sessions)) {
      if (owners[id] !== name) continue;
      for (const [d, n] of Object.entries(perDay)) live[d] = (live[d] ?? 0) + n;
    }
    for (const [d, n] of Object.entries(live)) mine[d] = Math.max(mine[d] ?? 0, n);
    days[name] = mine;
    nextSaved[name] = mine;
    for (const [d, n] of Object.entries(mine)) credited[d] = (credited[d] ?? 0) + n;
  }
  const remainder: Days = {};
  for (const [d, n] of Object.entries(folderDays)) {
    const left = n - (credited[d] ?? 0);
    if (left > 0) remainder[d] = left;
  }
  days[first] = remainder;
  return { days, saved: nextSaved };
}

export function promptDaysByAgent(dirs: Array<{ name: string; path: string }>, activityFile: string): Record<string, Days> {
  const out = promptDaysByDir(dirs, activityFile);
  const byPath = new Map<string, string[]>();
  for (const d of dirs) byPath.set(d.path, [...(byPath.get(d.path) ?? []), d.name]);
  const data = read();
  const before = JSON.stringify(data.days);
  for (const [folder, names] of byPath) {
    if (names.length < 2) continue;
    const folderDays: Days = {};
    for (const name of names) for (const [d, n] of Object.entries(out[name] ?? {})) folderDays[d] = Math.max(folderDays[d] ?? 0, n);
    const split = splitFolderDays(names, folderDays, promptDaysBySession(folder), data.owners, data.days);
    data.days = split.saved;
    Object.assign(out, split.days);
  }
  if (JSON.stringify(data.days) !== before) write(data);
  return out;
}
