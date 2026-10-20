# ADR-0011: Web reference client for MVP; native platforms pending Q06

- Status: Accepted (web reference client; native iOS in [ADR-0023](ADR-0023-ios-client.md)) / **Proposed (Android, desktop, offline)**
- Date: 2026-10-04
- Related: Q06, A03, PLY-001, NFR-A11Y-*, BRD

## Context
Supported devices and offline scope (Q06) are a product decision. The MVP still needs a client to verify the unified player, mixed library and DIG UX end to end.

## Decision
- Build a **web reference client** (`apps/web`: Vite, React, TypeScript, hls.js; Safari uses native HLS) that consumes only the public API. It is a verification and design-iteration surface, not a platform commitment.
- Apply brand working tokens (BRD §3) as CSS variables and the accessibility NFRs (keyboard operation, non-color status, reduced motion, list alternative for the DIG graph).
- **Proposed**: native iOS/Android, desktop, offline (P2), and whether production web is the same codebase.

## Amendment 2026-10-15: iOS
The product owner chose a native iOS client in SwiftUI for iOS 26 and later; see [ADR-0023](ADR-0023-ios-client.md). Android, desktop, offline and whether production web shares the reference client remain Proposed.

## Amendment 2026-10-20: the next track is prepared before the current one ends
From the audio pipeline review: each track opened its playback session only after the previous one ended, so the session request, playlist and first segment were all on the gap between tracks.
- Both clients open the next queue entry's session when the current track has 30 s or less left. The server checks rights at that moment, and again on every refresh.
- **iOS** queues the next item behind the current one in an `AVQueuePlayer`. AVFoundation moves on without a gap, and the edit lists written by the worker (ADR-0008) trim priming and padding. While both sessions live, both are refreshed. "Next" moves to the queued item instead of opening another session. Jumping elsewhere or stopping removes the queued item.
- **Web** warms the browser cache instead. It fetches the prepared session's playlist, init segment and first segment, then starts the track from them when the current one ends. hls.js still builds a new media source per track, so the join is short but not sample-accurate. Seamless joins on the web would need one MediaSource fed across tracks (open).
- A prepared session that is never played expires like any other (5 minutes). It reports no listening events until it plays.

## Revisit trigger
Q06 decision.
