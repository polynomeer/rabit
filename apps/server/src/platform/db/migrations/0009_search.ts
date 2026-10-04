import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Derived search documents (ADR-0006). Rebuildable from canonical tables.
 * Private documents always carry their owner workspace (CHECK) so the scope
 * predicate can be applied inside the same SQL statement as the match.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE search_document (
      id text PRIMARY KEY,
      doc_kind text NOT NULL CHECK (doc_kind IN
        ('recording','release','artist','person','label','private_audio','audio_log')),
      owner_workspace_id text REFERENCES workspace(id),
      visibility text NOT NULL CHECK (visibility IN ('private','public')),
      title text NOT NULL,
      subtitle text,
      body text NOT NULL DEFAULT '',
      exact_keys text[] NOT NULL DEFAULT '{}',
      tsv tsvector NOT NULL,
      norm text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((visibility = 'private') = (owner_workspace_id IS NOT NULL)),
      CHECK ((visibility = 'private') = (doc_kind IN ('private_audio','audio_log')))
    )`.execute(db);
  await sql`CREATE INDEX search_document_tsv_idx ON search_document USING gin (tsv)`.execute(db);
  await sql`CREATE INDEX search_document_trgm_idx ON search_document USING gin (norm gin_trgm_ops)`.execute(
    db,
  );
  await sql`CREATE INDEX search_document_keys_idx ON search_document USING gin (exact_keys)`.execute(
    db,
  );
  await sql`CREATE INDEX search_document_owner_idx ON search_document (owner_workspace_id) WHERE visibility = 'private'`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS search_document`.execute(db);
}
