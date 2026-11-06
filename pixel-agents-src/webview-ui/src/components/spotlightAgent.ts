import type { MutableRefObject } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';

/** Centra la cámara en el personaje de un agente. Devuelve cómo dejar la vista donde estaba. */
export function spotlightAgent(os: OfficeState, panRef: MutableRefObject<{ x: number; y: number }>, agent: string): () => void {
  const ch = [...os.characters.values()].find((c) => c.directoryName === agent && !c.isSubagent);
  const prevFollow = os.cameraFollowId;
  const prevPan = { ...panRef.current };
  if (ch) os.cameraFollowId = ch.id;
  return () => {
    os.cameraFollowId = prevFollow;
    panRef.current = prevPan;
  };
}
