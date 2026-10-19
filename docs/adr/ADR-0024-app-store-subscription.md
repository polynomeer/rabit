# ADR-0024: The Listen subscription as an App Store in-app purchase on iOS

- Status: Accepted (scope, price, one subscription per account, linking and verification) / **Proposed (VAT and commission accounting, Korean alternative payment)**
- Date: 2026-10-17
- Deciders: product owner (sell in-app, subscription only, same price, one subscription per account), engineering
- Related: ADR-0018 (payments and ledger), ADR-0016 (entitlement), ADR-0023 (iOS client), COM-008, Q04

## Context
The iOS client (ADR-0023) showed subscription state read-only. App Store rules require digital content bought inside an iOS app to use in-app purchase. The web subscription runs through the provider port of ADR-0018 (sandbox only so far). App Store purchases work the other way round: Apple charges the buyer and the app receives a signed transaction; renewals, failures and refunds arrive as App Store Server Notifications.

## Options
Scope: (1) **subscription only** (chosen) — one auto-renewable product; (2) subscription and album purchases — one App Store product per album, each reviewed, not practical.
Price: (1) **same as the web**, KRW 10,900 with VAT (chosen; Apple's commission lowers the net); (2) a higher iOS price.
Overlap with a web subscription: (1) **one subscription per account** (chosen); (2) allow both, with double charges to refund.
Linking a purchase to an account: (1) **`appAccountToken`** — a UUID the server issues per user, set on the purchase and returned inside Apple's signed transaction (chosen); (2) trust the user id the app sends — refused (CLAUDE.md: never trust client-supplied entitlement claims).

## Decision
- **Product**: one auto-renewable subscription, product id `app.rabit.ios.listen.monthly` (config `APP_STORE_PRODUCT_ID`), monthly, Apple price point nearest KRW 10,900, no free trial or offers, Family Sharing off. It maps to the plan `listen_monthly` and the same `catalog_all` play entitlement as the web subscription.
- **Who sells**: KR accounts only (as on the web). The app offers the purchase only when the account has no active or past-due subscription from another source; the web refuses checkout, stopping and resuming renewal for an App Store subscription ("App Store에서 관리").
- **Linking**: `GET /v1/subscription/app-store` returns the caller's `app_account_token` (created once, stored in `app_store_account`). The app passes it to `Product.purchase(options: [.appAccountToken])`.
- **Verification**: transactions and notifications are JWS signed by Apple and verified with Apple's App Store Server Library against Apple's root certificates (`APP_STORE_ROOT_CERTS`), the bundle id and the environment; production also checks the app's Apple id. `Xcode` and `LocalTesting` environments (unsigned StoreKit testing) are refused in production, like the development token issuer.
- **From the app**: after a purchase, and for renewals or restores the app sees, it sends `Transaction.jwsRepresentation` to `POST /v1/subscription/app-store/transactions`, and finishes the transaction only after a 2xx. The server accepts a transaction only if its product and bundle match, its `appAccountToken` is the caller's, and its original transaction is not bound to another account; it then applies it.
- **From Apple**: `POST /webhooks/app-store` receives App Store Server Notifications V2. A verified notification is stored as a `payment_event` (provider `app_store`, event id = notification UUID, so redeliveries are duplicates) and applied by a job: `SUBSCRIBED` and `DID_RENEW` apply the period; `DID_CHANGE_RENEWAL_STATUS` sets renewal on or off; `DID_FAIL_TO_RENEW` without a grace period makes the subscription past due (no access); `EXPIRED` and `GRACE_PERIOD_EXPIRED` end it; `REFUND` and `REVOKE` reverse the sale and end access now. Other types are acknowledged and ignored. A notification for an unknown account is held for an operator.
- **Applying a period** (one transaction, idempotent per transaction id): a `purchase_order` (kind `subscription`, provider `app_store`, `checkout_ref` = Apple transaction id, fulfilled), the sale journal, the subscription (source `app_store`, paid through Apple's `expiresDate`, never earlier than already paid) and its entitlement. Our renewal job never charges App Store subscriptions.
- **Ledger (provisional)**: the same gross sale journal as the sandbox (`provider_clearing` / `revenue` / `vat_payable`, VAT included at 10 %), with the order's provider telling App Store sales apart. Apple's commission and how VAT is remitted for App Store sales in Korea are Q04 accounting decisions; they will be booked at settlement, not guessed here.
- **A race** (the account got a web subscription while a purchase was in flight): Apple has already charged, so the period is applied, web renewal is switched off, and the overlap is audited and counted (`rabit_app_store_overlaps_total`) for support to refund one side.

## Amendment (2026-10-18): App Review's Sandbox purchases on Production
App Review and TestFlight buy in Sandbox against the production server, which refused them, so the review purchase would fail. Owner decision: **accept them as test purchases**.
- A Production server with `APP_STORE_ACCEPT_SANDBOX=true` (OpenTofu `app_store_accept_review_sandbox`, default true) verifies data Apple signed for another environment a second time as Sandbox, with Apple's root certificates and the bundle id. Unsigned environments (`Xcode`, `LocalTesting`) stay refused.
- Sandbox transaction ids are stored with a `sandbox:` prefix (order `checkout_ref`, subscription link), so a Sandbox id never matches a real one.
- A test purchase grants the subscription and its entitlement like a real one, fulfils an order with `snapshot.test = true`, and posts **no** sale or refund journal (no money moved). Metrics count it as `fulfilled_test`.
- Who can make one: Sandbox testers created in our App Store Connect account and TestFlight testers we invite. Sandbox subscriptions renew every few minutes and lapse after a few renewals.

## Amendment (2026-10-19): notifications are scoped to their subscription
Architecture review findings, fixed:
- **Scope.** Apple-driven changes (renewal on/off, failed renewal, expiry, refund) apply only to the subscription with `source = 'app_store'` linked to the notification's original transaction. A web subscription, or an App Store subscription since replaced, is never touched. The web's own past-due and refund paths never touch an App Store subscription. When the web takes over after an App Store subscription has ended, the link is dropped.
- **Order.** An `EXPIRED` whose transaction ends before the period already paid (it arrived after a renewal) is ignored (`stale`). A refund ends access only when the refunded transaction is the running period; refunding a past month changes nothing now.
- **Renewal margin.** Access for an App Store period lasts 24 h past Apple's expiry (`STORE_RENEWAL_MARGIN_MS`) so a renewal notification arriving after the expiry does not interrupt playback; `EXPIRED`, `REFUND` and `REVOKE` still end it at once. Reconciliation with the App Store Server API (missed notifications) is a follow-up that needs API keys from App Store Connect (owner action).
- **Deleted accounts.** Account deletion removes the `appAccountToken` and the original-transaction link. A notification for a deleted or deleting account is held (`account_deleted`) for support, never applied.
- **Test purchases.** A Sandbox purchase cannot take over a real paid App Store subscription (`test_over_paid`). Orders carry a typed `test` column.
- **Refunds.** App Store orders are refunded by Apple only; the operator refund refuses them, and refund jobs go only to the provider that took the payment.
- **Ledger.** App Store sales clear in `app_store_clearing` (web: `provider_clearing`) so they can be matched against Apple's net settlement. Commission and VAT treatment stay a Q04 decision. Journals booked before this change keep `provider_clearing` (entries are append-only).

## Consequences
- Releasing needs owner actions in App Store Connect: the app record and its Apple id, the subscription group and product, the server notification URL (`https://<api>/webhooks/app-store`, version 2), Apple's root certificates for the server, and enrolment in the App Store Small Business Program for the 15 % rate.
- Local testing uses an Xcode StoreKit configuration with the server in `LocalTesting`/`Xcode` mode.
- Albums bought on the web play in the app; the app neither sells albums nor points to the web to buy them.

## Revisit trigger
Abuse of test purchases (TestFlight opened to many testers); Q04 (provider, taxes, settlement); Korea's alternative-payment rules if the owner wants them; album sales in the app.
