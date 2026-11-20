/**
 * Responder a un agente desde la pantalla externa:
 *
 *   - Resumen ejecutivo de su última respuesta (qué necesita de ti para seguir), hecho con
 *     Claude Haiku en una llamada suelta (`claude -p`, sin herramientas ni sesión guardada)
 *     y adaptado al tamaño de la pantalla. Se guarda por conversación y última respuesta.
 *   - Transcripción de lo que dictas: la placa manda un WAV y aquí lo pasa a texto
 *     whisper.cpp (`whisper-cli`), en local. Nada de audio sale del computador.
 *
 * El envío del texto a la conversación está en appPrompt.ts.
 */
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Lo último que respondió el agente y el prompt al que respondía. */
export interface LastTurn {
  /** uuid del último registro del asistente: clave del resumen guardado. */
  key: string;
  prompt: string;
  answer: string;
}

export interface Brief {
  /** Qué necesita de ti para continuar o terminar (una frase). */
  need: string;
  /** Conclusión de su respuesta, lo más corta posible. */
  summary: string;
}

export type BriefState = { state: 'ready'; brief: Brief } | { state: 'pending' } | { state: 'none' };

const TAIL_BYTES = 512 * 1024;
const ANSWER_MAX_CHARS = 6000;
const PROMPT_MAX_CHARS = 600;
/** Lo que cabe en la pantalla (480x320) con letra legible. */
export const NEED_MAX_CHARS = 110;
export const SUMMARY_MAX_CHARS = 330;
const BRIEF_TIMEOUT_MS = 60_000;
const WHISPER_TIMEOUT_MS = 60_000;
/** WAV de 16 kHz mono: 20 s ≈ 640 KB. */
export const VOICE_MAX_BYTES = 1024 * 1024;

type Part = { type?: string; text?: unknown };
const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? (content as Part[])
          .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text as string)
          .join('\n')
      : '';

/** Texto que no escribió una persona (avisos del sistema, resultados de comandos). */
const isNoise = (t: string): boolean => t.startsWith('<') || t.startsWith('[Request interrupted') || t.startsWith('Caveat:');

/** Último turno de un transcript: el prompt humano más reciente y lo que el asistente dijo después. */
export function lastTurn(file: string): LastTurn | null {
  let tail: string;
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(size, TAIL_BYTES));
    fs.readSync(fd, buf, 0, buf.length, size - buf.length);
    fs.closeSync(fd);
    tail = buf.toString('utf8');
  } catch {
    return null;
  }
  let prompt = '';
  let answer: string[] = [];
  let key = '';
  for (const line of tail.split('\n')) {
    if (!line.startsWith('{')) continue;
    let r: { type?: string; uuid?: string; isMeta?: boolean; isSidechain?: boolean; isCompactSummary?: boolean; message?: { content?: unknown } };
    try {
      r = JSON.parse(line) as typeof r;
    } catch {
      continue;
    }
    if (r.isSidechain) continue;
    if (r.type === 'user' && !r.isMeta && !r.isCompactSummary) {
      const t = textOf(r.message?.content).trim();
      if (t && !isNoise(t)) {
        prompt = t;
        answer = [];
        key = '';
      }
    } else if (r.type === 'assistant') {
      const t = textOf(r.message?.content).trim();
      if (t) {
        answer.push(t);
        key = r.uuid ?? key;
      }
    }
  }
  if (!key || answer.length === 0) return null;
  const full = answer.join('\n\n');
  return { key, prompt: prompt.slice(0, PROMPT_MAX_CHARS), answer: full.length > ANSWER_MAX_CHARS ? full.slice(-ANSWER_MAX_CHARS) : full };
}

/** Recorta sin partir una palabra. */
function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).trimEnd()}…`;
}

/** Lee la respuesta del modelo: un JSON {need, summary}, aunque venga envuelto en texto. */
export function parseBrief(out: string): Brief | null {
  const m = /\{[\s\S]*\}/.exec(out);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { need?: unknown; summary?: unknown };
    if (typeof j.need !== 'string' || typeof j.summary !== 'string') return null;
    const need = clip(j.need, NEED_MAX_CHARS);
    const summary = clip(j.summary, SUMMARY_MAX_CHARS);
    return need || summary ? { need, summary } : null;
  } catch {
    return null;
  }
}

const SYSTEM_ES = `Resumes la última respuesta de un agente de programación para una pantalla muy pequeña. Quien lee está lejos del computador y solo quiere saber qué se necesita de él para que el agente continúe o termine.
Responde SOLO un JSON con dos campos, en español y en lenguaje sencillo:
- "need": una frase de máximo ${NEED_MAX_CHARS} caracteres con lo que el agente necesita de la persona (una decisión, un permiso, un dato). Si ofrece opciones, nómbralas. Si no necesita nada, escribe "Nada: ya terminó."
- "summary": máximo ${SUMMARY_MAX_CHARS} caracteres con la conclusión de la respuesta: qué hizo o encontró y el resultado. Sin introducción ni detalles técnicos que no cambien la decisión.
No inventes nada que no esté en el texto. Sin markdown.`;

const SYSTEM_EN = `You summarize a coding agent's latest reply for a very small screen. The reader is away from the computer and only wants to know what is needed from them so the agent can continue or finish.
Reply ONLY with a JSON object with two fields, in plain English:
- "need": one sentence of at most ${NEED_MAX_CHARS} characters with what the agent needs from the person (a decision, a permission, a piece of information). If it offers options, name them. If it needs nothing, write "Nothing: it is done."
- "summary": at most ${SUMMARY_MAX_CHARS} characters with the conclusion of the reply: what it did or found and the result. No introduction and no technical detail that would not change the decision.
Do not invent anything that is not in the text. No markdown.`;

export function briefInput(turn: LastTurn, lang: string): string {
  return lang === 'es'
    ? `Lo que pidió la persona:\n${turn.prompt || '(sin dato)'}\n\nÚltima respuesta del agente:\n${turn.answer}`
    : `What the person asked:\n${turn.prompt || '(unknown)'}\n\nThe agent's latest reply:\n${turn.answer}`;
}

/** Llama a Claude Haiku por la línea de comandos. El shell de inicio pone `claude` en el PATH. */
function askHaiku(system: string, input: string): Promise<string | null> {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'claude' : (process.env.SHELL ?? '/bin/bash');
    const flags = ['-p', '--model', 'haiku', '--no-session-persistence', '--strict-mcp-config', '--tools', '', '--system-prompt', system, '--output-format', 'text'];
    const args = process.platform === 'win32' ? flags : ['-lc', 'exec claude "$@"', 'claude', ...flags];
    // Fuera de cualquier proyecto: sin CLAUDE.md ni contexto de una carpeta de trabajo.
    const child = spawn(shell, args, { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => child.kill(), BRIEF_TIMEOUT_MS);
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out : null);
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

/** Resúmenes por conversación: el de su última respuesta, o el que se está generando. */
export class BriefCache {
  private readonly done = new Map<string, { key: string; brief: Brief | null }>();
  private readonly running = new Map<string, string>();

  constructor(private readonly ask: (system: string, input: string) => Promise<string | null> = askHaiku) {}

  /** Estado del resumen de esa conversación; si falta y no se está generando, lo lanza. */
  get(sessionId: string, transcript: string | null, lang: string): BriefState {
    const turn = transcript ? lastTurn(transcript) : null;
    if (!turn) return { state: 'none' };
    const have = this.done.get(sessionId);
    if (have?.key === turn.key) return have.brief ? { state: 'ready', brief: have.brief } : { state: 'none' };
    if (this.running.get(sessionId) !== turn.key) {
      this.running.set(sessionId, turn.key);
      void this.ask(lang === 'es' ? SYSTEM_ES : SYSTEM_EN, briefInput(turn, lang))
        .then((out) => {
          if (this.running.get(sessionId) !== turn.key) return; // llegó otra respuesta mientras tanto
          this.done.set(sessionId, { key: turn.key, brief: out ? parseBrief(out) : null });
        })
        .catch(() => this.done.set(sessionId, { key: turn.key, brief: null }))
        .finally(() => {
          if (this.running.get(sessionId) === turn.key) this.running.delete(sessionId);
        });
    }
    return { state: 'pending' };
  }
}

// ── Voz ───────────────────────────────────────────────────────────
export interface VoiceConfig {
  /** Ejecutable de whisper.cpp. */
  bin: string;
  /** Modelo ggml. */
  model: string;
}

const firstExisting = (list: string[]): string | null => list.find((p) => p && fs.existsSync(p)) ?? null;

/**
 * Dónde está whisper: `OFICINA_WHISPER_BIN` / `OFICINA_WHISPER_MODEL`, o los sitios habituales
 * (Homebrew y `~/.cache/cubicle-whisper/`). null si falta alguno de los dos.
 */
export function voiceConfig(): VoiceConfig | null {
  const home = os.homedir();
  const bin = firstExisting([process.env.OFICINA_WHISPER_BIN ?? '', '/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli', '/usr/bin/whisper-cli']);
  const dir = path.join(home, '.cache', 'cubicle-whisper');
  const model = firstExisting([process.env.OFICINA_WHISPER_MODEL ?? '', ...['ggml-small.bin', 'ggml-medium.bin', 'ggml-base.bin', 'ggml-large-v3-turbo.bin'].map((m) => path.join(dir, m))]);
  return bin && model ? { bin, model } : null;
}

const exec = (cmd: string, args: string[], timeout: number): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve({ ok: !err, out: String(stdout) })));

/** Quita lo que whisper añade cuando no oye voz ("[BLANK_AUDIO]", "(música)") y los espacios de más. */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pasa a texto un WAV dictado en la pantalla. null = no se pudo; '' = no se oyó nada.
 * `lang`: código de dos letras o 'auto' (whisper lo detecta). Con el idioma equivocado whisper
 * "traduce" lo que oye y sale un texto sin sentido, así que no se usa el de la interfaz.
 */
export async function transcribe(wav: Buffer, lang: string, cfg: VoiceConfig | null = voiceConfig()): Promise<string | null> {
  if (!cfg || wav.length < 44 || wav.length > VOICE_MAX_BYTES || wav.toString('ascii', 0, 4) !== 'RIFF') return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-voz-'));
  try {
    const raw = path.join(dir, 'in.wav');
    fs.writeFileSync(raw, wav);
    // El micrófono de la placa trae zumbido grave y poco nivel: se filtra y se normaliza si hay ffmpeg.
    let input = raw;
    const ffmpeg = firstExisting(['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']);
    if (ffmpeg) {
      const clean = path.join(dir, 'clean.wav');
      const f = await exec(ffmpeg, ['-y', '-loglevel', 'error', '-i', raw, '-af', 'highpass=f=150,highpass=f=150,lowpass=f=6000,loudnorm=I=-18', '-ar', '16000', '-ac', '1', clean], 20_000);
      if (f.ok && fs.existsSync(clean)) input = clean;
    }
    const r = await exec(cfg.bin, ['-m', cfg.model, '-l', /^[a-z]{2}$/.test(lang) ? lang : 'auto', '-nt', '-np', '-f', input], WHISPER_TIMEOUT_MS);
    return r.ok ? cleanTranscript(r.out) : null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
