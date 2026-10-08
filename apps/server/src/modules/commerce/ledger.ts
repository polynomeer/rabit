import type { DbOrTx } from '../../platform/db/db.js';
import type { Currency, LedgerAccount } from '../../platform/db/schema.js';
import { newId } from '../../platform/ids.js';

/**
 * VAT included in a consumer price (Korea: prices are shown with VAT). Integer
 * minor units throughout; rounding to the nearest unit (ADR-0018, provisional).
 */
export function includedTax(amountMinor: number, vatRateBp: number): number {
  return Math.round((amountMinor * vatRateBp) / (10_000 + vatRateBp));
}

type Line = { account: LedgerAccount; debit?: number; credit?: number };

/**
 * Double-entry journal for an order (COM-007). One journal per order and kind;
 * a second call is a no-op. The database refuses a journal that does not
 * balance at commit and any edit to an entry.
 */
async function post(
  db: DbOrTx,
  order: { id: string; currency: Currency },
  kind: 'sale' | 'refund',
  lines: Line[],
): Promise<boolean> {
  const journalId = newId('journal');
  const inserted = await db
    .insertInto('ledger_journal')
    .values({ id: journalId, order_id: order.id, kind, currency: order.currency })
    .onConflict((oc) => oc.columns(['order_id', 'kind']).doNothing())
    .executeTakeFirst();
  if (Number(inserted.numInsertedOrUpdatedRows ?? 0) === 0) return false;
  const rows = lines
    .filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0)
    .map((l, i) => ({
      journal_id: journalId,
      line_no: i + 1,
      account: l.account,
      debit_minor: l.debit ?? 0,
      credit_minor: l.credit ?? 0,
    }));
  await db.insertInto('ledger_line').values(rows).execute();
  return true;
}

/** Money received through the provider: revenue plus VAT owed. */
export function postSale(
  db: DbOrTx,
  order: { id: string; currency: Currency; amount_minor: number; tax_minor: number },
) {
  return post(db, order, 'sale', [
    { account: 'provider_clearing', debit: order.amount_minor },
    { account: 'revenue', credit: order.amount_minor - order.tax_minor },
    { account: 'vat_payable', credit: order.tax_minor },
  ]);
}

/** Full refund: the sale reversed as a new journal, never an edit. */
export function postRefund(
  db: DbOrTx,
  order: { id: string; currency: Currency; amount_minor: number; tax_minor: number },
) {
  return post(db, order, 'refund', [
    { account: 'revenue', debit: order.amount_minor - order.tax_minor },
    { account: 'vat_payable', debit: order.tax_minor },
    { account: 'provider_clearing', credit: order.amount_minor },
  ]);
}

/** Per-account balance (debit − credit) of one currency, for checks and the ops view. */
export async function ledgerBalances(db: DbOrTx, currency: Currency) {
  const rows = await db
    .selectFrom('ledger_line as l')
    .innerJoin('ledger_journal as j', 'j.id', 'l.journal_id')
    .select(['l.account'])
    .select((eb) => [
      eb.fn.sum<number>('l.debit_minor').as('debit'),
      eb.fn.sum<number>('l.credit_minor').as('credit'),
    ])
    .where('j.currency', '=', currency)
    .groupBy('l.account')
    .execute();
  return Object.fromEntries(rows.map((r) => [r.account, r.debit - r.credit]));
}
