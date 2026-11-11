/** Rutas propias de la oficina (todo lo que no es upstream de Pixel Agents). */
import type { FastifyInstance } from 'fastify';

import { ensureProjectContext } from '../capabilitiesPrompt.js';
import { readConfig } from '../configPersistence.js';
import type { HttpServerOptions } from '../httpServer.js';
import { registerDashboardRoutes } from './dashboardRoutes.js';
import { registerDeviceRoutes, startDeviceServer } from './deviceRoutes.js';
import { registerFsRoutes } from './fsRoutes.js';
import { registerGitRoutes } from './gitRoutes.js';
import { registerLangRoutes } from './langRoutes.js';
import { registerNotesRoutes } from './notesRoutes.js';
import { registerOnboardingRoutes } from './onboardingRoutes.js';
import { registerPrefsRoutes } from './prefsRoutes.js';
import { registerProjectRoutes } from './projectRoutes.js';
import { registerPrRoutes } from './prRoutes.js';
import { registerRoomsRoutes } from './roomsRoutes.js';
import { registerSkinRoutes } from './skinRoutes.js';
import { registerStatsRoutes } from './statsRoutes.js';

export { setListeningPort } from './shared.js';

/** Tras escuchar: la pantalla externa en la red local, si está activada (dispositivo.json). */
export function startOfficeDevice(app: FastifyInstance, options: HttpServerOptions, officePort: number): void {
  if (options.embedded) return;
  const server = startDeviceServer(options.store, officePort, (name) => readConfig().standalone.areaMappings[name]?.[0]);
  // Ya escuchando, Fastify no admite hooks nuevos: se cierra con el servidor HTTP de la oficina.
  if (server) app.server.on('close', () => server.close());
}

export function registerOfficeRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  registerNotesRoutes(app, options);
  registerGitRoutes(app, options);
  registerDashboardRoutes(app, options);
  registerFsRoutes(app, options);
  registerRoomsRoutes(app, options);
  registerStatsRoutes(app, options);
  registerOnboardingRoutes(app, options);
  registerPrRoutes(app, options);
  registerProjectRoutes(app, options);
  registerLangRoutes(app, options);
  registerSkinRoutes(app, options);
  registerPrefsRoutes(app, options);
  registerDeviceRoutes(app, options);
  // Contexto de Cubicle (carpeta de reportes) en el CLAUDE.md de todos los agentes, poco después de arrancar.
  setTimeout(() => ensureProjectContext(), 20_000).unref();
}
