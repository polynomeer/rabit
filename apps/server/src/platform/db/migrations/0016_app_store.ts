import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * The Listen subscription as an App Store in-app purchase (ADR-0024).
 * `app_store_account` holds the per-user `appAccountToken` that links Apple's
 * signed transactions to an account. Subscriptions gain the `app_store` source and
 * the Apple original transaction they follow (bound to one account only).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE app_store_account (
      user_id text PRIMARY KEY REFERENCES app_user(id),
      app_account_token uuid NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE subscription
      DROP CONSTRAINT subscription_source_check,
      ADD CONSTRAINT subscription_source_check CHECK (source IN ('operator', 'sandbox', 'app_store')),
      ADD COLUMN store_original_transaction_id text UNIQUE,
      ADD CONSTRAINT subscription_store_link CHECK ((source = 'app_store') = (store_original_transaction_id IS NOT NULL));`,
    )
    .execute(db);
}

/**
 * Rolling back turns App Store subscriptions into operator-set ones (access keeps
 * its paid-through date, nothing renews) and drops the account tokens. Orders,
 * journals and payment events stay: they are financial records.
 */
export async function down(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    UPDATE subscription SET source = 'operator', auto_renew = false, store_original_transaction_id = NULL
      WHERE source = 'app_store';
    ALTER TABLE subscription
      DROP CONSTRAINT subscription_store_link,
      DROP COLUMN store_original_transaction_id,
      DROP CONSTRAINT subscription_source_check,
      ADD CONSTRAINT subscription_source_check CHECK (source IN ('operator', 'sandbox'));
    DROP TABLE app_store_account;`,
    )
    .execute(db);
}
