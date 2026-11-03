import { useCallback, useEffect, useMemo, useState } from 'react';

import { authHeaders } from './api.js';
import { ArrowLeft, Chevron, fileColor, FileIcon } from './fileIcons.js';
import { useT } from '../../i18n/index.js';
import { lineDiff } from './lineDiff.js';

interface ChangedFile {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | '?' | 'C' | 'U';
  staged: boolean;
  from?: string;
}
interface RepoChanges {
  dir: string;
  root: string;
  branch: string | null;
  files: ChangedFile[];
}
/** Un proyecto del agente: sus cambios o el motivo por el que no se pudieron leer. */
type ProjectChanges = { name: string } & (RepoChanges | { error: string });
interface FileVersions {
  path: string;
  head: string | null;
  work: string | null;
  binary: boolean;
  tooLarge: boolean;
}

const POLL_MS = 5000;

const STATUS_COLOR: Record<ChangedFile['status'], string> = {
  M: 'text-status-permission',
  A: 'text-status-success',
  '?': 'text-status-success',
  D: 'text-status-error',
  R: 'text-accent-bright',
  C: 'text-accent-bright',
  U: 'text-status-error',
};

async function fetchAgentChanges(agent: string): Promise<ProjectChanges[]> {
  const res = await fetch(`./api/agents/${encodeURIComponent(agent)}/changes`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`GET /api/agents/${agent}/changes ${res.status}`);
  return (await res.json()) as ProjectChanges[];
}

async function fetchFile(agent: string, root: string, file: string): Promise<FileVersions> {
  const res = await fetch(
    `./api/agents/${encodeURIComponent(agent)}/file?root=${encodeURIComponent(root)}&file=${encodeURIComponent(file)}`,
    { cache: 'no-store', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`GET file ${res.status}`);
  return (await res.json()) as FileVersions;
}

// ── Árbol de carpetas ─────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  file?: ChangedFile;
}

function buildTree(files: ChangedFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map() };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      let child = node.children.get(parts[i]);
      if (!child) {
        child = { name: parts[i], path: acc, children: new Map() };
        node.children.set(parts[i], child);
      }
      node = child;
    }
    node.file = f;
  }
  // Colapsa carpetas con un solo hijo carpeta (a/b/c → "a/b/c"), como Cursor.
  const collapse = (n: TreeNode): TreeNode => {
    for (const [k, c] of n.children) {
      let cur = c;
      while (!cur.file && cur.children.size === 1) {
        const only = [...cur.children.values()][0];
        if (only.file) break;
        cur = { ...only, name: `${cur.name}/${only.name}` };
      }
      n.children.set(k, collapse(cur));
    }
    return n;
  };
  return collapse(root);
}

/** Indentación del árbol (como el explorador de VS Code). */
const INDENT_BASE = 12;
const INDENT = 16;
const GUIDE_COLOR = 'rgba(255,255,255,0.12)';

/** Líneas guía verticales, una por nivel de profundidad por encima de la fila. */
function Guides({ depth }: { depth: number }) {
  if (depth <= 0) return null;
  return (
    <>
      {Array.from({ length: depth }, (_, d) => (
        <span
          key={d}
          className="absolute top-0 bottom-0 w-px pointer-events-none"
          style={{ left: INDENT_BASE + d * INDENT + 6, background: GUIDE_COLOR }}
        />
      ))}
    </>
  );
}

function countFiles(n: TreeNode): number {
  if (n.file) return 1;
  let c = 0;
  for (const ch of n.children.values()) c += countFiles(ch);
  return c;
}

function TreeView({
  node,
  depth,
  selected,
  onOpen,
  collapsed,
  toggle,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onOpen: (f: ChangedFile) => void;
  collapsed: Set<string>;
  toggle: (p: string) => void;
}) {
  const entries = [...node.children.values()].sort((a, b) => {
    const af = a.file ? 1 : 0;
    const bf = b.file ? 1 : 0;
    if (af !== bf) return af - bf; // carpetas primero
    return a.name.localeCompare(b.name);
  });
  return (
    <>
      {entries.map((n) =>
        n.file ? (
          <button
            key={n.path}
            className={`relative w-full text-left flex items-center gap-6 h-[22px] pr-8 hover:bg-btn-hover ${
              selected === n.path ? 'bg-active-bg' : ''
            }`}
            style={{ paddingLeft: INDENT_BASE + depth * INDENT }}
            onClick={() => onOpen(n.file!)}
            title={n.path}
          >
            <Guides depth={depth} />
            <span className="w-12 shrink-0" />
            <FileIcon name={n.name} />
            <span className="truncate" style={{ color: fileColor(n.name) }}>
              {n.name}
            </span>
            <span className={`ml-auto shrink-0 w-14 text-right font-semibold ${STATUS_COLOR[n.file.status]}`}>
              {n.file.status === '?' ? 'U' : n.file.status}
            </span>
          </button>
        ) : (
          <div key={n.path}>
            <button
              className="relative w-full text-left flex items-center gap-6 h-[22px] pr-8 text-text-muted hover:bg-btn-hover"
              style={{ paddingLeft: INDENT_BASE + depth * INDENT }}
              onClick={() => toggle(n.path)}
            >
              <Guides depth={depth} />
              <span className="w-12 shrink-0 flex items-center justify-center">
                <Chevron open={!collapsed.has(n.path)} />
              </span>
              <FileIcon name={n.name} isDir open={!collapsed.has(n.path)} />
              <span className="truncate text-text">{n.name}</span>
              <span className="ml-auto opacity-60 text-[12px]">{countFiles(n)}</span>
            </button>
            {!collapsed.has(n.path) && (
              <TreeView
                node={n}
                depth={depth + 1}
                selected={selected}
                onOpen={onOpen}
                collapsed={collapsed}
                toggle={toggle}
              />
            )}
          </div>
        ),
      )}
    </>
  );
}

// ── Visor de archivo con diff ─────────────────────────────────

function FileView({
  agent,
  project,
  root,
  file,
  onBack,
}: {
  agent: string;
  project: string;
  root: string;
  file: ChangedFile;
  onBack: () => void;
}) {
  const { t } = useT();
  const [data, setData] = useState<FileVersions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetchFile(agent, root, file.path)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [agent, root, file.path]);

  const ops = useMemo(() => {
    if (!data) return [];
    return lineDiff(data.head ?? '', data.work ?? '');
  }, [data]);

  const stats = useMemo(() => {
    let add = 0;
    let del = 0;
    for (const o of ops) {
      if (o.kind === 'add') add++;
      else if (o.kind === 'del') del++;
    }
    return { add, del };
  }, [ops]);

  // "Solo cambios": bloques cambiados con 3 líneas de contexto.
  const visible = useMemo((): Array<{ o: (typeof ops)[number]; i: number; gap?: boolean }> => {
    if (!onlyChanges) return ops.map((o, i) => ({ o, i }));
    const keep = new Set<number>();
    ops.forEach((o, i) => {
      if (o.kind !== 'same') for (let j = i - 3; j <= i + 3; j++) keep.add(j);
    });
    const out: Array<{ o: (typeof ops)[number]; i: number; gap?: boolean }> = [];
    let last = -1;
    ops.forEach((o, i) => {
      if (!keep.has(i)) return;
      // Una sola fila por línea; `gap` marca que antes hubo líneas omitidas.
      out.push({ o, i, gap: last !== -1 && i !== last + 1 });
      last = i;
    });
    return out;
  }, [ops, onlyChanges]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-8 px-10 py-6 border-b-2 border-border">
        <button
          className="flex items-center gap-4 text-text-muted hover:text-text shrink-0"
          onClick={onBack}
          title={t('changes.backTree')}
        >
          <ArrowLeft />
          <span>{t('changes.title')}</span>
        </button>
        <FileIcon name={file.path} />
        <span className="truncate text-text flex-1 ide-code" title={`${project}/${file.path}`}>
          <span className="text-text-muted">{project}/</span>
          {file.path}
        </span>
        <span className="text-status-success shrink-0">+{stats.add}</span>
        <span className="text-status-error shrink-0">−{stats.del}</span>
        <button
          className={`px-8 py-2 border-2 shrink-0 ${onlyChanges ? 'border-accent text-text' : 'border-border text-text-muted hover:text-text'}`}
          onClick={() => setOnlyChanges((v) => !v)}
        >
          {onlyChanges ? t('changes.all') : t('changes.only')}
        </button>
      </div>
      {error && <div className="px-10 py-6 text-status-error">{error}</div>}
      {!data && !error && <div className="px-10 py-6 text-text-muted">{t('common.loading')}</div>}
      {data?.binary && <div className="px-10 py-6 text-text-muted">{t('changes.binary')}</div>}
      {data?.tooLarge && <div className="px-10 py-6 text-text-muted">{t('changes.tooLarge')}</div>}
      {data && !data.binary && !data.tooLarge && (
        <pre className="ide-code flex-1 min-h-0 overflow-auto m-0 py-4">
          {visible.map(({ o, i, gap }) => (
            <div key={i}>
              {gap && <div className="text-text-muted bg-bg-dark px-10 select-none">···</div>}
              <div
                className={`flex ${
                  o.kind === 'add'
                    ? 'bg-[rgba(70,200,110,0.22)]'
                    : o.kind === 'del'
                      ? 'bg-[rgba(220,70,80,0.22)]'
                      : ''
                }`}
              >
                <span className="w-44 shrink-0 text-right pr-6 text-text-muted select-none opacity-60">
                  {o.oldNo ?? ''}
                </span>
                <span className="w-44 shrink-0 text-right pr-8 text-text-muted select-none opacity-60">
                  {o.newNo ?? ''}
                </span>
                <span
                  className={`w-14 shrink-0 select-none ${
                    o.kind === 'add' ? 'text-status-success' : o.kind === 'del' ? 'text-status-error' : 'text-transparent'
                  }`}
                >
                  {o.kind === 'add' ? '+' : o.kind === 'del' ? '−' : ' '}
                </span>
                <span className={`whitespace-pre ${o.kind === 'del' ? 'opacity-80' : 'text-text'}`}>{o.text}</span>
              </div>
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

// ── Panel de cambios del agente ───────────────────────────────

/** Cambios sin commit de todos los proyectos del agente, uno por sección. */
/** `onOpenFile` avisa al panel cuando se abre/cierra un archivo (para ensancharse). */
export function ChangesPanel({ agent, onOpenFile }: { agent: string; onOpenFile?: (open: boolean) => void }) {
  const { t } = useT();
  const [projects, setProjects] = useState<ProjectChanges[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ project: string; root: string; file: ChangedFile } | null>(null);
  useEffect(() => {
    onOpenFile?.(open !== null);
    return () => onOpenFile?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open !== null]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    try {
      setProjects(await fetchAgentChanges(agent));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [agent]);

  useEffect(() => {
    setProjects(null);
    setOpen(null);
    void reload();
    const t = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(t);
  }, [reload]);

  const toggle = useCallback((p: string) => {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  }, []);

  if (open) {
    return (
      <FileView agent={agent} project={open.project} root={open.root} file={open.file} onBack={() => setOpen(null)} />
    );
  }

  if (error) return <div className="px-10 py-6 text-status-error">{error}</div>;
  if (!projects) return <div className="px-10 py-6 text-text-muted">{t('common.loading')}</div>;
  if (projects.length === 0) {
    return (
      <div className="px-10 py-6 text-text-muted">
        {t('changes.noRepos')}
      </div>
    );
  }

  const total = projects.reduce((n, p) => n + ('files' in p ? p.files.length : 0), 0);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-8">
      <div className="px-10 py-6 t-sub flex items-center">
        <span>{t('changes.title')}</span>
        <span className="ml-auto">{total}</span>
      </div>
      {projects.map((p) => {
        const key = `proj:${p.name}`;
        const isCollapsed = collapsed.has(key);
        return (
          <div key={p.name} className="mb-4">
            <button
              className="w-full text-left flex items-center gap-6 h-[24px] px-8 hover:bg-btn-hover"
              onClick={() => toggle(key)}
            >
              <span className="w-12 shrink-0 flex items-center justify-center text-text-muted">
                <Chevron open={!isCollapsed} />
              </span>
              <span className="font-semibold text-text truncate">{p.name}</span>
              {'branch' in p && p.branch && <span className="text-accent-bright truncate">{p.branch}</span>}
              <span className="ml-auto text-text-muted text-[12px] shrink-0">
                {'files' in p ? p.files.length : '—'}
              </span>
            </button>
            {!isCollapsed &&
              ('error' in p ? (
                <div className="px-16 py-4 text-text-muted">{p.error}</div>
              ) : p.files.length === 0 ? (
                <div className="px-16 py-4 text-text-muted">{t('changes.none')}</div>
              ) : (
                <TreeView
                  node={buildTree(p.files)}
                  depth={1}
                  selected={null}
                  onOpen={(f) => setOpen({ project: p.name, root: p.root, file: f })}
                  collapsed={collapsed}
                  toggle={toggle}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
