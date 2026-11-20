/**
 * Enviar un prompt a una conversación que vive en la app de escritorio de Claude (macOS).
 *
 * La app no ofrece ninguna entrada para esto (sus enlaces solo abren o crean conversaciones,
 * y un `claude -p --resume` en segundo plano escribe en el transcript pero la app no lo ve:
 * la conversación se parte en dos). Lo único que la app recibe como un mensaje del usuario
 * es que se lo escriban: se abre la conversación, se pega el texto y se pulsa Enter.
 *
 * Como eso es teclear a ciegas, antes de pegar se comprueba todo lo que se puede comprobar:
 *   1. La pantalla del Mac no está bloqueada (si lo está, el texto iría al campo de la clave).
 *   2. La app enfocó ESA conversación: la app anota `lastFocusedAt` en su ficha de la sesión
 *      (`claude-code-sessions/<cuenta>/<org>/local_<id>.json`). Debe avanzar tras abrir el
 *      enlace o, si ya era la que estaba abierta (ahí no se vuelve a anotar), ser la más reciente.
 *   3. La app de Claude es la que está al frente.
 * Al pegar se reemplaza lo que hubiera a medio escribir (Cmd+A): es preferible perder un
 * borrador a enviarlo pegado a lo dictado. Después se confirma en el transcript que el
 * mensaje entró.
 *
 * Requiere el permiso de Accesibilidad de macOS para el proceso que lo ejecuta.
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type AppPromptReason =
  | 'unsupported' // solo macOS
  | 'bad-input'
  | 'busy' // ya hay otro envío en curso
  | 'locked' // pantalla bloqueada
  | 'not-focused' // la app no mostró esa conversación
  | 'no-permission' // falta el permiso de Accesibilidad
  | 'not-confirmed' // se tecleó, pero el mensaje no apareció en el transcript
  | 'failed';

/** `queued`: el agente estaba a mitad de un turno; la app lo deja en cola y lo entrega al terminar. */
export type AppPromptResult = { ok: true; queued?: boolean } | { ok: false; reason: AppPromptReason };

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const APP_PROMPT_MAX_CHARS = 4000;
/** Espera a que la app anote el enfoque de la conversación. */
const FOCUS_TIMEOUT_MS = 8000;
/** Sin cambio tras este tiempo se acepta si la conversación ya era la más reciente (estaba abierta). */
const FOCUS_ALREADY_MS = 2500;
const FOCUS_POLL_MS = 150;
/** El enfoque se anota en disco un poco después de ocurrir: margen antes de teclear. */
const FOCUS_SETTLE_MS = 500;
const CONFIRM_TIMEOUT_MS = 10_000;
/** Con el agente trabajando no se espera tanto: lo normal es que quede en cola. */
const CONFIRM_WORKING_MS = 3000;
const CONFIRM_POLL_MS = 400;
const TAIL_BYTES = 256 * 1024;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Carpeta donde la app guarda la ficha de cada conversación de Claude Code. */
export const appSessionsDir = (): string => path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions');

/** Texto listo para pegar: una sola línea, sin caracteres de control. null si no sirve. */
export function cleanPrompt(text: unknown): string | null {
  if (typeof text !== 'string') return null;
   
  const t = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > 0 && t.length <= APP_PROMPT_MAX_CHARS ? t : null;
}

/** `lastFocusedAt` (ms) de cada conversación de la app, por id de Claude Code. */
export function focusTimes(dir: string = appSessionsDir()): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (d: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && depth < 2) walk(path.join(d, e.name), depth + 1);
      const m = e.isFile() ? /^local_([0-9a-f-]{36})\.json$/i.exec(e.name) : null;
      if (!m) continue;
      try {
        // Las fichas pesan (llevan la configuración de herramientas): basta con ese campo.
        const at = /"lastFocusedAt"\s*:\s*(\d+)/.exec(fs.readFileSync(path.join(d, e.name), 'utf8'));
        out.set(m[1].toLowerCase(), at ? Number(at[1]) : 0);
      } catch {
        /* a medio escribir: se reintenta en la siguiente vuelta */
      }
    }
  };
  walk(dir, 0);
  return out;
}

/**
 * ¿Mostró la app esa conversación? Sí si su enfoque avanzó respecto a `before`, o si pasado
 * `alreadyOk` sigue siendo la enfocada más reciente (ya era la que estaba abierta).
 */
export function focusVerdict(id: string, before: number, now: Map<string, number>, alreadyOk: boolean): boolean {
  const mine = now.get(id.toLowerCase()) ?? 0;
  if (mine > before) return true;
  if (!alreadyOk || mine === 0) return false;
  for (const [other, at] of now) if (other !== id.toLowerCase() && at >= mine) return false;
  return true;
}

function run(cmd: string, args: string[], timeout = 15_000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: String(stdout), err: String(stderr) });
    });
  });
}

async function screenLocked(): Promise<boolean> {
  const r = await run('ioreg', ['-n', 'Root', '-d1'], 5000);
  return /"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(r.out);
}

/** Pega el texto en la app al frente y pulsa Enter. El texto va por argumento, nunca dentro del guion. */
const TYPE_SCRIPT = `
on run argv
  tell application "Claude" to activate
  delay 0.4
  tell application "System Events"
    set frontApp to name of first application process whose frontmost is true
    if frontApp is not "Claude" then return "NOT_FRONT"
    set saved to missing value
    try
      set saved to the clipboard
    end try
    set the clipboard to (item 1 of argv)
    delay 0.15
    keystroke "a" using command down
    delay 0.1
    keystroke "v" using command down
    delay 0.4
    key code 36
    delay 0.4
    if saved is not missing value then
      try
        set the clipboard to saved
      end try
    end if
    return "SENT"
  end tell
end run`;

/** Transcript de una conversación de Claude Code, o null. */
export function transcriptOf(sessionId: string): string | null {
  const root = path.join(os.homedir(), '.claude', 'projects');
  try {
    for (const d of fs.readdirSync(root)) {
      const f = path.join(root, d, `${sessionId}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
  } catch {
    /* sin proyectos */
  }
  return null;
}

/** ¿Hay en el final del transcript un mensaje del usuario con ese texto, posterior a `sinceMs`? */
export function transcriptHasPrompt(file: string, text: string, sinceMs: number): boolean {
  let tail: string;
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(size, TAIL_BYTES));
    fs.readSync(fd, buf, 0, buf.length, size - buf.length);
    fs.closeSync(fd);
    tail = buf.toString('utf8');
  } catch {
    return false;
  }
  const needle = text.slice(0, 80);
  for (const line of tail.split('\n')) {
    if (!line.includes('"user"')) continue;
    try {
      const r = JSON.parse(line) as { type?: string; timestamp?: string; message?: { content?: unknown } };
      if (r.type !== 'user' || !r.timestamp || Date.parse(r.timestamp) < sinceMs) continue;
      const c = r.message?.content;
      const texts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')) : [];
      if (texts.some((t) => t.includes(needle))) return true;
    } catch {
      /* línea cortada por el recorte del final */
    }
  }
  return false;
}

let sending = false;

/**
 * Escribe `text` como mensaje del usuario en la conversación `sessionId` de la app de Claude.
 * `working`: el agente está a mitad de un turno. La app encola el mensaje y no llega al
 * transcript hasta que el turno acaba, así que no se puede confirmar: se da por encolado.
 */
export async function sendPromptToClaudeApp(sessionId: string, rawText: unknown, working = false): Promise<AppPromptResult> {
  // OFICINA_NO_RAISE=1 en pruebas: no tocar las apps del usuario.
  if (process.platform !== 'darwin' || process.env.OFICINA_NO_RAISE === '1') return { ok: false, reason: 'unsupported' };
  const text = cleanPrompt(rawText);
  if (!SESSION_ID.test(sessionId) || !text) return { ok: false, reason: 'bad-input' };
  if (sending) return { ok: false, reason: 'busy' };
  sending = true;
  try {
    if (await screenLocked()) return { ok: false, reason: 'locked' };
    const before = focusTimes().get(sessionId.toLowerCase()) ?? 0;
    const startedAt = Date.now();
    if ((await run('open', [`claude://resume?session=${sessionId}`])).code !== 0) return { ok: false, reason: 'failed' };
    let focused = false;
    while (!focused && Date.now() - startedAt < FOCUS_TIMEOUT_MS) {
      await sleep(FOCUS_POLL_MS);
      focused = focusVerdict(sessionId, before, focusTimes(), Date.now() - startedAt > FOCUS_ALREADY_MS);
    }
    if (!focused) return { ok: false, reason: 'not-focused' };
    await sleep(FOCUS_SETTLE_MS);
    const typed = await run('osascript', ['-e', TYPE_SCRIPT, text]);
    if (typed.code !== 0) return { ok: false, reason: /not allowed|assistive|\(1002\)|-25211/.test(typed.err) ? 'no-permission' : 'failed' };
    if (typed.out.trim() !== 'SENT') return { ok: false, reason: 'not-focused' };
    const until = Date.now() + (working ? CONFIRM_WORKING_MS : CONFIRM_TIMEOUT_MS);
    while (Date.now() < until) {
      await sleep(CONFIRM_POLL_MS);
      const file = transcriptOf(sessionId);
      if (file && transcriptHasPrompt(file, text, startedAt - 2000)) return { ok: true };
    }
    return working ? { ok: true, queued: true } : { ok: false, reason: 'not-confirmed' };
  } finally {
    sending = false;
  }
}
