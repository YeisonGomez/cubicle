import { KeyRound } from 'lucide-react';
import { useState } from 'react';

import { useT } from '../i18n/index.js';
import { isBrowserRuntime } from '../runtime.js';
import { serverToken } from '../transport/serverToken.js';

/**
 * Sin token (URL sin ?token= y nada recordado en este origen) la oficina solo se
 * puede mirar: terminal, lanzar agentes y ajustes quedan bloqueados. Este aviso lo
 * dice y deja pegar el token (o abrir con `cubicle open`); se recuerda y recarga.
 */
export function TokenBanner() {
  const { t } = useT();
  const [value, setValue] = useState('');
  if (!isBrowserRuntime || serverToken) return null;
  const save = () => {
    const v = value.trim();
    if (!v) return;
    try {
      localStorage.setItem('pixel-agents.token', v);
    } catch {
      /* sin almacenamiento: va en la URL */
    }
    const u = new URL(window.location.href);
    u.searchParams.set('token', v);
    window.location.replace(u.toString());
  };
  return (
    <div className="ide-ui absolute top-[84px] left-1/2 -translate-x-1/2 z-[60] flex items-center gap-10 px-12 py-8 bg-bg-dark border border-status-permission rounded-md shadow-pixel max-w-[95%]">
      <KeyRound size={18} className="text-status-permission shrink-0" />
      <span className="text-[13px] text-text">{t('token.missing')}</span>
      <input
        className="bg-bg rounded px-8 py-4 text-[13px] text-text outline-none w-[220px] placeholder:text-text-muted"
        placeholder={t('token.paste')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      <button className="text-accent-bright hover:underline underline-offset-4 text-[13px] disabled:opacity-40" disabled={!value.trim()} onClick={save}>
        {t('token.use')}
      </button>
    </div>
  );
}
