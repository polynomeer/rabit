import type { DbOrTx } from './db/db.js';

/**
 * One module's part of the operator support summary (R18). Sections return
 * counts, states, timestamps and ids only — never private content such as
 * titles, notes, filenames, audio, storage keys, URLs, devices or identity
 * provider subjects (OPS-007, T30). Each module decides what is safe to show.
 */
export interface SupportSection {
  name: string;
  read(
    db: DbOrTx,
    account: { userId: string; workspaceIds: readonly string[] },
  ): Promise<Record<string, unknown>>;
}

/** `[{ k, n }]` rows → `{ k: n }`, for grouped counts. */
export function countsBy(rows: readonly { k: string | null; n: number }[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.k ?? 'none', r.n]));
}
