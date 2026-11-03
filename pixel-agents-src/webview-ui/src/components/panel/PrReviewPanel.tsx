import { useCallback, useEffect, useState } from 'react';

import { locale, useT } from '../../i18n/index.js';
import { Button } from '../ui/Button.js';
import { authHeaders } from './api.js';

interface PullRequest {
  number: number;
  title: string;
  author: string;
  head: string;
  base: string;
  updatedAt: string;
  url: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  isDraft: boolean;
  reviewDecision: string;
  mergeable: string;
  mergeStateStatus: string;
}
interface RepoPrs {
  name: string;
  path: string;
  prs: PullRequest[];
  error?: string;
}

const POLL_MS = 60_000;

function ago(iso: string, lang: string): string {
  const ms = Date.now() - Date.parse(iso);
  const h = Math.round(ms / 3_600_000);
  if (h < 1) return lang === 'es' ? 'hace minutos' : 'minutes ago';
  if (h < 48) return lang === 'es' ? `hace ${h} h` : `${h} h ago`;
  return new Date(iso).toLocaleDateString(locale(), { day: '2-digit', month: 'short' });
}

/**
 * Pestaña PRs (si el agente tiene activada la revisión): PRs abiertos de sus
 * repos vía gh, con dos acciones que mandan un prompt a su terminal: informe
 * ejecutivo (gasta tokens de esa sesión) y resolver conflictos.
 */
export function PrReviewPanel({ agent }: { agent: string }) {
  const { t, lang } = useT();
  const [repos, setRepos] = useState<RepoPrs[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(
    async (fresh = false) => {
      try {
        const r = await fetch(`./api/agents/${encodeURIComponent(agent)}/prs${fresh ? '?fresh=1' : ''}`, { headers: authHeaders(), cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as { repos: RepoPrs[] };
        setRepos(d.repos);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [agent],
  );
  useEffect(() => {
    setRepos(null);
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const act = async (repo: string, n: number, action: 'informe' | 'conflictos') => {
    const key = `${repo}#${n}:${action}`;
    if (action === 'conflictos' && !window.confirm(t('prs.conflictsConfirm', { n }))) return;
    setBusy(key);
    setMsg(null);
    try {
      const r = await fetch(`./api/agents/${encodeURIComponent(agent)}/prs/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ repo, number: n }),
      });
      const b = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      setMsg(t(action === 'informe' ? 'prs.sentReport' : 'prs.sentConflicts', { n }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const total = repos?.reduce((a, r) => a + r.prs.length, 0) ?? 0;
  const decision = (d: string) => (d === 'APPROVED' ? t('prs.approved') : d === 'CHANGES_REQUESTED' ? t('prs.changes') : t('prs.pending'));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-12 py-10 flex flex-col gap-12">
      <div className="flex items-center gap-8">
        <span className="t-title">{t('prs.title', { n: total })}</span>
        <button className="ml-auto text-accent-bright hover:underline underline-offset-4 text-[12px]" onClick={() => void load(true)}>
          {t('prs.refresh')}
        </button>
      </div>
      <div className="t-desc">{t('prs.hint')}</div>
      {msg && <div className="text-text-muted text-[12px]">{msg}</div>}
      {error && <div className="text-status-error">{error}</div>}
      {!repos && !error && <div className="text-text-muted">{t('common.loadingLower')}</div>}
      {repos?.map((r) => (
        <div key={r.path} className="flex flex-col gap-6">
          <div className="t-sub flex items-center gap-8">
            {r.name} <span className="opacity-60">{r.prs.length}</span>
          </div>
          {r.error && <div className="text-status-error text-[12px]">{r.error}</div>}
          {!r.error && r.prs.length === 0 && <div className="text-text-muted text-[12px]">{t('prs.none')}</div>}
          {r.prs.map((p) => {
            const conflict = p.mergeable === 'CONFLICTING';
            return (
              <div key={p.number} className="border-2 border-border px-10 py-8 flex flex-col gap-6">
                <div className="flex items-baseline gap-8">
                  <a className="text-accent-bright hover:underline shrink-0" href={p.url} target="_blank" rel="noreferrer">
                    #{p.number}
                  </a>
                  <span className="text-text font-semibold truncate" title={p.title}>
                    {p.title}
                  </span>
                  {p.isDraft && <span className="text-[11px] uppercase text-text-muted border border-border px-4">draft</span>}
                </div>
                <div className="flex flex-wrap items-center gap-10 text-[12px] text-text-muted">
                  <span>{p.author}</span>
                  <span className="ide-code">
                    {p.head} → {p.base}
                  </span>
                  <span>
                    <span className="text-status-success">+{p.additions}</span> <span className="text-status-error">−{p.deletions}</span> · {p.changedFiles} {t('prs.files')}
                  </span>
                  <span>{ago(p.updatedAt, lang)}</span>
                  <span className={p.reviewDecision === 'APPROVED' ? 'text-status-success' : p.reviewDecision === 'CHANGES_REQUESTED' ? 'text-status-error' : ''}>{decision(p.reviewDecision)}</span>
                  {conflict && <span className="text-status-error font-semibold">{t('prs.conflict')}</span>}
                </div>
                <div className="flex items-center gap-8">
                  <Button variant="accent" size="sm" disabled={busy !== null} onClick={() => void act(r.name, p.number, 'informe')} title={t('prs.reportTip')}>
                    {busy === `${r.name}#${p.number}:informe` ? t('prs.sending') : t('prs.report')}
                  </Button>
                  {conflict && (
                    <Button variant="default" size="sm" disabled={busy !== null} onClick={() => void act(r.name, p.number, 'conflictos')} title={t('prs.conflictsTip')}>
                      {busy === `${r.name}#${p.number}:conflictos` ? t('prs.sending') : t('prs.resolve')}
                    </Button>
                  )}
                  <a className="ml-auto text-text-muted hover:text-text text-[12px]" href={p.url} target="_blank" rel="noreferrer">
                    GitHub ↗
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
