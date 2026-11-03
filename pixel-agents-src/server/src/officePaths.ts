/**
 * Rutas de la oficina.
 *  - Scripts (proyecto.py, capacidades.py): `<repo>/scripts/`, dos niveles
 *    arriba de dist/cli.js.
 *  - Datos del usuario (oficinas.json, letreros.json, capacidades.json,
 *    actividad.json, layout-oficina.json, assets/): `~/.pixel-agents/oficina/`,
 *    o `OFICINA_DIR` (pruebas aisladas).
 */
import * as os from 'os';
import * as path from 'path';

export function scriptsDir(): string {
  return path.resolve(path.dirname(process.argv[1] ?? ''), '..', '..', 'scripts');
}
export function officeDir(): string {
  return process.env.OFICINA_DIR ?? path.join(os.homedir(), '.pixel-agents', 'oficina');
}
export function activityFile(): string {
  return path.join(officeDir(), 'actividad.json');
}
export function capabilitiesFile(): string {
  return path.join(officeDir(), 'capacidades.json');
}
/** Límites de uso de la cuenta, escritos por la statusline de Claude Code. */
export function usageFile(): string {
  return path.join(os.homedir(), '.pixel-agents', 'usage.json');
}
