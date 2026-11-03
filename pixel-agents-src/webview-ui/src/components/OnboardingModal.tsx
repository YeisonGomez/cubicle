import { useEffect, useState } from 'react';

import { LANGS, locale, setLang, t, useT } from '../i18n/index.js';
import { apiHeaders, prettyPath } from './FolderPicker.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';
import { SkinPicker } from './SkinPicker.js';

/** Casilla propia (la nativa se ve anticuada): cuadro con marca, color de acento al activarse. */
function Check({ on, disabled, onChange, title }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!on)}
      className={`inline-flex items-center justify-center size-16 border-2 shrink-0 ${on ? 'bg-accent border-accent text-bg' : 'bg-bg-dark border-border text-transparent hover:border-accent'} disabled:opacity-40`}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M2 5.2 4.2 7.4 8 2.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** Texto editable en línea: se ve como texto; al pasar el mouse o enfocar aparece la línea inferior. */
function InlineEdit({ value, onChange, disabled, bold, width = 200, placeholder }: { value: string; onChange: (v: string) => void; disabled?: boolean; bold?: boolean; width?: number; placeholder?: string }) {
  return (
    <input
      className={`bg-transparent border-0 border-b-2 border-transparent hover:border-border focus:border-accent outline-none px-2 py-1 text-text ${bold ? 'font-semibold' : ''} disabled:opacity-60`}
      style={{ width }}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      title={t('onboarding.clickEdit')}
    />
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={open ? 'rotate-90' : ''}>
      <path d="M3 1.5 7 5l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface RecentSession {
  path: string;
  name: string;
  isGit: boolean;
  promptsRecent: number;
  prompts: number;
  sessions: number;
  lastAt: number | null;
  firstPrompt: string | null;
  registered: boolean;
}
interface Row extends RecentSession {
  checked: boolean;
  label: string;
  room: string;
}

function fmtDate(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toLocaleDateString(locale(), { day: '2-digit', month: 'short' });
}

/**
 * Primera vez (o "Importar sesiones" desde Settings): lista las carpetas con
 * sesiones de Claude trabajadas en la última semana; el usuario marca cuáles
 * entran, les pone nombre y sala, y se crea la oficina con ellas.
 */
export function OnboardingModal({ firstRun, onClose }: { firstRun: boolean; onClose: () => void }) {
  const { tn, lang } = useT();
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    fetch(`./api/onboarding?days=${days}`, { headers: apiHeaders(), cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as { items: RecentSession[] };
        if (!alive) return;
        // Oficina sugerida: una carpeta con sesión que CONTIENE otras carpetas con
        // sesión es una oficina (p. ej. empresa/ con empresa/api y empresa/web):
        // ella y sus hijas son sus agentes. Sin padre detectado → oficina propia.
        const paths = d.items.map((i) => i.path);
        const officeOf = (p: string) => {
          const anc = paths.filter((q) => q !== p && p.startsWith(q + '/')).sort((x, y) => y.length - x.length)[0];
          return anc ? d.items.find((i) => i.path === anc)?.name ?? anc.split('/').pop() ?? p : null;
        };
        setRows(
          d.items.map((i) => ({ ...i, checked: !i.registered, label: i.name, room: officeOf(i.path) ?? i.name })),
        );
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [days]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  // Grupos por oficina (sala), en el orden en que aparecen las filas.
  const groups = (() => {
    const m = new Map<string, Row[]>();
    for (const r of rows ?? []) {
      const k = r.room.trim() || r.label.trim() || r.name;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].map(([key, rs]) => ({ key, rows: rs }));
  })();
  const update = (p: string, patch: Partial<Row>) => setRows((rs) => (rs ? rs.map((r) => (r.path === p ? { ...r, ...patch } : r)) : rs));
  const selected = (rows ?? []).filter((r) => r.checked && !r.registered && r.label.trim());

  const apply = async (skip: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('./api/onboarding', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ items: skip ? [] : selected.map((r) => ({ name: r.label.trim(), path: r.path, room: r.room.trim() || r.label.trim() })) }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };


  return (
    <Modal isOpen title={firstRun ? t('onboarding.welcome') : t('onboarding.importTitle')} onClose={() => void (firstRun ? apply(true) : onClose())} className="w-[860px] max-w-[95vw]">
      <div className="ide-ui flex flex-col gap-10">
        <div className="flex items-center gap-10">
          <span className="t-desc">{firstRun ? t('onboarding.helpFirst') : t('onboarding.helpImport')}</span>
          {firstRun && <SkinPicker compact />}
          <span className="ml-auto inline-flex items-center gap-4" title="Idioma / Language">
            {LANGS.map((l) => (
              <button
                key={l.id}
                className={`px-6 py-2 border-2 text-[12px] ${lang === l.id ? 'border-accent text-text' : 'border-border text-text-muted hover:text-text'}`}
                onClick={() => setLang(l.id)}
              >
                {l.label}
              </button>
            ))}
          </span>
          <label className="inline-flex items-center gap-6 t-desc">
            {t('onboarding.last')}
            <select className="bg-bg-dark border-2 border-border px-4 py-2 text-text" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[7, 14, 30, 90].map((d) => (
                <option key={d} value={d}>
                  {t('onboarding.days', { n: d })}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Agrupado por oficina (sala), como el árbol de Cambios: cabecera de la
            oficina con su nombre editable y, debajo, sus agentes. */}
        <div className="max-h-[440px] overflow-y-auto border-2 border-border">
          {!rows && !error && <div className="px-10 py-8 text-text-muted">{t('onboarding.searching')}</div>}
          {rows && rows.length === 0 && <div className="px-10 py-8 text-text-muted">{t('onboarding.none')}</div>}
          {groups.map((g) => {
            const editable = g.rows.filter((r) => !r.registered);
            const sel = editable.filter((r) => r.checked).length;
            const open = !collapsed.has(g.key);
            return (
              <div key={g.key} className="border-b-2 border-border last:border-b-0">
                <div className="flex items-center gap-8 px-10 h-[36px] bg-bg-dark">
                  <Check on={sel > 0 && sel === editable.length} disabled={editable.length === 0} onChange={(v) => editable.forEach((r) => update(r.path, { checked: v }))} title={t('onboarding.allOffice')} />
                  <button className="text-text-muted hover:text-text" onClick={() => toggle(g.key)} title={open ? t('onboarding.collapse') : t('onboarding.expand')}>
                    <Chevron open={open} />
                  </button>
                  <span className="t-sub">{t('onboarding.office')}</span>
                  <InlineEdit value={g.key} bold width={240} onChange={(v) => g.rows.forEach((r) => update(r.path, { room: v }))} placeholder={t('onboarding.officeName')} />
                  <span className="t-label ml-auto">
                    {tn('common.agents', g.rows.length)}
                  </span>
                </div>
                {open &&
                  g.rows.map((r) => (
                    <div key={r.path} className={`flex items-center gap-8 pl-40 pr-10 h-[44px] border-t border-border ${r.registered ? 'opacity-50' : ''}`}>
                      <Check on={r.checked && !r.registered} disabled={r.registered} onChange={(v) => update(r.path, { checked: v })} />
                      <div className="flex-1 min-w-0 flex flex-col">
                        <div className="flex items-center gap-8 min-w-0">
                          <InlineEdit value={r.label} disabled={r.registered} width={220} onChange={(v) => update(r.path, { label: v })} placeholder={t('onboarding.agentName')} />
                          <span className="text-text-muted text-[12px] truncate" title={r.path}>
                            {prettyPath(r.path)}
                            {r.isGit ? t('onboarding.repo') : ''}
                          </span>
                        </div>
                        <div className="t-label flex gap-10 min-w-0 pl-2">
                          <span className="text-text shrink-0">{t('onboarding.prompts', { n: r.promptsRecent })}</span>
                          <span className="shrink-0">{t('onboarding.lastAt', { d: fmtDate(r.lastAt) })}</span>
                          {r.registered && <span className="text-status-permission shrink-0">{t('onboarding.registered')}</span>}
                          {r.firstPrompt && (
                            <span className="truncate opacity-70" title={r.firstPrompt}>
                              {r.firstPrompt}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            );
          })}
        </div>

        {error && <div className="text-status-error">{error}</div>}
        <div className="flex items-center gap-8">
          <span className="t-label">{t('onboarding.foot')}</span>
          <div className="ml-auto flex gap-8">
            <Button variant="ghost" onClick={() => void (firstRun ? apply(true) : onClose())} disabled={busy}>
              {firstRun ? t('onboarding.startEmpty') : t('common.cancel')}
            </Button>
            <Button variant="accent" onClick={() => void apply(false)} disabled={busy || selected.length === 0}>
              {busy ? t('onboarding.creating') : t('onboarding.create', { o: groups.filter((g) => g.rows.some((r) => r.checked && !r.registered)).length, a: selected.length })}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
