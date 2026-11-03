import { useState } from 'react';

import { useT } from '../i18n/index.js';
import { apiHeaders, FolderPicker, prettyPath } from './FolderPicker.js';
import type { FsEntry } from './FolderPicker.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

/** Temas de sala (muebles y suelo); los ids coinciden con gen_layout.py. */
const TEMAS: Array<{ id: string; key: string }> = [
  { id: '', key: 'newOffice.theme.auto' },
  { id: 'code', key: 'newOffice.theme.code' },
  { id: 'personal', key: 'newOffice.theme.personal' },
  { id: 'finanzas', key: 'newOffice.theme.finanzas' },
  { id: 'gym', key: 'newOffice.theme.gym' },
  { id: 'cafe', key: 'newOffice.theme.cafe' },
  { id: 'cursos', key: 'newOffice.theme.cursos' },
  { id: 'fintech', key: 'newOffice.theme.fintech' },
  { id: 'inmobiliaria', key: 'newOffice.theme.inmobiliaria' },
  { id: 'hardware', key: 'newOffice.theme.hardware' },
];

/** "+ Oficina": elige/crea la carpeta y se crea la sala (oficina) + su agente en un paso. */
export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [chosen, setChosen] = useState<{ path: string | null; entry: FsEntry | null }>({ path: null, entry: null });
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [tema, setTema] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenName = chosen.path ? (chosen.path.split('/').filter(Boolean).pop() ?? '') : '';
  const effectiveName = nameTouched ? name : chosenName;
  const alreadyRegistered = chosen.entry?.registered ?? false;

  const create = async () => {
    if (!chosen.path || !effectiveName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('./api/projects', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ name: effectiveName.trim(), path: chosen.path, ...(tema ? { tema } : {}) }),
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
    <Modal isOpen title={t('newOffice.title')} onClose={onClose} className="w-[720px] max-w-[95vw]">
      <div className="ide-ui flex flex-col gap-10">
        <FolderPicker onChange={(path, entry) => setChosen({ path, entry })} height={330} />
        <div className="text-text-muted truncate" title={chosen.path ?? ''}>
          {t('newOffice.folder')} <span className="text-text">{prettyPath(chosen.path)}</span>
        </div>
        <div className="flex items-center gap-10">
          <label className="flex items-center gap-6 flex-1 min-w-0">
            <span className="text-text-muted shrink-0">{t('newOffice.name')}</span>
            <input
              className="flex-1 min-w-0 bg-bg-dark border-2 border-border px-8 py-4 text-text outline-none focus:border-accent"
              value={effectiveName}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
            />
          </label>
          <label className="flex items-center gap-6">
            <span className="text-text-muted">{t('newOffice.theme')}</span>
            <select className="bg-bg-dark border-2 border-border px-6 py-4 text-text" value={tema} onChange={(e) => setTema(e.target.value)}>
              {TEMAS.map((x) => (
                <option key={x.id} value={x.id}>
                  {t(x.key)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <div className="text-status-error">{error}</div>}
        {alreadyRegistered && <div className="text-status-permission">{t('newOffice.exists')}</div>}
        <div className="flex items-center justify-end gap-8">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="accent"
            onClick={() => void create()}
            disabled={!chosen.path || !effectiveName.trim() || busy || alreadyRegistered}
            title={t('newOffice.createTitle')}
          >
            {busy ? t('newOffice.creating') : t('newOffice.create')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
