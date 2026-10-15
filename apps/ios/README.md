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

If the API runs on another port (`RABIT_API_PORT`), change `RABIT_API_BASE` under the scheme's Run → Arguments → Environment Variables.

## Tests

- `RabitKit` runs on macOS: `swift test --package-path apps/ios/Packages/RabitKit`.
- App tests: Product → Test in Xcode, or `xcodebuild test -scheme Rabit` with a simulator destination.
- CI runs both in `.github/workflows/ios.yml` when `apps/ios/` changes.

## What works now

Development sign-in, home (saved items, recent DIG sessions), search, album detail, archive (saved items, playlists), DIG (resume sessions, start from search or an album, follow connections by axis with their evidence, move back along the trail, save, end, make a playlist from the trail), Studio (record an Audio Log, import a file, upload steps with cancel, own audio), playback with the tab-bar mini player and the full player, theme choice and sign-out. Production sign-in (Cognito, PKCE) is not wired yet, so release builds cannot sign in.
