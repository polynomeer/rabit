import { z } from 'zod';
import { errors } from '../errors.js';
import { isIdOf, type Id, type IdKind } from '../ids.js';

/** Parses untrusted input; on failure throws 400 with field paths (never values). */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const res = schema.safeParse(data ?? {});
  if (!res.success) {
    throw errors.validation({
      issues: res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return res.data;
}

/** Zod schema for a prefixed id of a given kind, branded. */
export function idOf<K extends IdKind>(kind: K) {
  return z.custom<Id<K>>((v) => isIdOf(kind, v), { message: `must be a ${kind} id` });
}

export const isoTimestamp = z.iso.datetime({ offset: true });

export const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

/** Reject unknown fields everywhere (api-guidelines §1). */
export const strictObject = z.strictObject;

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

export function idempotencyKeyFrom(
  headers: Record<string, string | string[] | undefined>,
  required: boolean,
): string | null {
  const raw = headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === '') {
    if (required)
      throw errors.validation({ header: 'Idempotency-Key' }, 'Idempotency-Key header is required.');
    return null;
  }
  if (!IDEMPOTENCY_KEY.test(value)) {
    throw errors.validation({ header: 'Idempotency-Key' }, 'Idempotency-Key is malformed.');
  }
  return value;
}

/** Parses `If-Match: "<version>"`. Missing → 428 (api-guidelines §6). */
export function requireIfMatch(headers: Record<string, string | string[] | undefined>): number {
  const raw = headers['if-match'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) throw errors.preconditionRequired();
  const m = /^(?:W\/)?"?(\d{1,9})"?$/.exec(value.trim());
  if (!m?.[1]) throw errors.preconditionFailed();
  return Number(m[1]);
}

export function etag(version: number): string {
  return `"${version}"`;
}
