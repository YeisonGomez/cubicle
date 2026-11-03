/** Rutas propias de la oficina (todo lo que no es upstream de Pixel Agents). */
import type { FastifyInstance } from 'fastify';

import type { HttpServerOptions } from '../httpServer.js';
import { registerDashboardRoutes } from './dashboardRoutes.js';
import { registerFsRoutes } from './fsRoutes.js';
import { registerGitRoutes } from './gitRoutes.js';
import { registerLangRoutes } from './langRoutes.js';
import { registerNotesRoutes } from './notesRoutes.js';
import { registerOnboardingRoutes } from './onboardingRoutes.js';
import { registerPrRoutes } from './prRoutes.js';
import { registerProjectRoutes } from './projectRoutes.js';
import { registerRoomsRoutes } from './roomsRoutes.js';
import { registerSkinRoutes } from './skinRoutes.js';
import { registerStatsRoutes } from './statsRoutes.js';

export { setListeningPort } from './shared.js';

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
}
