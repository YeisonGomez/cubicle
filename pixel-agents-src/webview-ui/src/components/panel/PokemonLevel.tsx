import { useT } from '../../i18n/index.js';
import { useSkin } from '../../skin.js';

/** Tema Pokémon: forma, nivel y experiencia del agente, en la cabecera del panel. */
export function PokemonLevel({ name }: { name: string }) {
  const { t } = useT();
  const skin = useSkin();
  const a = skin.theme === 'pokemon' ? skin.agents[name] : undefined;
  if (!a || a.level === undefined) return null; // servidor aún sin reiniciar
  const span = a.nextXp - a.levelXp;
  const max = span <= 0;
  const pct = max ? 100 : Math.round(((a.xp - a.levelXp) / span) * 100);
  const hint = a.evolvesAt ? t('pokemon.evolvesAt', { level: a.evolvesAt }) : t('pokemon.noEvolve');
  return (
    <div className="flex items-center gap-8 mt-3 text-[12px]" title={hint}>
      <span className="text-text truncate">{a.name}</span>
      <span className="text-accent-bright font-semibold shrink-0">{t('pokemon.level', { level: a.level })}</span>
      <span className="h-6 w-[96px] shrink-0 bg-bg-dark overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('pokemon.xp')}>
        <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-text-muted shrink-0">{max ? t('pokemon.max') : `${a.xp - a.levelXp}/${span} ${t('pokemon.xp')}`}</span>
    </div>
  );
}
