/**
 * Client diagnostics (ADR-0027): uncaught errors, page loads and Core Web Vitals go
 * to the API in small batches. Signed-in only; nothing here names the listener, and
 * messages must not carry titles or other content (the server scrubs as well).
 * Reporting never disturbs the page: failures are dropped.
 */
import { onCLS, onINP, onLCP } from 'web-vitals';
import { API_BASE, bearerToken } from './api';

export const APP_VERSION = (import.meta.env['VITE_APP_VERSION'] as string | undefined) ?? 'dev';

type Kind = 'error' | 'unhandled';
interface Pending {
  kind: Kind;
  name: string;
  message: string;
  frames: string[];
  count: number;
}

/** The server takes at most this many errors per batch. */
const MAX_ERRORS = 20;
const FLUSH_MS = 60_000;

const pending = new Map<string, Pending>();
/** This page load, until a batch carries it. */
let launches = 1;
const vitals: { lcp_ms?: number; inp_ms?: number; cls?: number } = {};
let vitalsSent = false;

function framesOf(e: Error): string[] {
  return (e.stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at ') || l.includes('@'))
    .slice(0, 50)
    .map((l) => l.slice(0, 300));
}

/** Noise that is not ours: browser extensions and the benign ResizeObserver warning. */
function ignored(e: Error, frames: string[]): boolean {
  if (e.message.startsWith('ResizeObserver loop')) return true;
  return frames.length > 0 && frames.every((f) => /(chrome|moz|safari)-extension:/.test(f));
}

export function reportError(error: unknown, kind: Kind = 'error'): void {
  const e = error instanceof Error ? error : new Error(String(error));
  const frames = framesOf(e);
  if (ignored(e, frames)) return;
  const key = [kind, e.name, ...frames.slice(0, 5)].join('\n');
  const same = pending.get(key);
  if (same) {
    same.count = Math.min(same.count + 1, 1000);
    return;
  }
  if (pending.size >= MAX_ERRORS) return;
  pending.set(key, {
    kind,
    name: e.name.slice(0, 120),
    message: e.message.slice(0, 500),
    frames,
    count: 1,
  });
}

/** Sends what is pending; `keepalive` lets it outlive a closing page. */
function flush(keepalive = false): void {
  const token = bearerToken();
  if (!token) return;
  const errors = [...pending.values()];
  const sendVitals = !vitalsSent && Object.keys(vitals).length > 0 && keepalive;
  if (errors.length === 0 && launches === 0 && !sendVitals) return;
  const body = {
    platform: 'web',
    app_version: APP_VERSION,
    launches,
    errors,
    ...(sendVitals ? { vitals: { ...vitals } } : {}),
  };
  pending.clear();
  launches = 0;
  if (sendVitals) vitalsSent = true;
  void fetch(`${API_BASE}/v1/client-diagnostics`, {
    method: 'POST',
    keepalive,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

/** Starts collecting; call once before the first render. */
export function startDiagnostics(): void {
  window.addEventListener('error', (ev) => {
    reportError(ev.error ?? ev.message, 'unhandled');
  });
  window.addEventListener('unhandledrejection', (ev) => {
    reportError(ev.reason, 'unhandled');
  });
  // Final values arrive when the page is hidden; the batch goes out then.
  onLCP((m) => (vitals.lcp_ms = Math.round(m.value)));
  onINP((m) => (vitals.inp_ms = Math.round(m.value)));
  onCLS((m) => (vitals.cls = Math.round(m.value * 1000) / 1000));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  setInterval(() => {
    flush();
  }, FLUSH_MS);
}
