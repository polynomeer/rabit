# ADR-0031: Release artwork

- Status: Accepted (pipeline, storage, signed versioned URLs) / Proposed (public, unsigned covers for share pages, with CQ-WEB-2)
- Date: 2026-10-24
- Deciders: engineering (commercial quality plan CQ-CAT-4); the owner approved proceeding with the recommended options on 2026-10-24
- Related: [commercial-quality-plan](../plans/commercial-quality-plan.md), ADR-0004, ADR-0008, ADR-0030

## Context
Clients draw stand-in covers from a hash of the release id. Real catalogs deliver a front cover with every release (DDEX `Image` of type `FrontCoverImage`). Covers need checking, resizing and fast delivery, and they must not be listable by guessing release ids.

## Decision
- **Intake**: a release in the catalog manifest may name a `cover` file; ERN ingest maps `FrontCoverImage` to it. Covers follow the masters' order:
  - the original is stored first in the catalog originals bucket;
  - inside the transaction, the release gets a `release_artwork` row (status `processing`, version) and a processing job.
- **Processing** (job `catalog.process_artwork`, media pool):
  - ffprobe must see one JPEG or PNG image, at least 600 px, square within 2 %. Anything else is `failed` with a reason for operators, and the stand-in stays.
  - ffmpeg writes square JPEGs of 300, 600 and 1200 px (never upscaled) without metadata, under `artwork/<release>/v<version>/` in the catalog media bucket.
- **Versions**: a new cover increments the version, and only the current version of a ready cover is served, so stale URLs stop.
- **URLs**: API responses carry `artwork: {300, 600, 1200}`, on the release and on release cards, or null when there is no ready cover. The URLs are `<media>/artwork/v1/<token>/<size>.jpg`.
  - The token signs the release and version (HMAC, with its own `artwork:` prefix over the media secret). It does not expire, so CDNs and browsers can keep a version for good (`public, max-age=31536000, immutable`; CloudFront caches `/artwork/v1/*`).
  - It is unguessable, so covers cannot be enumerated.
- **Not public yet**: URLs are only handed to signed-in listeners. Open covers for share pages wait for the CQ-WEB-2 decision.

## Consequences
- Real covers on every client that reads `artwork` (clients follow in their own change); the stand-in remains the fallback.
- A cover URL handed out stays valid until the cover changes, which is acceptable for album art. A cover that must disappear at once needs a new version, or removing the release.

## Revisit trigger
- Share pages (public covers).
- Animated or video covers.
- Per-region cover variants.
