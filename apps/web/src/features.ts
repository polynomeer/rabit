/**
 * Feature flags for the signed-in user (ADR-0028), read after sign-in and on each page
 * load. Until they arrive, or when the read fails, every flag has its built-in default.
 */
import { get } from './api';

let flags: Record<string, boolean> = {};

export async function loadFeatures(): Promise<void> {
  try {
    flags = (await get<{ features: Record<string, boolean> }>('/v1/features')).features;
  } catch {
    // Keep what we had; defaults apply to anything never read.
  }
}

export function featureOn(key: string, fallback: boolean): boolean {
  return flags[key] ?? fallback;
}

export function clearFeatures(): void {
  flags = {};
}
