import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useT } from '../i18n/index.js';
import { loadSkinCatalog, type SkinCatalog, updateSkin, useSkin } from '../skin.js';
import { cn } from './ui/cn.js';
import { Modal } from './ui/Modal.js';

/**
 * Mapa de personajes (temas Pokémon y Yu-Gi-Oh): arriba, los agentes por sala con el
 * personaje que tienen; abajo, todos los del tema por grupo y cadena de evolución.
 * Se elige un agente y luego el personaje que se le quiere dar (`PUT /api/skin {assign}`).
 */
export function SkinRoster({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t, lang } = useT();
  const skin = useSkin();
  const [catalog, setCatalog] = useState<SkinCatalog | null>(null);
  const [agent, setAgent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    loadSkinCatalog()
      .then(setCatalog)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [isOpen, skin.theme]);

  // Agentes agrupados por sala, en el orden de las salas de la oficina.
  const rooms = useMemo(() => {
    const out: Array<{ room: string; agents: string[] }> = Object.keys(skin.rooms).map((room) => ({ room, agents: [] }));
    for (const [name, a] of Object.entries(skin.agents)) {
      let group = out.find((g) => g.room === (a.room ?? ''));
      if (!group) {
        group = { room: a.room ?? '', agents: [] };
        out.push(group);
      }
      group.agents.push(name);
    }
    return out.filter((g) => g.agents.length > 0);
  }, [skin]);

  // Quién tiene cada personaje (por su forma actual).
  const owners = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const [name, a] of Object.entries(skin.agents)) m.set(a.id, [...(m.get(a.id) ?? []), name]);
    return m;
  }, [skin]);

  const selected = agent ? skin.agents[agent] : undefined;
  const assign = async (id: number) => {
    if (!agent || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateSkin({ assign: { [agent]: id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const groupName = (g: { es: string; en: string }) => (lang === 'es' ? g.es : g.en);
  const sprite = (src: string, name: string, size: number) => (
    <img src={src} alt={name} width={size} height={size} loading="lazy" className="shrink-0 object-contain" style={{ imageRendering: 'pixelated', width: size, height: size }} />
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('roster.title')} zIndex={60} className="w-[min(980px,100%)]">
      <div className="ide-ui flex flex-col gap-14 px-10 pb-10">
        <div className="flex flex-col gap-8">
          <span className="t-title">{t('roster.yours')}</span>
          <span className="t-desc">{t('roster.yoursHelp')}</span>
          {rooms.map(({ room, agents }) => (
            <div key={room} className="flex flex-col gap-4">
              <span className="t-sub" style={{ color: catalog?.groups.find((g) => g.id === skin.rooms[room])?.color }}>
                {room || t('roster.noRoom')}
                {skin.rooms[room] && catalog && ` · ${groupName(catalog.groups.find((g) => g.id === skin.rooms[room]) ?? { es: '', en: '' })}`}
              </span>
              <div className="flex flex-wrap gap-6">
                {agents.map((name) => {
                  const a = skin.agents[name];
                  return (
                    <button
                      key={name}
                      onClick={() => setAgent(name === agent ? null : name)}
                      className={cn('flex items-center gap-8 rounded-md px-8 py-6 text-left bg-bg-dark hover:bg-btn-hover', name === agent && 'outline outline-2 outline-accent-bright bg-btn-hover')}
                    >
                      {sprite(a.sprite, a.name, 48)}
                      <span className="flex flex-col">
                        <span className="text-[14px] text-text">{name}</span>
                        <span className="t-desc">{a.name}</span>
                        <span className="t-label">{t('roster.level', { level: a.level })}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-8">
          <span className="t-title">{agent ? t('roster.pickFor', { name: agent }) : t('roster.pickFirst')}</span>
          <span className="t-desc">{t('roster.pickHelp')}</span>
          {error && <span className="t-desc text-status-permission">{error}</span>}
          {catalog?.groups.map((g) => (
            <div key={g.id} className="flex flex-col gap-4">
              <span className="t-sub" style={{ color: g.color }}>
                {groupName(g)}
              </span>
              <div className="flex flex-wrap gap-x-14 gap-y-6">
                {g.chains.map((chain) => (
                  <div key={chain.map((f) => f.id).join('-')} className="flex items-center gap-2">
                    {chain.map((f, i) => {
                      const mine = selected?.id === f.id;
                      const taken = (owners.get(f.id) ?? []).filter((n) => n !== agent);
                      return (
                        <span key={f.id} className="flex items-center gap-2">
                          {i > 0 && <ChevronRight size={14} className="text-text-muted shrink-0" />}
                          <button
                            disabled={!agent || busy}
                            onClick={() => void assign(f.id)}
                            title={taken.length > 0 ? t('roster.takenBy', { name: f.name, agents: taken.join(', ') }) : f.name}
                            className={cn(
                              'relative flex flex-col items-center gap-2 rounded-md px-4 py-4 w-[84px] hover:bg-btn-hover disabled:hover:bg-transparent disabled:cursor-default',
                              mine && 'outline outline-2 outline-accent-bright bg-btn-hover',
                            )}
                          >
                            {sprite(f.sprite, f.name, 56)}
                            <span className="t-label text-center leading-tight line-clamp-2">{f.name}</span>
                            {taken.length > 0 && <span className="absolute top-2 right-2 size-[7px] rounded-full bg-status-permission" />}
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {catalog && catalog.groups.length === 0 && <span className="t-desc">{t('roster.classic')}</span>}
        </div>
      </div>
    </Modal>
  );
}
