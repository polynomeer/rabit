import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Accounts, workspaces, memberships. Quota policy values are configuration (Q03);
 * workspaces store only the policy id. Rollback drops identity tables (dev only:
 * destroys accounts — never run `down` against production data).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE app_user (
      id text PRIMARY KEY CHECK (id ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
      oidc_issuer text NOT NULL,
      oidc_subject text NOT NULL,
      email_verified boolean NOT NULL,
      status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','deletion_requested','deleted')),
      license_country char(2) CHECK (license_country ~ '^[A-Z]{2}$'),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deletion_requested_at timestamptz,
      UNIQUE (oidc_issuer, oidc_subject)
    )`.execute(db);

  await sql`
    CREATE TABLE workspace (
      id text PRIMARY KEY CHECK (id ~ '^wsp_[0-9A-HJKMNP-TV-Z]{26}$'),
      type text NOT NULL CHECK (type IN ('personal','studio','catalog')),
      owner_user_id text REFERENCES app_user(id),
      quota_policy_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((type = 'catalog') = (owner_user_id IS NULL))
    )`.execute(db);
  await sql`CREATE UNIQUE INDEX workspace_one_personal ON workspace (owner_user_id) WHERE type = 'personal'`.execute(
    db,
  );
  await sql`CREATE UNIQUE INDEX workspace_one_catalog ON workspace (type) WHERE type = 'catalog'`.execute(
    db,
  );

  await sql`
    CREATE TABLE membership (
      workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES app_user(id),
      role text NOT NULL CHECK (role IN ('owner','publisher','editor','viewer')),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, user_id)
    )`.execute(db);
  await sql`CREATE INDEX membership_user_idx ON membership (user_id)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS membership`.execute(db);
  await sql`DROP TABLE IF EXISTS workspace`.execute(db);
  await sql`DROP TABLE IF EXISTS app_user`.execute(db);
}
