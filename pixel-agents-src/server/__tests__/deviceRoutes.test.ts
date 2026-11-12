import { describe, expect, it } from 'vitest';

import { DeviceStatusTracker, effectiveStatus, keyMatches, sortByUsage } from '../src/office/deviceRoutes.js';

describe('pantalla externa', () => {
  it('estado: sin mensajes = libre; sigue los mismos avisos que la webview', () => {
    const t = new DeviceStatusTracker();
    expect(t.get(1)).toBe('idle');
    t.onMessage({ type: 'agentStatus', id: 1, status: 'active' });
    expect(t.get(1)).toBe('working');
    t.onMessage({ type: 'agentToolPermission', id: 1 });
    expect(t.get(1)).toBe('permission');
    t.onMessage({ type: 'agentToolPermissionClear', id: 1 });
    expect(t.get(1)).toBe('working');
    t.onMessage({ type: 'agentStatus', id: 1, status: 'waiting' });
    expect(t.get(1)).toBe('idle');
    t.onMessage({ type: 'agentToolStart', id: 1, runInBackground: true });
    expect(t.get(1)).toBe('idle');
    t.onMessage({ type: 'agentToolStart', id: 1, permissionActive: true });
    expect(t.get(1)).toBe('permission');
  });
  it('clave: solo la exacta', () => {
    expect(keyMatches('abc123abc123abc1', 'abc123abc123abc1')).toBe(true);
    expect(keyMatches('abc123abc123abc2', 'abc123abc123abc1')).toBe(false);
    expect(keyMatches('corta', 'abc123abc123abc1')).toBe(false);
    expect(keyMatches(undefined, 'abc123abc123abc1')).toBe(false);
    expect(keyMatches(['abc123abc123abc1'], 'abc123abc123abc1')).toBe(false);
  });
  it('orden: salas por uso reciente, agentes de una sala juntos y por uso', () => {
    const list = [
      { name: 'Gym', room: 'Deporte' },
      { name: 'Investor Core', room: 'Investor' },
      { name: 'Meal Prep', room: 'Deporte' },
      { name: 'Investor Dashboard', room: 'Investor' },
      { name: 'Cubicle', room: 'Cubicle' },
    ];
    const usage = new Map([
      ['Investor Core', { recent: 50, total: 900 }],
      ['Investor Dashboard', { recent: 70, total: 100 }],
      ['Cubicle', { recent: 100, total: 300 }],
      ['Gym', { recent: 2, total: 40 }],
      ['Meal Prep', { recent: 2, total: 60 }],
    ]);
    expect(sortByUsage(list, usage).map((a) => a.name)).toEqual(['Investor Dashboard', 'Investor Core', 'Cubicle', 'Meal Prep', 'Gym']);
  });
  it('libre y pendiente de mirar = te necesita; trabajando o permiso no cambian', () => {
    const pending = new Set([1]);
    expect(effectiveStatus('idle', 1, pending)).toBe('question');
    expect(effectiveStatus('idle', 2, pending)).toBe('idle');
    expect(effectiveStatus('working', 1, pending)).toBe('working');
    expect(effectiveStatus('permission', 1, pending)).toBe('permission');
  });

  it('pendiente de atender: al terminar un turno, hasta que vuelve a trabajar o se abre desde la pantalla', () => {
    const t = new DeviceStatusTracker();
    expect(t.isPending(1)).toBe(false);
    t.onMessage({ type: 'agentStatus', id: 1, status: 'active' });
    t.onMessage({ type: 'agentStatus', id: 1, status: 'waiting' });
    t.onMessage({ type: 'agentStatus', id: 2, status: 'active' });
    t.onMessage({ type: 'agentStatus', id: 2, status: 'waiting' });
    expect([t.isPending(1), t.isPending(2)]).toEqual([true, true]);
    t.attended(1);
    t.onMessage({ type: 'agentStatus', id: 2, status: 'active' });
    expect([t.isPending(1), t.isPending(2)]).toEqual([false, false]);
  });
});
