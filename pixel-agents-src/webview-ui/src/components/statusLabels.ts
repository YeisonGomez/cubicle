/**
 * Estados cortos y legibles (con emoji) para personajes y tarjetas. El servidor
 * manda textos tipo "Running: cd … && npm test" o "Reading src/app.ts"; aquí se
 * resumen a una palabra para no inundar la UI. Los textos salen de i18n, así que
 * quien los muestre debe re-renderizar al cambiar de idioma (useT()).
 */
import { t } from '../i18n/index.js';

export type StatusKey = 'resting' | 'idle' | 'new' | 'working' | 'permission' | 'question' | 'disconnected';

/** Texto traducido de un estado fijo. */
export function statusText(key: StatusKey): string {
  return t(`status.${key}`);
}

/** Resume el texto crudo de una herramienta en un estado corto. */
export function shortActivity(raw: string): string {
  const s = raw.trim();
  if (!s || s === 'Idle') return t('status.idle');
  if (/^Needs approval/i.test(s)) return t('status.permission');
  if (/^Waiting/i.test(s)) return t('status.question');
  if (/^(Running|Executing|Bash)/i.test(s)) return t('status.running');
  if (/^(Reading|Read\b|Viewing|Opening)/i.test(s)) return t('status.reading');
  if (/^(Editing|Writing|Edit\b|Write\b|Creating|Notebook)/i.test(s)) return t('status.editing');
  if (/^(Searching|Grep|Glob|Finding|Listing)/i.test(s)) return t('status.searching');
  if (/chrome|browser|navigat|computer/i.test(s)) return t('status.browsing');
  if (/^(Fetching|Web|Searching the web)/i.test(s)) return t('status.web');
  if (/^(Thinking|Planning)/i.test(s)) return t('status.thinking');
  if (/^(Delegating|Spawning|Task\b|Agent\b|Running agent)/i.test(s)) return t('status.delegating');
  if (/^(Asking|Question)/i.test(s)) return t('status.question');
  if (/^Using/i.test(s)) return t('status.tool');
  return t('status.working');
}
