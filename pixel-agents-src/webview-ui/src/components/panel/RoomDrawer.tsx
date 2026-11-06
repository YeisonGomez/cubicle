import { Activity, Home, PanelLeftClose, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '../../i18n/index.js';
import { IconClaude } from '../icons.js';
import { IconButton } from '../ui/IconButton.js';
import { PokemonLevel } from './PokemonLevel.js';
import { ActivityPanel } from './ActivityPanel.js';
import { AgentSettingsForm } from './AgentSettingsForm.js';
import type { AgentInfo, PanelTarget } from './api.js';
import { fetchInfo } from './api.js';
import { CapabilitiesPanel } from './CapabilitiesPanel.js';
import { ChangesPanel } from './ChangesPanel.js';
import { DashboardPanel } from './DashboardPanel.js';
import { NotesPanel } from './NotesPanel.js';
import type { RoomTab } from './panelTabs.js';
import { HOME_TABS, homeTab, readPrefTab, resolveTab, writePrefTab } from './panelTabs.js';
import { PrReviewPanel } from './PrReviewPanel.js';
import { usePanelWidth } from './usePanelWidth.js';

export type { PanelTarget } from './api.js';

const INFO_POLL_MS = 5000;

interface RoomDrawerProps {
  /** El agente abierto cambió de nombre (Configuración → Renombrar). */
  onRenamed?: (name: string) => void;
  /** Empieza un renombre: el agente se cierra y relanza con el nombre nuevo. */
  onRenaming?: (from: string, to: string) => void;
  target: PanelTarget | null;
  color: string | null;
  onClose: () => void;
}

/** Info del agente (repos, dashboards): se refresca para detectar cambios sin recargar. */
function useAgentInfo(agentName: string | null): { info: AgentInfo | null; error: string | null; setInfo: (i: AgentInfo) => void } {
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setInfo(null);
    setError(null);
    if (!agentName) return;
    let alive = true;
    const load = async () => {
      try {
        const i = await fetchInfo(agentName);
        if (alive) {
          setInfo(i);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const t = window.setInterval(() => void load(), INFO_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [agentName]);
  return { info, error, setInfo };
}

/** Info de todos los agentes de una sala (tablero/TV): Cambios y Reportes agregados. */
function useRoomInfo(area: string | null) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  useEffect(() => {
    setAgents([]);
    if (!area) return;
    let alive = true;
    const load = () =>
      fetch(`./api/rooms/${encodeURIComponent(area)}/info`, { cache: 'no-store' })
        .then(async (r) => (r.ok ? ((await r.json()) as { agents: AgentInfo[] }) : null))
        .then((d) => alive && d && setAgents(d.agents))
        .catch(() => {
          /* servidor viejo */
        });
    void load();
    const t = window.setInterval(() => void load(), INFO_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [area]);
  return agents;
}

/** Pestaña mostrada + preferida (ver panelTabs.ts). */
function usePanelTab(target: PanelTarget | null, info: AgentInfo | null, isCode: boolean, hasDash: boolean, hasPrs: boolean) {
  const [tab, setTabState] = useState<RoomTab>(readPrefTab);
  const prefRef = useRef<RoomTab>(readPrefTab());
  const setTab = useCallback((t: RoomTab) => {
    prefRef.current = t;
    writePrefTab(t);
    setTabState(t);
  }, []);
  // Al cambiar de objetivo (o cuando llega su info) se aplica la preferida si
  // cabe; si no, la alternativa. Cubre también que una pestaña deje de existir.
  const targetId = target ? (target.kind === 'room' ? `room:${target.area}` : `agent:${target.name}`) : null;
  const targetKind = target?.kind;
  const wantedTab = target?.kind === 'room' ? target.tab : undefined;
  useEffect(() => {
    if (!targetId) return;
    if (targetKind === 'agent' && !info) return; // aún sin saber si tiene repos/dashboards
    if (wantedTab) {
      setTabState(wantedTab); // TV → Reportes de la sala
      return;
    }
    setTabState(resolveTab(prefRef.current, { agent: targetKind === 'agent', code: isCode, dash: hasDash, prs: hasPrs }));
  }, [targetId, targetKind, wantedTab, info, isCode, hasDash, hasPrs]);
  return { tab, setTab };
}

function BranchIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="4" cy="3" r="1.8" />
      <circle cx="4" cy="13" r="1.8" />
      <circle cx="12" cy="5" r="1.8" />
      <path d="M4 4.8v6.4M12 6.8c0 3-8 2-8 4.4" />
    </svg>
  );
}

/**
 * Panel izquierdo tipo IDE. Pestañas de inicio: Notas (tablero de la sala),
 * Cambios (git de sus repos, con la rama en la cabecera) y Dashboard (HTML de
 * sus carpetas de dashboards). Botones de cabecera: Inicio, Actividad,
 * Capacidades, Configuración (solo agente) y Cerrar. Ancho fijo ajustable.
 */
export function RoomDrawer({ target, color, onClose, onRenamed, onRenaming }: RoomDrawerProps) {
  const { t } = useT();
  const [fileOpen, setFileOpen] = useState(false);
  const { width, onResizeStart } = usePanelWidth(fileOpen);
  const agentName = target?.kind === 'agent' ? target.name : null;
  const area = target ? (target.kind === 'room' ? target.area : (target.area ?? 'General')) : null;
  const { info, error: infoError, setInfo } = useAgentInfo(agentName);
  const roomAgents = useRoomInfo(target?.kind === 'room' ? target.area : null);
  const roomCode = roomAgents.filter((a) => a.projects.length > 0);
  // Cambios aparece cuando el agente (o algún agente de la sala) tiene repos git.
  const isCode = agentName ? (info?.projects.length ?? 0) > 0 : roomCode.length > 0;
  const hasDash = (info?.dashboards.length ?? 0) > 0;
  const hasPrs = !!agentName && info?.settings.prReview === true;
  const { tab, setTab } = usePanelTab(target, info, isCode, hasDash, hasPrs);

  if (!target || !area) return null;

  const ctx = { agent: !!agentName, code: isCode, dash: hasDash, prs: hasPrs };
  const home = homeTab(ctx);
  const toggle = (t: RoomTab) => setTab(tab === t ? home : t);
  const tabs: Array<{ id: RoomTab; label: string }> = [{ id: 'notas', label: t('panel.tab.notes') }];
  if (isCode) tabs.push({ id: 'cambios', label: t('panel.tab.changes') });
  tabs.push({ id: 'dashboard', label: t('panel.tab.reports') });
  if (hasPrs) tabs.push({ id: 'prs', label: t('panel.tab.prs') });

  const subtitle =
    target.kind === 'agent'
      ? info
        ? info.projects.length > 0
          ? info.projects.map((p) => (p.branch ? `${p.name} (${p.branch})` : p.name)).join(' · ')
          : (info.path ?? '')
        : (infoError ?? t('common.loadingLower'))
      : t('panel.roomBoard');
  const subtitleNode =
    target.kind === 'agent' && info && info.projects.length > 0 ? (
      <span className="flex items-center gap-8 min-w-0 overflow-hidden">
        {info.projects.map((p) => (
          <span key={p.path} className="inline-flex items-center gap-4 shrink-0">
            <span>{p.name}</span>
            {p.branch && (
              <span className="inline-flex items-center gap-3 text-accent-bright font-semibold" title={t('panel.branch', { b: p.branch })}>
                <BranchIcon />
                {p.branch}
              </span>
            )}
          </span>
        ))}
      </span>
    ) : null;

  const agentUrl = (what: string) => `./api/agents/${encodeURIComponent(agentName ?? '')}/${what}`;
  const roomUrl = (what: string) => `./api/rooms/${encodeURIComponent(area)}/${what}`;

  return (
    <div className="ide-ui relative h-full shrink-0 flex flex-col bg-bg border-r-2 border-border text-text" style={{ width }}>
      {/* Borde derecho arrastrable para cambiar el ancho */}
      <div className="absolute top-0 right-0 h-full w-6 -mr-3 cursor-col-resize z-20 hover:bg-accent/40" onMouseDown={onResizeStart} title={t('panel.resize')} />

      <div className="flex items-center gap-8 px-12 py-8 border-b-2" style={{ borderBottomColor: color ?? 'var(--color-border)' }}>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-8 min-w-0">
            <span className="font-semibold text-[17px] truncate" style={{ color: color ?? undefined }}>
              {target.kind === 'agent' ? target.name : target.area}
            </span>
            {target.kind === 'agent' && target.area && <span className="text-text-muted text-[12px] truncate">{target.area}</span>}
          </div>
          <div className="text-text-muted text-[12px] truncate" title={subtitle}>
            {subtitleNode ?? subtitle}
          </div>
        </div>
        {agentName && <PokemonLevel name={agentName} />}
        <IconButton label={t('panel.home')} active={HOME_TABS.includes(tab)} onClick={() => setTab(home)}>
          <Home size={16} />
        </IconButton>
        <IconButton label={agentName ? t('panel.activityAgent') : t('panel.activityRoom')} active={tab === 'actividad'} onClick={() => toggle('actividad')}>
          <Activity size={16} />
        </IconButton>
        <IconButton label={agentName ? t('panel.capsAgent') : t('panel.capsRoom')} active={tab === 'capacidades'} onClick={() => toggle('capacidades')}>
          <IconClaude />
        </IconButton>
        {agentName && (
          <IconButton label={t('panel.settings')} active={tab === 'ajustes'} onClick={() => toggle('ajustes')}>
            <SlidersHorizontal size={16} />
          </IconButton>
        )}
        <IconButton label={t('panel.close')} onClick={onClose}>
          <PanelLeftClose size={16} />
        </IconButton>
      </div>

      {HOME_TABS.includes(tab) && (
        <div className="flex border-b-2 border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`px-14 py-6 border-b-2 -mb-[2px] ${tab === t.id ? 'border-accent text-text' : 'border-transparent text-text-muted hover:text-text'}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'notas' && <NotesPanel area={area} />}
      {tab === 'cambios' && agentName && <ChangesPanel agent={agentName} onOpenFile={setFileOpen} />}
      {tab === 'cambios' && !agentName && (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          {roomCode.map((a) => (
            <div key={a.name} className="flex flex-col">
              <div className="t-sub px-10 pt-8 pb-2 text-text">{a.name}</div>
              <ChangesPanel agent={a.name} onOpenFile={setFileOpen} />
            </div>
          ))}
        </div>
      )}
      {tab === 'dashboard' && info && agentName && <DashboardPanel agent={agentName} info={info} onInfo={setInfo} />}
      {tab === 'prs' && agentName && hasPrs && <PrReviewPanel agent={agentName} />}
      {tab === 'dashboard' && !agentName && roomAgents.length > 0 && (
        <DashboardPanel
          agent={roomAgents[0].name}
          info={{ ...roomAgents[0], dashboards: roomAgents.flatMap((a) => a.dashboards.map((d) => ({ ...d, label: roomAgents.length > 1 ? `${a.name} · ${d.label}` : d.label }))) }}
          onInfo={() => undefined}
          configurable={false}
        />
      )}
      {tab === 'dashboard' && !agentName && roomAgents.length === 0 && <div className="px-12 py-8 text-text-muted">{t('common.loadingLower')}</div>}
      {tab === 'actividad' &&
        (agentName ? <ActivityPanel url={agentUrl('stats')} title={agentName} /> : <ActivityPanel url={roomUrl('stats')} title={t('panel.roomTitle', { area })} />)}
      {tab === 'capacidades' &&
        (agentName ? (
          <CapabilitiesPanel url={agentUrl('capabilities')} title={agentName} many={false} />
        ) : (
          <CapabilitiesPanel url={roomUrl('capabilities')} title={t('panel.roomTitle', { area })} many />
        ))}
      {tab === 'ajustes' && agentName && info && <AgentSettingsForm name={agentName} info={info} onSaved={setInfo} onRenamed={onRenamed} onRenaming={onRenaming} />}
    </div>
  );
}
