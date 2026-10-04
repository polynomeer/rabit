import { createHmac, timingSafeEqual } from 'node:crypto';
import { errors } from '../errors.js';

/**
 * Opaque, HMAC-signed pagination cursors bound to the caller and the query, so
 * a cursor cannot be forged or replayed into another scope (T26).
 */
export class CursorCodec {
  constructor(private readonly secret: string) {}

  encode(scope: { userId: string; query: string }, position: readonly (string | number)[]): string {
    const body = Buffer.from(
      JSON.stringify({ u: scope.userId, q: scope.query, p: position }),
    ).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  decode(
    scope: { userId: string; query: string },
    cursor: string | undefined,
  ): (string | number)[] | null {
    if (!cursor) return null;
    const [body, sig] = cursor.split('.');
    if (!body || !sig) throw errors.validation({ cursor: 'invalid' });
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw errors.validation({ cursor: 'invalid' });
    }
    const data = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
      u: string;
      q: string;
      p: (string | number)[];
    };
    if (data.u !== scope.userId || data.q !== scope.query)
      throw errors.validation({ cursor: 'invalid' });
    return data.p;
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}
