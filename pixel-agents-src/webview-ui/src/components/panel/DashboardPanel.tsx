import { ChevronDown, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { locale, useT } from '../../i18n/index.js';
import { prettyPath } from '../FolderPicker.js';
import { Button } from '../ui/Button.js';
import { IconButton } from '../ui/IconButton.js';
import type { AgentInfo, DashboardRef } from './api.js';
import { authHeaders, deleteDashboard, fetchInfo } from './api.js';
import { ReportDirsConfig } from './ReportDirsConfig.js';

/**
 * Dashboards del agente: sub-pestaña por archivo HTML detectado. La lista (y su
 * mtime) la refresca el panel padre; cuando cambia el mtime el iframe se recarga.
 */
export function DashboardPanel({ agent, info, onInfo, configurable = true }: { agent: string; info: AgentInfo; onInfo?: (i: AgentInfo) => void; configurable?: boolean }) {
  const { t } = useT();
  const dashboards: DashboardRef[] = info.dashboards;
  const [which, setWhich] = useState<string>(dashboards[0]?.url ?? '');
  const [bump, setBump] = useState(0);
  const [creating, setCreating] = useState(false);
  const [full, setFull] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [delMsg, setDelMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setConfirmDel(false);
    setDelMsg(null);
  }, [which]);

  useEffect(() => {
    if (!dashboards.some((d) => d.url === which)) setWhich(dashboards[0]?.url ?? '');
  }, [dashboards, which]);

  const current = dashboards.find((d) => d.url === which) ?? dashboards[0];
  // Reportes agrupados por proyecto, en el orden en que aparecen.
  const groups: Array<{ name: string; items: DashboardRef[] }> = [];
  for (const d of dashboards) {
    const name = d.project ?? d.label.split(' · ')[0];
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, items: [] }));
    g.items.push(d);
  }

  const remove = async () => {
    if (!current) return;
    setDeleting(true);
    setDelMsg(null);
    try {
      await deleteDashboard(current);
      setConfirmDel(false);
      const next = await fetchInfo(agent);
      onInfo?.(next);
      setWhich(next.dashboards[0]?.url ?? '');
    } catch (e) {
      setDelMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  if (!current || creating) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {configurable && <ReportDirsConfig agent={agent} info={info} onInfo={onInfo} defaultOpen={!current} />}
        <NewReportForm agent={agent} info={info} onDone={() => setCreating(false)} cancel={current ? () => setCreating(false) : undefined} />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {configurable && <ReportDirsConfig agent={agent} info={info} onInfo={onInfo} />}
      {dashboards.length > 1 && (
        // Un desplegable agrupado por proyecto (repo): se entiende a cuál pertenece cada reporte.
        <div className="px-8 pt-6 relative">
          <ChevronDown size={16} className="pointer-events-none absolute right-20 top-1/2 mt-3 -translate-y-1/2 text-text-muted" />
          <select className="w-full appearance-none rounded-md bg-bg-dark border border-border hover:border-accent focus:border-accent outline-none pl-10 pr-36 py-7 text-text text-[14px] cursor-pointer" value={current.url} onChange={(e) => setWhich(e.target.value)} title={t('reports.pick')}>
            {groups.map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.items.map((d) => (
                  <option key={d.url} value={d.url}>
                    {(d.sub ? `${d.sub} · ` : '') + d.file}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}
      <div className="flex items-center gap-8 px-10 py-4 text-text-muted text-[12px]">
        <span className="truncate" title={`${current.dir}/${current.file}`}>
          {current.project ? `${current.project} · ` : ''}{current.sub ? `${current.sub}/` : ''}{current.file} · {t('reports.updated')}{' '}
          {new Date(current.mtime).toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
        <button className="ml-auto text-accent-bright hover:underline underline-offset-4" onClick={() => setCreating(true)} title={t('reports.newTitle')}>
          {t('reports.new')}
        </button>
        <button className="text-accent-bright hover:underline underline-offset-4" onClick={() => setFull(true)} title={t('reports.fullscreenTitle')}>
          {t('reports.fullscreen')}
        </button>
        <span className="flex items-center gap-2 ml-4">
          <IconButton label={t('reports.openTab')} onClick={() => window.open(current.url, '_blank', 'noopener')}>
            <ExternalLink size={15} />
          </IconButton>
          <IconButton label={t('reports.reload')} onClick={() => setBump((v) => v + 1)}>
            <RefreshCw size={15} />
          </IconButton>
          <IconButton label={t('reports.delete')} active={confirmDel} className="hover:text-status-error" onClick={() => setConfirmDel((v) => !v)}>
            <Trash2 size={15} />
          </IconButton>
        </span>
      </div>
      {confirmDel && (
        <div className="flex items-center gap-8 px-10 py-6 border-y-2 border-border bg-bg-dark text-[12px]">
          <span className="truncate flex-1 text-text">
            {t('reports.confirmDelete', { file: current.file })}
          </span>
          <Button variant="default" size="sm" onClick={() => void remove()} disabled={deleting}>
            {deleting ? t('reports.deleting') : t('reports.yesDelete')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmDel(false)} disabled={deleting}>
            {t('common.no')}
          </Button>
        </div>
      )}
      {delMsg && <div className="px-10 py-4 text-status-error text-[12px]">{delMsg}</div>}
      <iframe
        key={`${current.url}-${current.mtime}-${bump}`}
        title={t('reports.iframe', { name: current.label })}
        src={`${current.url}?v=${Math.round(current.mtime)}-${bump}`}
        className="flex-1 min-h-0 w-full border-0 bg-bg"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
      {full && <ReportFullscreen dashboards={dashboards} current={current} onPick={setWhich} onClose={() => setFull(false)} />}
    </div>
  );
}

// ── Pantalla completa (presentar): tira arriba para cambiar de reporte, Esc cierra ──

function ReportFullscreen({ dashboards, current, onPick, onClose }: { dashboards: DashboardRef[]; current: DashboardRef; onPick: (url: string) => void; onClose: () => void }) {
  const { t } = useT();
  const [hideBar, setHideBar] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const i = dashboards.findIndex((d) => d.url === current.url);
        const n = dashboards[(i + (e.key === 'ArrowRight' ? 1 : dashboards.length - 1)) % dashboards.length];
        if (n) onPick(n.url);
      }
      if (e.key === 'h' || e.key === 'H') setHideBar((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    // Pantalla completa real del navegador si se permite; si no, igual ocupa toda la ventana.
    const el = document.documentElement;
    el.requestFullscreen?.().catch(() => {});
    return () => {
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, [dashboards, current, onPick, onClose]);

  return createPortal(
    <div className="ide-ui fixed inset-0 z-[200] bg-bg flex flex-col">
      {!hideBar && (
        <div className="flex items-center gap-6 px-10 py-6 border-b-2 border-border bg-bg-dark overflow-x-auto bar-scroll">
          {dashboards.map((d) => (
            <button
              key={d.url}
              className={`px-10 py-4 border-2 shrink-0 ${current.url === d.url ? 'border-accent bg-active-bg text-text' : 'border-border text-text-muted hover:text-text'}`}
              onClick={() => onPick(d.url)}
            >
              {d.label}
            </button>
          ))}
          <span className="ml-auto text-text-muted text-[12px] shrink-0">{t('reports.fsHint')}</span>
          <button className="shrink-0 px-8 py-4 border-2 border-border text-text-muted hover:text-text" onClick={onClose}>
            {t('reports.exit')}
          </button>
        </div>
      )}
      <iframe
        key={current.url}
        title={t('reports.iframe', { name: current.label })}
        src={`${current.url}?v=${Math.round(current.mtime)}`}
        className="flex-1 min-h-0 w-full border-0 bg-bg"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
    </div>,
    document.body,
  );
}

// ── Nuevo reporte: se le pide a la sesión (terminal) que lo cree ──────

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'reporte'
  );
}

function NewReportForm({ agent, info, onDone, cancel }: { agent: string; info: AgentInfo; onDone: () => void; cancel?: () => void }) {
  const { t } = useT();
  const [titulo, setTitulo] = useState('');
  const [que, setQue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const base = info.projects[0]?.path ?? info.path ?? '';
  const dir = `${base}/${info.settings.dashboardDirs[0] ?? 'docs/reports'}`.replace(/\/\.$/, '');
  const file = `${dir}/${slug(titulo || que)}.html`;

  const send = async () => {
    setBusy(true);
    setMsg(null);
    const text = t('reports.form.prompt', { file, title: titulo || t('reports.form.defaultTitle'), what: que.trim() });
    try {
      const r = await fetch(`./api/agents/${encodeURIComponent(agent)}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ text }),
      });
      const b = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      setMsg(t('reports.form.sent'));
      setQue('');
      setTitulo('');
      window.setTimeout(onDone, 2500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'w-full bg-bg-dark border-2 border-border px-8 py-6 text-text outline-none focus:border-accent';
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-14 py-12 flex flex-col gap-12">
      <div>
        <div className="t-title">{info.dashboards.length === 0 ? t('reports.form.titleEmpty') : t('reports.form.title')}</div>
        <div className="t-desc">{t('reports.form.desc')}</div>
      </div>
      <label className="flex flex-col gap-4">
        <span className="t-sub">{t('reports.form.label')}</span>
        <input className={inputCls} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={t('reports.form.placeholder')} maxLength={80} />
      </label>
      <label className="flex flex-col gap-4">
        <span className="t-sub">{t('reports.form.what')}</span>
        <textarea
          className={`${inputCls} min-h-[110px]`}
          value={que}
          onChange={(e) => setQue(e.target.value)}
          placeholder={t('reports.form.whatPlaceholder')}
          maxLength={800}
        />
      </label>
      <div className="text-text-muted text-[12px] truncate" title={file}>
        {t('reports.form.saveTo', { path: prettyPath(file) })}
      </div>
      {msg && <div className="text-text-muted">{msg}</div>}
      <div className="flex items-center gap-8">
        <Button variant="accent" size="sm" onClick={() => void send()} disabled={busy || !que.trim()}>
          {busy ? t('reports.form.sending') : t('reports.form.send')}
        </Button>
        {cancel && (
          <Button variant="ghost" size="sm" onClick={cancel}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}
