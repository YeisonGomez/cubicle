import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { cleanPrompt, focusTimes, focusVerdict, transcriptHasPrompt } from '../src/office/appPrompt.js';
import { BriefCache, cleanTranscript, lastTurn, NEED_MAX_CHARS, parseBrief } from '../src/office/deviceVoice.js';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-voz-test-'));
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function transcript(rows: object[]): string {
  const f = path.join(tmp(), 't.jsonl');
  fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return f;
}

describe('responder desde la pantalla: envío a la app', () => {
  it('el texto se pega en una línea y sin caracteres de control; vacío o enorme no vale', () => {
    expect(cleanPrompt('  sí,\nhazlo\tya \u0007 ')).toBe('sí, hazlo ya');
    expect(cleanPrompt('   ')).toBeNull();
    expect(cleanPrompt('x'.repeat(4001))).toBeNull();
    expect(cleanPrompt(42)).toBeNull();
  });

  it('lee el enfoque de cada conversación de las fichas de la app', () => {
    const dir = tmp();
    const sub = path.join(dir, 'cuenta', 'org');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, `local_${A}.json`), JSON.stringify({ sessionId: `local_${A}`, lastFocusedAt: 500, otro: 'x'.repeat(2000) }));
    fs.writeFileSync(path.join(sub, `local_${B}.json`), JSON.stringify({ sessionId: `local_${B}` }));
    fs.writeFileSync(path.join(sub, 'otra-cosa.json'), '{"lastFocusedAt": 999}');
    expect([...focusTimes(dir)].sort()).toEqual([
      [A, 500],
      [B, 0],
    ]);
  });

  it('solo se teclea si la app mostró ESA conversación', () => {
    // Se abrió desde otra: su enfoque avanza.
    expect(focusVerdict(A, 100, new Map([[A, 300], [B, 200]]), false)).toBe(true);
    // Aún no avanza y es pronto para darla por abierta.
    expect(focusVerdict(A, 300, new Map([[A, 300], [B, 200]]), false)).toBe(false);
    // Ya era la que estaba abierta (la app no vuelve a anotar el enfoque): vale si es la más reciente.
    expect(focusVerdict(A, 300, new Map([[A, 300], [B, 200]]), true)).toBe(true);
    // Otra se enfocó después: el texto caería en la equivocada.
    expect(focusVerdict(A, 300, new Map([[A, 300], [B, 400]]), true)).toBe(false);
    // La app no conoce la conversación.
    expect(focusVerdict(A, 0, new Map([[B, 400]]), true)).toBe(false);
  });

  it('confirma el envío solo con un mensaje del usuario, con ese texto y posterior', () => {
    const at = Date.parse('2026-01-01T10:00:00Z');
    const f = transcript([
      { type: 'user', timestamp: '2026-01-01T09:00:00Z', message: { content: 'sí, hazlo' } },
      { type: 'assistant', timestamp: '2026-01-01T10:00:05Z', message: { content: [{ type: 'text', text: 'dijiste: no, espera' }] } },
      { type: 'user', timestamp: '2026-01-01T10:00:06Z', message: { content: [{ type: 'text', text: 'no, espera' }] } },
    ]);
    expect(transcriptHasPrompt(f, 'no, espera', at)).toBe(true);
    expect(transcriptHasPrompt(f, 'sí, hazlo', at)).toBe(false); // es anterior al envío
    expect(transcriptHasPrompt(f, 'dijiste', at)).toBe(false); // lo dijo el asistente
    expect(transcriptHasPrompt('/no/existe.jsonl', 'x', at)).toBe(false);
  });
});

describe('responder desde la pantalla: resumen y dictado', () => {
  const rows = [
    { type: 'user', uuid: 'u1', message: { content: 'arregla el login' } },
    { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'Reviso el código.' }, { type: 'tool_use', name: 'Read' }] } },
    { type: 'user', uuid: 'u2', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', uuid: 'a2', isSidechain: true, message: { content: [{ type: 'text', text: 'soy un subagente' }] } },
    { type: 'user', uuid: 'u3', isMeta: true, message: { content: 'aviso interno' } },
    { type: 'user', uuid: 'u4', message: { content: '<system-reminder>ruido</system-reminder>' } },
    { type: 'assistant', uuid: 'a3', message: { content: [{ type: 'text', text: 'Listo. ¿Hago push?' }] } },
  ];

  it('último turno: el prompt humano más reciente y todo lo que el agente dijo después', () => {
    expect(lastTurn(transcript(rows))).toEqual({ key: 'a3', prompt: 'arregla el login', answer: 'Reviso el código.\n\nListo. ¿Hago push?' });
    expect(lastTurn(transcript([...rows, { type: 'user', uuid: 'u5', message: { content: 'sí' } }]))).toBeNull(); // aún no responde
    expect(lastTurn('/no/existe.jsonl')).toBeNull();
  });

  it('lee el JSON del modelo aunque venga con texto alrededor, y lo recorta a la pantalla', () => {
    expect(parseBrief('Claro:\n```json\n{"need": "Decidir si hace push.", "summary": "Arregló el login."}\n```')).toEqual({ need: 'Decidir si hace push.', summary: 'Arregló el login.' });
    const long = parseBrief(JSON.stringify({ need: 'palabra '.repeat(60), summary: 'ok' }));
    expect(long?.need.length).toBeLessThanOrEqual(NEED_MAX_CHARS);
    expect(long?.need.endsWith('…')).toBe(true);
    expect(parseBrief('no pude')).toBeNull();
    expect(parseBrief('{"need": 3}')).toBeNull();
  });

  it('el resumen se genera una vez por respuesta y se rehace cuando el agente responde de nuevo', async () => {
    let calls = 0;
    const cache = new BriefCache(async () => {
      calls++;
      return `{"need": "n${calls}", "summary": "s${calls}"}`;
    });
    const f = transcript(rows);
    expect(cache.get(A, f, 'es')).toEqual({ state: 'pending' });
    expect(cache.get(A, f, 'es')).toEqual({ state: 'pending' });
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.get(A, f, 'es')).toEqual({ state: 'ready', brief: { need: 'n1', summary: 's1' } });
    expect(calls).toBe(1);
    fs.appendFileSync(f, JSON.stringify({ type: 'assistant', uuid: 'a4', message: { content: [{ type: 'text', text: 'Push hecho.' }] } }) + '\n');
    expect(cache.get(A, f, 'es')).toEqual({ state: 'pending' });
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.get(A, f, 'es')).toEqual({ state: 'ready', brief: { need: 'n2', summary: 's2' } });
    expect(cache.get(B, null, 'es')).toEqual({ state: 'none' });
  });

  it('si el modelo falla no se queda cargando', async () => {
    const cache = new BriefCache(async () => null);
    const f = transcript(rows);
    expect(cache.get(A, f, 'en')).toEqual({ state: 'pending' });
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.get(A, f, 'en')).toEqual({ state: 'none' });
  });

  it('del dictado se quitan las marcas de silencio de whisper', () => {
    expect(cleanTranscript(' [BLANK_AUDIO] \n')).toBe('');
    expect(cleanTranscript('  Sí, haz el push.\n (música) ')).toBe('Sí, haz el push.');
  });
});
