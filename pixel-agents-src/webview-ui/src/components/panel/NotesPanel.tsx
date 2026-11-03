import { useCallback, useEffect, useRef, useState } from 'react';

import { serverToken } from '../../transport/serverToken.js';
import { locale, useT } from '../../i18n/index.js';
import { Button } from '../ui/Button.js';

/** Una nota del tablero de una sala. Espejo de server/src/notesPersistence.ts. */
export interface NoteItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  by?: string;
}
export type NotesDoc = Record<string, NoteItem[]>;

const POLL_MS = 3000;

async function fetchNotes(): Promise<NotesDoc> {
  const res = await fetch('./api/notes', { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/notes ${res.status}`);
  return (await res.json()) as NotesDoc;
}

async function putNotes(doc: NotesDoc): Promise<NotesDoc> {
  const res = await fetch('./api/notes', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(serverToken ? { Authorization: `Bearer ${serverToken}` } : {}),
    },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw new Error(`PUT /api/notes ${res.status}`);
  return (await res.json()) as NotesDoc;
}

/** Checklist de notas de una sala (vive en ~/.pixel-agents/notes.json en el servidor). */
export function NotesPanel({ area }: { area: string }) {
  const { t, tn } = useT();
  const [doc, setDoc] = useState<NotesDoc>({});
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setDoc(await fetchNotes());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
    const t = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(t);
  }, [area, reload]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [area]);

  const save = useCallback(
    async (next: NotesDoc) => {
      setDoc(next);
      try {
        setDoc(await putNotes(next));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        void reload();
      }
    },
    [reload],
  );

  const items = doc[area] ?? [];
  const pending = items.filter((i) => !i.done).length;

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    const item: NoteItem = {
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      done: false,
      createdAt: Date.now(),
      by: t('notes.me'),
    };
    setDraft('');
    void save({ ...doc, [area]: [...items, item] });
  };
  const toggle = (id: string) =>
    void save({ ...doc, [area]: items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)) });
  const remove = (id: string) => void save({ ...doc, [area]: items.filter((i) => i.id !== id) });
  const clearDone = () => void save({ ...doc, [area]: items.filter((i) => !i.done) });

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <form
        className="flex gap-4 px-12 py-8 border-b-2 border-border"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('notes.placeholder')}
          className="flex-1 min-w-0 py-4 px-6 bg-bg-dark border-2 border-border rounded-none text-text"
          maxLength={500}
        />
        <Button variant="accent" size="sm" type="submit" disabled={!draft.trim()}>
          +
        </Button>
      </form>

      <div className="flex items-center justify-between px-12 py-4 text-text-muted">
        <span>
          {tn('notes.pending', pending)} · {tn('notes.done', items.length - pending)}
        </span>
        <span className="flex items-center gap-14">
          <button className="text-accent-bright hover:underline underline-offset-4" onClick={() => setShowDone((v) => !v)}>
            {showDone ? t('notes.hideDone') : t('notes.showDone')}
          </button>
          {items.some((i) => i.done) && (
            <button className="text-status-error hover:underline underline-offset-4" onClick={clearDone}>
              {t('notes.clearDone')}
            </button>
          )}
        </span>
      </div>

      <ul className="flex-1 min-h-0 overflow-y-auto px-8 pb-8 flex flex-col gap-3">
        {items.length === 0 && (
          <li className="text-text-muted px-4 py-8">{t('notes.empty')}</li>
        )}
        {items
          .filter((i) => showDone || !i.done)
          .map((i) => (
            <li
              key={i.id}
              className={`group flex items-start gap-6 px-4 py-4 border-2 border-transparent hover:border-border ${i.done ? 'opacity-60' : ''}`}
            >
              <button
                className={`mt-2 size-16 shrink-0 border-2 border-border flex items-center justify-center ${i.done ? 'bg-status-success text-bg' : 'bg-bg-dark'}`}
                onClick={() => toggle(i.id)}
                title={i.done ? t('notes.markPending') : t('notes.markDone')}
              >
                {i.done ? '✓' : ''}
              </button>
              <div className="flex-1 min-w-0">
                <div className={`text-text break-words ${i.done ? 'line-through' : ''}`}>{i.text}</div>
                <div className="text-text-muted">
                  {new Date(i.createdAt).toLocaleString(locale(), {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {i.by ? ` · ${i.by}` : ''}
                </div>
              </div>
              <button
                className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-danger px-2"
                onClick={() => remove(i.id)}
                title={t('notes.delete')}
              >
                ×
              </button>
            </li>
          ))}
      </ul>

      {error && <div className="px-12 py-4 text-status-error border-t-2 border-border">{error}</div>}
    </div>
  );
}
