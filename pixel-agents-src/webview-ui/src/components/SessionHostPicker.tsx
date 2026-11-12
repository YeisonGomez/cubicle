import { useEffect, useRef, useState } from 'react';

import { useT } from '../i18n/index.js';
import { authHeaders } from './panel/api.js';
import { Segmented } from './ui/Segmented.js';

type Host = 'cubicle' | 'claude-app';
interface MoveResult {
  directory: string;
  outcome: 'moved' | 'skipped';
  reason?: 'working' | 'no-session' | 'open-elsewhere' | 'failed';
}
interface HostState {
  host: Host;
  moving: boolean;
  results: MoveResult[];
}

const POLL_MS = 2000;

/**
 * Dónde viven las sesiones: terminales de Cubicle o la app de escritorio de Claude.
 * Cambiarlo mueve las sesiones (cierra en un lado y abre en el otro), así que pide confirmar.
 */
export function SessionHostPicker() {
  const { t } = useT();
  const [state, setState] = useState<HostState | null>(null);
  const [pending, setPending] = useState<Host | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const load = async () => {
    try {
      const r = await fetch('./api/session-host', { headers: authHeaders() });
      if (r.ok) setState((await r.json()) as HostState);
    } catch {
      /* se reintenta al abrir Ajustes */
    }
  };
  useEffect(() => {
    void load();
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, []);
  useEffect(() => {
    if (state?.moving && timer.current === null) timer.current = window.setInterval(() => void load(), POLL_MS);
    if (!state?.moving && timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, [state?.moving]);

  if (!state) return null;
  const apply = async (host: Host) => {
    setError(null);
    setPending(null);
    try {
      const r = await fetch('./api/session-host', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ host }) });
      const b = (await r.json()) as HostState & { error?: string };
      if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      setState(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const skipped = state.results.filter((r) => r.outcome === 'skipped' && r.reason !== 'no-session');
  return (
    <div className="flex flex-col gap-6 py-6 px-10">
      <div className="flex items-center justify-between gap-8">
        <span className="text-text-muted">{t('host.title')}</span>
        <Segmented
          value={pending ?? state.host}
          disabled={state.moving}
          options={[
            { id: 'cubicle', label: 'Cubicle' },
            { id: 'claude-app', label: t('host.app') },
          ]}
          onChange={(id) => setPending(id === state.host ? null : id)}
        />
      </div>
      {pending && (
        <div className="flex flex-col gap-6 pl-4">
          <span className="text-text-muted text-sm leading-relaxed">{t(pending === 'claude-app' ? 'host.toApp' : 'host.toCubicle')}</span>
          <span className="flex gap-10">
            <button type="button" className="text-accent text-sm hover:underline" onClick={() => void apply(pending)}>
              {t('host.confirm')}
            </button>
            <button type="button" className="text-text-muted text-sm hover:underline" onClick={() => setPending(null)}>
              {t('host.cancel')}
            </button>
          </span>
        </div>
      )}
      {state.moving && <span className="text-text-muted text-sm pl-4">{t('host.moving')}</span>}
      {!state.moving && !pending && skipped.length > 0 && (
        <span className="text-text-muted text-sm leading-relaxed pl-4">
          {t('host.skipped')} {skipped.map((r) => `${r.directory} (${t(`host.reason.${r.reason ?? 'failed'}`)})`).join(', ')}
        </span>
      )}
      {error && <span className="text-sm pl-4 text-status-permission">{error}</span>}
    </div>
  );
}
