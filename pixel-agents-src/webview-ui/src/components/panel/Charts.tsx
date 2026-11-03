import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useMemo, useState } from 'react';

import { locale, useT } from '../../i18n/index.js';

/* Gráficas pequeñas compartidas por Actividad y Consumo: prompts por hora y por
 * día de la semana. Misma estructura en ambas (barras de 80 px + fila de etiquetas)
 * para que queden alineadas lado a lado. Tooltip propio, inmediato, con prompts
 * y (si se pasan) tokens. */
const BAR = '#40c463';
const BAR_PEAK = '#216e39';

export function fmtDate(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} k`;
  return String(n);
}

/** Tooltip inmediato anclado al puntero dentro del contenedor (relative). */
export function useHoverTip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const show = (e: ReactMouseEvent, text: string) => {
    const host = (e.currentTarget as HTMLElement).closest('[data-tip-host]') as HTMLElement | null;
    const r = host?.getBoundingClientRect();
    setTip({ x: e.clientX - (r?.left ?? 0), y: (r ? e.clientY - r.top : e.clientY) - 10, text });
  };
  const hide = () => setTip(null);
  const node: ReactNode = tip ? (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap bg-bg-dark border-2 border-border px-8 py-4 text-[12px] text-text shadow-[2px_2px_0px_#0a0a14]"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>
  ) : null;
  return { show, hide, node };
}

/** Prompts por hora del día (24 barras), con el pico resaltado. `tokens` opcional por hora. */
export function HoursChart({ hours, tokens, lastAt }: { hours: number[]; tokens?: number[]; lastAt?: number | null }) {
  const { t } = useT();
  const { show, hide, node } = useHoverTip();
  const peak = hours.reduce((best, n, h) => (n > hours[best] ? h : best), 0);
  const max = Math.max(1, ...hours);
  return (
    <div className="relative" data-tip-host>
      <div className="t-title mb-6">{t('activity.hours')}</div>
      <div className="flex items-end gap-2 h-[80px]">
        {hours.map((n, h) => (
          <div
            key={h}
            className="flex-1 h-full flex items-end"
            onMouseMove={(e) => show(e, `${h}:00 · ${t('activity.promptsN', { n })}${tokens ? ` · ${fmtTokens(tokens[h] ?? 0)} tokens` : ''}`)}
            onMouseLeave={hide}
          >
            <div className="w-full" style={{ height: `${Math.max(2, (n / max) * 100)}%`, background: h === peak ? BAR_PEAK : BAR }} />
          </div>
        ))}
      </div>
      <div className="flex text-[10px] text-text-muted mt-2 h-[14px]">
        {[0, 6, 12, 18].map((h) => (
          <span key={h} className="flex-1">
            {h}:00
          </span>
        ))}
        <span>23:00</span>
      </div>
      {lastAt !== undefined && <div className="text-text-muted text-[11px] mt-6">{t('activity.peak', { h: peak, d: fmtDate(lastAt) })}</div>}
      {node}
    </div>
  );
}

/** Prompts por día de la semana (L..D). `tokensByDay` opcional para el tooltip. */
export function WeekdayChart({ days, tokensByDay }: { days: Record<string, number>; tokensByDay?: Record<string, number> }) {
  const { t } = useT();
  const { show, hide, node } = useHoverTip();
  const DOW = t('activity.dow').split(',');
  const DOW_LONG = t('activity.dowLong').split(',');
  const byWeekday = useMemo(() => {
    const out = new Array<number>(7).fill(0);
    const tok = new Array<number>(7).fill(0);
    for (const [k, n] of Object.entries(days)) out[(new Date(`${k}T12:00:00`).getDay() + 6) % 7] += n;
    for (const [k, n] of Object.entries(tokensByDay ?? {})) tok[(new Date(`${k}T12:00:00`).getDay() + 6) % 7] += n;
    return { out, tok };
  }, [days, tokensByDay]);
  const max = Math.max(1, ...byWeekday.out);
  const best = byWeekday.out.indexOf(Math.max(...byWeekday.out));
  return (
    <div className="relative" data-tip-host>
      <div className="t-title mb-6">{t('activity.weekdays')}</div>
      <div className="flex items-end gap-4 h-[80px]">
        {byWeekday.out.map((n, i) => (
          <div
            key={i}
            className="flex-1 h-full flex items-end"
            onMouseMove={(e) => show(e, `${DOW_LONG[i]} · ${t('activity.promptsN', { n })}${tokensByDay ? ` · ${fmtTokens(byWeekday.tok[i])} tokens` : ''}`)}
            onMouseLeave={hide}
          >
            <div className="w-full" style={{ height: `${Math.max(2, (n / max) * 100)}%`, background: i === best ? BAR_PEAK : BAR }} />
          </div>
        ))}
      </div>
      <div className="flex gap-4 text-[10px] text-text-muted mt-2 h-[14px]">
        {DOW.map((d) => (
          <span key={d} className="flex-1 text-center">
            {d}
          </span>
        ))}
      </div>
      {node}
    </div>
  );
}
