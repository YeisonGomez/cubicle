import type { DragEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { notify } from '../notifications.js';

import { TERMINAL_SIDEBAR_WIDTH_PX } from '../constants.js';
import { AGENT_RENAMED_EVENT } from '../renameAgent.js';
import { useT } from '../i18n/index.js';
import type { AgentAppearance, TabStatus } from './AgentCard.js';
import { AgentCard } from './AgentCard.js';
import { cardVariant, reorderByPointer } from './cardBar.js';
import { IconGrip, IconPin } from './icons.js';

/** Una sala (Área del layout): etiqueta y color de cabecera. */
export interface CardGroup {
  label: string;
  color: string;
}

interface AgentCardBarProps {
  /** Agents to show, top to bottom. */
  agentIds: number[];
  /** The agent whose terminal pane is showing (standalone). Its card gets the
   *  accent border. */
  activeAgentId?: number | null;
  /** The agent whose character is selected in the office. Its card gets the
   *  active background; `activeAgentId` wins when both name the same agent. */
  focusedAgentId?: number | null;
  getAppearance: (agentId: number) => AgentAppearance;
  statusFor: (agentId: number) => TabStatus | null;
  /** Nombre corto para la tarjeta (directorio de la sesión). */
  nameOf?: (agentId: number) => string | undefined;
  /** Sala a la que pertenece el agente (null = sin sala). Con esto la barra se
   *  parte en secciones con cabecera, en el orden de `groups`. */
  groupOf?: (agentId: number) => string | null;
  groups?: CardGroup[];
  onSelect: (agentId: number) => void;
  onClose: (agentId: number) => void;
  /** Barra superior en fila (escritorio). El orden es SOLO del usuario: las salas se
   *  arrastran por su cabecera, las fichas dentro de su sala, y la chincheta fija
   *  una ficha al frente. Todo se guarda por nombre (los ids cambian al relanzar). */
  horizontal?: boolean;
  isResting?: (agentId: number) => boolean;
  onRest?: (agentId: number) => void;
  onWake?: (agentId: number) => void;
  /** Clic en el nombre de una sala: abre su ficha de proyecto. */
  onRoomInfo?: (label: string) => void;
  /** Agentes que te necesitan y no has mirado (cambia cuando cambia): la oficina los hace saltar. */
  onUnseenChange?: (ids: number[]) => void;
}

const UNGROUPED = '__sin_sala__';
const PINNED = '__fijados__';
const COLLAPSED_KEY = 'pixel-agents.collapsedGroups';
const ORDER_KEY = 'pixel-agents.cardOrder';
const GROUP_ORDER_KEY = 'pixel-agents.groupOrder';
const PINNED_KEY = 'pixel-agents.pinnedAgents';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento: solo esta sesión */
  }
}

/** Orden guardado por sala: nombres de directorio. */
type SavedOrder = Record<string, string[]>;

/** Ids ordenados según la lista guardada de nombres; los desconocidos al final. */
function applySavedOrder(ids: number[], saved: string[] | undefined, nameOf: (id: number) => string | undefined): number[] {
  if (!saved || saved.length === 0) return ids;
  const rank = new Map(saved.map((n, i) => [n, i]));
  return [...ids]
    .map((id, i) => ({ id, i, r: rank.get(nameOf(id) ?? '') ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
    .map((x) => x.id);
}

interface Section {
  key: string;
  label: string;
  color: string | null;
  ids: number[];
}

/**
 * The column of agent cards along the office's right edge — one card per
 * agent, grouped by sala when `groupOf`/`groups` are given — shared by both
 * desktop hosts. In `horizontal` mode it is the top bar of the office.
 */
export function AgentCardBar({
  agentIds,
  activeAgentId = null,
  focusedAgentId = null,
  getAppearance,
  statusFor,
  nameOf,
  groupOf,
  groups,
  onSelect,
  onClose,
  horizontal = false,
  isResting,
  onRest,
  onWake,
  onRoomInfo,
  onUnseenChange,
}: AgentCardBarProps) {
  const { t, tn } = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(readJson<string[]>(COLLAPSED_KEY, [])));
  const [order, setOrder] = useState<SavedOrder>(() => readJson<SavedOrder>(ORDER_KEY, {}));
  const [groupOrder, setGroupOrder] = useState<string[]>(() => readJson<string[]>(GROUP_ORDER_KEY, []));
  const [pinned, setPinned] = useState<string[]>(() => readJson<string[]>(PINNED_KEY, []));
  // Renombrado desde la ficha: fijados y orden siguen al nombre nuevo.
  useEffect(() => {
    const on = (e: Event) => {
      const { from, to } = (e as CustomEvent<{ from: string; to: string }>).detail;
      const swap = (n: string) => (n === from ? to : n);
      setPinned((p) => p.map(swap));
      setOrder((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.map(swap)])));
    };
    window.addEventListener(AGENT_RENAMED_EVENT, on);
    return () => window.removeEventListener(AGENT_RENAMED_EVENT, on);
  }, []);
  const [drag, setDrag] = useState<{ id: number; group: string; ids: number[] } | null>(null);
  const [groupDrag, setGroupDrag] = useState<{ key: string; keys: string[] } | null>(null);
  const cardRefs = useRef(new Map<number, HTMLDivElement>());
  // "Te necesita" sin ver: un agente que pide permiso, te pregunta algo o TERMINÓ
  // un turno mientras no mirabas su terminal. Late en la barra (y avisa con una
  // notificación del navegador) hasta que abres su terminal o vuelve a trabajar.
  const [pending, setPending] = useState<Set<number>>(new Set());
  const prevStatus = useRef(new Map<number, TabStatus | null>());
  // Ya revisados en este episodio de reposo: Claude vuelve a avisar (idle_prompt)
  // cada cierto tiempo mientras la sesión sigue parada en el prompt, y eso NO debe
  // volver a marcarla como pendiente. Se olvida cuando el agente vuelve a trabajar.
  const seenRef = useRef(new Set<number>());
  // Mirar al agente cuenta como revisarlo: su terminal abierta o su personaje elegido.
  const lookedAt = activeAgentId ?? focusedAgentId;
  const markSeen = useCallback((id: number) => {
    seenRef.current.add(id);
    setPending((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : p));
  }, []);
  const statusKey = agentIds.map((id) => `${id}:${statusFor(id)}`).join('|');
  useEffect(() => {
    const finished: number[] = [];
    setPending((p) => {
      const next = new Set(p);
      for (const id of agentIds) {
        const now = statusFor(id);
        const was = prevStatus.current.get(id) ?? null;
        prevStatus.current.set(id, now);
        if (now === 'working') {
          next.delete(id); // volvió a trabajar: se olvida y empieza un episodio nuevo
          seenRef.current.delete(id);
        }
        if (was === null) continue; // primera observación (carga de la página): nada pendiente
        const asks = now === 'attention' || now === 'question';
        const justFinished = was === 'working' && now === 'idle';
        if ((asks || justFinished) && id !== lookedAt && !seenRef.current.has(id) && !next.has(id)) {
          next.add(id);
          finished.push(id);
        }
      }
      for (const id of [...next]) if (!agentIds.includes(id)) next.delete(id);
      return next.size === p.size && [...next].every((x) => p.has(x)) ? p : next;
    });
    if (finished.length > 0) notify(finished.map((id) => nameOf?.(id) ?? `Agent ${id}`), statusFor(finished[0]) === 'idle' ? t('notify.finished') : t('notify.needs'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey]);
  useEffect(() => {
    if (lookedAt !== null && lookedAt !== undefined) markSeen(lookedAt);
  }, [lookedAt, markSeen]);
  const unseen = (id: number) => pending.has(id) && id !== lookedAt;
  // Al seleccionar un agente (ficha, personaje o terminal), la barra se desplaza para centrar su ficha.
  useEffect(() => {
    if (activeAgentId === null) return;
    const el = cardRefs.current.get(activeAgentId);
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [activeAgentId]);
  const unseenKey = [...pending].filter((id) => id !== lookedAt).sort((a, b) => a - b).join(',');
  useEffect(() => {
    onUnseenChange?.(unseenKey ? unseenKey.split(',').map(Number) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseenKey]);
  // "Te necesita" (idle_prompt: la sesión espera en el prompt) solo mientras no lo
  // hayas visto; una vez abierta su terminal vuelve a mostrarse Libre. El permiso
  // pendiente (attention) sí se mantiene, porque bloquea de verdad.
  const shownStatus = (id: number): TabStatus | null => {
    const s = statusFor(id);
    return s === 'question' && !unseen(id) ? 'idle' : s;
  };
  const sectionRefs = useRef(new Map<string, HTMLDivElement>());

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeJson(COLLAPSED_KEY, [...next]);
      return next;
    });
  }, []);
  const name = useCallback((id: number) => nameOf?.(id), [nameOf]);
  const togglePin = useCallback(
    (id: number) => {
      const n = nameOf?.(id);
      if (!n) return;
      setPinned((prev) => {
        const next = prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n];
        writeJson(PINNED_KEY, next);
        return next;
      });
    },
    [nameOf],
  );

  // ── Arrastre de fichas dentro de una sala ──
  const onDragStart = (e: DragEvent, id: number, group: string, ids: number[]) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', `card:${id}`);
    } catch {
      /* algunos navegadores exigen setData; si falla igual arrastra */
    }
    setDrag({ id, group, ids });
  };
  const midpointOf = (el: HTMLElement | undefined) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2;
  };
  const onDragOverSection = (e: DragEvent, group: string) => {
    if (!drag || drag.group !== group) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const next = reorderByPointer(drag.ids, drag.id, (id) => midpointOf(cardRefs.current.get(id)), e.clientX);
    if (next.some((id, i) => id !== drag.ids[i])) setDrag({ ...drag, ids: next });
  };
  const onDropSection = (e: DragEvent, group: string) => {
    if (!drag || drag.group !== group) return;
    e.preventDefault();
    const names = drag.ids.map((id) => name(id)).filter((n): n is string => !!n);
    if (group === PINNED) {
      setPinned(names);
      writeJson(PINNED_KEY, names);
    } else {
      const next = { ...order, [group]: names };
      setOrder(next);
      writeJson(ORDER_KEY, next);
    }
    setDrag(null);
  };

  // ── Arrastre de salas por su cabecera ──
  const onGroupDragStart = (e: DragEvent, key: string, keys: string[]) => {
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', `group:${key}`);
    } catch {
      /* ídem */
    }
    setGroupDrag({ key, keys });
  };
  const onBarDragOver = (e: DragEvent) => {
    if (!groupDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const ids = groupDrag.keys.map((_, i) => i);
    const cur = groupDrag.keys.indexOf(groupDrag.key);
    const next = reorderByPointer(ids, cur, (i) => midpointOf(sectionRefs.current.get(groupDrag.keys[i])), e.clientX).map((i) => groupDrag.keys[i]);
    if (next.some((k, i) => k !== groupDrag.keys[i])) setGroupDrag({ ...groupDrag, keys: next });
  };
  const onBarDrop = (e: DragEvent) => {
    if (!groupDrag) return;
    e.preventDefault();
    const next = groupDrag.keys.filter((k) => k !== PINNED && k !== UNGROUPED);
    setGroupOrder(next);
    writeJson(GROUP_ORDER_KEY, next);
    setGroupDrag(null);
  };
  const onDragEnd = () => {
    setDrag(null);
    setGroupDrag(null);
  };

  if (agentIds.length === 0) return null;

  // Los que descansan en el sofá no aparecen en la barra: vuelven al recibir un prompt.
  const shown = horizontal && isResting ? agentIds.filter((id) => !isResting(id)) : agentIds;
  const pinnedIds = horizontal ? applySavedOrder(shown.filter((id) => pinned.includes(name(id) ?? '')), pinned, name) : [];
  const unpinned = horizontal ? shown.filter((id) => !pinnedIds.includes(id)) : shown;

  // Secciones: fijados primero; luego las salas en el orden guardado por el usuario
  // (las nuevas al final, en el orden del plano); al final "sin sala".
  let sections: Section[] = [];
  if (groupOf && groups && groups.length > 0) {
    const byGroup = new Map<string, number[]>();
    for (const id of unpinned) {
      const g = groupOf(id) ?? UNGROUPED;
      byGroup.set(g, [...(byGroup.get(g) ?? []), id]);
    }
    for (const g of groups) {
      const ids = byGroup.get(g.label);
      if (ids && ids.length > 0) sections.push({ key: g.label, label: g.label, color: g.color, ids });
      byGroup.delete(g.label);
    }
    const rank = new Map(groupOrder.map((k, i) => [k, i]));
    sections = sections
      .map((s, i) => ({ s, i, r: rank.get(s.key) ?? Number.POSITIVE_INFINITY }))
      .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
      .map((x) => x.s);
    for (const [key, ids] of byGroup) sections.push({ key, label: key === UNGROUPED ? t('bar.others') : key, color: null, ids });
  } else {
    sections.push({ key: 'all', label: '', color: null, ids: unpinned });
  }
  if (pinnedIds.length > 0) sections.unshift({ key: PINNED, label: t('bar.pinned'), color: null, ids: pinnedIds });
  if (groupDrag) {
    const byKey = new Map(sections.map((s) => [s.key, s]));
    sections = groupDrag.keys.map((k) => byKey.get(k)).filter((s): s is Section => !!s);
  }

  if (horizontal) {
    if (sections.length === 0) return null;
    const sectionKeys = sections.map((s) => s.key);
    return (
      <div
        className="ide-ui relative z-30 w-full shrink-0 flex items-stretch gap-10 px-10 pt-4 pb-3 overflow-x-auto overflow-y-hidden border-b-2 border-border bg-bg-dark bar-scroll"
        onDragOver={onBarDragOver}
        onDrop={onBarDrop}
      >
        {sections.map((s) => {
          const isCollapsed = collapsed.has(s.key);
          const isPinnedSection = s.key === PINNED;
          const busy = s.ids.filter((id) => ['working', 'attention', 'question'].includes(shownStatus(id) ?? '')).length;
          const ordered = isPinnedSection ? s.ids : applySavedOrder(s.ids, order[s.key], name);
          const ids = drag && drag.group === s.key ? drag.ids : ordered;
          return (
            <div
              key={s.key}
              ref={(el) => {
                if (el) sectionRefs.current.set(s.key, el);
                else sectionRefs.current.delete(s.key);
              }}
              className={`flex flex-col gap-4 shrink-0 transition-opacity ${groupDrag?.key === s.key ? 'opacity-40' : ''}`}
            >
              {s.label && (
                <div className="flex items-center gap-4 group">
                  {!isPinnedSection && (
                    <span
                      className="text-text-muted opacity-40 group-hover:opacity-100 cursor-grab active:cursor-grabbing"
                      draggable
                      onDragStart={(e) => onGroupDragStart(e, s.key, sectionKeys)}
                      onDragEnd={onDragEnd}
                      title={t('bar.dragRoom')}
                    >
                      <IconGrip size={12} />
                    </span>
                  )}
                  {isPinnedSection && (
                    <span className="text-accent-bright">
                      <IconPin size={12} />
                    </span>
                  )}
                  <button
                    className="flex items-center gap-6 text-left text-[11px] uppercase tracking-wider text-text-muted hover:text-text"
                    title={!isPinnedSection && onRoomInfo ? t('bar.info', { room: s.label }) : s.label}
                    onClick={() => (!isPinnedSection && onRoomInfo ? onRoomInfo(s.key) : toggle(s.key))}
                  >
                    {s.color && <span className="inline-block w-8 h-8" style={{ background: s.color }} />}
                    <span className="font-semibold">{s.label}</span>
                  </button>
                  <button
                    className="flex items-center text-text-muted hover:text-text px-2"
                    title={t('bar.toggle', { room: s.label, action: isCollapsed ? t('bar.show') : t('bar.hide') })}
                    onClick={() => toggle(s.key)}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={isCollapsed ? '' : 'rotate-90'}>
                      <path d="M3 1.5 7 5l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {isCollapsed && (
                      <span>
                        {s.ids.length}
                        {busy ? <span className="text-status-permission"> · {tn('bar.active', busy)}</span> : null}
                      </span>
                    )}
                  </button>
                </div>
              )}
              {!isCollapsed && (
                <div className="flex items-center gap-4" onDragOver={(e) => onDragOverSection(e, s.key)} onDrop={(e) => onDropSection(e, s.key)}>
                  {ids.map((agentId) => (
                    <div
                      key={agentId}
                      ref={(el) => {
                        if (el) cardRefs.current.set(agentId, el);
                        else cardRefs.current.delete(agentId);
                      }}
                      draggable
                      onDragStart={(e) => onDragStart(e, agentId, s.key, ids)}
                      onDragEnd={onDragEnd}
                      className={`cursor-grab active:cursor-grabbing transition-opacity ${drag?.id === agentId ? 'opacity-40' : ''}`}
                      title={t('bar.drag')}
                    >
                      <AgentCard
                        compact
                        agentId={agentId}
                        variant={cardVariant(agentId, { activeId: activeAgentId, focusedId: focusedAgentId })}
                        appearance={getAppearance(agentId)}
                        status={shownStatus(agentId)}
                        name={nameOf?.(agentId)}
                        onSelect={(id) => {
                          markSeen(id);
                          onSelect(id);
                        }}
                        onClose={onClose}
                        resting={isResting?.(agentId) ?? false}
                        onRest={onRest}
                        onWake={onWake}
                        unseen={unseen(agentId)}
                        pinned={pinned.includes(name(agentId) ?? '')}
                        onPin={togglePin}
                        roomColor={isPinnedSection ? (groups?.find((g) => g.label === groupOf?.(agentId))?.color ?? null) : null}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="relative z-30 h-full shrink-0 flex flex-col items-stretch gap-6 pt-4 px-2 overflow-y-auto pointer-events-none"
      style={{ width: TERMINAL_SIDEBAR_WIDTH_PX, marginLeft: -TERMINAL_SIDEBAR_WIDTH_PX }}
    >
      {sections.map((s) => (
        <div key={s.key} className="flex flex-col items-stretch gap-3">
          {s.label && (
            <button
              className="pointer-events-auto text-2xs leading-none text-center py-3 px-2 border-2 uppercase tracking-wide text-bg font-bold truncate"
              style={{
                background: s.color ?? 'var(--color-border)',
                borderColor: s.color ?? 'var(--color-border)',
              }}
              title={t('bar.toggle', { room: s.label, action: collapsed.has(s.key) ? t('bar.show') : t('bar.hide') })}
              onClick={() => toggle(s.key)}
            >
              {s.label}
              {collapsed.has(s.key) ? ` (${s.ids.length})` : ''}
            </button>
          )}
          {!collapsed.has(s.key) &&
            s.ids.map((agentId) => (
              <AgentCard
                key={agentId}
                agentId={agentId}
                variant={cardVariant(agentId, { activeId: activeAgentId, focusedId: focusedAgentId })}
                appearance={getAppearance(agentId)}
                status={shownStatus(agentId)}
                name={nameOf?.(agentId)}
                onSelect={onSelect}
                onClose={onClose}
                resting={isResting?.(agentId) ?? false}
                onRest={onRest}
                onWake={onWake}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
