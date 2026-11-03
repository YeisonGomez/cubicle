import { FolderGit2, Loader2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { locale, useT } from '../i18n/index.js';
import { prettyPath } from './FolderPicker.js';
import { authHeaders } from './panel/api.js';
import type { AgentInfo } from './panel/api.js';
import { cn } from './ui/cn.js';
import { IconButton } from './ui/IconButton.js';

interface SubProject {
  name: string;
  path: string;
  isRepo: boolean;
  branch: string | null;
  lastCommitAt: number | null;
  lastCommit: string | null;
  hasClaudeMd: boolean;
  kind: string | null;
  agents: string[];
}
interface Project {
  label: string;
  color: string | null;
  base: string | null;
  root: { isRepo: boolean; branch: string | null; hasClaudeMd: boolean; kind: string | null } | null;
  agents: Array<{ name: string; path: string; live: boolean; info: AgentInfo | null }>;
  subprojects: SubProject[];
  saved: { descripcion?: string; subproyectos?: Record<string, string>; roles?: Record<string, string>; actualizado?: number } | null;
}
interface Caps {
  recursos: Array<{ nombre: string; tipo: string }>;
  mcp: Array<{ name: string }>;
  skills: Array<{ nombre: string }>;
}
interface Stats {
  prompts: number;
  last7: number;
  streak: number;
  sessions: number;
  lastAt: number | null;
}

const POLL_MS = 15_000;

function ago(ms: number | null, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (!ms) return '—';
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  if (d <= 0) return t('project.today');
  if (d < 30) return t('project.daysAgo', { n: d });
  return new Date(ms).toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Bloque de sección: título en mayúsculas con línea, cuenta opcional y contenido separado. */
function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-8">
      <div className="flex items-center gap-8">
        <span className="t-sub">{title}</span>
        {count !== undefined && <span className="t-label text-text-muted">{count}</span>}
        <span className="flex-1 h-px bg-border opacity-60" />
      </div>
      {children}
    </section>
  );
}

function Chip({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return <span className={cn('t-label px-5 py-1 bg-btn-bg', accent ? 'text-accent-bright' : 'text-text-muted')}>{children}</span>;
}

/**
 * Ficha de una oficina (sala/proyecto), a la derecha: qué es (una línea escrita
 * una sola vez por su propia sesión), sus agentes con rol y estado, todas las
 * subcarpetas con repo/rama/último commit, y cifras de actividad y capacidades.
 */
export function ProjectInfoDrawer({ room, statusOf, onOpenAgent, onClose, overlay }: { room: string; statusOf: (name: string) => string | null; onOpenAgent: (name: string) => void; onClose: () => void; overlay: boolean }) {
  const { t } = useT();
  const [p, setP] = useState<Project | null>(null);
  const [caps, setCaps] = useState<Caps | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const askedRef = useState<Set<string>>(() => new Set())[0];
  // Momento en que se pidió la ficha: mientras lo guardado no sea posterior, se muestra la espera.
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const waiting = askedAt !== null && !((p?.saved?.actualizado ?? 0) > askedAt);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`./api/rooms/${encodeURIComponent(room)}/project`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setP((await r.json()) as Project);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [room]);
  useEffect(() => {
    setP(null);
    setCaps(null);
    setStats(null);
    void load();
    fetch(`./api/rooms/${encodeURIComponent(room)}/capabilities`, { cache: 'no-store' }).then(async (r) => r.ok && setCaps((await r.json()) as Caps)).catch(() => undefined);
    fetch(`./api/rooms/${encodeURIComponent(room)}/stats`, { cache: 'no-store' }).then(async (r) => r.ok && setStats((await r.json()) as Stats)).catch(() => undefined);
    const id = window.setInterval(() => void load(), waiting ? 4_000 : POLL_MS);
    return () => window.clearInterval(id);
  }, [room, load, waiting]);

  const ask = useCallback(async () => {
    setAsking(true);
    setMsg(null);
    try {
      const r = await fetch(`./api/rooms/${encodeURIComponent(room)}/project/ask`, { method: 'POST', headers: authHeaders() });
      const b = (await r.json()) as { error?: string; agent?: string };
      if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      setMsg(t('project.asked', { agent: b.agent ?? '' }));
      setAskedAt(Date.now());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  }, [room, t]);

  // Primera vez: si no hay ficha guardada y hay una sesión viva, se pide sola (una vez por sala).
  useEffect(() => {
    if (!p || p.saved || askedRef.has(room) || !p.agents.some((a) => a.live)) return;
    askedRef.add(room);
    void ask();
  }, [p, room, ask, askedRef]);

  const color = p?.color ?? 'var(--color-accent)';
  const anyLive = p?.agents.some((a) => a.live) ?? false;
  const repos = p?.subprojects.filter((s) => s.isRepo).length ?? 0;
  const cls = overlay ? 'absolute inset-0 z-[60]' : 'relative h-full shrink-0 w-[560px]';
  return (
    <div className={`${cls} ide-ui flex flex-col bg-bg border-l-2 border-border text-text`}>
      {/* Cabecera: franja del color de la sala, nombre, carpeta y rama */}
      <div className="flex items-stretch border-b-2 border-border">
        <div className="w-6 shrink-0" style={{ background: color }} />
        <div className="min-w-0 flex-1 px-12 py-10">
          <div className="t-title truncate" style={{ color }}>
            {room}
          </div>
          <div className="t-desc truncate flex items-center gap-6" title={p?.base ?? ''}>
            <span className="truncate">{p?.base ? prettyPath(p.base) : t('project.noFolder')}</span>
            {p?.root?.branch && (
              <span className="flex items-center gap-3 text-accent-bright shrink-0">
                <FolderGit2 size={11} />
                {p.root.branch}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-start p-6">
          <IconButton label={t('project.closeTip')} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-14 py-14 flex flex-col gap-22">
        {error && <div className="text-status-error">{error}</div>}
        {!p && !error && <div className="text-text-muted">{t('common.loadingLower')}</div>}
        {p && (
          <>
            {/* Qué es */}
            <div className="bg-bg-dark px-14 py-12 border-l-4" style={{ borderLeftColor: color }}>
              <div className={cn('text-[15px] leading-relaxed', p.saved?.descripcion ? 'text-text' : 'text-text-muted')}>{p.saved?.descripcion || t('project.noDesc')}</div>
              <div className="flex items-center gap-12 mt-8 t-desc">
                {waiting ? (
                  <span className="flex items-center gap-6 text-accent-bright">
                    <Loader2 size={14} className="animate-spin" />
                    {t('project.waiting')}
                  </span>
                ) : (
                  <>
                    {p.saved?.actualizado ? <span>{t('project.savedAt', { d: new Date(p.saved.actualizado).toLocaleDateString(locale(), { day: '2-digit', month: 'short' }) })}</span> : null}
                    <button className="text-accent-bright hover:underline underline-offset-4 disabled:opacity-40 disabled:no-underline" onClick={() => void ask()} disabled={asking || !anyLive} title={anyLive ? t('project.askTip') : t('project.needsLive')}>
                      {asking ? t('project.asking') : p.saved ? t('project.refresh') : t('project.ask')}
                    </button>
                    {!anyLive && !p.saved && <span>{t('project.needsLive')}</span>}
                    {msg && !p.saved && anyLive && <span>{msg}</span>}
                  </>
                )}
              </div>
            </div>

            {/* Cifras */}
            <div className="grid grid-cols-4 gap-8">
              {[
                { v: p.agents.length, l: t('project.agents') },
                { v: repos, l: t('project.repos') },
                { v: stats?.last7 ?? '—', l: t('project.prompts7') },
                { v: caps ? caps.recursos.length : '—', l: t('project.resources') },
              ].map((x) => (
                <div key={x.l} className="bg-bg-dark px-10 py-8">
                  <div className="text-[20px] font-semibold leading-none">{x.v}</div>
                  <div className="t-desc mt-4">{x.l}</div>
                </div>
              ))}
            </div>

            {/* Agentes y roles */}
            <Section title={t('project.agentsTitle')} count={p.agents.length}>
              <div className="flex flex-col gap-6">
                {p.agents.map((a) => {
                  const st = statusOf(a.name);
                  return (
                    <button
                      key={a.name}
                      className={cn('flex flex-col gap-3 text-left px-12 py-8 bg-bg-dark border-l-4 hover:bg-btn-hover transition-colors', a.live ? 'border-status-success' : 'border-border')}
                      onClick={() => onOpenAgent(a.name)}
                      title={prettyPath(a.path)}
                    >
                      <span className="flex items-center gap-8">
                        <span className="font-semibold text-[14px] text-text">{a.name}</span>
                        <Chip accent={a.live}>{a.live ? (st ?? t('project.live')) : t('project.offline')}</Chip>
                        {a.info?.settings.kind && <Chip>{a.info.settings.kind}</Chip>}
                      </span>
                      <span className="t-desc leading-relaxed">{p.saved?.roles?.[a.name] ?? (a.info?.projects.length ? a.info.projects.map((r) => r.name).join(' · ') : t('project.noRole'))}</span>
                    </button>
                  );
                })}
              </div>
            </Section>

            {/* Subproyectos */}
            {p.subprojects.length > 0 && (
              <Section title={t('project.subprojects')} count={p.subprojects.length}>
                <div className="flex flex-col gap-6">
                  {p.subprojects.map((s) => (
                    <div key={s.path} className="px-12 py-8 bg-bg-dark flex flex-col gap-3" title={prettyPath(s.path)}>
                      <div className="flex items-center gap-8 min-w-0">
                        <span className="font-semibold text-[14px] text-text truncate">{s.name}</span>
                        {s.isRepo && <Chip accent>repo</Chip>}
                        {s.kind && <Chip>{s.kind}</Chip>}
                        {s.hasClaudeMd && <Chip>CLAUDE.md</Chip>}
                        {s.agents.length > 0 && <Chip accent>{s.agents.join(', ')}</Chip>}
                      </div>
                      <div className="t-desc leading-relaxed">{p.saved?.subproyectos?.[s.name] ?? t('project.noInfo')}</div>
                      {s.isRepo && (
                        <div className="t-label text-text-muted flex items-center gap-8">
                          {s.branch && (
                            <span className="flex items-center gap-3 text-accent-bright">
                              <FolderGit2 size={11} />
                              {s.branch}
                            </span>
                          )}
                          <span>{ago(s.lastCommitAt, t)}</span>
                          {s.lastCommit && <span className="truncate">· {s.lastCommit}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Capacidades y actividad */}
            <div className="grid grid-cols-2 gap-12">
              <Section title={t('project.capsTitle')}>
                <div className="bg-bg-dark px-12 py-10 t-desc flex flex-col gap-4 leading-relaxed">
                  {caps ? (
                    <>
                      <span className="text-text">{t('project.capsLine', { r: caps.recursos.length, m: caps.mcp.length, s: caps.skills.length })}</span>
                      {caps.recursos.length > 0 && <span>{caps.recursos.slice(0, 6).map((r) => r.nombre).join(' · ')}</span>}
                    </>
                  ) : (
                    '—'
                  )}
                </div>
              </Section>
              <Section title={t('project.activityTitle')}>
                <div className="bg-bg-dark px-12 py-10 t-desc flex flex-col gap-4 leading-relaxed">
                  {stats ? (
                    <>
                      <span className="text-text">{t('project.activityLine', { n: stats.prompts, s: stats.sessions, k: stats.streak })}</span>
                      <span>{t('project.lastPrompt', { d: ago(stats.lastAt, t) })}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </div>
              </Section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
