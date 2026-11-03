import { useEffect, useMemo, useRef, useState } from 'react';

import { locale, useT } from '../../i18n/index.js';

/*
 * Mapa de calor tipo GitHub (una celda por día, columnas = semanas, filas L..D).
 * Ocupa todo el ancho disponible con celdas pequeñas: se muestran tantas semanas
 * como quepan (20 a 53) y la celda se ajusta al resto. Lo usan Actividad
 * (prompts por día) y Consumo (tokens por día, todos los agentes).
 */
const WEEKS_MIN = 20;
const WEEKS_MAX = 53;
const DAY_MS = 86_400_000;
const GAP = 3;
const CELL = 11;
const LABEL_W = 22;
// Como GitHub: más uso = verde más oscuro.
const LEVEL_COLOR = ['rgba(255,255,255,0.06)', '#9be9a8', '#40c463', '#30a14e', '#216e39'];

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function fmtDay(key: string): string {
  return new Date(`${key}T12:00:00`).toLocaleDateString(locale(), { weekday: 'short', day: '2-digit', month: 'short' });
}
function level(n: number, max: number): number {
  if (n <= 0) return 0;
  const r = n / Math.max(1, max);
  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
}

export interface HeatGrid {
  weeks: Array<Array<{ key: string; n: number; future: boolean }>>;
  max: number;
  months: Array<{ idx: number; label: string }>;
}

/** Cuadrícula de `weeks` semanas terminando hoy, con los valores por día dados. */
export function buildGrid(values: Record<string, number>, weeks: number): HeatGrid {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7; // lunes = 0
  const end = new Date(today.getTime() + (6 - dow) * DAY_MS);
  const start = new Date(end.getTime() - (weeks * 7 - 1) * DAY_MS);
  const cols: HeatGrid['weeks'] = [];
  let max = 0;
  for (let w = 0; w < weeks; w++) {
    const col: HeatGrid['weeks'][number] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * DAY_MS);
      const key = dayKey(date);
      const n = values[key] ?? 0;
      if (n > max) max = n;
      col.push({ key, n, future: date.getTime() > today.getTime() });
    }
    cols.push(col);
  }
  const months: HeatGrid['months'] = [];
  let lastM = -1;
  cols.forEach((col, i) => {
    const m = new Date(`${col[0].key}T12:00:00`).getMonth();
    if (m !== lastM) {
      months.push({ idx: i, label: new Date(`${col[0].key}T12:00:00`).toLocaleDateString(locale(), { month: 'short' }) });
      lastM = m;
    }
  });
  return { weeks: cols, max, months };
}

export function Heatmap({ values, format, extra }: { values: Record<string, number>; format: (n: number) => string; extra?: (key: string) => string | null }) {
  const { t, lang } = useT();
  const DOW = t('activity.dow').split(',');
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ weeks: WEEKS_MIN, cell: CELL });
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth - LABEL_W;
      const weeks = Math.max(WEEKS_MIN, Math.min(WEEKS_MAX, Math.floor((w + GAP) / (CELL + GAP))));
      const cell = Math.max(8, Math.min(CELL + 3, Math.floor((w - GAP * (weeks - 1)) / weeks)));
      setFit((f) => (f.weeks === weeks && f.cell === cell ? f : { weeks, cell }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const grid = useMemo(() => buildGrid(values, fit.weeks), [values, fit.weeks, lang]);
  const { cell } = fit;
  const tipText = hover ? `${fmtDay(hover)} · ${format(values[hover] ?? 0)}${extra?.(hover) ? ` · ${extra(hover)}` : ''}` : '';
  return (
    <div ref={ref} className="relative">
      {tip && hover && (
        <div className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap bg-bg-dark border-2 border-border px-8 py-4 text-[12px] text-text shadow-[2px_2px_0px_#0a0a14]" style={{ left: tip.x, top: tip.y }}>
          {tipText}
        </div>
      )}
      <div className="relative h-[14px] text-[11px] text-text-muted" style={{ marginLeft: LABEL_W }}>
        {grid.months.map((m) => (
          <span key={m.idx} className="absolute" style={{ left: m.idx * (cell + GAP) }}>
            {m.label}
          </span>
        ))}
      </div>
      <div className="flex" style={{ gap: GAP }}>
        <div className="flex flex-col text-[10px] text-text-muted" style={{ gap: GAP, width: LABEL_W - GAP }}>
          {DOW.map((d) => (
            <span key={d} style={{ height: cell, lineHeight: `${cell}px` }}>
              {d}
            </span>
          ))}
        </div>
        {grid.weeks.map((col, i) => (
          <div key={i} className="flex flex-col" style={{ gap: GAP }}>
            {col.map((c) => (
              <div
                key={c.key}
                style={{ width: cell, height: cell, background: c.future ? 'transparent' : LEVEL_COLOR[level(c.n, grid.max)] }}
                onMouseEnter={(e) => {
                  setHover(c.key);
                  const r = ref.current?.getBoundingClientRect();
                  setTip({ x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) - 10 });
                }}
                onMouseLeave={() => {
                  setHover(null);
                  setTip(null);
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-8 mt-6 text-[11px] text-text-muted">
        <span>{t('activity.less')}</span>
        {LEVEL_COLOR.map((c, i) => (
          <span key={i} className="inline-block w-[11px] h-[11px]" style={{ background: c }} />
        ))}
        <span>{t('activity.more')}</span>
        <span className="ml-auto">{hover ? tipText : t('activity.weeksHint', { n: fit.weeks })}</span>
      </div>
    </div>
  );
}
