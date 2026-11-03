/**
 * Capacidades por Directorio: lo DECLARADO por cada sesión en
 * <oficina>/capacidades.json (capacidades.py: recursos externos, MCP, apps,
 * skills) fusionado con lo DETECTADO en los transcripts (servidores MCP y
 * skills realmente usados; ver activityStats.detected).
 */
import * as fs from 'fs';

import { activityStats } from './activityStats.js';
export interface DeclaredCapabilities {
  recursos: Array<{ nombre: string; tipo: string; detalle: string }>;
  mcp: string[];
  apps: string[];
  skills: Array<{ nombre: string; descripcion: string; detalle?: string }>;
  actualizado?: number;
  fuente?: string;
}

export interface Capabilities {
  /** Recursos externos declarados (con los agentes que los declaran). */
  recursos: Array<{ nombre: string; tipo: string; detalle: string; agentes: string[] }>;
  /** MCP: declarados y/o detectados (count = llamadas vistas en transcripts). */
  mcp: Array<{ name: string; count: number; declarado: boolean; agentes: string[] }>;
  apps: Array<{ name: string; agentes: string[] }>;
  skills: Array<{ nombre: string; descripcion: string; detalle: string; count: number; declarada: boolean; agentes: string[] }>;
  /** Agentes sin declaración (hay que preguntarles). */
  sinDeclarar: string[];
  actualizado: number | null;
}

/** Apps que se infieren de un MCP (cuando la sesión no las declaró). */
const APP_OF_MCP: Record<string, string> = { Chrome: 'Chrome', Gmail: 'Mail', Notion: 'Notion', Slack: 'Slack', 'Google Drive': 'Google Drive', Figma: 'Figma' };

function readDeclared(file: string): Record<string, DeclaredCapabilities> {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, DeclaredCapabilities>) : {};
  } catch {
    return {};
  }
}

/** Clave para fusionar nombres declarados y detectados: sin mayúsculas ni signos, con alias. */
const ALIAS: Record<string, string> = { claudeinchrome: 'chrome', googlechrome: 'chrome', customerio: 'customerio', awsapi: 'aws', mail: 'gmail' };
const keyOf = (s: string) => {
  const k = s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return ALIAS[k] ?? k;
};

export function capabilitiesFor(dirs: Array<{ name: string; path: string }>, declaredFile: string): Capabilities {
  const declared = readDeclared(declaredFile);
  const recursos = new Map<string, Capabilities['recursos'][number]>();
  const mcp = new Map<string, Capabilities['mcp'][number]>();
  const apps = new Map<string, Capabilities['apps'][number]>();
  const skills = new Map<string, Capabilities['skills'][number]>();
  const sinDeclarar: string[] = [];
  let actualizado: number | null = null;
  const push = (list: string[], a: string) => {
    if (!list.includes(a)) list.push(a);
  };
  for (const d of dirs) {
    const dec = declared[d.name];
    if (!dec) sinDeclarar.push(d.name);
    else if (dec.actualizado && (actualizado === null || dec.actualizado > actualizado)) actualizado = dec.actualizado;
    for (const r of dec?.recursos ?? []) {
      const k = keyOf(r.nombre);
      const e = recursos.get(k) ?? { nombre: r.nombre, tipo: r.tipo, detalle: r.detalle, agentes: [] };
      if (!e.detalle && r.detalle) e.detalle = r.detalle;
      push(e.agentes, d.name);
      recursos.set(k, e);
    }
    for (const m of dec?.mcp ?? []) {
      const k = keyOf(m);
      const e = mcp.get(k) ?? { name: m, count: 0, declarado: false, agentes: [] };
      e.declarado = true;
      push(e.agentes, d.name);
      mcp.set(k, e);
    }
    for (const a of dec?.apps ?? []) {
      const k = keyOf(a);
      const e = apps.get(k) ?? { name: a, agentes: [] };
      push(e.agentes, d.name);
      apps.set(k, e);
    }
    for (const sk of dec?.skills ?? []) {
      const k = keyOf(sk.nombre);
      const e = skills.get(k) ?? { nombre: sk.nombre, descripcion: sk.descripcion, detalle: sk.detalle ?? '', count: 0, declarada: false, agentes: [] };
      e.declarada = true;
      if (!e.descripcion && sk.descripcion) e.descripcion = sk.descripcion;
      if (!e.detalle && sk.detalle) e.detalle = sk.detalle;
      push(e.agentes, d.name);
      skills.set(k, e);
    }
    // detectado en transcripts
    const det = activityStats([d.path]).detected;
    for (const m of det.mcp) {
      const k = keyOf(m.name);
      const e = mcp.get(k) ?? { name: m.name, count: 0, declarado: false, agentes: [] };
      e.count += m.count;
      push(e.agentes, d.name);
      mcp.set(k, e);
      const app = APP_OF_MCP[m.name];
      if (app && !apps.has(keyOf(app))) apps.set(keyOf(app), { name: app, agentes: [d.name] });
      else if (app) push(apps.get(keyOf(app))!.agentes, d.name);
    }
    for (const sk of det.skills) {
      const k = keyOf(sk.name);
      const e = skills.get(k) ?? { nombre: sk.name, descripcion: '', detalle: '', count: 0, declarada: false, agentes: [] };
      e.count += sk.count;
      push(e.agentes, d.name);
      skills.set(k, e);
    }
  }
  return {
    recursos: [...recursos.values()].sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre)),
    mcp: [...mcp.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    apps: [...apps.values()].sort((a, b) => a.name.localeCompare(b.name)),
    skills: [...skills.values()].sort((a, b) => Number(b.declarada) - Number(a.declarada) || b.count - a.count),
    sinDeclarar,
    actualizado,
  };
}
