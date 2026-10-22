import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * The account's play queue (ADR-0026): items in order, played ones kept as history
 * above the current item, each chosen by the listener (`user`) or suggested by
 * autoplay with its reason. One row of settings per account.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE play_queue (
      user_id text PRIMARY KEY REFERENCES app_user (id),
      mode text NOT NULL DEFAULT 'queue' CHECK (mode IN ('queue', 'radio')),
      autoplay boolean NOT NULL DEFAULT true,
      include_inferred boolean NOT NULL DEFAULT false,
      current_item_id text,
      version integer NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE play_queue_item (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES play_queue (user_id) ON DELETE CASCADE,
      position integer NOT NULL,
      ref_type text NOT NULL CHECK (ref_type IN ('recording', 'audio_source')),
      ref_id text NOT NULL,
      origin text NOT NULL CHECK (origin IN ('user', 'autoplay')),
      reason jsonb,
      added_at timestamptz NOT NULL DEFAULT now(),
      played_at timestamptz
    );
    CREATE INDEX play_queue_item_order_idx ON play_queue_item (user_id, position);
    CREATE INDEX play_queue_item_ref_idx ON play_queue_item (ref_id);`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw('DROP TABLE play_queue_item; DROP TABLE play_queue;').execute(db);
}
