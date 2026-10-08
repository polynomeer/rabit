import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Album purchase (ADR-0018, provisional): offers, orders with a frozen snapshot,
 * provider events stored before they are applied, refunds, and a double-entry
 * ledger in integer minor units whose journals must balance at commit.
 * `mock_payment` is the sandbox provider's own record (PAYMENTS_PROVIDER=mock).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE offer (
      id text PRIMARY KEY CHECK (id ~ '^ofr_[0-9A-HJKMNP-TV-Z]{26}$'),
      release_id text NOT NULL REFERENCES release(id),
      territories text[] NOT NULL CHECK (cardinality(territories) >= 1),
      currency text NOT NULL CHECK (currency IN ('KRW')),
      price_minor bigint NOT NULL CHECK (price_minor > 0),
      vat_rate_bp integer NOT NULL CHECK (vat_rate_bp BETWEEN 0 AND 10000),
      capabilities text[] NOT NULL CHECK (cardinality(capabilities) >= 1 AND capabilities <@ ARRAY['play']::text[]),
      status text NOT NULL CHECK (status IN ('on_sale', 'withdrawn')),
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX offer_one_on_sale ON offer (release_id) WHERE status = 'on_sale';

    CREATE TABLE purchase_order (
      id text PRIMARY KEY CHECK (id ~ '^ord_[0-9A-HJKMNP-TV-Z]{26}$'),
      user_id text NOT NULL REFERENCES app_user(id),
      offer_id text NOT NULL REFERENCES offer(id),
      offer_version integer NOT NULL,
      status text NOT NULL CHECK (status IN
        ('pending', 'paid', 'fulfilled', 'cancelled', 'expired', 'refund_pending', 'refunded')),
      currency text NOT NULL,
      amount_minor bigint NOT NULL CHECK (amount_minor > 0),
      tax_minor bigint NOT NULL CHECK (tax_minor >= 0 AND tax_minor <= amount_minor),
      snapshot jsonb NOT NULL,
      provider text NOT NULL,
      checkout_ref text UNIQUE,
      checkout_url text,
      entitlement_id text REFERENCES entitlement(id),
      expires_at timestamptz NOT NULL,
      paid_at timestamptz,
      refunded_at timestamptz,
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      -- Fulfilled means entitled; nothing before payment is. A payment that cannot
      -- be fulfilled (offer withdrawn, order cancelled) is refunded without one.
      CHECK (status <> 'fulfilled' OR entitlement_id IS NOT NULL),
      CHECK (status NOT IN ('pending', 'cancelled', 'expired') OR entitlement_id IS NULL),
      CHECK (status IN ('pending', 'cancelled', 'expired') OR paid_at IS NOT NULL)
    );
    CREATE INDEX purchase_order_user_idx ON purchase_order (user_id, created_at DESC);
    CREATE UNIQUE INDEX purchase_order_one_pending ON purchase_order (user_id, offer_id) WHERE status = 'pending';
    CREATE INDEX purchase_order_pending_expiry ON purchase_order (expires_at) WHERE status = 'pending';

    CREATE TABLE payment_refund (
      id text PRIMARY KEY CHECK (id ~ '^rfd_[0-9A-HJKMNP-TV-Z]{26}$'),
      order_id text NOT NULL REFERENCES purchase_order(id),
      amount_minor bigint NOT NULL CHECK (amount_minor > 0),
      status text NOT NULL CHECK (status IN ('requested', 'succeeded', 'failed')),
      provider_ref text UNIQUE,
      requested_by text NOT NULL,
      reason text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX payment_refund_one_open ON payment_refund (order_id) WHERE status = 'requested';

    CREATE TABLE payment_event (
      id text PRIMARY KEY CHECK (id ~ '^pev_[0-9A-HJKMNP-TV-Z]{26}$'),
      provider text NOT NULL,
      provider_event_id text NOT NULL,
      type text NOT NULL,
      checkout_ref text NOT NULL,
      payload_sha256 text NOT NULL,
      payload jsonb NOT NULL,
      status text NOT NULL CHECK (status IN ('received', 'applied', 'ignored', 'held')),
      detail text,
      received_at timestamptz NOT NULL DEFAULT now(),
      processed_at timestamptz,
      UNIQUE (provider, provider_event_id)
    );
    CREATE INDEX payment_event_held_idx ON payment_event (received_at) WHERE status = 'held';
    CREATE INDEX payment_event_checkout_idx ON payment_event (provider, checkout_ref);

    CREATE TABLE ledger_journal (
      id text PRIMARY KEY CHECK (id ~ '^jrn_[0-9A-HJKMNP-TV-Z]{26}$'),
      order_id text NOT NULL REFERENCES purchase_order(id),
      kind text NOT NULL CHECK (kind IN ('sale', 'refund')),
      currency text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (order_id, kind)
    );
    CREATE TABLE ledger_line (
      journal_id text NOT NULL REFERENCES ledger_journal(id),
      line_no integer NOT NULL CHECK (line_no >= 1),
      account text NOT NULL CHECK (account IN ('provider_clearing', 'revenue', 'vat_payable')),
      debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
      credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
      PRIMARY KEY (journal_id, line_no),
      CHECK ((debit_minor > 0) <> (credit_minor > 0))
    );

    -- Every journal balances when its transaction commits (COM-007).
    CREATE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      j text := coalesce(NEW.journal_id, OLD.journal_id);
      d bigint; c bigint;
    BEGIN
      SELECT coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0) INTO d, c
        FROM ledger_line WHERE journal_id = j;
      IF d <> c OR d = 0 THEN
        RAISE EXCEPTION 'ledger journal % does not balance (debit %, credit %)', j, d, c;
      END IF;
      RETURN NULL;
    END $$;
    CREATE CONSTRAINT TRIGGER ledger_line_balanced AFTER INSERT ON ledger_line
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

    -- Entries are never edited; corrections are new journals.
    CREATE FUNCTION ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'ledger entries are append-only';
    END $$;
    CREATE TRIGGER ledger_line_immutable BEFORE UPDATE OR DELETE ON ledger_line
      FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
    CREATE TRIGGER ledger_journal_immutable BEFORE UPDATE OR DELETE ON ledger_journal
      FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

    CREATE TABLE mock_payment (
      id text PRIMARY KEY CHECK (id ~ '^mpy_[0-9A-HJKMNP-TV-Z]{26}$'),
      checkout_ref text NOT NULL UNIQUE,
      order_id text NOT NULL,
      amount_minor bigint NOT NULL,
      currency text NOT NULL,
      status text NOT NULL CHECK (status IN ('open', 'succeeded', 'failed', 'refunded')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    DROP TABLE mock_payment;
    DROP TABLE ledger_line;
    DROP TABLE ledger_journal;
    DROP FUNCTION ledger_immutable();
    DROP FUNCTION ledger_check_balanced();
    DROP TABLE payment_event;
    DROP TABLE payment_refund;
    DROP TABLE purchase_order;
    DROP TABLE offer;`,
    )
    .execute(db);
}
