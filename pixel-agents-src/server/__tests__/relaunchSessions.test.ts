import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isGhostExternal, latestSessionId, sessionForDirectory } from '../src/terminal/relaunch.js';

describe('conversación de Directorios que comparten carpeta', () => {
  let dir: string;
  const deps = () => ({ provider: { getSessionDirs: () => [dir] } }) as never;
  const repo = '/repo';
  const all = [
    { name: 'A', path: repo },
    { name: 'B', path: repo },
    { name: 'Solo', path: '/otro' },
  ];
  const write = (id: string, ageS: number) => {
    const f = path.join(dir, `${id}.jsonl`);
    fs.writeFileSync(f, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'hola' }, timestamp: new Date().toISOString() })}\n`.padEnd(300, ' '));
    const t = Date.now() / 1000 - ageS;
    fs.utimesSync(f, t, t);
  };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relanzar-'));
    write('vieja', 100);
    write('media', 50);
    write('nueva', 10);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('con la carpeta para sí solo reanuda la más reciente, aunque recuerde otra', () => {
    expect(sessionForDirectory(deps(), all[2], all, { Solo: 'vieja' }, new Set())).toBe('nueva');
  });
  it('cada uno vuelve a la suya, aunque la del otro sea más reciente', () => {
    const mem = { A: 'media', B: 'nueva' };
    expect(sessionForDirectory(deps(), all[0], all, mem, new Set())).toBe('media');
    expect(sessionForDirectory(deps(), all[1], all, mem, new Set(['media']))).toBe('nueva');
  });
  it('sin recuerdo propio no toma la recordada por otro', () => {
    expect(sessionForDirectory(deps(), all[1], all, { A: 'nueva' }, new Set(['nueva']))).toBe('media');
  });
  it('si su conversación ya no está en disco toma otra libre', () => {
    expect(sessionForDirectory(deps(), all[0], all, { A: 'borrada', B: 'nueva' }, new Set())).toBe('media');
  });
  it('latestSessionId respeta las exclusiones', () => {
    expect(latestSessionId(deps(), repo, new Set(['nueva', 'media']))).toBe('vieja');
  });
});

describe('sesión externa sin proceso', () => {
  const d = path.join(os.tmpdir(), 'no-existe-repo');
  it('es fantasma si nadie la reanuda ni trabaja en la carpeta', () => {
    expect(isGhostExternal('abc', d, [])).toBe(true);
    expect(isGhostExternal('abc', d, [{ argv: 'claude', cwd: '/otra' }])).toBe(true);
    expect(isGhostExternal('abc', d, [{ argv: 'claude', cwd: `${d}-2` }])).toBe(true);
  });
  it('no lo es si un proceso ajeno la reanuda o trabaja en la carpeta o debajo', () => {
    expect(isGhostExternal('abc', d, [{ argv: 'claude --resume abc', cwd: null }])).toBe(false);
    expect(isGhostExternal('abc', d, [{ argv: 'claude', cwd: d }])).toBe(false);
    expect(isGhostExternal('abc', d, [{ argv: 'claude', cwd: path.join(d, 'sub') }])).toBe(false);
  });
});
