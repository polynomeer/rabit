# ADR-0023: Native iOS client in SwiftUI, iOS 26 and later

- Status: Accepted (platform, stack, minimum OS, playback approach) / **Proposed (production sign-in, offline, Android, typeface on iOS)**
- Date: 2026-10-15
- Deciders: product owner (platform, stack, minimum OS, first scope), engineering
- Related: ADR-0008 (HLS, media tokens), ADR-0009 (auth), ADR-0011 (client strategy), ADR-0016 (rights), ADR-0022 (visual design), Q06, PLY-001, PLY-012

## Context
ADR-0011 left native platforms Proposed until Q06. The product owner asked for an iOS app following design pages F/G of the design canvas (iOS 26 "Liquid Glass": floating tab bar with a separate search tab, a player accessory above it, glass toolbar buttons and sheets).

Constraints from earlier decisions:
- Playback goes through short-lived sessions; the media token in the URL path lives ≤ 60 s and is rotated by `POST /v1/playback-sessions/{id}/refresh` (ADR-0008). The web player rewrites every segment request with the newest token.
- Tokens come from an OIDC provider (Cognito, ADR-0009); local development uses the dev issuer.
- Clients consume only the public API; rights and entitlement are decided by the server.

## Options
Stack: (1) **SwiftUI native** (chosen) — the system tab bar, accessory, glass and sheets are first-class; no code shared with the web, API models written in Swift. (2) React Native (Expo) — shares TypeScript with the web, Liquid Glass only through third-party or custom native modules. (3) Capacitor wrapping `apps/web` — fastest, but no native tab bar or glass.

Minimum OS: **iOS 26** (chosen) — the design uses iOS 26 controls without fallbacks; iOS 18 would need a second visual path on every screen.

Token rotation under AVPlayer: (a) **resource loader on a custom scheme** (chosen) — the app fetches the playlist itself so its relative segment URIs stay on `rabit-media://`, and answers each segment request with a redirect to the gateway carrying the newest token; (b) long-lived tokens for native clients — weakens revocation (NFR-REL-010); (c) the gateway accepting any unexpired token of the session in segment URLs — server change, deferred.

## Decision
- `apps/ios/`: SwiftUI app `Rabit` (bundle `app.rabit.ios`, iPhone, iOS 26.0+) and the Swift package `RabitKit` (API models with typed ids, API client, Keychain token store, playback sessions, media locator, listening events, cover style). RabitKit has no UI and also builds for macOS, so its tests run without a simulator.
- The Xcode project is generated with XcodeGen from `apps/ios/project.yml` and not committed.
- Navigation follows design page F: tabs 홈 / DIG / 보관함 / Studio plus the search tab (`Tab(role: .search)`); Playlists live under 보관함; the account opens as a sheet from the home toolbar; Atlas stays hidden (ADR-0022). The player is the tab bar's bottom accessory and opens a full sheet.
- Tokens are stored in the Keychain (`WhenUnlockedThisDeviceOnly`), never in `UserDefaults`. A 401 drops the token and returns to sign-in.
- Debug builds sign in with the dev issuer (`POST /dev/token`); release builds have no sign-in until provider sign-in lands. Plain HTTP is allowed only to local addresses (`NSAllowsLocalNetworking`).
- Playback: `POST /v1/playback-sessions` with a per-install `device_id` (`ios-<uuid>`), refresh every 40 s, listening events `started / heartbeat (15 s) / seek / paused / ended` as on the web; paused time is not counted. A failed refresh or a failed item stops playback with a message. Audio session category `.playback` with the `audio` background mode.
- Colours are the web tokens (ADR-0022) resolved per colour scheme; theme choice 기기 설정 / 다크 / 라이트 per device, default the device setting. Text uses the system font for now.
- CI: `.github/workflows/ios.yml` on `macos-26` (path-filtered) runs the RabitKit tests, generates the project and runs the app tests on an iOS 26 simulator.

## Amendment 2026-10-15: lock screen and icon
- The player publishes title, artist, duration, position and the stand-in cover to the lock screen and Control Center, and answers play, pause, next, previous and scrubbing there.
- The app icon is the brand symbol on Ink, rendered at 1024 px (opaque) by `apps/web/scripts/icons.mjs` from the same SVG as the web icons.

## Consequences
- Models are written by hand and can drift from `openapi.yaml`; decoding tests pin the shapes the app reads. Generating them (swift-openapi-generator) stays an option.
- Redirect-based segment loading depends on AVFoundation behaviour that unit tests cannot cover; it must be checked on a simulator or device against the local stack.
- Local development needs Xcode 26 and XcodeGen.

## Still open (Proposed)
- Production sign-in: OIDC Authorization Code + PKCE through `ASWebAuthenticationSession` against Cognito, refresh token in the Keychain.
- Offline (PLY-012, P2), DRM (contract-dependent), Android, iPad layout.
- Typeface on iOS: system font (SF Pro / Apple SD Gothic Neo) or bundled Noto Sans KR as on the web (OQ-BRD-01).

## Revisit trigger
Q06 for other platforms; a server change to segment authorisation; DRM requirements.
