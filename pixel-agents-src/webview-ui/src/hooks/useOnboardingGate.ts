import { useEffect, useState } from 'react';

import { serverToken } from '../transport/serverToken.js';

export interface OnboardingState {
  /** true = primera vez (sin proyectos); false = abierto desde Settings ("Importar sesiones"). */
  firstRun: boolean;
}

/**
 * Primera vez (sin proyectos registrados): el servidor dice si hace falta el
 * onboarding y la webview muestra el modal. También se puede abrir a mano.
 */
export function useOnboardingGate(enabled: boolean) {
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch('./api/onboarding?days=7', { headers: serverToken ? { Authorization: `Bearer ${serverToken}` } : {}, cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as { needed: boolean }) : null))
      .then((d) => alive && d?.needed && setOnboarding({ firstRun: true }))
      .catch(() => {
        /* servidor viejo */
      });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return { onboarding, open: () => setOnboarding({ firstRun: false }), close: () => setOnboarding(null) };
}
