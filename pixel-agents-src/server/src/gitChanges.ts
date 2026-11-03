/**
 * Cambios sin commit de los repos de una sala (vista "Cambios" del panel
 * izquierdo). Solo se consultan directorios registrados en la oficina
 * (config.directories), nunca rutas arbitrarias.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import { readConfig } from './configPersistence.js';

const execFileP = promisify(execFile);
const MAX_FILE_BYTES = 1_500_000;

export interface ChangedFile {
  /** Ruta relativa a la raíz del repo. */
  path: string;
  /** M modificado · A agregado · D borrado · R renombrado · ? sin seguimiento. */
  status: 'M' | 'A' | 'D' | 'R' | '?' | 'C' | 'U';
  staged: boolean;
  /** Ruta anterior en renombrados. */
  from?: string;
}

export interface RepoChanges {
  /** Directorio de la oficina que se consultó. */
  dir: string;
  /** Raíz del repo git (puede ser un ancestro o el mismo dir). */
  root: string;
  branch: string | null;
  files: ChangedFile[];
}

function isKnownDirectory(dir: string): boolean {
  const norm = path.resolve(dir);
  return readConfig().directories.some((d) => path.resolve(d.path) === norm);
}

async function git(cwd: string, args: string[], maxBuffer = 20_000_000): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd, maxBuffer });
  return stdout;
}

export async function repoChanges(dir: string): Promise<RepoChanges | { error: string }> {
  if (!isKnownDirectory(dir)) return { error: 'directorio no registrado en la oficina' };
  return repoChangesAt(dir);
}

/** Igual que repoChanges pero para una raíz ya autorizada (proyecto de un agente). */
export async function repoChangesAt(dir: string): Promise<RepoChanges | { error: string }> {
  if (!fs.existsSync(dir)) return { error: 'el directorio no existe' };
  let root: string;
  try {
    root = (await git(dir, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return { error: 'no es un repositorio git' };
  }
  let branch: string | null = null;
  try {
    branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  } catch {
    branch = null;
  }
  const out = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const files: ChangedFile[] = [];
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry || entry.length < 4) continue;
    const x = entry[0];
    const y = entry[1];
    const p = entry.slice(3);
    let from: string | undefined;
    if (x === 'R' || x === 'C') {
      // en -z el formato es "R  nuevo\0viejo"
      from = parts[i + 1];
      i++;
    }
    let status: ChangedFile['status'];
    if (x === '?' && y === '?') status = '?';
    else if (x === 'U' || y === 'U') status = 'U';
    else if (x === 'R' || y === 'R') status = 'R';
    else if (x === 'C') status = 'C';
    else if (x === 'A' || y === 'A') status = 'A';
    else if (x === 'D' || y === 'D') status = 'D';
    else status = 'M';
    const staged = x !== ' ' && x !== '?';
    files.push({ path: p, status, staged, ...(from ? { from } : {}) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { dir, root, branch, files };
}

export interface FileVersions {
  path: string;
  /** Contenido en HEAD (null si el archivo es nuevo). */
  head: string | null;
  /** Contenido actual en disco (null si fue borrado). */
  work: string | null;
  binary: boolean;
  tooLarge: boolean;
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export async function fileVersions(dir: string, file: string): Promise<FileVersions | { error: string }> {
  if (!isKnownDirectory(dir)) return { error: 'directorio no registrado en la oficina' };
  return fileVersionsAt(dir, file);
}

/** Versiones HEAD/disco de un archivo dentro de una raíz ya autorizada. */
export async function fileVersionsAt(dir: string, file: string): Promise<FileVersions | { error: string }> {
  const changes = await repoChangesAt(dir);
  if ('error' in changes) return changes;
  const root = changes.root;
  const abs = path.resolve(root, file);
  if (!abs.startsWith(root + path.sep) && abs !== root) return { error: 'ruta fuera del repo' };
  const rel = path.relative(root, abs).split(path.sep).join('/');

  let work: string | null = null;
  let binary = false;
  let tooLarge = false;
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    const st = fs.statSync(abs);
    if (st.size > MAX_FILE_BYTES) tooLarge = true;
    else {
      const buf = fs.readFileSync(abs);
      binary = looksBinary(buf);
      work = binary ? null : buf.toString('utf8');
    }
  }
  let head: string | null = null;
  try {
    const buf = Buffer.from(await git(root, ['show', `HEAD:${rel}`]), 'utf8');
    if (buf.length > MAX_FILE_BYTES) tooLarge = true;
    else if (looksBinary(buf)) binary = true;
    else head = buf.toString('utf8');
  } catch {
    head = null; // archivo nuevo o sin seguimiento
  }
  return { path: rel, head, work, binary, tooLarge };
}
