import { describe, expect, it } from 'vitest';

import { agentStarts } from '../src/agentStarts.js';

const all = () => true;

describe('agentStarts: quién empezó a trabajar (evolución al enviar un prompt)', () => {
  it('libre → activo (sin entrada) cuenta como empezar', () => {
    expect(agentStarts({ 17: 'waiting' }, {}, all)).toEqual([17]);
  });
  it('al cargar la pestaña nadie empieza', () => {
    expect(agentStarts({}, { 17: 'waiting' }, all)).toEqual([]);
    expect(agentStarts({}, {}, all)).toEqual([]);
  });
  it('seguir libre o seguir activo no cuenta', () => {
    expect(agentStarts({ 17: 'waiting' }, { 17: 'waiting' }, all)).toEqual([]);
    expect(agentStarts({}, {}, all)).toEqual([]);
  });
  it('un agente quitado de la oficina no cuenta', () => {
    expect(agentStarts({ 17: 'waiting' }, {}, (id) => id !== 17)).toEqual([]);
  });
  it('solo el que cambió, entre varios', () => {
    expect(agentStarts({ 1: 'waiting', 2: 'waiting', 3: 'permission' }, { 1: 'waiting', 3: 'permission' }, all)).toEqual([2]);
  });
});
