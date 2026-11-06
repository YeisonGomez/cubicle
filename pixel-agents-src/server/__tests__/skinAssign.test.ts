import { describe, expect, it } from 'vitest';

import { assignPokemon, freezeRoomTypes, type PokeData, type SkinFile } from '../src/office/skinRoutes.js';
import { xpForLevel, XP_DAILY_CAP } from '../src/pokemonXp.js';
import { nextRankLevel, RANK_LEVELS, rankForLevel } from '../src/ranks.js';

const p = (id: number) => ({ id, name: `p${id}`, slug: `p${id}`, gen: 1 });
const form = (next: number[] = []) => ({ name: 'x', slug: 'x', gen: 1, next });
const data = {
  order: ['fire', 'water', 'grass', 'rock'],
  sprite: '',
  types: {
    fire: { es: '', en: '', color: '', hue: 0, sat: 0, pokemon: [p(4), p(155), p(37)] },
    water: { es: '', en: '', color: '', hue: 0, sat: 0, pokemon: [p(7), p(158), p(60), p(54)] },
    grass: { es: '', en: '', color: '', hue: 0, sat: 0, pokemon: [p(1), p(152), p(43)] },
    rock: { es: '', en: '', color: '', hue: 0, sat: 0, pokemon: [p(74), p(95)] },
  },
  evo: {
    1: form([2]), 2: form([3]), 3: form(),
    4: form([5]), 5: form([6]), 6: form(),
    7: form([8]), 8: form([9]), 9: form(),
    152: form([153]), 153: form([154]), 154: form(),
    155: form([156]), 156: form([157]), 157: form(),
    158: form([159]), 159: form([160]), 160: form(),
    37: form([38]), 38: form(),
    54: form([55]), 55: form(),
    60: form([61]), 61: form([62]), 62: form(),
    43: form([44]), 44: form([45]), 45: form(),
    74: form([75]), 75: form([76]), 76: form(),
    95: form(),
  },
} as unknown as PokeData;
const empty = (): SkinFile => ({ theme: 'pokemon', rooms: {}, agents: {}, paths: {}, seen: {}, rankSeen: {} });

describe('asignación de Pokémon', () => {
  const rooms = { F: 'fire', W: 'water', G: 'grass', R: 'rock' };
  const order = ['F', 'W', 'G', 'R'];

  it('el primero de cada proyecto recibe un inicial, de su tipo si queda', () => {
    const s = empty();
    assignPokemon(s, data, [{ name: 'a', room: 'F' }, { name: 'b', room: 'W' }, { name: 'c', room: 'G' }, { name: 'd', room: 'R' }], rooms, order);
    expect(s.agents).toEqual({ a: 4, b: 7, c: 1, d: 152 }); // rock no tiene inicial: el siguiente libre
  });

  it('agotados los 6 iniciales, cadenas de 3 formas en orden, de su tipo primero', () => {
    const s = empty();
    const many = { ...rooms, A: 'fire', B: 'water', C: 'rock', D: 'fire' };
    const names = ['F', 'W', 'G', 'A', 'B', 'R', 'C', 'D'];
    assignPokemon(s, data, names.map((room) => ({ name: room, room })), many, names);
    expect(names.map((n) => s.agents[n])).toEqual([4, 7, 1, 155, 158, 152, 74, 43]);
  });

  it('los demás agentes salen al azar, nunca un inicial', () => {
    for (const r of [0, 0.5, 0.99]) {
      const s = empty();
      assignPokemon(s, data, [{ name: 'a', room: 'W' }, { name: 'b', room: 'W' }, { name: 'c', room: 'W' }], rooms, order, () => r);
      expect(s.agents.a).toBe(7);
      expect([60, 54]).toContain(s.agents.b);
      expect([60, 54]).toContain(s.agents.c);
      expect(s.agents.b).not.toBe(s.agents.c);
    }
  });

  it('solo se asigna una vez: moverse de sala o repetir no cambia nada', () => {
    const s = empty();
    const dirs = [{ name: 'a', room: 'F' }, { name: 'b', room: 'F' }];
    assignPokemon(s, data, dirs, rooms, order);
    const before = { ...s.agents };
    expect(assignPokemon(s, data, dirs, rooms, order)).toBe(false);
    expect(assignPokemon(s, data, [{ name: 'a', room: 'W' }, { name: 'b', room: 'R' }], rooms, order)).toBe(false);
    expect(s.agents).toEqual(before);
  });

  it('un agente nuevo en un proyecto con Pokémon no recibe inicial', () => {
    const s = empty();
    s.agents.a = 60;
    assignPokemon(s, data, [{ name: 'a', room: 'W' }, { name: 'b', room: 'W' }], rooms, order, () => 0);
    expect(s.agents).toEqual({ a: 60, b: 54 });
  });
});

describe('tipo de cada sala', () => {
  it('se guarda: una sala nueva no cambia el de las demás', () => {
    const s = empty();
    freezeRoomTypes(s, data, ['F', 'W']);
    expect(s.rooms).toEqual({ F: 'fire', W: 'water' });
    freezeRoomTypes(s, data, ['Nueva', 'F', 'W']);
    expect(s.rooms).toMatchObject({ F: 'fire', W: 'water', Nueva: 'grass' });
  });
});

describe('rangos', () => {
  it('cada rango empieza en su nivel', () => {
    RANK_LEVELS.forEach((l, i) => {
      expect(rankForLevel(l)).toBe(i);
      if (i > 0) expect(rankForLevel(l - 1)).toBe(i - 1);
    });
    expect(nextRankLevel(0)).toBe(10);
    expect(nextRankLevel(6)).toBeNull();
  });
  it('respetan el tiempo mínimo prometido, gracias al tope diario', () => {
    const days = RANK_LEVELS.slice(1).map((l) => Math.ceil(xpForLevel(l) / XP_DAILY_CAP));
    [7, 30, 60, 150, 240, 365].forEach((min, i) => expect(days[i]).toBeGreaterThanOrEqual(min));
  });
});
