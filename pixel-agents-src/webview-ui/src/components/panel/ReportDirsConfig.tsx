import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { useState } from 'react';

import { useT } from '../../i18n/index.js';
import { IconButton } from '../ui/IconButton.js';
import type { AgentInfo } from './api.js';
import { putSettings } from './api.js';

/**
 * Carpetas que revisa la pestaña Reportes (relativas a cada repositorio y a la
 * carpeta del agente). Una línea con las rutas actuales; al abrirla se quitan,
 * se añaden las detectadas o una a mano. Cada cambio se guarda al momento.
 */
export function ReportDirsConfig({ agent, info, onInfo, defaultOpen = false }: { agent: string; info: AgentInfo; onInfo?: (i: AgentInfo) => void; defaultOpen?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirs = info.settings.dashboardDirs;
  const suggestions = info.dashboardSuggestions.filter((x) => !dirs.includes(x.dir));

  const save = async (next: string[]) => {
    setBusy(true);
    setErr(null);
    try {
      const kind = info.settings.kind ?? (info.projects.length > 0 ? 'code' : 'personal');
      onInfo?.(await putSettings(agent, { ...info.settings, kind, dashboardDirs: next }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const add = (d: string) => {
    const v = d.trim().replace(/\/+$/, '') || '.';
    if (!dirs.includes(v)) void save([...dirs, v]);
  };

  return (
    <div className="px-10 pt-6">
      <button className="w-full flex items-center gap-6 text-left text-[12px] text-text-muted hover:text-text" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="shrink-0">{t('reports.dirs.label')}</span>
        <span className="ide-code truncate text-text">{dirs.length > 0 ? dirs.join(', ') : t('settings.reports.none')}</span>
      </button>
      {open && (
        <div className="mt-6 mb-4 rounded-md bg-bg-dark px-10 py-8 flex flex-col gap-8">
          <div className="t-desc">{t('settings.reports.hint')}</div>
          <ul className="flex flex-col">
            {dirs.map((d) => (
              <li key={d} className="flex items-center gap-8 h-[26px]">
                <span className="ide-code text-text flex-1 truncate">{d}</span>
                <IconButton label={t('common.remove')} disabled={busy} onClick={() => void save(dirs.filter((x) => x !== d))}>
                  <X size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
          {suggestions.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="t-sub">{t('settings.reports.detected')}</div>
              {suggestions.map((x) => (
                <div key={x.dir} className="flex items-center gap-8 h-[26px]">
                  <span className="ide-code text-text-muted">{x.dir}</span>
                  <span className="text-text-muted text-[11px] truncate flex-1">{t('settings.reports.htmlIn', { n: x.html, bases: x.bases.join(', ') })}</span>
                  <IconButton label={t('common.add')} disabled={busy} onClick={() => add(x.dir)}>
                    <Plus size={14} />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-6">
            <input
              className="flex-1 min-w-0 rounded-md bg-bg px-8 py-4 text-text ide-code outline-none focus:ring-1 focus:ring-accent"
              value={draft}
              placeholder={t('settings.reports.placeholder')}
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) {
                  add(draft);
                  setDraft('');
                }
              }}
            />
            <IconButton
              label={t('common.add')}
              disabled={busy || !draft.trim()}
              onClick={() => {
                add(draft);
                setDraft('');
              }}
            >
              <Plus size={14} />
            </IconButton>
          </div>
          {err && <div className="text-status-error text-[12px]">{err}</div>}
        </div>
      )}
    </div>
  );
}
