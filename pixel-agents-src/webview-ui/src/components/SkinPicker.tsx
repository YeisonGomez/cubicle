import { useEffect, useState } from 'react';

import { useT } from '../i18n/index.js';
import { loadSkin, updateSkin, useSkin } from '../skin.js';
import { SkinRoster } from './SkinRoster.js';
import { Segmented } from './ui/Segmented.js';

/**
 * Elección del skin de los personajes: Clásico, Pokémon o Yu-Gi-Oh. Con los dos últimos, cada sala
 * es un tipo o atributo (se puede cambiar) y "Volver a sortear" reparte Pokémon nuevos.
 * `compact` (primer arranque): solo los dos botones.
 */
export function SkinPicker({ compact = false }: { compact?: boolean }) {
  const { t, lang } = useT();
  const skin = useSkin();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [roster, setRoster] = useState(false);
  useEffect(() => {
    void loadSkin();
  }, []);
  const run = async (body: Parameters<typeof updateSkin>[0]) => {
    setBusy(true);
    setMsg(null);
    try {
      await updateSkin(body);
      setMsg(t('skin.applied'));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const typeName = (id: string) => skin.types.find((x) => x.id === id)?.[lang === 'es' ? 'es' : 'en'] ?? id;
  const buttons = (
    <Segmented
      value={skin.theme}
      disabled={busy}
      options={[
        { id: 'classic', label: t('skin.classic') },
        { id: 'pokemon', label: t('skin.pokemon') },
        { id: 'yugioh', label: t('skin.yugioh') },
      ]}
      onChange={(id) => void run({ theme: id })}
    />
  );
  if (compact) {
    return (
      <span className="inline-flex items-center gap-6" title={t('skin.help')}>
        <span className="text-text-muted">{t('skin.title')}</span>
        {buttons}
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-8 py-6 px-10">
      <div className="flex items-center justify-between gap-8">
        <span className="text-text-muted">{t('skin.title')}</span>
        {buttons}
      </div>
      {skin.theme !== 'classic' && (
        <div className="flex flex-col gap-6 pl-4">
          <span className="text-text-muted text-sm leading-relaxed">{t(skin.theme === 'yugioh' ? 'skin.helpYugioh' : 'skin.help')}</span>
          {Object.entries(skin.rooms).map(([label, type]) => (
            <label key={label} className="flex items-center justify-between gap-12 py-2">
              <span className="truncate">{label}</span>
              <select className="bg-bg-dark px-10 py-6 text-text text-base min-w-[220px] rounded-md hover:bg-btn-hover outline-none cursor-pointer" value={type} disabled={busy} onChange={(e) => void run({ rooms: { [label]: e.target.value } })}>
                {skin.types.map((x) => (
                  <option key={x.id} value={x.id}>
                    {typeName(x.id)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div className="flex items-center gap-10 mt-2">
            <button className="text-accent-bright hover:underline underline-offset-4 disabled:opacity-40" disabled={busy} onClick={() => void run({ reshuffle: 'all' })}>
              {t(skin.theme === 'yugioh' ? 'skin.reshuffleYugioh' : 'skin.reshuffle')}
            </button>
            <button className="text-accent-bright hover:underline underline-offset-4" onClick={() => setRoster(true)}>
              {t('roster.open')}
            </button>
            {msg && <span className="text-text-muted text-sm">{msg}</span>}
          </div>
        </div>
      )}
      <SkinRoster isOpen={roster} onClose={() => setRoster(false)} />
      {skin.theme === 'classic' && msg && <span className="text-text-muted text-sm">{msg}</span>}
    </div>
  );
}
