/**
 * Salas y agentes: info/ajustes por agente, relanzar, lista de salas, lanzar un
 * agente en una sala, crear proyecto (= sala), aplicar layout y recargar assets.
 */
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';

import { agentInfo, saveAgentSettings } from '../agentProjects.js';
import { capabilitiesPromptFor } from '../capabilitiesPrompt.js';
import { readConfig, writeConfig } from '../configPersistence.js';
import { DEFAULT_ROOM_COLOR } from '../constants.js';
import { listDirectories } from '../directories.js';
import { hostDirectory } from '../hostDirectory.js';
import type { HttpServerOptions } from '../httpServer.js';
import { writeLayoutToFile } from '../layoutPersistence.js';
import { officeDir, scriptsDir, activityFile, capabilitiesFile } from '../officePaths.js';
import { relaunchAll } from '../terminal/relaunch.js';
import { launchStandaloneAgent } from '../terminal/standaloneAgentLauncher.js';
import { bearerAuth, desksFor, HOME, insideHome, launchDeps, runProyecto, writePromptToAgent } from './shared.js';

interface RoomInfo {
  label: string;
  color: string;
  base: string;
  dirs: Array<{ name: string; path: string }>;
}

/** Ancestro común de varias rutas (dentro del home; si no, el home). */
function commonAncestor(paths: string[]): string | null {
  if (paths.length === 0) return null;
  let parts = paths[0].split(path.sep);
  for (const p of paths.slice(1)) {
    const q = p.split(path.sep);
    let i = 0;
    while (i < parts.length && i < q.length && parts[i] === q[i]) i++;
    parts = parts.slice(0, i);
  }
  const dir = parts.join(path.sep) || path.sep;
  return insideHome(dir) ? dir : HOME;
}

/** Salas: las de oficinas.json más cualquier área mapeada en la config. */
function rooms(): RoomInfo[] {
  const cfg = readConfig();
  const mappings = cfg.standalone.areaMappings;
  let salas: Array<{ label: string; color?: string; base?: string }> = [];
  try {
    salas = (JSON.parse(fs.readFileSync(path.join(officeDir(), 'oficinas.json'), 'utf8')) as { salas: typeof salas }).salas;
  } catch {
    salas = [];
  }
  const labels = new Set<string>(salas.map((s) => s.label));
  for (const areas of Object.values(mappings)) for (const a of areas) labels.add(a);
  return [...labels].map((label) => {
    const sala = salas.find((s) => s.label === label);
    const dirs = cfg.directories.filter((d) => (mappings[d.name] ?? []).includes(label)).map((d) => ({ name: d.name, path: d.path }));
    const base = sala?.base && fs.existsSync(sala.base) ? sala.base : (commonAncestor(dirs.map((d) => d.path)) ?? HOME);
    return { label, color: sala?.color ?? DEFAULT_ROOM_COLOR, base, dirs };
  });
}

export function registerRoomsRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  // Reanudar la última conversación de cada Directorio (tras un reinicio).
  app.post<{ Body: { only?: string[] } | undefined }>(
    '/api/relaunch',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const deps = launchDeps(options);
      if (!deps) {
        reply.code(503).send({ error: 'terminal no disponible' });
        return;
      }
      const results = await relaunchAll(deps, { bypassPermissions: readConfig().standalone.bypassPermissions, only: request.body?.only });
      reply.send(results);
    },
  );

  // Panel por agente: info (proyectos, dashboards) y ajustes.
  app.get<{ Params: { name: string } }>('/api/agents/:name/info', async (request, reply) => {
    const info = agentInfo(request.params.name);
    if (!info) {
      reply.code(404).send({ error: 'agente no registrado' });
      return;
    }
    reply.send(info);
  });
  app.put<{ Params: { name: string }; Body: unknown }>(
    '/api/agents/:name/settings',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const saved = saveAgentSettings(request.params.name, request.body);
      if (!saved) {
        reply.code(422).send({ error: 'no se pudo guardar' });
        return;
      }
      reply.send(agentInfo(request.params.name));
    },
  );

  app.get('/api/rooms', { preHandler: bearerAuth(options.token) }, async () => rooms());
  // Info de todos los agentes de una sala (para Cambios y Reportes del tablero/TV).
  app.get<{ Params: { label: string } }>('/api/rooms/:label/info', async (request) => {
    const cfg = readConfig();
    const names = cfg.directories.filter((d) => (cfg.standalone.areaMappings[d.name] ?? []).includes(request.params.label)).map((d) => d.name);
    return { label: request.params.label, agents: names.map((n) => agentInfo(n)).filter((i) => i !== null) };
  });

  // La biblioteca de cada sala crece con los archivos de la oficina: se recalcula
  // el plano una vez al día (y poco después de arrancar).
  const DAY_MS = 24 * 60 * 60_000;
  const refresh = () => void runProyecto(options, ['aplicar']).then((r) => console.log('[Cubicle] plano actualizado:', r.log.trim().split('\n').pop()));
  setTimeout(refresh, 90_000).unref();
  setInterval(refresh, DAY_MS).unref();

  // Nuevo agente en una sala: carpeta elegida (o creada), se registra como
  // Directorio de esa sala y se abre una sesión nueva de Claude ahí.
  // Quitar un agente de la oficina: cierra su terminal y borra su registro
  // (Directorio, sala, configuración, capacidades y actividad). No toca la
  // carpeta ni las conversaciones; con "+ Agent" se puede volver a agregar.
  app.delete<{ Params: { name: string } }>('/api/agents/:name', { preHandler: bearerAuth(options.token) }, async (request, reply) => {
    const name = request.params.name;
    const cfg = readConfig();
    const entry = cfg.directories.find((d) => d.name === name);
    if (!entry) return reply.code(404).send({ error: 'agente no registrado' });
    const room = cfg.standalone.areaMappings[name]?.[0];
    const inRoom = () => (room ? cfg.directories.filter((d) => (cfg.standalone.areaMappings[d.name] ?? []).includes(room)).length : 0);
    const before = desksFor(inRoom());
    cfg.directories = cfg.directories.filter((d) => d.name !== name);
    delete cfg.standalone.areaMappings[name];
    delete cfg.standalone.agentSettings[name];
    writeConfig(cfg);
    for (const file of [capabilitiesFile(), activityFile()]) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        if (raw[name] !== undefined) {
          delete raw[name];
          fs.writeFileSync(file, JSON.stringify(raw, null, 2));
        }
      } catch {
        /* sin archivo */
      }
    }
    const deps = launchDeps(options);
    for (const a of [...options.store.values()]) {
      if (!a.isExternal && a.directoryName === name && deps?.ptyManager.has(a.id)) options.runtime?.closeAgent(a.id);
    }
    options.store.broadcast({ type: 'directoriesLoaded', directories: listDirectories([hostDirectory()]) });
    options.store.broadcast({ type: 'areaMappingsLoaded', mappings: cfg.standalone.areaMappings });
    let relayout: string | null = null;
    if (room && desksFor(inRoom()) !== before) relayout = (await runProyecto(options, ['aplicar'])).log.trim().split('\n').pop() ?? null;
    return reply.send({ ok: true, removed: name, relayout });
  });

  // Renombrar un agente (Directorio): config, salas, capacidades y actividad; su
  // terminal se reinicia con la misma conversación para que nazca con el nombre nuevo.
  app.put<{ Params: { name: string }; Body: { name?: string } }>(
    '/api/agents/:name/rename',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const from = request.params.name;
      const to = (request.body?.name ?? '').trim().slice(0, 40);
      const cfg = readConfig();
      const entry = cfg.directories.find((d) => d.name === from);
      if (!entry) return reply.code(404).send({ error: 'agente no registrado' });
      if (!to || to === from) return reply.send({ ok: true, name: from });
      if (cfg.directories.some((d) => d.name === to)) return reply.code(409).send({ error: 'ya hay un agente con ese nombre' });
      entry.name = to;
      if (cfg.standalone.areaMappings[from]) {
        cfg.standalone.areaMappings[to] = cfg.standalone.areaMappings[from];
        delete cfg.standalone.areaMappings[from];
      }
      if (cfg.standalone.agentSettings[from]) {
        cfg.standalone.agentSettings[to] = cfg.standalone.agentSettings[from];
        delete cfg.standalone.agentSettings[from];
      }
      writeConfig(cfg);
      for (const file of [capabilitiesFile(), activityFile()]) {
        try {
          const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
          if (raw[from] !== undefined && raw[to] === undefined) {
            raw[to] = raw[from];
            delete raw[from];
            fs.writeFileSync(file, JSON.stringify(raw, null, 2));
          }
        } catch {
          /* sin archivo todavía */
        }
      }
      options.store.broadcast({ type: 'directoriesLoaded', directories: listDirectories([hostDirectory()]) });
      options.store.broadcast({ type: 'areaMappingsLoaded', mappings: cfg.standalone.areaMappings });
      let launched: unknown = null;
      const deps = launchDeps(options);
      if (deps) {
        const live = [...options.store.values()].filter((a) => !a.isExternal && a.directoryName === from && deps.ptyManager.has(a.id));
        for (const a of live) options.runtime?.closeAgent(a.id);
        if (live.length > 0) {
          await new Promise<void>((r) => setTimeout(r, 800));
          launched = await relaunchAll(deps, { bypassPermissions: cfg.standalone.bypassPermissions, only: [to], delayMs: 0, askCapabilities: false });
        }
      }
      return reply.send({ ok: true, name: to, launched });
    },
  );

  // Escribir un prompt en la terminal viva de un agente (p. ej. "crea un reporte HTML…").
  app.post<{ Params: { name: string }; Body: { text?: string } }>(
    '/api/agents/:name/prompt',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const r = await writePromptToAgent(options, request.params.name, request.body?.text ?? '');
      if (!r.ok) return reply.code(r.error === 'prompt vacío' ? 400 : 409).send({ error: r.error });
      return reply.send({ ok: true, agentId: r.agentId });
    },
  );

  app.post<{ Body: { room?: string; path?: string; name?: string; newFolder?: string } }>(
    '/api/agents/launch',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const room = (request.body?.room ?? '').trim();
      let dir = request.body?.path ? path.resolve(request.body.path) : '';
      const name = (request.body?.name ?? '').trim();
      const newFolder = (request.body?.newFolder ?? '').trim();
      if (!room || !dir || !name || !insideHome(dir) || !fs.existsSync(dir)) {
        reply.code(400).send({ error: 'oficina, carpeta o nombre inválidos' });
        return;
      }
      const deps = launchDeps(options);
      if (!deps) {
        reply.code(503).send({ error: 'terminal no disponible en este servidor' });
        return;
      }
      if (newFolder) {
        if (/[\/\\\0]/.test(newFolder) || newFolder.startsWith('.')) {
          reply.code(400).send({ error: 'nombre de carpeta inválido' });
          return;
        }
        dir = path.join(dir, newFolder);
        fs.mkdirSync(dir, { recursive: true });
      }
      const cfg = readConfig();
      const inRoom = () => cfg.directories.filter((d) => (cfg.standalone.areaMappings[d.name] ?? []).includes(room)).length;
      const before = desksFor(inRoom());
      // Mismo nombre que un Directorio existente → se reutiliza. Nombre nuevo →
      // Directorio nuevo (aunque la carpeta ya tenga otro): varios agentes
      // pueden vivir en la misma carpeta con nombres distintos.
      const samePath = cfg.directories.filter((d) => path.resolve(d.path) === dir);
      let dirName = samePath.find((d) => d.name === name)?.name ?? (name ? undefined : samePath[0]?.name);
      let registered = false;
      if (!dirName) {
        dirName = name || path.basename(dir);
        let i = 2;
        while (cfg.directories.some((d) => d.name === dirName)) dirName = `${name || path.basename(dir)} ${i++}`;
        cfg.directories.push({ name: dirName, path: dir });
        cfg.standalone.areaMappings[dirName] = [room];
        cfg.standalone.agentSettings[dirName] = {
          kind: fs.existsSync(path.join(dir, '.git')) ? 'code' : 'personal',
          projects: [],
          dashboardDirs: ['docs/reports'],
        };
        writeConfig(cfg);
        registered = true;
        fs.mkdirSync(path.join(dir, 'docs', 'reports'), { recursive: true });
        options.store.broadcast({ type: 'directoriesLoaded', directories: listDirectories([hostDirectory()]) });
        options.store.broadcast({ type: 'areaMappingsLoaded', mappings: cfg.standalone.areaMappings });
      } else if (!(cfg.standalone.areaMappings[dirName] ?? []).includes(room)) {
        cfg.standalone.areaMappings[dirName] = [room];
        writeConfig(cfg);
        options.store.broadcast({ type: 'areaMappingsLoaded', mappings: cfg.standalone.areaMappings });
      }
      let relayout: string | null = null;
      if (desksFor(inRoom()) !== before) {
        const r = await runProyecto(options, ['aplicar']);
        relayout = r.log.trim().split('\n').pop() ?? null;
      }
      const initialPrompt = capabilitiesPromptFor(dirName);
      const agentId = launchStandaloneAgent(deps, {
        directoryPath: dir,
        directoryName: dirName,
        bypassPermissions: cfg.standalone.bypassPermissions,
        ...(initialPrompt ? { initialPrompt } : {}),
      });
      reply.send({ ok: agentId !== null, agentId, directory: dirName, path: dir, registered, relayout });
    },
  );

  // Crear un proyecto (= sala + agente) desde la UI. Delega en proyecto.py,
  // que registra el Directorio, genera letrero/plano y lo aplica en vivo.
  app.post<{ Body: { name?: string; path?: string; tema?: string; sala?: string } }>(
    '/api/projects',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const name = (request.body?.name ?? '').trim();
      const dir = request.body?.path ? path.resolve(request.body.path) : '';
      if (!name || !dir || !insideHome(dir) || !fs.existsSync(dir)) {
        reply.code(400).send({ error: 'nombre o carpeta inválidos' });
        return;
      }
      const cli = path.join(scriptsDir(), 'proyecto.py');
      if (!fs.existsSync(cli)) {
        reply.code(503).send({ error: `no existe ${cli}` });
        return;
      }
      const args = ['nuevo', name, dir];
      if (request.body?.tema) args.push('--tema', request.body.tema);
      if (request.body?.sala) args.push('--sala', request.body.sala);
      const out = await runProyecto(options, args);
      if (!out.ok) {
        reply.code(500).send({ error: out.log });
        return;
      }
      // Abrir su agente (conversación nueva si no tenía sesiones).
      const deps = launchDeps(options);
      const launched = deps
        ? await relaunchAll(deps, { bypassPermissions: readConfig().standalone.bypassPermissions, only: [name], delayMs: 0 })
        : null;
      reply.send({ ok: true, log: out.log, launched });
    },
  );

  // Layout nuevo desde fuera (proyecto.py): se guarda y se aplica en vivo en
  // todas las pestañas abiertas.
  app.put<{ Body: Record<string, unknown> }>(
    '/api/layout',
    { preHandler: bearerAuth(options.token), bodyLimit: 8 * 1024 * 1024 },
    async (request, reply) => {
      const layout = request.body;
      if (!layout || layout.version !== 1 || !Array.isArray(layout.tiles) || !Array.isArray(layout.furniture)) {
        reply.code(400).send({ error: 'layout inválido' });
        return;
      }
      writeLayoutToFile(layout);
      options.store.broadcast({ type: 'layoutLoaded', layout });
      reply.send({ ok: true, furniture: layout.furniture.length });
    },
  );

  // Recargar muebles externos (tras generar letreros nuevos).
  app.post('/api/assets/reload', { preHandler: bearerAuth(options.token) }, async (_request, reply) => {
    if (!options.onReloadAssets) {
      reply.code(503).send({ error: 'sin recarga de assets' });
      return;
    }
    await options.onReloadAssets((msg) => options.store.broadcast(msg));
    reply.send({ ok: true });
  });
}
