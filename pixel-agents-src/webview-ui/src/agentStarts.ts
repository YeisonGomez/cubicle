/**
 * Qué agentes acaban de empezar a trabajar entre dos instantáneas de `agentStatuses`.
 * Ojo: useExtensionMessages BORRA la entrada de un agente cuando pasa a activo (no guarda
 * 'active'), así que "empezó" = tenía estado (libre, esperando…) y ya no lo tiene, y sigue
 * en la oficina (un agente quitado también pierde la entrada). Al cargar la pestaña la
 * instantánea anterior está vacía: nadie "empieza" por cargar.
 */
export function agentStarts(prev: Record<number, string>, next: Record<number, string>, exists: (id: number) => boolean): number[] {
  return Object.keys(prev)
    .map(Number)
    .filter((id) => prev[id] !== 'active' && !(id in next) && exists(id));
}
