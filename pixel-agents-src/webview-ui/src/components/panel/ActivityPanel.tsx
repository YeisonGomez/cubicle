import { useEffect, useMemo, useState } from 'react';

import { locale, useT } from '../../i18n/index.js';
import { HoursChart, WeekdayChart } from './Charts.js';
import { buildGrid, Heatmap } from './Heatmap.js';

interface DayStats {
  prompts: number;
  replies: number;
  tools: number;
}
interface Stats {
  days: Record<string, DayStats>;
  sessions: number;
  prompts: number;
  hours: number[];
  firstAt: number | null;
  lastAt: number | null;
  streak: number;
  last7: number;
  last30: number;
  busiestDay: { day: string; prompts: number } | null;
  agents?: number;
}

function fmtDate(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDay(key: string): string {
  return new Date(`${key}T12:00:00`).toLocaleDateString(locale(), { weekday: 'short', day: '2-digit', month: 'short' });
}
const BAR = '#40c463';
const BAR_PEAK = '#216e39';

/** Vista "Actividad": mapa de calor de prompts por día, cifras básicas, horas en que
 *  más trabajas y las capacidades de la sesión (recursos externos, MCP, apps, skills). */
export function ActivityPanel({ url, title }: { url: string; title: string }) {
  const { t, tn, lang } = useT();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setStats(null);
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const s = (await r.json()) as Stats;
        if (alive) setStats(s);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [url]);

  const promptsByDay = useMemo(() => Object.fromEntries(Object.entries(stats?.days ?? {}).map(([k, v]) => [k, v.prompts])), [stats]);
  // Semanas para la gráfica semanal (26 = 6 meses), independiente del ancho del mapa.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const grid = useMemo(() => buildGrid(promptsByDay, 26), [promptsByDay, lang]);

  // Últimos 6 meses (26 semanas), con etiquetas de mes sin solaparse.
  const byWeek = useMemo(() => {
    const weeks = grid.weeks.map((col) => ({ key: col[0].key, n: col.reduce((a, c) => a + c.n, 0) }));
    const months: Array<{ idx: number; label: string }> = [];
    let lastM = -1;
    weeks.forEach((w, i) => {
      const d = new Date(`${w.key}T12:00:00`);
      if (d.getMonth() !== lastM) {
        lastM = d.getMonth();
        const prev = months[months.length - 1];
        if (!prev || i - prev.idx >= 3) months.push({ idx: i, label: d.toLocaleDateString(locale(), { month: 'short' }) });
      }
    });
    if (months.length && weeks.length - months[months.length - 1].idx < 3) months.pop(); // no pisar "hoy"
    return { weeks, months };
  }, [grid]);

  if (error) return <div className="px-12 py-8 text-status-error">{error}</div>;
  if (!stats) return <div className="px-12 py-8 text-text-muted">{t('activity.loading')}</div>;

  const activeDays = Object.values(stats.days).filter((d) => d.prompts > 0).length;

  const Stat = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
    <div className="flex-1 min-w-[120px] border-2 border-border px-10 py-8">
      <div className="text-[24px] font-semibold text-text leading-none">{value}</div>
      <div className="t-desc mt-4">{label}</div>
      {hint && <div className="t-label">{hint}</div>}
    </div>
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-12 py-10 flex flex-col gap-16">
      <div className="t-title">
        {t('activity.title', { name: title })}
        {stats.agents !== undefined && <span className="t-desc">{` · ${tn('common.agents', stats.agents)}`}</span>}
      </div>

      {/* Mapa de calor */}
      <Heatmap values={promptsByDay} format={(n) => tn('activity.prompts', n)} />

      {/* Cifras */}
      <div className="flex flex-wrap gap-8">
        <Stat label={t('activity.stat.prompts')} value={stats.prompts} hint={t('activity.stat.promptsHint', { w: stats.last7, m: stats.last30 })} />
        <Stat label={t('activity.stat.days')} value={activeDays} hint={stats.streak ? tn('activity.stat.streak', stats.streak) : t('activity.stat.noStreak')} />
        <Stat label={t('activity.stat.sessions')} value={stats.sessions} hint={t('activity.stat.since', { d: fmtDate(stats.firstAt) })} />
      </div>

      {/* Horas */}
      <HoursChart hours={stats.hours} lastAt={stats.lastAt} />

      {/* Días de la semana y semanas */}
      <div className="grid grid-cols-[180px_1fr] gap-16">
        <WeekdayChart days={promptsByDay} />
        <div>
          <div className="t-title mb-6">{t('activity.weekly')} <span className="t-desc">{t('activity.weeklySub')}</span></div>
          {(() => {
            const weeks = byWeek.weeks;
            const max = Math.max(1, ...weeks.map((w) => w.n));
            const best = weeks.reduce((b, w, i) => (w.n > weeks[b].n ? i : b), 0);
            return (
              <>
                <div className="flex items-end gap-2 h-[80px]">
                  {weeks.map((w, i) => (
                    <div
                      key={w.key}
                      className="flex-1"
                      style={{ height: `${Math.max(2, (w.n / max) * 100)}%`, background: i === best ? BAR_PEAK : BAR }}
                      title={t('activity.weekTip', { d: fmtDay(w.key), n: w.n })}
                    />
                  ))}
                </div>
                <div className="relative h-[14px] text-[10px] text-text-muted">
                  {byWeek.months.map((m) => (
                    <span key={m.idx} className="absolute" style={{ left: `${(m.idx / weeks.length) * 100}%` }}>
                      {m.label}
                    </span>
                  ))}
                  <span className="absolute right-0">{t('activity.today')}</span>
                </div>
                <div className="text-text-muted text-[11px] mt-4">
                  {t('activity.bestWeek', { d: fmtDay(weeks[best].key), n: weeks[best].n, avg: Math.round(weeks.reduce((a, w) => a + w.n, 0) / Math.max(1, weeks.filter((w) => w.n > 0).length)) })}
                </div>
              </>
            );
          })()}
        </div>
      </div>

    </div>
  );
}
