/**
 * Actividad (mapa de calor; historia en <oficina>/actividad.json), capacidades
 * (declaradas en <oficina>/capacidades.json + detectadas), última actividad por
 * agente (sofás) y límites de uso de la cuenta (usage.json de la statusline).
 */
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as os from 'os';

import { persistedActivityStats, tokenUsageByDir, totalTokens, windowedHours } from '../activityStats.js';
import { transcriptLastActivity } from '../agentProjects.js';
import { capabilitiesFor } from '../capabilities.js';
import { usageByModel } from '../modelUsage.js';
import { clearCapabilities } from '../capabilitiesPrompt.js';
import { readConfig } from '../configPersistence.js';
import type { HttpServerOptions } from '../httpServer.js';
import { activityFile, capabilitiesFile, officeDir, usageFile } from '../officePaths.js';
import * as path from 'path';
import { relaunchAll } from '../terminal/relaunch.js';
import { bearerAuth, launchDeps } from './shared.js';

/** Plan de la cuenta de Claude (~/.claude.json → oauthAccount): solo nombre, tipo y nivel; nada personal. */
function claudePlan(): { name: string | null; type: string | null; tier: string | null } | null {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')) as { oauthAccount?: Record<string, unknown> };
    const a = d.oauthAccount;
    if (!a) return null;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return { name: str(a.planDisplayName), type: str(a.organizationType), tier: str(a.organizationRateLimitTier) ?? str(a.userRateLimitTier) };
  } catch {
    return null;
  }
}

function dirsOfRoom(label: string) {
  const cfg = readConfig();
  return cfg.directories.filter((d) => (cfg.standalone.areaMappings[d.name] ?? []).includes(label));
}

/** Colores de las salas (oficinas.json) para el desglose de consumo. */
function roomColors(): Record<string, string> {
  try {
    const of = JSON.parse(fs.readFileSync(path.join(officeDir(), 'oficinas.json'), 'utf8')) as { salas?: Array<{ label: string; color?: string }> };
    return Object.fromEntries((of.salas ?? []).map((s) => [s.label, s.color ?? '#888888']));
  } catch {
    return {};
  }
}

export function registerStatsRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  // Consumo de tokens por sala y por agente en una ventana de días (0 = todo).
  app.get<{ Querystring: { days?: string } }>('/api/usage/tokens', async (request) => {
    const cfg = readConfig();
    const days = Math.max(0, Math.min(365, Number(request.query.days ?? 7) || 0));
    const per = tokenUsageByDir(cfg.directories, activityFile(), days);
    const colors = roomColors();
    const rooms = new Map<string, { label: string; color: string; total: number; agents: Array<{ name: string; total: number; prompts: number; in: number; out: number; cacheW: number; cacheR: number }> }>();
    for (const p of per) {
      const label = cfg.standalone.areaMappings[p.name]?.[0] ?? 'Otros';
      const r = rooms.get(label) ?? { label, color: colors[label] ?? '#888888', total: 0, agents: [] };
      const total = totalTokens(p.tokens);
      r.total += total;
      r.agents.push({ name: p.name, total, prompts: p.prompts, ...p.tokens });
      rooms.set(label, r);
    }
    const grand = [...rooms.values()].reduce((a, r) => a + r.total, 0);
    const out = [...rooms.values()]
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .map((r) => ({
        ...r,
        pct: grand ? (100 * r.total) / grand : 0,
        agents: r.agents.filter((a) => a.total > 0).sort((a, b) => b.total - a.total).map((a) => ({ ...a, pct: grand ? (100 * a.total) / grand : 0, pctRoom: r.total ? (100 * a.total) / r.total : 0 })),
      }));
    return { days, total: grand, rooms: out };
  });

  // Estadísticas de actividad de un agente, de una sala y de toda la oficina.
  app.get<{ Params: { name: string } }>('/api/agents/:name/stats', async (request, reply) => {
    const dir = readConfig().directories.find((d) => d.name === request.params.name);
    if (!dir) {
      reply.code(404).send({ error: 'agente no registrado' });
      return;
    }
    reply.send(persistedActivityStats([dir], activityFile()));
  });
  app.get<{ Params: { label: string } }>('/api/rooms/:label/stats', async (request, reply) => {
    const dirs = dirsOfRoom(request.params.label);
    reply.send({ ...persistedActivityStats(dirs, activityFile()), agents: dirs.length });
  });
  app.get<{ Querystring: { days?: string } }>('/api/stats', async (request) => {
    const cfg = readConfig();
    const base = { ...persistedActivityStats(cfg.directories, activityFile()), agents: cfg.directories.length };
    // ?days=N: horas y tokens por hora solo de la ventana (las gráficas de horas/días siguen el filtro).
    const days = Math.max(0, Math.min(365, Number(request.query.days ?? 0) || 0));
    if (days > 0) Object.assign(base, windowedHours(cfg.directories.map((d) => d.path), days));
    return base;
  });

  // Capacidades: recursos externos, MCP, apps, skills.
  app.get<{ Params: { name: string } }>('/api/agents/:name/capabilities', async (request, reply) => {
    const dir = readConfig().directories.find((d) => d.name === request.params.name);
    if (!dir) {
      reply.code(404).send({ error: 'agente no registrado' });
      return;
    }
    reply.send(capabilitiesFor([dir], capabilitiesFile()));
  });
  app.get<{ Params: { label: string } }>('/api/rooms/:label/capabilities', async (request) =>
    capabilitiesFor(dirsOfRoom(request.params.label), capabilitiesFile()),
  );
  app.get('/api/capabilities', async () => capabilitiesFor(readConfig().directories, capabilitiesFile()));

  // "Volver a preguntar": borra la declaración y relanza el agente con la pregunta como prompt inicial.
  app.delete<{ Params: { name: string } }>(
    '/api/agents/:name/capabilities',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const name = request.params.name;
      if (!readConfig().directories.some((d) => d.name === name)) {
        reply.code(404).send({ error: 'agente no registrado' });
        return;
      }
      clearCapabilities(name);
      let launched: unknown = null;
      const deps = launchDeps(options);
      if (deps) {
        for (const a of [...options.store.values()]) {
          if (!a.isExternal && a.directoryName === name && deps.ptyManager.has(a.id)) deps.runtime.closeAgent(a.id);
        }
        await new Promise<void>((r) => setTimeout(r, 800));
        launched = await relaunchAll(deps, { bypassPermissions: readConfig().standalone.bypassPermissions, only: [name], delayMs: 0 });
      }
      return reply.send({ ok: true, launched });
    },
  );

  // Última actividad real de cada agente (para los sofás).
  app.get('/api/activity', async () => {
    const out: Record<number, { lastActivityAt: number | null; directoryName?: string }> = {};
    for (const [id, agent] of options.store) {
      // Sin prompt humano todavía: cuenta desde que se creó la conversación (un agente recién
      // creado no se va al sofá); sin transcript aún, acaba de lanzarse → ahora.
      let at = agent.jsonlFile ? transcriptLastActivity(agent.jsonlFile) : null;
      if (at === null) {
        try {
          at = agent.jsonlFile ? fs.statSync(agent.jsonlFile).birthtimeMs || null : Date.now();
        } catch {
          at = Date.now();
        }
      }
      out[id] = {
        lastActivityAt: at,
        directoryName: agent.directoryName,
      };
    }
    return out;
  });

  // Tokens por modelo en los últimos N días (todos los transcripts de la cuenta).
  app.get<{ Querystring: { days?: string } }>('/api/usage/models', async (request) => {
    const days = Math.max(1, Math.min(31, Number(request.query.days ?? 7) || 7));
    return { days, models: usageByModel(days) };
  });

  // Límites de uso de la cuenta (sesión de 5 h y semana), escritos por la statusline.
  app.get('/api/usage', async () => {
    try {
      const u = JSON.parse(fs.readFileSync(usageFile(), 'utf8')) as Record<string, unknown>;
      return { ...u, plan: claudePlan() };
    } catch {
      return null;
    }
  });
}
