import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useT } from '../i18n/index.js';
import type { StatusKey } from './statusLabels.js';
import { statusText } from './statusLabels.js';

import type { CardVariant } from './cardBar.js';
import { CharacterMugShot } from './CharacterMugShot.js';
import { IconPin } from './icons.js';
import { Button } from './ui/Button.js';
import { ConfirmModal } from './ui/ConfirmModal.js';

/** How a given agent's character looks, for the tab mug shot. */
export interface AgentAppearance {
  palette: number;
  hueShift: number;
}

/** Agent activity reflected by the tab's status dot. */
export type AgentActivity = 'idle' | 'working' | 'attention';

/** Activity plus the drawer-owned "connection broken" state. */
export type TabStatus = AgentActivity | 'disconnected';

const STATUS_DOT: Record<TabStatus, string> = {
  idle: 'bg-status-success', // verde — turno terminado
  working: 'bg-accent-bright animate-pulse', // azul pulsante — ejecutando
  attention: 'bg-status-permission animate-bounce', // amarillo saltando — te necesita
  disconnected: 'bg-status-error', // rojo — se cayó el socket de la terminal
};

const STATUS_KEY: Record<TabStatus, StatusKey> = {
  idle: 'idle',
  working: 'working',
  attention: 'permission',
  disconnected: 'disconnected',
};

const STATUS_TEXT: Record<TabStatus, string> = {
  idle: 'text-text-muted',
  working: 'text-accent-bright',
  attention: 'text-status-permission',
  disconnected: 'text-status-error',
};

const CARD_VARIANT: Record<CardVariant, string> = {
  default: 'bg-btn-bg border-transparent hover:bg-btn-hover',
  focused: 'bg-active-bg border-transparent',
  active: 'bg-active-bg border-accent',
};

interface AgentCardProps {
  agentId: number;
  variant: CardVariant;
  appearance: AgentAppearance;
  status: TabStatus | null;
  /** Nombre corto bajo la figura (directorio de la sesión). */
  name?: string;
  /** Mostrar el botón × visible (solo móvil). En escritorio el cierre va por
   *  clic derecho → "Cerrar agente", para que un clic perdido no mate una sesión. */
  showClose?: boolean;
  onSelect: (agentId: number) => void;
  onClose: (agentId: number) => void;
  /** Sofá: true si el agente está descansando. Con onRest/onWake el menú ofrece
   *  "Mandar a descansar" / "Despertar". */
  resting?: boolean;
  onRest?: (agentId: number) => void;
  onWake?: (agentId: number) => void;
  /** Ficha compacta en fila (barra superior): figura pequeña + nombre + estado. */
  compact?: boolean;
  /** Chincheta: fijada al frente de la barra; onPin la alterna. */
  pinned?: boolean;
  onPin?: (agentId: number) => void;
  /** Color de su sala (solo en la sección de fijados, para saber de dónde es). */
  roomColor?: string | null;
}

/** One agent's card in the terminal sidebar — mug shot, name and an animated
 *  status under it. The cards double as the terminal panel's tabs: clicking
 *  one selects that agent's pane; right-click opens the close menu. */
export function AgentCard({
  agentId,
  variant,
  appearance,
  status,
  name,
  showClose = false,
  onSelect,
  onClose,
  resting = false,
  onRest,
  onWake,
  compact = false,
  pinned = false,
  onPin,
  roomColor = null,
}: AgentCardProps) {
  const { t } = useT();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  // El menú no se sale de la pantalla: tras pintarse se mide y se reubica.
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4));
    const y = Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4));
    if (x !== menu.x || y !== menu.y) setMenu({ x, y });
  }, [menu]);

  // Clic en una ficha ya seleccionada (o doble clic) → menú, igual que el clic derecho.
  const onCardClick = (e: ReactMouseEvent) => {
    // Siempre selecciona (abre terminal y panel); si ya estaba seleccionada o es
    // doble clic, además abre el menú de acciones.
    onSelect(agentId);
    if (variant !== 'default' || e.detail >= 2) {
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY });
    }
  };

  const onContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const menuNode = <>{menu &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[100] bg-bg border-2 border-border flex flex-col"
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="text-sm text-left px-10 py-6 hover:bg-btn-hover text-text whitespace-nowrap"
              onClick={(e) => {
                e.stopPropagation();
                setMenu(null);
                onSelect(agentId);
              }}
            >
              {t('card.openTerminal')}
            </button>
            {onPin && (
              <button
                className="text-sm text-left px-10 py-6 hover:bg-btn-hover text-text whitespace-nowrap"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(null);
                  onPin(agentId);
                }}
              >
                {pinned ? t('card.unpin') : t('card.pin')}
              </button>
            )}
            {(resting ? onWake : onRest) && (
              <button
                className="text-sm text-left px-10 py-6 hover:bg-btn-hover text-text whitespace-nowrap"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(null);
                  if (resting) onWake?.(agentId);
                  else onRest?.(agentId);
                }}
              >
                {resting ? t('card.wake') : t('card.rest')}
              </button>
            )}
            <button
              className="text-sm text-left px-10 py-6 hover:bg-btn-hover text-danger whitespace-nowrap"
              onClick={(e) => {
                e.stopPropagation();
                setMenu(null);
                setConfirmClose(true);
              }}
            >
              {t('card.removeMenu')}
            </button>
          </div>,
          document.body,
        )}
      {confirmClose && (
        <ConfirmModal
          title={t('card.removeTitle')}
          confirmLabel={t('card.removeConfirm')}
          danger
          onCancel={() => setConfirmClose(false)}
          onConfirm={() => {
            setConfirmClose(false);
            onClose(agentId);
          }}
        >
          {t('card.removeBody', { name: name ?? `Agent ${agentId}` })}
        </ConfirmModal>
      )}</>;

  const working = status === 'working';
  const attention = status === 'attention';
  const statusLabel = resting ? statusText('resting') : status ? statusText(STATUS_KEY[status]) : statusText('new');
  const statusCls = resting ? 'text-text-muted' : status ? STATUS_TEXT[status] : 'text-text-muted';

  if (compact) {
    return (
      <div
        className={`ide-ui group pointer-events-auto relative flex items-center gap-8 pl-6 pr-10 py-4 cursor-pointer border-2 shrink-0 w-[168px] ${CARD_VARIANT[variant]}`}
        onClick={onCardClick}
        onContextMenu={onContextMenu}
        title={name ? t('card.tipOptions', { name }) : `Agent ${agentId}`}
      >
        <div className="relative shrink-0">
          <span
            className={`absolute -inset-2 border-2 pointer-events-none ${
              working ? 'border-accent-bright animate-pulse' : attention ? 'border-status-permission' : 'border-transparent'
            }`}
          />
          <CharacterMugShot palette={appearance.palette} hueShift={appearance.hueShift} size={28} />
          <span
            className={`absolute -right-3 -bottom-3 size-8 border-2 border-bg ${
              status ? STATUS_DOT[status] : 'bg-transparent border-transparent'
            }`}
          />
        </div>
        <div className="min-w-0 flex-1 flex flex-col leading-tight">
          <span className="truncate text-text font-semibold text-[13px] flex items-center gap-4">
            {roomColor && <span className="inline-block w-6 h-6 shrink-0" style={{ background: roomColor }} />}
            <span className="truncate">{name ?? `Agent ${agentId}`}</span>
          </span>
          <span className={`truncate text-[11px] ${statusCls}`}>{statusLabel}</span>
        </div>
        {onPin && (
          <button
            className={`absolute top-2 right-2 ${pinned ? 'text-accent-bright' : 'text-text-muted opacity-0 group-hover:opacity-100'}`}
            title={pinned ? t('card.unpin') : t('card.pin')}
            onClick={(e) => {
              e.stopPropagation();
              onPin(agentId);
            }}
          >
            <IconPin size={12} />
          </button>
        )}
        {menuNode}
      </div>
    );
  }

  return (
    <div
      className={`pointer-events-auto w-full flex flex-col items-center gap-2 py-3 px-2 cursor-pointer border-2 shrink-0 ${CARD_VARIANT[variant]}`}
      onClick={onCardClick}
      onContextMenu={onContextMenu}
      title={name ? t('card.tipClose', { name }) : `Agent ${agentId}`}
    >
      <div className="relative">
        {/* Anillo pulsante alrededor de la figura mientras trabaja; amarillo fijo si espera algo. */}
        <span
          className={`absolute -inset-3 border-2 pointer-events-none ${
            working
              ? 'border-accent-bright animate-pulse'
              : attention
                ? 'border-status-permission'
                : 'border-transparent'
          }`}
        />
        <CharacterMugShot palette={appearance.palette} hueShift={appearance.hueShift} />
        <span
          className={`absolute -right-4 -bottom-4 size-10 border-2 border-bg ${
            status ? STATUS_DOT[status] : 'bg-transparent border-transparent'
          }`}
        />
        {showClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onClose(agentId);
            }}
            title={t('card.closeAgent')}
            className="absolute -right-6 -top-8 leading-none"
          >
            ×
          </Button>
        )}
      </div>
      {name && (
        <span
          className="w-full text-center text-2xs leading-tight text-text break-words"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {name}
        </span>
      )}
      <span className={`text-2xs leading-none ${resting ? 'text-text-muted' : status ? STATUS_TEXT[status] : 'text-text-muted'}`}>
        {statusLabel}
      </span>

      {menuNode}
    </div>
  );
}
