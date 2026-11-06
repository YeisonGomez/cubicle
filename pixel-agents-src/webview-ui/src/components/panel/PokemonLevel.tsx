import { useT } from '../../i18n/index.js';
import { useSkin } from '../../skin.js';

const XP_SEGMENTS = 10;

/** Tema Pokémon: forma, nivel y barra de experiencia por tramos, centrados con los botones de la cabecera del panel. */
export function PokemonLevel({ name }: { name: string }) {
  const { t } = useT();
  const skin = useSkin();
  const a = skin.theme === 'pokemon' ? skin.agents[name] : undefined;
  if (!a || a.level === undefined) return null; // servidor aún sin reiniciar
  const span = a.nextXp - a.levelXp;
  const max = span <= 0;
  const pct = max ? 100 : Math.round(((a.xp - a.levelXp) / span) * 100);
  const xpText = max ? t('pokemon.max') : `${a.xp - a.levelXp}/${span} ${t('pokemon.xp')}`;
  const hint = `${xpText} · ${a.evolvesAt ? t('pokemon.evolvesAt', { level: a.evolvesAt }) : t('pokemon.noEvolve')}`;
  // Cuánto de la barra entera llena cada tramo: los anteriores completos, el actual en parte.
  const filled = (pct / 100) * XP_SEGMENTS;
  return (
    <span className="flex items-center gap-6 shrink-0 text-[12px]" title={hint}>
      <span className="text-text">{a.name}</span>
      <span className="text-text font-semibold">{t('pokemon.level', { level: a.level })}</span>
      <span className="flex gap-[2px]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('pokemon.xp')}>
        {Array.from({ length: XP_SEGMENTS }, (_, i) => (
          <span key={i} className="block h-[6px] w-[9px] bg-border overflow-hidden">
            <span className="block h-full bg-xp" style={{ width: `${Math.max(0, Math.min(1, filled - i)) * 100}%` }} />
          </span>
        ))}
      </span>
    </span>
  );
}
