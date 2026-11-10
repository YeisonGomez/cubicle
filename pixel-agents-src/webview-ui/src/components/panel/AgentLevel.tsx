import { useT } from '../../i18n/index.js';
import { RANK_KEYS, useSkin } from '../../skin.js';

const XP_SEGMENTS = 10;

/** Cabecera del panel: forma del Pokémon o rango, nivel y barra de experiencia por tramos. */
export function AgentLevel({ name }: { name: string }) {
  const { t } = useT();
  const skin = useSkin();
  const pokemon = skin.theme === 'pokemon' ? skin.agents[name] : undefined;
  const rank = skin.theme === 'classic' ? skin.ranks?.[name] : undefined;
  const a = pokemon ?? rank;
  if (!a || a.level === undefined) return null; // servidor aún sin reiniciar
  const span = a.nextXp - a.levelXp;
  const max = span <= 0;
  const pct = max ? 100 : Math.round(((a.xp - a.levelXp) / span) * 100);
  const xpText = max ? t('pokemon.max') : `${a.xp - a.levelXp}/${span} ${t('pokemon.xp')}`;
  const next = pokemon
    ? pokemon.evolvesAt
      ? t('pokemon.evolvesAt', { level: pokemon.evolvesAt })
      : t('pokemon.noEvolve')
    : rank?.nextRankAt
      ? t('rank.next', { level: rank.nextRankAt })
      : t('rank.top');
  // Cuánto de la barra entera llena cada tramo: los anteriores completos, el actual en parte.
  const filled = (pct / 100) * XP_SEGMENTS;
  const left = a.toNext?.prompts
    ? t(pokemon ? 'pokemon.toEvolve' : 'rank.toNext', { n: a.toNext!.prompts.toLocaleString(), d: a.toNext!.days })
    : null;
  return (
    <span className="flex items-center gap-6 shrink-0 text-[12px]" title={`${xpText} · ${next}`}>
      <span className="text-text">{pokemon ? pokemon.name : t(RANK_KEYS[rank?.rank ?? 0])}</span>
      <span className="text-text font-semibold">{t('pokemon.level', { level: a.level })}</span>
      <span className="relative flex">
        <span className="flex gap-[2px]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('pokemon.xp')}>
          {Array.from({ length: XP_SEGMENTS }, (_, i) => (
            <span key={i} className="block h-[6px] w-[9px] bg-border overflow-hidden">
              <span className="block h-full bg-xp" style={{ width: `${Math.max(0, Math.min(1, filled - i)) * 100}%` }} />
            </span>
          ))}
        </span>
        {/* Debajo, fuera del flujo: así la barra sigue centrada con los botones de la cabecera. */}
        {left && <span className="absolute top-full left-0 mt-[2px] whitespace-nowrap text-[10px] leading-none text-text-muted">{left}</span>}
      </span>
    </span>
  );
}
