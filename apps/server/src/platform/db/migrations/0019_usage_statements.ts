import { sql, type Kysely } from 'kysely';
import { refuseDataLoss } from '../migration-guard.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Monthly usage statements for rights holders (ADR-0025). A catalog playback
 * session records the territory and the access it was granted under, so a month
 * can be reported after accounts change country or are deleted. Statements are
 * closed once and kept; `usage_carryover` holds the qualifying streams of
 * deleted accounts, without any user reference, until their month closes.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE playback_session
      ADD COLUMN territory text CHECK (territory IS NULL OR territory ~ '^[A-Z]{2}$'),
      ADD COLUMN access_origin text CHECK (access_origin IN ('subscription', 'purchase', 'grant'));

    CREATE INDEX playback_session_usage_idx ON playback_session (issued_at)
      WHERE rights_grant_id IS NOT NULL;

    CREATE TABLE usage_statement (
      month date PRIMARY KEY CHECK (extract(day FROM month) = 1),
      policy text NOT NULL,
      streams bigint NOT NULL CHECK (streams >= 0),
      line_count integer NOT NULL CHECK (line_count >= 0),
      closed_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE usage_statement_line (
      month date NOT NULL REFERENCES usage_statement (month),
      recording_id text NOT NULL,
      isrc text,
      rights_grant_id text NOT NULL,
      rights_holder text NOT NULL,
      contract_ref text NOT NULL,
      territory text NOT NULL,
      access_origin text NOT NULL,
      streams integer NOT NULL CHECK (streams > 0),
      listeners integer NOT NULL CHECK (listeners > 0),
      played_ms bigint NOT NULL CHECK (played_ms >= 0),
      PRIMARY KEY (month, recording_id, rights_grant_id, territory, access_origin)
    );

    CREATE TABLE usage_carryover (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      month date NOT NULL CHECK (extract(day FROM month) = 1),
      recording_id text NOT NULL,
      rights_grant_id text NOT NULL,
      territory text NOT NULL,
      access_origin text NOT NULL,
      streams integer NOT NULL CHECK (streams > 0),
      played_ms bigint NOT NULL CHECK (played_ms >= 0),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX usage_carryover_month_idx ON usage_carryover (month);

    -- Closed statements are records for rights holders: never changed afterwards.
    CREATE FUNCTION usage_statement_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'usage statements are closed records';
    END $$;
    CREATE TRIGGER usage_statement_immutable BEFORE UPDATE OR DELETE ON usage_statement
      FOR EACH ROW EXECUTE FUNCTION usage_statement_immutable();
    CREATE TRIGGER usage_statement_line_immutable BEFORE UPDATE OR DELETE ON usage_statement_line
      FOR EACH ROW EXECUTE FUNCTION usage_statement_immutable();`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await refuseDataLoss(db, 'closed usage statements', 'SELECT 1 FROM usage_statement');
  await sql
    .raw(
      `
    DROP TABLE usage_carryover;
    DROP TABLE usage_statement_line;
    DROP TABLE usage_statement;
    DROP FUNCTION usage_statement_immutable();
    DROP INDEX playback_session_usage_idx;
    ALTER TABLE playback_session DROP COLUMN territory, DROP COLUMN access_origin;`,
    )
    .execute(db);
}
