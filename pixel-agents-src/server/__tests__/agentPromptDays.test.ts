import { describe, expect, it } from 'vitest';

import { splitFolderDays } from '../src/agentPromptDays.js';

describe('prompts de agentes en la misma carpeta', () => {
  const names = ['A', 'B'];

  it('cada uno suma sus conversaciones; lo que no tiene dueño es del primero', () => {
    const { days } = splitFolderDays(names, { d1: 10, d2: 5 }, { s1: { d1: 7 }, s2: { d1: 3, d2: 2 }, viejo: { d2: 3 } }, { s1: 'A', s2: 'B' }, {});
    expect(days.A).toEqual({ d1: 7, d2: 3 });
    expect(days.B).toEqual({ d1: 3, d2: 2 });
  });

  it('el total de la carpeta se conserva y nadie queda en negativo', () => {
    const { days } = splitFolderDays(names, { d1: 2 }, { s2: { d1: 5 } }, { s2: 'B' }, {});
    expect(days.A).toEqual({});
    expect(days.B).toEqual({ d1: 5 });
  });

  it('lo ganado no se pierde si desaparece el transcript', () => {
    const first = splitFolderDays(names, { d1: 4 }, { s2: { d1: 4 } }, { s2: 'B' }, {});
    const after = splitFolderDays(names, { d1: 4 }, {}, { s2: 'B' }, first.saved);
    expect(after.days.B).toEqual({ d1: 4 });
    expect(after.days.A).toEqual({});
  });

  it('una conversación de otro agente no cuenta', () => {
    const { days } = splitFolderDays(['A', 'B', 'C'], { d1: 3 }, { s: { d1: 3 } }, { s: 'C' }, {});
    expect(days.B).toEqual({});
    expect(days.C).toEqual({ d1: 3 });
  });
});
