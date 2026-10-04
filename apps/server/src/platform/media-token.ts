import { createHmac, timingSafeEqual } from 'node:crypto';

/** Claims carried by a media token (ADR-0008). */
export interface MediaTokenClaims {
  /** Playback session id; the gateway re-checks its state on every request. */
  sessionId: string;
  /** Media namespace: private or catalog bucket. */
  namespace: 'private' | 'catalog';
  /** Storage prefix of the source's HLS package. */
  prefix: string;
  /** Expiry, unix seconds. */
  exp: number;
}

export class MediaTokenCodec {
  constructor(private readonly secret: string) {}

  sign(claims: MediaTokenClaims): string {
    const body = Buffer.from(
      JSON.stringify({
        s: claims.sessionId,
        n: claims.namespace === 'catalog' ? 'c' : 'p',
        k: claims.prefix,
        e: claims.exp,
      }),
    ).toString('base64url');
    return `v1.${body}.${this.mac(body)}`;
  }

  /** Returns claims only for a well-formed, authentic, unexpired token. */
  verify(token: string, nowSeconds = Math.floor(Date.now() / 1000)): MediaTokenClaims | null {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const [, body, sig] = parts as [string, string, string];
    const expected = Buffer.from(this.mac(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    let raw: { s?: unknown; n?: unknown; k?: unknown; e?: unknown };
    try {
      raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as typeof raw;
    } catch {
      return null;
    }
    if (
      typeof raw.s !== 'string' ||
      (raw.n !== 'p' && raw.n !== 'c') ||
      typeof raw.k !== 'string' ||
      typeof raw.e !== 'number'
    ) {
      return null;
    }
    if (raw.e <= nowSeconds) return null;
    return {
      sessionId: raw.s,
      namespace: raw.n === 'c' ? 'catalog' : 'private',
      prefix: raw.k,
      exp: raw.e,
    };
  }

  private mac(body: string): string {
    return createHmac('sha256', this.secret).update(`media:${body}`).digest('base64url');
  }
}
