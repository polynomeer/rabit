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

For staging or release builds, set the build settings `RABIT_OIDC_ISSUER` and `RABIT_OIDC_CLIENT_ID` from `tofu output ios_oidc` (and `RABIT_API_BASE_URL`).

If the API runs on another port (`RABIT_API_PORT`), change `RABIT_API_BASE` under the scheme's Run → Arguments → Environment Variables.

## Tests

- `RabitKit` runs on macOS: `swift test --package-path apps/ios/Packages/RabitKit`.
- App tests: Product → Test in Xcode, or `xcodebuild test -scheme Rabit` with a simulator destination.
- CI runs both in `.github/workflows/ios.yml` when `apps/ios/` changes.

## What works now

Provider sign-in (Cognito, PKCE) and development sign-in, home (saved items, recent DIG sessions), search, album detail, archive (saved items, playlists), DIG (resume sessions, start from search or an album, follow connections by axis with their evidence, move back along the trail, save, end, make a playlist from the trail), Studio (record an Audio Log, import a file, upload steps with cancel, own audio), playback with the tab-bar mini player, the full player and lock-screen controls, theme choice and sign-out.
