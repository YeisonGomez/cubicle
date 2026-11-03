import { useEffect, useState } from 'react';

import { useT } from '../i18n/index.js';
import { apiHeaders, FolderPicker, prettyPath } from './FolderPicker.js';
import type { FsEntry } from './FolderPicker.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

interface Room {
  label: string;
  color: string;
  base: string;
  dirs: Array<{ name: string; path: string }>;
}

/**
 * "+ Agent": 1) elige la oficina (sala); 2) navega desde la carpeta base de esa
 * sala hasta la carpeta del nuevo agente (o crea una nueva); 3) abre una sesión
 * nueva de Claude ahí, registrada en esa sala.
 */
export function NewAgentModal({ onClose }: { onClose: () => void }) {
  const { t, tn } = useT();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [chosen, setChosen] = useState<{ path: string | null; entry: FsEntry | null }>({ path: null, entry: null });
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('./api/rooms', { cache: 'no-store', headers: apiHeaders() })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setRooms((await r.json()) as Room[]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const chosenName = chosen.path ? (chosen.path.split('/').filter(Boolean).pop() ?? '') : '';
  const effectiveName = nameTouched ? name : newFolder !== null ? newFolder : chosenName;
  const registeredHere = chosen.entry?.registered ?? false;

  const launch = async () => {
    if (!room || !chosen.path || !effectiveName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('./api/agents/launch', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          room: room.label,
          path: chosen.path,
          name: effectiveName.trim(),
          ...(newFolder !== null && newFolder.trim() ? { newFolder: newFolder.trim() } : {}),
        }),
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
    <Modal isOpen title={room ? t('newAgent.titleRoom', { room: room.label }) : t('newAgent.titleWhich')} onClose={onClose} className="w-[720px] max-w-[95vw]">
      <div className="ide-ui flex flex-col gap-10">
        {!room && (
          <div className="grid grid-cols-3 gap-8">
            {rooms === null && !error && <div className="text-text-muted">{t('common.loadingLower')}</div>}
            {rooms?.map((r) => (
              <button
                key={r.label}
                className="text-left border-2 px-10 py-8 hover:bg-btn-hover"
                style={{ borderColor: r.color }}
                onClick={() => setRoom(r)}
              >
                <div className="font-semibold" style={{ color: r.color }}>
                  {r.label}
                </div>
                <div className="text-text-muted text-[12px] truncate" title={r.base}>
                  {prettyPath(r.base)}
                </div>
                <div className="text-text-muted text-[12px]">
                  {tn('common.agents', r.dirs.length)}
                </div>
              </button>
            ))}
          </div>
        )}

        {room && (
          <>
            <div className="flex items-center gap-8">
              <Button variant="ghost" size="sm" onClick={() => { setRoom(null); setChosen({ path: null, entry: null }); setNewFolder(null); }}>
                {t('newAgent.backRooms')}
              </Button>
              <span className="text-text-muted">
                {t('newAgent.chooseFolder')}{' '}
                <span className="text-text">{prettyPath(room.base)}</span>
              </span>
            </div>
            <FolderPicker initialPath={room.base} onChange={(path, entry) => setChosen({ path, entry })} allowCreate={false} height={300} />

            <div className="flex flex-col gap-6 border-2 border-border p-10">
              <div className="flex items-center gap-10">
                <label className="flex items-center gap-6 cursor-pointer">
                  <input type="radio" checked={newFolder === null} onChange={() => setNewFolder(null)} />
                  {t('newAgent.openIn')} <span className="text-text">{prettyPath(chosen.path)}</span>
                </label>
              </div>
              <div className="flex items-center gap-10">
                <label className="flex items-center gap-6 cursor-pointer shrink-0">
                  <input type="radio" checked={newFolder !== null} onChange={() => setNewFolder('')} />
                  {t('newAgent.createFolder')}
                </label>
                {newFolder !== null && (
                  <input
                    autoFocus
                    className="flex-1 min-w-0 bg-bg-dark border-2 border-accent px-8 py-4 text-text outline-none"
                    placeholder={t('newAgent.folderPlaceholder')}
                    value={newFolder}
                    onChange={(e) => setNewFolder(e.target.value)}
                  />
                )}
              </div>
              <label className="flex items-center gap-6">
                <span className="text-text-muted shrink-0">{t('newAgent.agentName')}</span>
                <input
                  className="flex-1 min-w-0 bg-bg-dark border-2 border-border px-8 py-4 text-text outline-none focus:border-accent"
                  value={effectiveName}
                  onChange={(e) => {
                    setNameTouched(true);
                    setName(e.target.value);
                  }}
                />
              </label>
            </div>
            {registeredHere && newFolder === null && (
              <div className="text-status-permission">{t('newAgent.registeredHere')}</div>
            )}
            {error && <div className="text-status-error">{error}</div>}
            <div className="flex items-center justify-end gap-8">
              <Button variant="ghost" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="accent"
                onClick={() => void launch()}
                disabled={!chosen.path || !effectiveName.trim() || busy || (newFolder !== null && !newFolder.trim())}
              >
                {busy ? t('newAgent.opening') : t('newAgent.open')}
              </Button>
            </div>
          </>
        )}
        {!room && error && <div className="text-status-error">{error}</div>}
      </div>
    </Modal>
  );
}
