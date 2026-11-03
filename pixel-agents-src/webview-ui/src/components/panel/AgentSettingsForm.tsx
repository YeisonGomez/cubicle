import { useState } from 'react';

import { useT } from '../../i18n/index.js';
import { FolderPicker, prettyPath } from '../FolderPicker.js';
import { Button } from '../ui/Button.js';
import type { AgentInfo, AgentSettings } from './api.js';
import { authHeaders, putSettings } from './api.js';

/*
 * Lenguaje visual del formulario (una sola cosa por elemento):
 *  - Sección: título en mayúsculas pequeñas, separada por una línea.
 *  - Campo de texto: fondo oscuro con borde.
 *  - Acción secundaria: texto en color de acento, sin borde ("+ Agregar…", "Quitar").
 *  - Acción principal: botón relleno (Guardar / Renombrar).
 *  - Dato de solo lectura: texto normal; etiqueta "detectado" en gris.
 */
const inputCls = 'w-full bg-bg-dark border-2 border-border px-8 py-5 text-text outline-none focus:border-accent';
const linkCls = 'text-accent-bright hover:underline underline-offset-4 text-[12px] disabled:opacity-40 disabled:no-underline';

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t-2 border-border pt-10 first:border-t-0 first:pt-0 flex flex-col gap-8">
      <div>
        <div className="t-title">{title}</div>
        {hint && <div className="t-desc">{hint}</div>}
      </div>
      {children}
    </section>
  );
}

/** Configuración de un agente: nombre, repositorios (Cambios) y carpetas de reportes. */
export function AgentSettingsForm({ name, info, onSaved, onRenamed, onRenaming }: { name: string; info: AgentInfo; onSaved: (i: AgentInfo) => void; onRenamed?: (name: string) => void; onRenaming?: (from: string, to: string) => void }) {
  const { t } = useT();
  const [projects, setProjects] = useState<string[]>(info.settings.projects);
  const [dashDirs, setDashDirs] = useState<string[]>(info.settings.dashboardDirs);
  const [prReview, setPrReview] = useState<boolean>(info.settings.prReview === true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const kind: AgentSettings['kind'] = info.projects.length > 0 ? 'code' : 'personal';
      onSaved(await putSettings(name, { kind, projects, dashboardDirs: dashDirs, prReview }));
      setMsg(t('common.saved'));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-14 py-12 flex flex-col gap-14">
      <RenameField name={name} onRenamed={onRenamed} onRenaming={onRenaming} />
      <ReposField info={info} projects={projects} setProjects={setProjects} />
      <ReportDirsField info={info} dashDirs={dashDirs} setDashDirs={setDashDirs} />
      <Section title={t('settings.pr.title')} hint={t('settings.pr.hint')}>
        <label className="flex items-center gap-8 cursor-pointer">
          <input type="checkbox" checked={prReview} onChange={(e) => setPrReview(e.target.checked)} />
          <span>{t('settings.pr.enable')}</span>
        </label>
        {info.projects.length === 0 && <div className="t-desc">{t('settings.pr.noRepos')}</div>}
      </Section>
      <div className="border-t-2 border-border pt-10 flex items-center gap-10">
        <Button variant="accent" size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
        {msg && <span className="text-text-muted text-[12px]">{msg}</span>}
      </div>
    </div>
  );
}

// ── Nombre ────────────────────────────────────────────────────

function RenameField({ name, onRenamed, onRenaming }: { name: string; onRenamed?: (name: string) => void; onRenaming?: (from: string, to: string) => void }) {
  const { t } = useT();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const to = value.trim();
  const rename = async () => {
    if (!window.confirm(t('settings.name.confirm', { from: name, to }))) return;
    setBusy(true);
    setErr(null);
    onRenaming?.(name, to); // el agente se cierra y relanza: que el panel no salte a otro
    try {
      const r = await fetch(`./api/agents/${encodeURIComponent(name)}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name: to }),
      });
      const b = (await r.json()) as { error?: string; name?: string };
      if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      onRenamed?.(b.name ?? to);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t('settings.name.title')} hint={t('settings.name.hint')}>
      <div className="flex items-center gap-8">
        <input className={inputCls} value={value} maxLength={40} onChange={(e) => setValue(e.target.value)} />
        <Button variant="default" size="sm" disabled={busy || !to || to === name} onClick={() => void rename()}>
          {busy ? t('settings.name.renaming') : t('settings.name.rename')}
        </Button>
      </div>
      {err && <div className="text-status-error text-[12px]">{err}</div>}
    </Section>
  );
}

// ── Repositorios ──────────────────────────────────────────────

function ReposField({ info, projects, setProjects }: { info: AgentInfo; projects: string[]; setProjects: (f: (l: string[]) => string[]) => void }) {
  const { t } = useT();
  const [picking, setPicking] = useState<string | null>(null);
  const custom = projects.length > 0;
  const rows = custom
    ? projects.map((p) => ({ name: p.split('/').filter(Boolean).pop() ?? p, path: p }))
    : info.projects.map((p) => ({ name: p.name, path: p.path }));
  return (
    <Section title={t('settings.repos.title')} hint={t('settings.repos.hint')}>
      {rows.length === 0 && <div className="text-text-muted text-[12px]">{t('settings.repos.none', { path: prettyPath(info.path) })}</div>}
      {rows.length > 0 && (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={r.path} className="flex items-center gap-8 h-[26px]">
              <span className="text-text shrink-0">{r.name}</span>
              <span className="text-text-muted text-[12px] truncate" title={r.path}>
                {prettyPath(r.path)}
              </span>
              {custom ? (
                <button className={`ml-auto ${linkCls}`} onClick={() => setProjects((l) => l.filter((x) => x !== r.path))}>
                  {t('common.remove')}
                </button>
              ) : (
                <span className="ml-auto t-label">{t('settings.repos.detected')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-14">
        <button className={linkCls} onClick={() => setPicking(picking === null ? (info.path ?? '') : null)}>
          {picking === null ? t('settings.repos.add') : t('settings.repos.closePicker')}
        </button>
        {custom && (
          <button className={linkCls} onClick={() => setProjects(() => [])} title={t('settings.repos.useDetectedTitle')}>
            {t('settings.repos.useDetected')}
          </button>
        )}
      </div>
      {picking !== null && (
        <div className="flex flex-col gap-6">
          <FolderPicker initialPath={picking || undefined} onChange={(p) => setPicking(p ?? '')} allowCreate={false} height={220} />
          <div className="flex items-center gap-8">
            <span className="text-text-muted text-[12px] truncate flex-1">{prettyPath(picking || null)}</span>
            <Button
              variant="default"
              size="sm"
              disabled={!picking}
              onClick={() => {
                if (picking && !projects.includes(picking)) setProjects((l) => [...(l.length > 0 ? l : info.projects.map((p) => p.path)), picking]);
                setPicking(null);
              }}
            >
              {t('common.add')}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

// ── Carpetas de reportes ──────────────────────────────────────

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-border pl-10 flex flex-col gap-4">
      <div className="t-sub">{title}</div>
      {children}
    </div>
  );
}

function ReportDirsField({ info, dashDirs, setDashDirs }: { info: AgentInfo; dashDirs: string[]; setDashDirs: (f: (l: string[]) => string[]) => void }) {
  const { t } = useT();
  const [draft, setDraft] = useState('');
  const add = (d: string) => setDashDirs((l) => (l.includes(d) ? l : [...l, d]));
  const suggestions = info.dashboardSuggestions.filter((x) => !dashDirs.includes(x.dir));
  return (
    <Section title={t('settings.reports.title')} hint={t('settings.reports.hint')}>
      <Sub title={t('settings.reports.active')}>
        {dashDirs.length === 0 && <div className="text-text-muted text-[12px]">{t('settings.reports.none')}</div>}
        <ul className="flex flex-col">
          {dashDirs.map((d) => (
            <li key={d} className="flex items-center gap-8 h-[26px]">
              <span className="ide-code text-text">{d}</span>
              <button className={`ml-auto ${linkCls}`} onClick={() => setDashDirs((l) => l.filter((x) => x !== d))}>
                {t('common.remove')}
              </button>
            </li>
          ))}
        </ul>
      </Sub>
      {suggestions.length > 0 && (
        <Sub title={t('settings.reports.detected')}>
          <ul className="flex flex-col">
            {suggestions.map((x) => (
              <li key={x.dir} className="flex items-center gap-8 h-[26px]">
                <span className="ide-code text-text-muted">{x.dir}</span>
                <span className="text-text-muted text-[11px] truncate">
                  {t('settings.reports.htmlIn', { n: x.html, bases: x.bases.join(', ') })}
                </span>
                <button className={`ml-auto ${linkCls}`} onClick={() => add(x.dir)}>
                  {t('common.add')}
                </button>
              </li>
            ))}
          </ul>
        </Sub>
      )}
      <Sub title={t('settings.reports.other')}>
        <div className="flex items-center gap-8">
          <input
            className={`${inputCls} ide-code py-3`}
            value={draft}
            placeholder={t('settings.reports.placeholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                add(draft.trim());
                setDraft('');
              }
            }}
            spellCheck={false}
          />
          <Button
            variant="default"
            size="sm"
            disabled={!draft.trim()}
            onClick={() => {
              add(draft.trim());
              setDraft('');
            }}
          >
            {t('common.add')}
          </Button>
        </div>
      </Sub>
    </Section>
  );
}
