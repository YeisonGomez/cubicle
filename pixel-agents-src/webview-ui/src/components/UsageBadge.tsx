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
  /** Cuánto queda de Fable (límite aparte) y de dónde sale el dato. */
  fable?: { remaining: number | null; source: 'notice' | 'cache' | 'unused' | null; at: number | null };
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

/** Cuánto se ha consumido de un límite; sin dato, la barra queda vacía. */
function Meter({ label, used, reset, title }: { label: string; used: number | null; reset: string; title?: string }) {
  const { t } = useT();
  const c = used === null ? undefined : colorFor(used);
  const resetTxt = reset ? t('usage.resets', { t: reset }) : '';
  return (
    <div className="flex items-center gap-6" title={title ?? t('usage.meterTitle', { label, pct: used ?? 0, reset: resetTxt })}>
      <span className="text-text-muted text-[11px] uppercase tracking-wide">{label}</span>
      <span className="relative inline-flex w-[80px] h-[8px] bg-bg border border-border overflow-hidden">
        {used !== null && <span className="absolute inset-y-0 left-0" style={{ width: `${Math.min(100, used)}%`, background: c }} />}
      </span>
      <span className="text-[12px] font-semibold text-text-muted" style={{ color: c }}>
        {used === null ? t('usage.unknown') : `${used}%`}
      </span>
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
        {usage && typeof day === 'number' && <Meter label={t('usage.session')} used={Math.round(day)} reset={fmtReset(usage.five_hour?.resets_at)} />}
        {usage?.plan?.name && (
          <span className="text-[11px] uppercase tracking-wide text-accent-bright" title={t('usage.planTitle', { p: usage.plan.name })}>
            {usage.plan.name}
          </span>
        )}
        {typeof week === 'number' && <Meter label={t('usage.week')} used={Math.round(week)} reset={fmtReset(usage?.seven_day?.resets_at, true)} />}
        {usage?.fable && (
          <Meter
            label="Fable"
            used={typeof usage.fable.remaining === 'number' ? 100 - usage.fable.remaining : null}
            reset=""
            title={
              usage.fable.source === 'notice'
                ? t('usage.fableNotice', { t: fmtReset((usage.fable.at ?? 0) / 1000, true) })
                : usage.fable.source === 'cache'
                  ? t('usage.fableCache', { t: fmtReset((usage.fable.at ?? 0) / 1000, true) })
                  : usage.fable.source === 'unused'
                    ? t('usage.fableUnused')
                    : t('usage.fableUnknown')
            }
          />
        )}
        {/* Ventanas por modelo (seven_day_<modelo>) si Claude Code llega a enviarlas; hoy solo envía la semanal total. */}
        {Object.entries(usage?.rate_limits ?? {})
          .filter(([k, v]) => /^seven_day_./.test(k) && typeof v?.used_percentage === 'number')
          .map(([k, v]) => (
            <Meter key={k} label={`${t('usage.week')} ${k.slice(9)}`} used={Math.round(v!.used_percentage!)} reset="" />
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
