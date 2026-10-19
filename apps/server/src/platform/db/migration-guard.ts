import { sql, type Kysely } from 'kysely';

/**
 * Down migrations that would delete or rewrite financial records refuse to run
 * while such rows exist, unless MIGRATION_ALLOW_DATA_LOSS=true (test databases,
 * which are rebuilt on every run). A production rollback has to keep the books.
 */
export async function refuseDataLoss(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations target the raw schema
  db: Kysely<any>,
  what: string,
  existsQuery: string,
): Promise<void> {
  if (process.env['MIGRATION_ALLOW_DATA_LOSS'] === 'true') return;
  const r = await sql<{ found: boolean }>`SELECT EXISTS (${sql.raw(existsQuery)}) AS found`.execute(
    db,
  );
  if (r.rows[0]?.found) {
    throw new Error(
      `Refusing to roll back: it would delete ${what}. Set MIGRATION_ALLOW_DATA_LOSS=true only for a disposable database.`,
    );
  }
}
