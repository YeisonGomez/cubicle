import { PieChart } from 'lucide-react';
import { useEffect, useState } from 'react';

import { locale, useT } from '../i18n/index.js';
import { TokenUsageModal } from './TokenUsageModal.js';
import { IconButton } from './ui/IconButton.js';

interface Usage {
  five_hour: { used_percentage?: number; resets_at?: number } | null;
  seven_day: { used_percentage?: number; resets_at?: number } | null;
  rate_limits?: Record<string, { used_percentage?: number; resets_at?: number } | null> | null;
  plan?: { name: string | null; type: string | null; tier: string | null } | null;
  /** Límite de Fable agotado, según el aviso de Claude Code. */
  fable?: { exhausted: boolean; reachedAt: number };
  model: string | null;
  updatedAt: number;
}

const POLL_MS = 20_000;
const COLORS = { ok: '#55c272', warn: '#f6c744', bad: '#ef5b5b' };

function colorFor(pct: number): string {
  return pct >= 80 ? COLORS.bad : pct >= 50 ? COLORS.warn : COLORS.ok;
}
function fmtReset(ts?: number, withDay = false): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return withDay
    ? d.toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
}

/** Reparto del uso por modelo (tokens de salida de la semana): partes de la barra, no límites aparte. */
interface Split { fable: number; other: number }
const FABLE_COLOR = '#8b7bff';

function Meter({ label, pct, reset, split }: { label: string; pct: number; reset: string; split?: Split | null }) {
  const { t } = useT();
  const c = colorFor(pct);
  const resetTxt = reset ? t('usage.resets', { t: reset }) : '';
  const title = split
    ? t('usage.weekSplitTitle', { pct, f: Math.round((pct * split.fable) / 100), o: Math.round((pct * split.other) / 100), fs: Math.round(split.fable), os: Math.round(split.other), reset: resetTxt })
    : t('usage.meterTitle', { label, pct, reset: resetTxt });
  return (
    <div className="flex items-center gap-6" title={title}>
      <span className="text-text-muted text-[11px] uppercase tracking-wide">{label}</span>
      <span className="relative inline-flex w-[80px] h-[8px] bg-bg border border-border overflow-hidden">
        {split ? (
          <>
            <span className="h-full" style={{ width: `${(Math.min(100, pct) * split.fable) / 100}%`, background: FABLE_COLOR }} />
            <span className="h-full" style={{ width: `${(Math.min(100, pct) * split.other) / 100}%`, background: c }} />
          </>
        ) : (
          <span className="absolute inset-y-0 left-0" style={{ width: `${Math.min(100, pct)}%`, background: c }} />
        )}
      </span>
      <span className="text-[12px] font-semibold" style={{ color: c }}>
        {pct}%
      </span>
      {split && (
        <span className="text-[11px] text-text-muted">
          {t('usage.tokens')}: <span style={{ color: FABLE_COLOR }}>Fable {Math.round(split.fable)}%</span> · {t('usage.others')} {Math.round(split.other)}%
        </span>
      )}
      {reset && <span className="text-text-muted text-[11px]">↻ {reset}</span>}
    </div>
  );
}

/** Límites de uso de la cuenta (sesión de 5 h y semana): son globales, por eso
 *  viven en una franja propia sobre la barra de agentes (fuera del scroll) y no
 *  en cada terminal. El modelo no se muestra: cada sesión puede usar uno distinto. */
export function UsageBadge({ working }: { working: number }) {
  const { t } = useT();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [showTokens, setShowTokens] = useState(false);
  const [split, setSplit] = useState<Split | null>(null);
  // Reparto Fable / otros modelos de la semana (el servidor lo cachea 5 min).
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('./api/usage/models?days=7', { cache: 'no-store' })
        .then(async (r) => (r.ok ? ((await r.json()) as { models: Array<{ model: string; output: number }> }) : null))
        .then((d) => {
          if (!alive || !d) return;
          let f = 0;
          let o = 0;
          for (const m of d.models) {
            if (/^claude-fable/.test(m.model)) f += m.output;
            else o += m.output;
          }
          setSplit(f + o > 0 ? { fable: (f / (f + o)) * 100, other: (o / (f + o)) * 100 } : null);
        })
        .catch(() => undefined);
    void load();
    const id = window.setInterval(() => void load(), 300_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('./api/usage', { cache: 'no-store' })
        .then(async (r) => (r.ok ? ((await r.json()) as Usage | null) : null))
        .then((u) => alive && setUsage(u))
        .catch(() => {
          /* servidor viejo */
        });
    void load();
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  const day = usage?.five_hour?.used_percentage;
  const week = usage?.seven_day?.used_percentage;
  const stale = usage ? Date.now() / 1000 - usage.updatedAt > 3600 : false;
  return (
    <div className="ide-ui flex items-center gap-16">
      <span className={`flex items-center gap-16 ${stale ? 'opacity-50' : ''}`} title={stale ? t('usage.stale') : undefined}>
        {usage && typeof day === 'number' && <Meter label={t('usage.session')} pct={Math.round(day)} reset={fmtReset(usage.five_hour?.resets_at)} />}
        {usage?.plan?.name && (
          <span className="text-[11px] uppercase tracking-wide text-accent-bright" title={t('usage.planTitle', { p: usage.plan.name })}>
            {usage.plan.name}
          </span>
        )}
        {typeof week === 'number' && <Meter label={t('usage.week')} pct={Math.round(week)} reset={fmtReset(usage?.seven_day?.resets_at, true)} split={split} />}
        {usage?.fable?.exhausted && (
          <span className="text-[12px] font-semibold" style={{ color: COLORS.bad }} title={t('usage.fableOutTitle', { t: fmtReset(usage.fable.reachedAt / 1000, true) })}>
            {t('usage.fableOut')}
          </span>
        )}
        {/* Ventanas por modelo (seven_day_<modelo>) si Claude Code llega a enviarlas; hoy solo envía la semanal total. */}
        {Object.entries(usage?.rate_limits ?? {})
          .filter(([k, v]) => /^seven_day_./.test(k) && typeof v?.used_percentage === 'number')
          .map(([k, v]) => (
            <Meter key={k} label={`${t('usage.week')} ${k.slice(9)}`} pct={Math.round(v!.used_percentage!)} reset="" />
          ))}
      </span>
      {working > 0 && (
        <span className="text-[12px] text-accent-bright" title={t('usage.workingTitle')}>
          {t('usage.working', { n: working })}
        </span>
      )}
      <IconButton label={t('usage.tokensTitle')} size="sm" active={showTokens} onClick={() => setShowTokens(true)}>
        <PieChart size={14} />
      </IconButton>
      {showTokens && <TokenUsageModal onClose={() => setShowTokens(false)} />}
    </div>
  );
}
