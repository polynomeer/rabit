/**
 * Loudness normalisation preference (ADR-0008 amendment 2026-10-20): on by default,
 * kept per device. The server sends each track's gain; the browser can only lower
 * the volume (`HTMLMediaElement.volume` ≤ 1), so quiet tracks play as mastered.
 */
const KEY = 'rabit.normalize';
const EVENT = 'rabit:normalize';

export function normalizeEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setNormalizeEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, 'off');
  } catch {
    // Storage blocked (private mode): the choice still applies until reload.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Calls `fn` whenever the preference changes; returns the unsubscribe function. */
export function onNormalizeChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => {
    window.removeEventListener(EVENT, fn);
  };
}

/** Element volume for a track gain: attenuation only, full volume when off or unknown. */
export function volumeFor(gainDb: number | null | undefined, enabled: boolean): number {
  if (!enabled || gainDb === null || gainDb === undefined) return 1;
  return Math.min(1, 10 ** (gainDb / 20));
}
