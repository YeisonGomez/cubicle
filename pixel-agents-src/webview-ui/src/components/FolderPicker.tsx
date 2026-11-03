import { useCallback, useEffect, useState } from 'react';

import { serverToken } from '../transport/serverToken.js';
import { t, useT } from '../i18n/index.js';
import { Button } from './ui/Button.js';

export interface FsEntry {
  name: string;
  path: string;
  isRepo: boolean;
  registered: boolean;
}
export interface FsListing {
  path: string;
  parent: string | null;
  display: string;
  dirs: FsEntry[];
  shortcuts: Array<{ label: string; path: string }>;
  isRepo: boolean;
  registered: boolean;
}

export const apiHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(serverToken ? { Authorization: `Bearer ${serverToken}` } : {}),
});

async function listDir(p?: string): Promise<FsListing> {
  const res = await fetch(`./api/fs${p ? `?path=${encodeURIComponent(p)}` : ''}`, { cache: 'no-store', headers: apiHeaders() });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error: string }).error);
  return (await res.json()) as FsListing;
}

export function prettyPath(p: string | null | undefined): string {
  if (!p) return '—';
  return p.replace(/^.*\/com~apple~CloudDocs/, 'iCloud').replace(/^\/Users\/[^/]+/, '~');
}

interface FolderPickerProps {
  /** Carpeta inicial (se puede subir con ↑ hasta el home). */
  initialPath?: string;
  /** Carpeta elegida: la seleccionada en la lista, o la actual si no hay selección. */
  onChange: (path: string | null, entry: FsEntry | null) => void;
  /** Permite crear carpetas desde el propio selector. */
  allowCreate?: boolean;
  height?: number;
}

/**
 * Selector de carpetas tipo Finder: favoritos a la izquierda, lista de
 * subcarpetas (clic = seleccionar, doble clic o › = entrar), ↑ para subir y
 * "Carpeta nueva". Solo navega dentro del home del usuario (lo impone el servidor).
 */
export function FolderPicker({ initialPath, onChange, allowCreate = true, height = 300 }: FolderPickerProps) {
  useT();
  const [listing, setListing] = useState<FsListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = useCallback(async (p?: string) => {
    setError(null);
    try {
      const l = await listDir(p);
      setListing(l);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void go(initialPath);
  }, [go, initialPath]);

  useEffect(() => {
    const entry = selected ? (listing?.dirs.find((d) => d.path === selected) ?? null) : null;
    onChange(selected ?? listing?.path ?? null, entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, listing]);

  const createFolder = async () => {
    if (!listing || !newFolder?.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('./api/fs/mkdir', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ path: listing.path, name: newFolder.trim() }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
      const { path } = (await res.json()) as { path: string };
      setNewFolder(null);
      await go(listing.path);
      setSelected(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ide-ui flex flex-col gap-8" style={{ height }}>
      <div className="flex items-center gap-8">
        <Button variant="default" size="sm" onClick={() => listing?.parent && void go(listing.parent)} disabled={!listing?.parent} title={t('fs.up')}>
          ↑
        </Button>
        <span className="truncate text-text flex-1" title={listing?.path}>
          {listing?.display ?? t('common.loadingLower')}
        </span>
        {allowCreate && (
          <Button variant="default" size="sm" onClick={() => setNewFolder('')} disabled={!listing || newFolder !== null}>
            {t('fs.newFolder')}
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-0 flex gap-10">
        <div className="w-[140px] shrink-0 flex flex-col gap-2 border-r-2 border-border pr-8 overflow-y-auto">
          <div className="t-sub mb-2">{t('fs.favorites')}</div>
          {listing?.shortcuts.map((s) => (
            <button
              key={s.path}
              className={`text-left px-6 py-3 hover:bg-btn-hover ${listing.path === s.path ? 'bg-active-bg' : ''}`}
              onClick={() => void go(s.path)}
            >
              {t(`fs.shortcut.${s.label}`) === `fs.shortcut.${s.label}` ? s.label : t(`fs.shortcut.${s.label}`)}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-0 overflow-y-auto border-2 border-border bg-bg-dark">
          {listing?.dirs.length === 0 && newFolder === null && (
            <div className="px-10 py-8 text-text-muted">{t('fs.noSub')}</div>
          )}
          {listing?.dirs.map((d) => (
            <div
              key={d.path}
              className={`flex items-center gap-8 px-10 h-[26px] cursor-default select-none ${
                selected === d.path ? 'bg-active-bg text-text' : 'hover:bg-btn-hover'
              }`}
              onClick={() => setSelected(d.path)}
              onDoubleClick={() => void go(d.path)}
              title={d.path}
            >
              <span className="text-status-permission">▮</span>
              <span className="truncate flex-1">{d.name}</span>
              {d.isRepo && <span className="text-[11px] text-accent-bright">git</span>}
              {d.registered && <span className="text-[11px] text-status-success">{t('fs.registered')}</span>}
              <button
                className="text-text-muted hover:text-text px-4"
                onClick={(e) => {
                  e.stopPropagation();
                  void go(d.path);
                }}
                title={t('fs.enter')}
              >
                ›
              </button>
            </div>
          ))}
          {newFolder !== null && (
            <div className="flex items-center gap-6 px-10 py-4 bg-active-bg">
              <input
                autoFocus
                className="flex-1 bg-bg border-2 border-accent px-6 py-2 text-text outline-none"
                placeholder={t('fs.newPlaceholder')}
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createFolder();
                  if (e.key === 'Escape') setNewFolder(null);
                }}
              />
              <Button variant="accent" size="sm" onClick={() => void createFolder()} disabled={busy}>
                {t('common.create')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setNewFolder(null)}>
                ✕
              </Button>
            </div>
          )}
        </div>
      </div>
      {error && <div className="text-status-error">{error}</div>}
    </div>
  );
}
