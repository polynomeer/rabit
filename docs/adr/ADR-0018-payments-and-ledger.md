# ADR-0018: Payments, ledger and settlement

- Status: **Accepted (provisional, 2026-10-09) — sandbox provider only; Commercial Gate still open for a real provider**
- Date: 2026-10-04
- Source topic: AP ADR-06
- Related: COM-002..008, COM-015, COM-018, Q04, Q05, Q12

## Context
Payment provider, app-store billing policy, taxes and pricing are human decisions (Q04, Playbook §9). AP-14 allows sandbox implementation, but the MVP cut (mvp-scope §0.3) places orders/payments in P1.

## Recommendation (not decided)
- Provider-agnostic `PaymentProvider` port; webhook endpoint per provider with signature, timestamp and replay checks; store event (`provider, event_id UNIQUE, payload_hash`) → ack → idempotent processing.
- One transaction: payment event record + order state change + entitlement creation + outbox event (AP-05).
- Internal double-entry ledger in integer minor units; per-currency balance enforced by a deferred constraint or check job; corrections as new entries.
- Daily reconciliation job against the provider.

## Provisional decision (2026-10-09)
The owner asked to build album purchase against a mock provider before Q04 is decided. Accepted provisionally, for the sandbox only:
- **Port and adapter.** `PaymentProvider` (checkout, refund, webhook verification, lookup). The only adapter is `mock`: HMAC-SHA256 signed webhooks (`mock-pay-signature: t=…,v1=…`, 5-minute window), its own `mock_payment` records, and dev-only "hosted checkout" endpoints under `/dev/mock-pay`. Configuration refuses `PAYMENTS_PROVIDER=mock` in production, so staging and production have checkout off (`none`) until a real provider is chosen.
- **Money.** KRW only, integer minor units. Prices include VAT (Korean consumer prices); the default rate is 10 % and the included tax is `round(price × rate / (1 + rate))`, snapshotted on the order. Tax rules, invoices and other currencies wait for Q04.
- **Scope.** Album (release) purchase granting `play` only. Downloads (COM-011, Legal Q05), subscriptions through a provider (COM-008), partial refunds, settlement to rights holders (COM-015) and app-store billing are out.
- **Flow.** Order `pending` with a frozen snapshot → checkout → verified webhook stored (`provider, event_id` unique) and acknowledged → applied by a job in one transaction: order, entitlement (`origin = purchase`), ledger journal and outbox. Amount or currency mismatches and unknown references are held, never applied. A payment that arrives after expiry is honoured if the release is still sellable; after cancellation or withdrawal it is booked and refunded.
- **Ledger.** `ledger_journal` + `ledger_line`, double entry, accounts `provider_clearing`, `revenue`, `vat_payable`. A deferred constraint trigger refuses an unbalanced journal at commit; entries are append-only, refunds are reversing journals.
- **Reconciliation.** Hourly job compares orders with the provider's records and reports mismatches (metric `rabit_payment_reconcile_mismatches_total`, log); it does not repair.

Details: [commerce](../03-architecture/commerce.md). Replacing the mock with a real provider is a new adapter plus Q04 decisions (provider, taxes, refund policy, terms); the schema and flow are meant to stay.

## Before the provisional decision (MVP)
Entitlements with `origin = grant` created by an authenticated operator (audited) or by fixtures; `origin = subscription` toggled by an operator to simulate subscription state. No endpoint lets a user confirm a payment.

## Revisit trigger
Q04 (provider, pricing, taxes) and Q05 (download scope) decided.
