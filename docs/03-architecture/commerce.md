# Album purchase (provisional)

- Status: implemented against the sandbox provider (2026-10-09). Decision: [ADR-0018](../adr/ADR-0018-payments-and-ledger.md) provisional section. Requirements: COM-001–007, COM-009, COM-010, COM-012, COM-013, COM-016, COM-018. Code: `apps/server/src/modules/commerce/`.
- Not included: downloads (COM-011, Legal), partial refunds, settlement (COM-015), a real provider (Q04). Subscription checkout (COM-008) is in §5.

## 1. Order states

| From | Event | To | Effect |
|---|---|---|---|
| — | `POST /v1/orders` | `pending` | snapshot frozen, checkout opened, expires in 30 min |
| `pending` | buyer cancels, offer withdrawn, account deleted | `cancelled` | — |
| `pending` | checkout window passes (job, every 5 min) | `expired` | — |
| `pending`, `expired` | `payment.succeeded`, still sellable | `fulfilled` | sale journal, purchase entitlement |
| `pending`, `expired`, `cancelled` | `payment.succeeded`, not sellable or cancelled | `refund_pending` | sale journal, system refund requested |
| `pending` | `payment.failed` | `cancelled` | — |
| `fulfilled`, `paid` | operator refund (If-Match) | `refund_pending` | refund requested |
| `refund_pending` | `refund.succeeded` | `refunded` | refund journal, entitlement revoked (sessions end) |
| `refund_pending` | `refund.failed` | `fulfilled` (or `paid` without entitlement) | operator follows up |

"Sellable" means the offer is on sale and every track has an active `stream` grant in the snapshot territory. The territory is the user's server-side licence country, never a client value (PLY-013).

## 2. Provider events

1. `POST /webhooks/payments/{provider}`: signature and timestamp checked on the raw body; failures are 400 and counted (`rabit_payment_events_total{outcome="rejected_*"}`).
2. The event is stored (`payment_event`, unique per provider event id) and a job is queued in the same transaction; then 200. A redelivery is answered `duplicate: true`.
3. The job applies the event in one transaction with the order row locked. Outcomes: `applied`, `ignored` (already in that state), `held` (amount or currency mismatch, unknown checkout or refund). Held events need an operator; `GET /v1/ops/orders/{id}` shows events, refunds and ledger lines.

## 3. Ledger

| Journal | Debit | Credit |
|---|---|---|
| sale | `provider_clearing` amount | `revenue` amount − VAT; `vat_payable` VAT |
| refund | `revenue` amount − VAT; `vat_payable` VAT | `provider_clearing` amount |

One journal per order and kind. The database refuses unbalanced journals (deferred constraint trigger) and any update or delete of entries.

## 4. Sandbox provider

`PAYMENTS_PROVIDER=mock` (refused in production) with `PAYMENTS_MOCK_WEBHOOK_SECRET`. The order's `checkout_url` points at `GET /dev/mock-pay/checkouts/{ref}`; `POST …/complete` with `succeeded` or `failed` plays the buyer. Outcomes are delivered as signed webhooks by a job through the same verification as HTTP deliveries. Refunds succeed while the mock payment is `succeeded`.

## 5. Monthly subscription (COM-008)

| Action | Effect |
|---|---|
| `GET /v1/subscription/plan` | plan, placeholder price with VAT, whether the region can subscribe, current state |
| `POST /v1/subscription/checkout` | order `kind = subscription`; on payment one month is added from the later of now and the paid-through date, renewal on |
| `POST /v1/subscription/cancel` | renewal off; access until the paid-through date, then the existing expiry job ends it |
| `POST /v1/subscription/resume` | renewal back on while the month runs; no charge now |
| renewal job (hourly) | charges the stored payment method for subscriptions ending within 24 h; success extends a month, decline → `past_due` (no access) |
| operator refund of a subscription order | access ends now (`cancelled`), renewal off; purchases stay (COM-009) |

Checkout is refused while a subscription is active (pay again only after it lapses or fails). Operator-set subscriptions keep working as before and never renew. The mock provider declines renewals for a user after `PUT /dev/mock-pay/cards/{user_id} {"declined": true}`.

Open (owner): price, retry and grace policy for declined renewals, withdrawal rules (청약철회) and the terms text.

## 6. Operations

- Offers: `POST /v1/ops/offers` (one on sale per release), `POST /v1/ops/offers/{id}/withdraw`.
- Refund: `POST /v1/ops/orders/{id}/refunds` with If-Match and a reason; audited.
- Reconciliation: hourly; mismatches are counted (`rabit_payment_reconcile_mismatches_total{kind}`) and logged with the order id, not repaired.
- Account deletion cancels pending orders; paid orders, refunds and the ledger stay for finance and legal traceability.
