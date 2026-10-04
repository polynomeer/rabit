# ADR-0018: Payments, ledger and settlement

- Status: **Proposed — Commercial Gate**
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

## What MVP does instead
Entitlements with `origin = grant` created by an authenticated operator (audited) or by fixtures; `origin = subscription` toggled by an operator to simulate subscription state. No endpoint lets a user confirm a payment.

## Revisit trigger
Q04 (provider, pricing, taxes) and Q05 (download scope) decided.
