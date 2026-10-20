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

## Amendment 2026-10-20: sample rate and gapless (audio pipeline review)
- **Sample rate follows the source family.** Sources of the 44.1 kHz family (11.025, 22.05, 44.1, 88.2, 176.4 kHz) render at 44.1 kHz, everything else at 48 kHz. CD masters are no longer resampled, and high-rate masters are reduced by an integer ratio. Codec, bitrate and segment length stay provisional (O-26).
- **Gapless was not delivered.** The statement above ("verified by test fixture") had no fixture behind it: ffmpeg's HLS muxer writes an empty edit list into `init.mp4`, so every rendition played 1,024 samples of encoder priming at the start and up to one frame of padding at the end. The worker now rewrites the edit list in place (movie timescale = sample rate, media time = priming, duration = source samples); `test/audio-render.test.ts` checks the boxes and that the decoded rendition is in phase with the source. Whether a source got the edit list is recorded as `gapless` in the version's technical data; a layout the patcher does not recognise costs gapless playback, not the rendition.
- Players that honour edit lists (AVFoundation) trim both ends. Each rung's playlist is shortened to match: the first segment loses the priming and the last segment loses the padding. On the web, Chrome's media source trims the padding as well, and hls.js then never signals the end of the stream. To cover that, the web player treats a stall within 0.3 s of the end, with the media buffered to it, as the end of the track (`apps/web/e2e/track-end.spec.ts`). Seamless joins between tracks also need the next track loaded before the current one ends (client queue, separate change).

## Amendment 2026-10-20: loudness normalisation
- The worker already measures integrated loudness and true peak (EBU R128). A playback session now returns `loudness.gain_db` = min(target − integrated, −1 dBTP − true peak), so a quiet track is raised only as far as its peak allows. The target is `PLAYBACK_LOUDNESS_TARGET_LUFS`, default −14 LUFS (the common streaming reference).
- Clients apply the gain unless the listener turns normalisation off (per device, on by default). The web and iOS players can only lower the volume (`volume` ≤ 1), so positive gains are ignored for now; amplification needs a Web Audio gain node or an AVAudioMix tap.
- Track gain only: an album played in order is levelled per track. Album gain needs the release's tracks measured together (open).

## Amendment 2026-10-20: three-rung ladder (owner decision)
- The product owner chose an adaptive ladder over the single rendition. Each source is encoded once per rung into `hls/<rung>/`, and a master playlist `hls/master.m3u8` lists the rungs:
  - `standard` 160 kbps, listed first, so players start there;
  - `low` 96 kbps;
  - `high` 256 kbps.
- Each rung is AAC-LC stereo with the same segments and gapless edit lists. The master's `BANDWIDTH` and `AVERAGE-BANDWIDTH` are measured from the segments.
- The low rung is AAC-LC, not HE-AAC. ffmpeg's built-in encoder has no HE-AAC, and the encoder that has it (fdk-aac) is non-free.
- Sessions point at `master.m3u8` and report `quality.renditions_kbps`. Audio processed before the ladder keeps its single top-level rendition and `index.m3u8`, decided by `renditions_kbps` in the version's technical data. Re-encoding old audio is a backfill job for when there is any in production.
- The gateway serves `/media/v1/{token}/{rendition}/{file}` with the same checks.
- Storage per source is about 3.2 times the single rendition (96 + 160 + 256 kbps against 160 kbps). Encoding decodes once and runs three encoders.
- Bitrates stay provisional until the listening test (O-26). Lossless is not part of this decision (Q02).

## Amendment 2026-10-20: catalog segments cached at the edge (owner decision)
- The product owner accepted that, after a revocation, already issued media tokens may keep fetching segments for up to their lifetime (60 s), in exchange for caching. Playlists still go to the origin on every request and check the session, so a revoked session cannot load a new playlist. Sessions cannot be issued for removed audio.
- **Segments at the edge.** The media distribution sends segment and init requests (`/media/v1/*.m4s`, `/media/v1/*init.mp4`) through a CloudFront Function (`infra/aws/functions/media-edge.js`). It checks the token's HMAC with the media token secret, read from a CloudFront KeyValueStore. It also checks the token's expiry and the file name.
- **Shared cache for catalog.** For catalog tokens the function rewrites the request to the storage path, `/media/v1/edge/<prefix>/<file>`, without the token. Every session then shares one cached copy. The cache key is the path plus the `Origin` header, and the TTL is one day; segment bytes never change under a prefix.
- **No edge cache for private uploads.** Private tokens keep their path and reach the origin. The origin answers `private`, so CloudFront does not cache them.
- **Protecting the shared route.** The origin serves `/media/v1/edge/...` only with the `x-media-edge` header (`MEDIA_EDGE_SECRET`). Only the second CloudFront origin used by the segment behaviours sends that header, so viewers cannot reach the route directly. The route serves segments only, from the catalog media bucket.
- Rotating the media token secret updates the KeyValueStore with the app secret (`tofu apply`).

## Consequences
The media gateway is on the data path in MVP; capacity scales with egress. Replacing it with a CDN changes deployment, not the API.

## Revisit trigger
Listening tests (ABX) for bitrate; device matrix (Q06); catalog contract DRM requirements (Q02); measured egress cost.
