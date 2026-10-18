# App Store in-app purchase: setup and operations

The Listen subscription sold in the iOS app ([ADR-0024](../adr/ADR-0024-app-store-subscription.md)). Steps marked **owner** need the Apple Developer account and are done by the owner; the rest is configuration.

## 1. App Store Connect (owner)

1. Join the Apple Developer Program as the business (organization enrolment needs a D-U-N-S number) and accept the Paid Apps agreement under Business, with banking and tax forms. Without that agreement, products cannot be sold or tested in Sandbox.
2. Apply for the App Store Small Business Program (15 % commission).
3. Create the app: bundle id `app.rabit.ios` (register the identifier first under Certificates, Identifiers & Profiles, with In-App Purchase enabled). Note its **Apple ID** (App Information → General); it becomes `app_store_app_apple_id`.
4. Subscriptions → create a subscription group (for example "Rabit Listen") and one auto-renewable subscription:
   - Product ID `app.rabit.ios.listen.monthly` (must equal `APP_STORE_PRODUCT_ID`);
   - duration 1 month; price: the South Korea price point nearest ₩10,900, availability South Korea only;
   - no introductory or promotional offers; Family Sharing off;
   - Korean display name and description, and the review screenshot of the purchase screen.
5. App Information → App Store Server Notifications: set **both** the Production and the Sandbox URL to `https://<api host>/webhooks/app-store`, version 2. Before the domain exists (owner-actions O-02) the api host is the CloudFront name from `tofu output`.
6. Users and Access → Sandbox → create a sandbox tester with a Korean storefront for staging tests.

## 2. Server configuration

| Environment | `app_store_environment` (OpenTofu) | Also needs |
|---|---|---|
| Local, Xcode StoreKit testing | `APP_STORE_ENVIRONMENT=Xcode` in `.env` | nothing; signatures are not checked |
| Staging | `Sandbox` in `staging.tfvars` | the App Store Connect app and product |
| Production | `Production` | `app_store_app_apple_id`; `app_store_accept_review_sandbox` (default true, §4) |

`tofu apply` sets `APP_STORE_ENVIRONMENT`, `APP_STORE_ROOT_CERTS=/etc/ssl/apple/AppleRootCA-G3.cer` (Apple's root certificate is part of the image, see `apps/server/certs/apple`) and the Apple ID on the api and worker tasks. The server refuses to start in Production without the Apple ID, and refuses `Xcode`/`LocalTesting` in production.

Check after the deploy, with a signed-in test account:

```sh
curl -s -H "authorization: Bearer $TOKEN" https://<api host>/v1/subscription/app-store
```

It answers `503 UNAVAILABLE` while the setting is off, otherwise the account's token and whether it may buy.

App Store Connect's "Request a Test Notification" button sends a `TEST` notification; the api acknowledges it and it is stored as a `payment_event` with status `ignored`:

```sql
SELECT type, status, detail, received_at FROM payment_event WHERE provider = 'app_store' ORDER BY received_at DESC LIMIT 5;
```

## 3. Operations

- **Held notifications.** A verified notification the server could not tie to an account or an order is stored with status `held` (detail `unknown_account`, `no_transaction`, `unknown_order` or a rejection reason) and logged as "App Store notification held for review". It needs an operator: find the buyer from the `originalTransactionId` (App Store Connect, or Apple's App Store Server API) and support records. There is no tool to re-apply a held event yet; until there is, the buyer's next purchase or restore in the app (`POST /v1/subscription/app-store/transactions`) links and applies the subscription.
- **Overlaps.** `rabit_app_store_overlaps_total` counts accounts that ended up with both a web and an App Store subscription (a purchase raced a web checkout). Support refunds one side: the web one through our provider, the App Store one only by the buyer asking Apple (reportaproblem.apple.com).
- **Refunds.** Apple decides App Store refunds; the `REFUND` notification reverses the sale and ends access. Our cancel endpoint and the web renewal switch refuse App Store subscriptions; the buyer manages them in iOS Settings → Apple ID → Subscriptions.
- **Signature failures** (`422` on `/v1/subscription/app-store/transactions`, rejected webhooks) after a deploy usually mean a wrong environment or Apple ID. A Production server refuses Sandbox data only when `app_store_accept_review_sandbox` is false.
- **Test purchases.** Orders with `checkout_ref` starting `sandbox:` (and `snapshot.test = true`) are App Review or TestFlight purchases: they grant access but have no ledger journal. Sandbox subscriptions renew every few minutes and stop after a few renewals, so a reviewer's access ends on its own. Count them with `rabit_orders_total{event="fulfilled_test"}`.

## 4. App Review

App Review and TestFlight testers buy with Sandbox accounts against the production app and server. Production accepts these as **test purchases** (owner decision 2026-10-18, ADR-0024 amendment): access without a sale, ids kept apart with a `sandbox:` prefix. Only Sandbox testers we create in App Store Connect and TestFlight testers we invite can make them. In the review notes, give App Review a Rabit demo account whose license country is KR (the purchase is offered only in Korea).

## 5. Open before release

- Commission and VAT accounting for App Store sales (Q04).
