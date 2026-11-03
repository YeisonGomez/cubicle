/**
 * Tableros de notas por sala (Área). Persistencia simple en
 * ~/.pixel-agents/notes.json: { "<área>": [ { id, text, done, createdAt } ] }.
 *
 * Cualquier proceso (una sesión de Claude incluida) puede editar el archivo
 * directamente; el panel de la oficina lo relee al abrirse y cada pocos segundos.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR } from './constants.js';

export interface NoteItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  /** Quién la agregó (opcional; "yo" desde la UI, nombre del agente desde fuera). */
  by?: string;
}

export type NotesDoc = Record<string, NoteItem[]>;

const NOTES_FILE_NAME = 'notes.json';

export function notesFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, NOTES_FILE_NAME);
}

function sanitizeItem(raw: unknown): NoteItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (!text) return null;
  const id = typeof r.id === 'string' && r.id ? r.id : `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = typeof r.createdAt === 'number' ? r.createdAt : Date.now();
  const by = typeof r.by === 'string' && r.by ? r.by : undefined;
  return { id, text: text.slice(0, 500), done: r.done === true, createdAt, ...(by ? { by } : {}) };
}

export function sanitizeNotesDoc(raw: unknown): NotesDoc {
  const out: NotesDoc = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [area, items] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(items)) continue;
    const clean = items.map(sanitizeItem).filter((x): x is NoteItem => x !== null);
    out[area] = clean.slice(0, 500);
  }
  return out;
}

export function readNotes(): NotesDoc {
  try {
    const text = fs.readFileSync(notesFilePath(), 'utf8');
    return sanitizeNotesDoc(JSON.parse(text));
  } catch {
    return {};
  }
}

export function writeNotes(doc: NotesDoc): boolean {
  try {
    const file = notesFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 1));
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    console.error('[Pixel Agents] No se pudo guardar notes.json:', err);
    return false;
  }
}
