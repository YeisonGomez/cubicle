import { useCallback, useMemo, useRef, useState } from 'react';

import type { PanelTarget } from '../components/panel/api.js';
import type { OfficeState } from '../office/engine/officeState.js';

/**
 * Panel izquierdo (IDE): una sala (clic en su tablero) o un agente (clic en su
 * personaje o en su tarjeta). Siempre abre; se cierra con el botón del panel.
 * `areaMappings` decide a qué sala pertenece un agente (su primera área).
 */
export function useRoomPanel(getOfficeState: () => OfficeState, areaMappings: Record<string, string[]>, layoutTick: unknown) {
  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const areaMappingsRef = useRef(areaMappings);
  areaMappingsRef.current = areaMappings;

  const openAgentPanel = useCallback((agentId: number) => {
    const os = getOfficeState();
    const ownerId = os.terminalOwnerOf(agentId);
    const name = os.characters.get(ownerId)?.directoryName ?? os.characters.get(agentId)?.directoryName;
    if (!name) return;
    const area = areaMappingsRef.current[name]?.[0] ?? null;
    setPanel((cur) => (cur?.kind === 'agent' && cur.name === name ? cur : { kind: 'agent', name, area }));
  }, [getOfficeState]);
  const handleBoardClick = useCallback((area: string) => {
    setPanel((cur) => (cur?.kind === 'room' && cur.area === area && !cur.tab ? null : { kind: 'room', area }));
  }, []);
  /** TV de la sala: abre (o cambia a) los Reportes de esa sala. */
  const handleTvClick = useCallback((area: string) => {
    setPanel({ kind: 'room', area, tab: 'dashboard' });
  }, []);
  const close = useCallback(() => setPanel(null), []);
  const rename = useCallback((name: string) => setPanel((cur) => (cur?.kind === 'agent' ? { ...cur, name } : cur)), []);

  // Color de la sala del objetivo (borde de la cabecera del panel).
  const panelColor = useMemo(() => {
    const area = panel?.area ?? null;
    return area ? (getOfficeState().getLayout().areas?.find((a) => a.label === area)?.color ?? null) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, layoutTick, getOfficeState]);

  return { panel, panelColor, openAgentPanel, handleBoardClick, handleTvClick, close, rename };
}
