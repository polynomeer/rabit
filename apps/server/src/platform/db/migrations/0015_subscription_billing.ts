import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Subscription checkout and renewal through the payment provider (COM-008,
 * ADR-0018 provisional). Orders gain a kind: a release purchase has an offer, a
 * subscription period does not. Subscriptions record whether they renew.
 * `mock_card` is the sandbox provider's stored payment method.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE purchase_order
      ADD COLUMN kind text NOT NULL DEFAULT 'release' CHECK (kind IN ('release', 'subscription')),
      ALTER COLUMN offer_id DROP NOT NULL,
      ALTER COLUMN offer_version DROP NOT NULL,
      ADD CONSTRAINT purchase_order_offer_by_kind CHECK ((kind = 'release') = (offer_id IS NOT NULL));
    CREATE UNIQUE INDEX purchase_order_one_pending_subscription ON purchase_order (user_id)
      WHERE kind = 'subscription' AND status = 'pending';

    ALTER TABLE subscription
      ADD COLUMN auto_renew boolean NOT NULL DEFAULT false;

    CREATE TABLE mock_card (
      user_id text PRIMARY KEY,
      declined boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    );`,
    )
    .execute(db);
}

/**
 * Rolling back deletes subscription orders with their refunds and ledger
 * journals (the ledger's append-only trigger is suspended for this only);
 * release orders are untouched.
 */
export async function down(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE ledger_line DISABLE TRIGGER ledger_line_immutable;
    ALTER TABLE ledger_journal DISABLE TRIGGER ledger_journal_immutable;
    DELETE FROM ledger_line WHERE journal_id IN (SELECT j.id FROM ledger_journal j
      JOIN purchase_order o ON o.id = j.order_id WHERE o.kind = 'subscription');
    DELETE FROM ledger_journal WHERE order_id IN (SELECT id FROM purchase_order WHERE kind = 'subscription');
    ALTER TABLE ledger_journal ENABLE TRIGGER ledger_journal_immutable;
    ALTER TABLE ledger_line ENABLE TRIGGER ledger_line_immutable;
    DELETE FROM payment_refund WHERE order_id IN (SELECT id FROM purchase_order WHERE kind = 'subscription');
    DELETE FROM purchase_order WHERE kind = 'subscription';
    DROP TABLE mock_card;
    ALTER TABLE subscription DROP COLUMN auto_renew;
    DROP INDEX purchase_order_one_pending_subscription;
    ALTER TABLE purchase_order DROP CONSTRAINT purchase_order_offer_by_kind;
    ALTER TABLE purchase_order ALTER COLUMN offer_version SET NOT NULL;
    ALTER TABLE purchase_order ALTER COLUMN offer_id SET NOT NULL;
    ALTER TABLE purchase_order DROP COLUMN kind;`,
    )
    .execute(db);
}
