# ADR-0008: HLS delivery via short-lived playback sessions and a media gateway

- Status: Accepted (protocol, access model; CDN Amazon CloudFront since 2026-10-05) / **Proposed (codec ladder values, DRM)**
- Date: 2026-10-04
- Source topics: AP ADR-04 (codec·HLS·player), ADR-05 (CDN·DRM·offline)
- Related: PLY-004, PLY-007, PLY-008, PLY-011, AUD-013, AUD-014, AUD-017, NFR-REL-004, NFR-REL-010, NFR-SEC-006

## Context
Playback must be authorized at access time, revocation must stop new and active sessions within 60 s (proposal), and manifests **and segments** must be protected (AP-06). Codec/bitrate values must not be fixed without evidence (PB Phase 18, AP-06).

## Options (protocol)
1. **HLS** (RFC 8216) — broad client support (Safari native, hls.js elsewhere), manifest/segment split
2. DASH
3. Progressive download of a single file

## Options (access)
1. Public object URLs — rejected (PB Phase 6).
2. Long-lived signed object URLs — weak revocation.
3. **Short-lived playback session + media token verified on every manifest and segment request by a media gateway (data plane)**; in production the same token model maps to CDN signed cookies/edge auth.

## Decision
- `POST /v1/playback-sessions` (control plane) evaluates the playback policy (ADR-0016) and returns a manifest URL on the media gateway that embeds an HMAC-signed media token: `{session_id, source_id, asset_prefix, exp}` with `exp ≤ 60 s` from issue (renewed by `refresh`). Session lifetime: 5 minutes, refreshable while policy still allows (AP-06 proposal).
- The media gateway verifies the token signature, expiry, and that the session is still `active` (revocation check against DB with a short in-process cache ≤ 5 s), then streams bytes from the media bucket. Manifest segment URIs are rewritten to carry the token.
- Rights revocation marks affected sessions `revoked`; the gateway rejects the next request; tokens expire within 60 s regardless (NFR-REL-010).
- **Codec ladder (provisional, AUD-017)**: single rendition AAC-LC 48 kHz stereo at a provisional 160 kbps, HLS with fMP4 segments of a provisional 4 s target duration. These numbers are placeholders inside the 2–6 s experimental range from AP-06 and are **not** product claims. Lossless is not offered in MVP, so `quality.lossless` is always `false` (AUD-014).
- Gapless: preserve encoder delay/padding via fMP4 edit lists; verified by test fixture.
- **Proposed**: CDN provider, signed-cookie/edge implementation, DRM (contract dependent), offline (PLY-012, P2).

## Amendment 2026-10-05: CloudFront
- CloudFront (pay-as-you-go, not the flat-rate plans: they throttle silently above their allowance) sits in front of the media role. Media URLs carry the session token in the path, so responses are not shared between sessions; CloudFront is for egress price and latency, not caching. Cache keys include the full path, TTL ≤ token lifetime, and `no-store` responses for denials are not cached.
- Alternative kept on record: Cloudflare R2 + Workers (≈ USD 600 vs 2,460/month at 10k MAU); it moves the revocation check to the edge and stores data outside the Seoul region, so it needs its own decision.

## Consequences
The media gateway is on the data path in MVP; capacity scales with egress. Replacing it with a CDN changes deployment, not the API.

## Revisit trigger
Listening tests (ABX) for bitrate; device matrix (Q06); catalog contract DRM requirements (Q02); measured egress cost.
