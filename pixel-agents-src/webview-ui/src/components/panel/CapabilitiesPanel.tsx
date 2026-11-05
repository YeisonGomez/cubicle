import { useEffect, useState } from 'react';

import { BrandIcon } from '../BrandIcon.js';
import { locale, useT } from '../../i18n/index.js';
import { apiHeaders } from '../FolderPicker.js';

interface Capabilities {
  recursos: Array<{ nombre: string; tipo: string; detalle: string; agentes: string[] }>;
  mcp: Array<{ name: string; count: number; declarado: boolean; agentes: string[] }>;
  apps: Array<{ name: string; agentes: string[] }>;
  skills: Array<{ nombre: string; descripcion: string; detalle?: string; count: number; declarada: boolean; agentes: string[] }>;
  sinDeclarar: string[];
  actualizado: number | null;
}

/** Grupos de recursos externos que se muestran (lo local, "archivos", no es externo). */
const GRUPOS: Array<{ key: string; tipos: string[]; color: string }> = [
  { key: 'caps.group.db', tipos: ['base de datos'], color: '#4fc1ff' },
  { key: 'caps.group.api', tipos: ['api', 'servicio', 'otro'], color: '#c586c0' },
  { key: 'caps.group.cloud', tipos: ['nube'], color: '#ffb86c' },
  { key: 'caps.group.mail', tipos: ['correo'], color: '#f28b82' },
];

function fmtDate(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' });
}

function Chip({ label, color, title, muted, icon }: { label: string; color?: string; title?: string; muted?: boolean; icon?: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-6 border-2 border-border px-8 py-3 text-[12px] leading-tight ${muted ? 'text-text-muted' : 'text-text'}`}
      title={title}
    >
      {color && <span className="inline-block w-6 h-6 shrink-0" style={{ background: color }} />}
      {icon}
      {label}
    </span>
  );
}

function Section({ title, n, children }: { title: string; n: number; children: React.ReactNode }) {
  if (n === 0) return null;
  return (
    <div>
      <div className="t-sub mb-6">
        {title} <span className="opacity-60">{n}</span>
      </div>
      {children}
    </div>
  );
}

/** Vista "Capacidades": a qué accede la sesión fuera del proyecto (bases de datos,
 *  APIs y servicios, nube, correo), MCP que usa, apps y skills resumidas. */
export function CapabilitiesPanel({ url, title, many }: { url: string; title: string; many: boolean }) {
  const { t } = useT();
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [openSkill, setOpenSkill] = useState<string | null>(null);

  // Solo para un agente: borra su declaración y relanza su terminal con la pregunta.
  const reask = async () => {
    if (!window.confirm(t('caps.reaskConfirm', { name: title }))) return;
    setAsking(true);
    try {
      const r = await fetch(url, { method: 'DELETE', headers: apiHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };

  useEffect(() => {
    let alive = true;
    setCaps(null);
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const c = (await r.json()) as Capabilities;
        if (alive) setCaps(c);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [url]);

  if (error) return <div className="px-12 py-8 text-status-error">{error}</div>;
  if (!caps) return <div className="px-12 py-8 text-text-muted">{t('caps.loading')}</div>;

  const who = (agentes: string[]) => (many ? agentes.join(', ') : undefined);
  const externos = caps.recursos.filter((r) => r.tipo !== 'archivos');
  const empty = externos.length + caps.mcp.length + caps.apps.length + caps.skills.length === 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-12 py-10 flex flex-col gap-16">
      <div className="t-title">
        {t('caps.title', { name: title })}
        {caps.actualizado && <span className="t-desc">{t('caps.declared', { d: fmtDate(caps.actualizado) })}</span>}
      </div>
      {empty && <div className="text-text-muted text-[12px]">{t('caps.empty')}</div>}

      {externos.length > 0 && (
        <div className="flex flex-col gap-12">
          <div className="t-title">{t('caps.external')}</div>
          {GRUPOS.map((g) => {
            const items = externos.filter((r) => g.tipos.includes(r.tipo));
            return (
              <Section key={g.key} title={t(g.key)} n={items.length}>
                <div className="flex flex-wrap gap-4">
                  {items.map((r) => (
                    <Chip key={r.nombre} label={r.nombre} color={g.color} title={[r.detalle, who(r.agentes)].filter(Boolean).join(' · ')} />
                  ))}
                </div>
              </Section>
            );
          })}
        </div>
      )}

      <Section title={t('caps.mcp')} n={caps.mcp.length}>
        <div className="flex flex-wrap gap-4">
          {caps.mcp.map((m) => (
            <Chip
              key={m.name}
              label={m.count > 0 ? `${m.name} ×${m.count}` : m.name}
              muted={!m.declarado}
              icon={<BrandIcon name={m.name} />}
              title={[m.declarado ? t('caps.declaredBy') : t('caps.detectedIn'), who(m.agentes)].filter(Boolean).join(' · ')}
            />
          ))}
        </div>
      </Section>

      <Section title={t('caps.apps')} n={caps.apps.length}>
        <div className="flex flex-wrap gap-4">
          {caps.apps.map((a) => (
            <Chip key={a.name} label={a.name} title={who(a.agentes)} icon={<BrandIcon name={a.name} />} />
          ))}
        </div>
      </Section>

      <Section title={t('caps.skills')} n={caps.skills.length}>
        <ul className="flex flex-col border-2 border-border">
          {caps.skills.map((k) => {
            const open = openSkill === k.nombre;
            return (
              <li key={k.nombre} className="border-b border-border last:border-b-0">
                <button className="w-full flex items-center gap-8 px-10 h-[30px] text-left hover:bg-btn-hover" onClick={() => setOpenSkill(open ? null : k.nombre)} title={who(k.agentes)}>
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={`shrink-0 text-text-muted ${open ? 'rotate-90' : ''}`}>
                    <path d="M3 1.5 7 5l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className={`shrink-0 ${k.declarada ? 'text-text' : 'text-text-muted'}`}>{k.nombre}</span>
                  <span className="t-label truncate">{k.descripcion || (k.count > 0 ? t('caps.invoked', { n: k.count }) : '')}</span>
                  {k.count > 0 && <span className="ml-auto t-label shrink-0">×{k.count}</span>}
                </button>
                {open && (
                  <div className="px-28 pb-8 t-desc">
                    {k.detalle || k.descripcion || t('caps.noDetail')}
                    {many && k.agentes.length > 0 && <div className="t-label mt-4">{t('caps.agents', { list: k.agentes.join(', ') })}</div>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      {caps.sinDeclarar.length > 0 && (
        <div className="text-text-muted text-[11px]">
          {t('caps.undeclared', { list: caps.sinDeclarar.join(', ') })}
        </div>
      )}
      {!many && (
        <div>
          <button className="px-8 py-4 border-2 border-border text-text-muted hover:text-text text-[12px]" onClick={() => void reask()} disabled={asking}>
            {asking ? t('caps.asking') : t('caps.reask')}
          </button>
        </div>
      )}
    </div>
  );
}
