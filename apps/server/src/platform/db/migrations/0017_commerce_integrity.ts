import { sql, type Kysely } from 'kysely';
import { refuseDataLoss } from '../migration-guard.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Commerce integrity (architecture review 2026-10-19):
 * - App Store sales clear in their own ledger account, matched against Apple's
 *   settlement (net of commission) apart from the web provider.
 * - Test purchases (App Review, TestFlight) carry a typed flag instead of a jsonb
 *   field, so reports and reconciliation can leave them out.
 * - One entitlement per purchase order: a retried fulfilment cannot grant twice.
 * - Currencies are checked where money is stored.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE ledger_line DROP CONSTRAINT ledger_line_account_check,
      ADD CONSTRAINT ledger_line_account_check
        CHECK (account IN ('provider_clearing', 'app_store_clearing', 'revenue', 'vat_payable'));

    ALTER TABLE purchase_order ADD COLUMN test boolean NOT NULL DEFAULT false;
    UPDATE purchase_order SET test = true WHERE snapshot->>'test' = 'true';
    ALTER TABLE purchase_order
      ADD CONSTRAINT purchase_order_currency_check CHECK (currency IN ('KRW'));
    ALTER TABLE ledger_journal
      ADD CONSTRAINT ledger_journal_currency_check CHECK (currency IN ('KRW'));

    CREATE UNIQUE INDEX entitlement_one_per_purchase ON entitlement (origin_ref)
      WHERE origin = 'purchase';`,
    )
    .execute(db);
}

/** Refuses while App Store sales are booked in their own clearing account. */
export async function down(db: Kysely<any>): Promise<void> {
  await refuseDataLoss(
    db,
    'ledger lines in app_store_clearing',
    "SELECT 1 FROM ledger_line WHERE account = 'app_store_clearing'",
  );
  await sql
    .raw(
      `
    DROP INDEX entitlement_one_per_purchase;
    ALTER TABLE ledger_journal DROP CONSTRAINT ledger_journal_currency_check;
    ALTER TABLE purchase_order DROP CONSTRAINT purchase_order_currency_check;
    ALTER TABLE purchase_order DROP COLUMN test;
    ALTER TABLE ledger_line DISABLE TRIGGER ledger_line_immutable;
    DELETE FROM ledger_line WHERE account = 'app_store_clearing';
    ALTER TABLE ledger_line ENABLE TRIGGER ledger_line_immutable;
    ALTER TABLE ledger_line DROP CONSTRAINT ledger_line_account_check,
      ADD CONSTRAINT ledger_line_account_check
        CHECK (account IN ('provider_clearing', 'revenue', 'vat_payable'));`,
    )
    .execute(db);
}
