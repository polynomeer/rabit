# Rabit iOS

SwiftUI client for iOS 26 and later ([ADR-0023](../../docs/adr/ADR-0023-ios-client.md)). It follows design pages F (dark) and G (light) of the design canvas.

```text
project.yml            XcodeGen spec (the .xcodeproj is generated, not committed)
Rabit/                 the app: App/ (entry, config, model), Design/, Features/, Player/
RabitTests/            app unit tests (run on a simulator)
Packages/RabitKit/     UI-free core: API models and client, tokens, playback, media URLs
```

## Run it locally

Needs Xcode 26 (Mac App Store) and XcodeGen.

```bash
brew install xcodegen
```

```bash
pnpm dev
```

```bash
xcodegen generate --spec apps/ios/project.yml && open apps/ios/Rabit.xcodeproj
```

Pick an iPhone simulator and run the `Rabit` scheme. Sign in with any development ID (for example `ios-dev`). The simulator reaches the local API on `localhost`.

To make catalog tracks playable for that ID (region KR and a Listen subscription), run, while `pnpm dev` is up:

```bash
pnpm demo:user ios-dev
```

To try the provider sign-in locally, start the mock provider, run the api with `AUTH_AUDIENCE=rabit-web,rabit-ios` and the other settings under "Running pieces by hand" in the root README, and enable `RABIT_OIDC_ISSUER` / `RABIT_OIDC_CLIENT_ID` in the scheme's environment variables:

```bash
docker compose --profile oidc up -d oidc
```

To try the in-app subscription locally (ADR-0024), run the api with `APP_STORE_ENVIRONMENT=Xcode` (unsigned StoreKit testing; refused in production) and a KR account (`pnpm demo:user <ID>` sets KR). The scheme uses `Rabit/Rabit.storekit` (Listen monthly, KRW 10,900); Xcode's Debug → StoreKit → Manage Transactions can renew, refund or expire it.

For staging or release builds, set the build settings `RABIT_OIDC_ISSUER` and `RABIT_OIDC_CLIENT_ID` from `tofu output ios_oidc` (and `RABIT_API_BASE_URL`).

If the API runs on another port (`RABIT_API_PORT`), change `RABIT_API_BASE` under the scheme's Run → Arguments → Environment Variables.

## Tests

- `RabitKit` runs on macOS: `swift test --package-path apps/ios/Packages/RabitKit`.
- App tests: Product → Test in Xcode, or `xcodebuild test -scheme Rabit` with a simulator destination.
- CI runs both in `.github/workflows/ios.yml` when `apps/ios/` changes.

## What works now

Provider sign-in (Cognito, PKCE) and development sign-in, home (saved items, recent DIG sessions), search, album detail, archive (saved items, playlists; save and unsave, add to playlists, new playlists, swipe to remove, reorder; physical collection; Audio Log editing), account (subscription bought in-app through the App Store, restore and manage; entitlements, purchases and storage), DIG (resume sessions, start from search or an album, follow connections by axis with their evidence, move back along the trail, save, end, make a playlist from the trail; Blind Digging with nothing revealed until Keep or Pass; Crate Digging by era and popularity; label timelines from search, albums and DIG; Artist Journey by year with dates at their stored precision and a cutoff view, and two releases compared, while `exploration_journey` / `exploration_compare` are on), Time Radio (a date and a mode, what the date leaves, then playback through the queue with "다음 달로" and a way out, while `exploration_time_machine` is on), digging under a cutoff date stored on the session, Rediscover (saved tracks quiet for 90/180/365 days, honest about missing history, clearing it) while `exploration_rediscover` is on, credits and provenance per track (creation stages, credits, claims, integrity axes) with reporting, Studio (record an Audio Log, import a file, upload steps with cancel, own audio), playback with the tab-bar mini player, the full player and lock-screen controls, theme choice and sign-out.
