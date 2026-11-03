import { useEffect, useRef, useState } from 'react';

import { locale, useT } from '../i18n/index.js';
import { IconChevronLeft, IconChevronRight } from './icons.js';
import { fmtTokens, HoursChart, WeekdayChart } from './panel/Charts.js';
import { Heatmap } from './panel/Heatmap.js';
import { Modal } from './ui/Modal.js';

interface AgentUsage {
  name: string;
  total: number;
  prompts: number;
  in: number;
  out: number;
  cacheW: number;
  cacheR: number;
  pct: number;
  pctRoom: number;
}
interface RoomUsage {
  label: string;
  color: string;
  total: number;
  pct: number;
  agents: AgentUsage[];
}
interface TokenUsage {
  days: number;
  total: number;
  rooms: RoomUsage[];
}

interface RateLimit {
  used_percentage?: number | null;
  resets_at?: number | null;
}
interface AccountUsage {
  five_hour: RateLimit | null;
  seven_day: RateLimit | null;
  rate_limits?: Record<string, RateLimit | null> | null;
  model?: string | null;
  modelId?: string | null;
  cost?: { total_cost_usd?: number; total_duration_ms?: number; total_lines_added?: number; total_lines_removed?: number } | null;
  context_window?: { used_percentage?: number; context_window_size?: number } | null;
  version?: string | null;
  updatedAt: number;
}
/** Nombre legible de cada ventana de límite que reporta Claude Code (five_hour, seven_day, seven_day_opus…). */
function limitLabel(key: string, t: (k: string) => string): string {
  if (key === 'five_hour') return t('tokens.acc.session');
  if (key === 'seven_day') return t('tokens.acc.week');
  const m = /^seven_day_(.+)$/.exec(key);
  if (m) return `${t('tokens.acc.week')} · ${m[1].charAt(0).toUpperCase() + m[1].slice(1)}`;
  return key.replace(/_/g, ' ');
}
function fmtReset(ts: number | null | undefined): string {
  if (!ts) return '';
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleString(locale(), { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const WINDOWS: Array<{ days: number; key: string }> = [
  { days: 1, key: 'tokens.win.today' },
  { days: 7, key: 'tokens.win.7' },
  { days: 30, key: 'tokens.win.30' },
  { days: 0, key: 'tokens.win.all' },
];

const pct = (p: number) => `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;

function Bar({ p, color }: { p: number; color: string }) {
  return (
    <span className="relative inline-block w-full h-[8px] bg-bg border border-border">
      <span className="absolute inset-y-0 left-0" style={{ width: `${Math.min(100, p)}%`, background: color }} />
    </span>
  );
}

/** Dónde se van los tokens: por sala y, dentro de cada sala, por agente. */
export function TokenUsageModal({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<TokenUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Actividad de TODOS los agentes (/api/stats): prompts por día y por hora, en dos láminas.
  const [act, setAct] = useState<{ days: Record<string, number>; hours: number[]; tokDays: Record<string, number>; tokHours: number[] } | null>(null);
  const wheelAt = useRef(0);
  const [slide, setSlide] = useState(0);
  const [account, setAccount] = useState<AccountUsage | null>(null);
  useEffect(() => {
    fetch('./api/usage', { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as AccountUsage) : null))
      .then((u) => u && setAccount(u))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    let alive = true;
    fetch(`./api/stats?days=${days}`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as { days?: Record<string, { prompts: number }>; hours?: number[]; tokensByDay?: Record<string, { in: number; out: number; cacheW: number; cacheR: number }>; tokensByHour?: number[] }) : null))
      .then((d) => {
        if (!alive || !d?.days || !d.hours) return;
        setAct({
          days: Object.fromEntries(Object.entries(d.days).map(([k, v]) => [k, v.prompts])),
          hours: d.hours,
          tokDays: Object.fromEntries(Object.entries(d.tokensByDay ?? {}).map(([k, v]) => [k, v.in + v.out + v.cacheW + v.cacheR])),
          tokHours: d.tokensByHour ?? new Array<number>(24).fill(0),
        });
      })
      .catch(() => {
        /* servidor viejo */
      });
    return () => {
      alive = false;
    };
  }, [days]);

  useEffect(() => {
    let alive = true;
    setData(null);
    fetch(`./api/usage/tokens?days=${days}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as TokenUsage;
        if (alive) {
          setData(d);
          setOpen(new Set(d.rooms.slice(0, 3).map((r) => r.label)));
        }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [days]);

  // Días dentro de la ventana elegida (para la gráfica de días de la semana).
  const inWindow = <T,>(m: Record<string, T>): Record<string, T> => {
    if (days <= 0) return m;
    const cut = new Date(Date.now() - (days - 1) * 86_400_000);
    const key = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, '0')}-${String(cut.getDate()).padStart(2, '0')}`;
    return Object.fromEntries(Object.entries(m).filter(([k]) => k >= key));
  };
  const toggle = (label: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(label)) n.delete(label);
      else n.add(label);
      return n;
    });

  return (
    <Modal isOpen title={t('tokens.title')} onClose={onClose} className="w-[760px] max-w-[95vw]">
      <div className="ide-ui flex flex-col gap-10">
        <div className="flex items-center gap-10">
          <span className="t-desc">{t('tokens.desc')}</span>
          <span className="ml-auto flex gap-4">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                className={`px-8 py-3 border-2 text-[12px] ${days === w.days ? 'border-accent text-text' : 'border-border text-text-muted hover:text-text'}`}
                onClick={() => setDays(w.days)}
              >
                {t(w.key)}
              </button>
            ))}
          </span>
        </div>
        {account && (
          <div className="border-2 border-border px-10 py-8 flex flex-col gap-8">
            <div className="flex items-center gap-8">
              <span className="t-sub">{t('tokens.acc.title')}</span>
              <span className="t-desc">
                {account.model ? `${t('tokens.acc.model')}: ${account.model}` : ''}
                {account.version ? ` · Claude Code ${account.version}` : ''}
              </span>
              <span className="ml-auto t-desc">{t('tokens.acc.updated', { d: new Date(account.updatedAt * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-16 gap-y-6">
              {Object.entries({ five_hour: account.five_hour, seven_day: account.seven_day, ...(account.rate_limits ?? {}) })
                .filter(([k], i, arr) => arr.findIndex(([x]) => x === k) === i)
                .map(([k, v]) => {
                  const used = typeof v?.used_percentage === 'number' ? Math.round(v.used_percentage) : null;
                  return (
                    <div key={k} className="flex flex-col gap-3">
                      <div className="flex items-center gap-8 text-[13px]">
                        <span className="text-text">{limitLabel(k, t)}</span>
                        <span className="ml-auto font-semibold" style={{ color: used === null ? 'var(--color-text-muted)' : used >= 90 ? 'var(--color-status-error)' : used >= 70 ? 'var(--color-status-permission)' : 'var(--color-status-success)' }}>
                          {used === null ? t('tokens.acc.noData') : `${used}% · ${t('tokens.acc.left', { n: 100 - used })}`}
                        </span>
                      </div>
                      <div className="h-6 bg-bg-dark border border-border">
                        <div className="h-full" style={{ width: `${used ?? 0}%`, background: used === null ? 'transparent' : used >= 90 ? 'var(--color-status-error)' : used >= 70 ? 'var(--color-status-permission)' : 'var(--color-status-success)' }} />
                      </div>
                      <div className="t-desc">{v?.resets_at ? t('tokens.acc.resets', { d: fmtReset(v.resets_at) }) : used === null ? t('tokens.acc.noDataWhy') : ''}</div>
                    </div>
                  );
                })}
            </div>
            {(account.cost || account.context_window) && (
              <div className="t-desc flex flex-wrap gap-x-16 gap-y-2">
                {typeof account.context_window?.used_percentage === 'number' && <span>{t('tokens.acc.context', { p: Math.round(account.context_window.used_percentage) })}</span>}
                {typeof account.cost?.total_cost_usd === 'number' && <span>{t('tokens.acc.cost', { c: account.cost.total_cost_usd.toFixed(2) })}</span>}
                {typeof account.cost?.total_duration_ms === 'number' && <span>{t('tokens.acc.duration', { m: Math.round(account.cost.total_duration_ms / 60000) })}</span>}
                {typeof account.cost?.total_lines_added === 'number' && <span>{t('tokens.acc.lines', { a: account.cost.total_lines_added, r: account.cost.total_lines_removed ?? 0 })}</span>}
              </div>
            )}
            <div className="t-desc">{t('tokens.acc.planNote')}</div>
          </div>
        )}
        {act && (
          <div
            className="border-2 border-border px-10 py-8 overflow-hidden"
            onWheel={(e) => {
              // Rueda/trackpad horizontal: cambia de lámina (con freno para no saltar dos).
              if (Math.abs(e.deltaX) < 20 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
              const now = Date.now();
              if (now - wheelAt.current < 500) return;
              wheelAt.current = now;
              setSlide((s) => Math.max(0, Math.min(1, s + (e.deltaX > 0 ? 1 : -1))));
            }}
          >
            <div className="flex items-center gap-8 mb-6">
              <span className="t-sub">{slide === 0 ? t('tokens.slideHeat') : t('tokens.slideCharts')}</span>
              <span className="ml-auto flex items-center gap-6">
                <button className="flex items-center justify-center size-24 border-2 border-border text-text-muted hover:text-text disabled:opacity-30" disabled={slide === 0} onClick={() => setSlide(0)} title={t('tokens.slideHeat')}>
                  <IconChevronLeft size={18} />
                </button>
                {[0, 1].map((i) => (
                  <button key={i} className={`w-10 h-10 ${slide === i ? 'bg-accent' : 'bg-border hover:bg-text-muted'}`} onClick={() => setSlide(i)} title={i === 0 ? t('tokens.slideHeat') : t('tokens.slideCharts')} />
                ))}
                <button className="flex items-center justify-center size-24 border-2 border-border text-text-muted hover:text-text disabled:opacity-30" disabled={slide === 1} onClick={() => setSlide(1)} title={t('tokens.slideCharts')}>
                  <IconChevronRight size={18} />
                </button>
              </span>
            </div>
            <div className="flex w-full transition-transform duration-300 ease-out" style={{ transform: `translateX(-${slide * 100}%)` }}>
              <div className="w-full shrink-0 pr-2 overflow-hidden">
                <Heatmap values={act.days} format={(n) => t('activity.promptsN', { n })} extra={(k) => (act.tokDays[k] ? `${fmtTokens(act.tokDays[k])} tokens` : null)} />
              </div>
              <div className="w-full shrink-0 pl-2 pt-4 grid grid-cols-[1fr_220px] gap-20 overflow-hidden">
                <HoursChart hours={act.hours} tokens={act.tokHours} />
                <WeekdayChart days={inWindow(act.days)} tokensByDay={inWindow(act.tokDays)} />
              </div>
            </div>
          </div>
        )}
        {error && <div className="text-status-error">{error}</div>}
        {!data && !error && <div className="text-text-muted">{t('tokens.calc')}</div>}
        {data && (
          <>
            <div className="t-title">
              {t('tokens.total', { n: fmtTokens(data.total) })}
              {data.rooms[0] && (
                <span className="text-text-muted">
                  {t('tokens.top')}<span className="text-text">{data.rooms[0].label}</span> ({pct(data.rooms[0].pct)})
                </span>
              )}
            </div>
            <div className="max-h-[480px] overflow-y-auto flex flex-col gap-6">
              {data.rooms.length === 0 && <div className="text-text-muted">{t('tokens.none')}</div>}
              {data.rooms.map((r) => (
                <div key={r.label} className="border-2 border-border">
                  <button className="w-full flex items-center gap-10 px-10 py-6 text-left hover:bg-btn-hover" onClick={() => toggle(r.label)}>
                    <span className="inline-block w-8 h-8 shrink-0" style={{ background: r.color }} />
                    <span className="font-semibold text-text w-[140px] truncate">{r.label}</span>
                    <span className="flex-1">
                      <Bar p={r.pct} color={r.color} />
                    </span>
                    <span className="w-[56px] text-right font-semibold" style={{ color: r.color }}>
                      {pct(r.pct)}
                    </span>
                    <span className="w-[70px] text-right text-text-muted text-[12px]">{fmtTokens(r.total)}</span>
                  </button>
                  {open.has(r.label) &&
                    r.agents.map((a) => (
                      <div
                        key={a.name}
                        className="flex items-center gap-10 pl-28 pr-10 py-4 text-[12px] border-t border-border"
                        title={t('tokens.agentTip', { in: fmtTokens(a.in), out: fmtTokens(a.out), cw: fmtTokens(a.cacheW), cr: fmtTokens(a.cacheR), p: a.prompts })}
                      >
                        <span className="text-text w-[140px] truncate">{a.name}</span>
                        <span className="flex-1">
                          <Bar p={a.pctRoom} color={r.color} />
                        </span>
                        <span className="w-[56px] text-right text-text">{pct(a.pct)}</span>
                        <span className="w-[70px] text-right text-text-muted">{fmtTokens(a.total)}</span>
                      </div>
                    ))}
                </div>
              ))}
            </div>
            <div className="text-text-muted text-[11px]">
              {t('tokens.foot')}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
