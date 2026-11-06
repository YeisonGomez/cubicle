import { describe, expect, it } from 'vitest';

import { fableExhausted } from '../src/modelUsage.js';

const H = 3_600_000;
const resetsAt = 1_000_000; // segundos
const now = resetsAt * 1000 - H;

describe('límite de Fable', () => {
  it('sin aviso no está agotado', () => expect(fableExhausted(0, 5, resetsAt, now)).toBe(false));
  it('con aviso y sin respuestas después, agotado', () => expect(fableExhausted(now - H, now - 2 * H, resetsAt, now)).toBe(true));
  it('una respuesta de Fable posterior lo libera', () => expect(fableExhausted(now - 2 * H, now - H, resetsAt, now)).toBe(false));
  it('al pasar el reinicio semanal deja de mostrarse', () => expect(fableExhausted(now - H, now - 2 * H, resetsAt, resetsAt * 1000 + 1)).toBe(false));
  it('un aviso de la semana anterior no cuenta', () => expect(fableExhausted((resetsAt - 8 * 86400) * 1000, 0, resetsAt, now)).toBe(false));
  it('sin dato de reinicio, caduca a los 7 días', () => {
    expect(fableExhausted(now - H, 0, undefined, now)).toBe(true);
    expect(fableExhausted(now - 8 * 24 * H, 0, undefined, now)).toBe(false);
  });
});
