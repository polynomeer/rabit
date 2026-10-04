/** Thin client for the Rabit API (docs/05-api/openapi.yaml). */

export const API_BASE =
  (import.meta.env['VITE_API_BASE'] as string | undefined) ?? 'http://localhost:8080';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let token: string | null = sessionStorage.getItem('rabit.token');

export function setToken(t: string | null): void {
  token = t;
  if (t) sessionStorage.setItem('rabit.token', t);
  else sessionStorage.removeItem('rabit.token');
}

export function hasToken(): boolean {
  return token !== null;
}

// T is the caller's expected response shape (validated server-side by the contract).
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ data: T; etag: string | null }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return { data: undefined as T, etag: null };
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? `Request failed (${res.status})`,
    );
  }
  return { data: json as T, etag: res.headers.get('etag') };
}

export const get = <T>(path: string) => api<T>('GET', path).then((r) => r.data);

/** Development sign-in (dev issuer, ADR-0009). Production uses the OIDC provider. */
export async function devSignIn(subject: string): Promise<void> {
  const r = await fetch(`${API_BASE}/dev/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject }),
  });
  if (!r.ok) throw new Error('Sign-in failed');
  setToken(((await r.json()) as { access_token: string }).access_token);
}

export interface Playability {
  playable: boolean;
  reason: string | null;
}
export interface LibraryItem {
  library_item_id: string;
  ref_type: 'audio_source' | 'recording' | 'release';
  ref_id: string;
  origin: string;
  title: string | null;
  subtitle: string | null;
  ownership: string;
  playability: Playability;
}
export interface PlaylistItem {
  item_id: string;
  position: number;
  ref_type: 'audio_source' | 'recording';
  ref_id: string;
  title: string | null;
  subtitle: string | null;
  ownership: string | null;
  playability: Playability;
}
export interface Playlist {
  playlist_id: string;
  title: string;
  version: number;
  item_count: number;
  items: PlaylistItem[];
  items_next_cursor: string | null;
}
export interface EntitySummary {
  entity_id: string;
  entity_type: 'artist' | 'person' | 'label' | 'release' | 'recording';
  name: string;
  subtitle: string | null;
}
export interface Evidence {
  basis: 'verified_fact' | 'declared' | 'ml_inferred';
  verification_state: string;
  source: string;
  confidence: number | null;
  license_status: string | null;
  explanation: string;
}
export interface Connection {
  entity: EntitySummary;
  axis: string;
  via: { relation_id: string | null; credit_id: string | null };
  evidence: Evidence;
  popularity_tier: string;
  playability: Playability | null;
}
export interface DigSession {
  dig_session_id: string;
  current_seq: number;
  empty_state: { reason: string; message: string } | null;
  trail: {
    seq: number;
    parent_seq: number | null;
    entity: EntitySummary;
    via_axis: string | null;
    evidence: Evidence | null;
  }[];
  summary: {
    nodes: number;
    distinct_artists: number;
    axes_used: string[];
    played: number;
    saved: number;
  };
}

export const REASON_TEXT: Record<string, string> = {
  not_ready: '처리 중',
  rights_unavailable: '이 지역에서 재생할 수 없음',
  subscription_required: 'Listen 구독 필요',
  purchase_available: '구매 가능',
  no_audio: '음원 없음',
  deleted: '삭제됨',
  not_found: '찾을 수 없음',
  capability_denied: '사용할 수 없음',
};

export const OWNERSHIP_TEXT: Record<string, string> = {
  private: 'Private',
  audio_log: 'Audio Log',
  streaming: 'Streaming',
  purchased: 'Purchased',
  granted: 'Granted',
};

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
