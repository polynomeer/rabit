import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Time Radio through the account queue (ADR-0034): a third queue mode whose
 * suggestions come from music out by a cutoff, with the cutoff and mode stored as
 * `radio_context` (required in that mode, cleared in the others). The unnamed mode
 * CHECK from 0021 got Postgres's default name, `play_queue_mode_check`.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE play_queue
      DROP CONSTRAINT play_queue_mode_check,
      ADD CONSTRAINT play_queue_mode_check CHECK (mode IN ('queue', 'radio', 'time_machine')),
      ADD COLUMN radio_context jsonb,
      ADD CONSTRAINT play_queue_time_machine_context
        CHECK ((mode = 'time_machine') = (radio_context IS NOT NULL));
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE play_queue
      DROP CONSTRAINT play_queue_time_machine_context,
      DROP CONSTRAINT play_queue_mode_check,
      DROP COLUMN radio_context;
    -- Time Radio queues fall back to track-based radio; their items stay.
    UPDATE play_queue SET mode = 'radio' WHERE mode = 'time_machine';
    ALTER TABLE play_queue
      ADD CONSTRAINT play_queue_mode_check CHECK (mode IN ('queue', 'radio'));
  `,
    )
    .execute(db);
}
