import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Db } from '../../platform/db/db.js';

/**
 * Feature flags (ADR-0028): declared here with a default, overridden per environment
 * by operators, evaluated on the server. A flag may hide or switch off a feature; it
 * never wraps authorization, rights, entitlement, validation, rate limits or audit.
 */
export interface FlagDefinition {
  description: string;
  default: boolean;
  /** Clients may read it through `GET /v1/features`. */
  client: boolean;
}

export type FlagKey = 'client_diagnostics';

export const FLAGS: Record<FlagKey, FlagDefinition> = {
  client_diagnostics: {
    description: 'Clients send error, crash and web vitals reports (ADR-0027). Kill switch.',
    default: true,
    client: true,
  },
};

export const isFlagKey = (key: string): key is FlagKey => Object.hasOwn(FLAGS, key);

interface Override {
  enabled: boolean;
  rollout_percent: number;
  updated_by: string;
  updated_at: Date;
}

/** Flags change rarely and a kill switch may take this long to reach every process. */
export const CACHE_MS = 15_000;
let cache: { at: number; overrides: Map<string, Override> } | null = null;

export function clearFlagCache(): void {
  cache = null;
}

async function overrides(db: Db): Promise<Map<string, Override>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.overrides;
  const rows = await db.selectFrom('feature_flag').selectAll().execute();
  cache = { at: Date.now(), overrides: new Map(rows.map((r) => [r.key, r])) };
  return cache.overrides;
}

/** 0–99, stable for a user and a flag, independent across flags. */
export function bucket(key: string, userId: string): number {
  return createHash('sha256').update(`${key}:${userId}`).digest().readUInt32BE(0) % 100;
}

function on(key: FlagKey, o: Override | undefined, userId: string): boolean {
  if (!o) return FLAGS[key].default;
  return o.enabled && bucket(key, userId) < o.rollout_percent;
}

export async function isEnabled(db: Db, key: FlagKey, userId: string): Promise<boolean> {
  return on(key, (await overrides(db)).get(key), userId);
}

/** The client-readable flags, evaluated for one user. */
export async function clientFlags(db: Db, userId: string): Promise<Record<string, boolean>> {
  const o = await overrides(db);
  const out: Record<string, boolean> = {};
  for (const key of Object.keys(FLAGS) as FlagKey[]) {
    if (FLAGS[key].client) out[key] = on(key, o.get(key), userId);
  }
  return out;
}

export async function flagList(db: Db) {
  const rows = await db.selectFrom('feature_flag').selectAll().execute();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (Object.keys(FLAGS) as FlagKey[]).map((key) => {
    const o = byKey.get(key);
    return {
      key,
      description: FLAGS[key].description,
      default: FLAGS[key].default,
      client: FLAGS[key].client,
      override: o
        ? {
            enabled: o.enabled,
            rollout_percent: o.rollout_percent,
            updated_by: o.updated_by,
            updated_at: o.updated_at.toISOString(),
          }
        : null,
    };
  });
}

/** Sets or (null) clears an override. */
export async function setOverride(
  db: Db,
  key: FlagKey,
  value: { enabled: boolean; rollout_percent: number } | null,
  operatorId: string,
): Promise<void> {
  if (value === null) {
    await db.deleteFrom('feature_flag').where('key', '=', key).execute();
  } else {
    await db
      .insertInto('feature_flag')
      .values({ key, ...value, updated_by: operatorId })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({ ...value, updated_by: operatorId, updated_at: sql`now()` }),
      )
      .execute();
  }
  clearFlagCache();
}
