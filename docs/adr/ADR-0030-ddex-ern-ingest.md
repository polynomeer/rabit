# ADR-0030: Catalog deliveries as DDEX ERN 4.3

- Status: Accepted (new releases) / Proposed (updates, takedowns and purges: next step)
- Date: 2026-10-24
- Deciders: engineering (commercial quality plan CQ-CAT-2); delivery specs per licensor stay the owner's (Q02, O-21)
- Related: [commercial-quality-plan](../plans/commercial-quality-plan.md), ADR-0016, ADR-0008, CAT-001, CAT-008

## Context
Licensors and distributors deliver releases as DDEX ERN messages. Our catalog ingest reads a Rabit JSON manifest only, written for fixtures and self-made content. Supporting ERN 4.3 is what a commercial catalog needs. ERN 4.3.x is what DDEX recommends (current 4.3.2, namespaces `http://ddex.net/xml/ern/431` and `/432`). This ADR is written against the official 4.3.2 XSD and the 4.3.1 samples.

## Decision
- **Conversion, not a second ingest**: an ERN NewReleaseMessage is converted (`ernToManifest`) into the existing manifest. Rights, audio QC, transcoding and search then run unchanged.
- **Mapping**:

  | ERN | Manifest |
  |---|---|
  | `PartyList/Party` (`PartyReference`, `PartyName/FullName`) | artists (DisplayArtist), people (Contributor), labels (ReleaseLabelReference) |
  | `SoundRecording` | recording: `DisplayTitleText`, `SoundRecordingEdition/ResourceId/ISRC`, main artists (`DisplayArtistRole` = MainArtist, by `SequenceNumber`), file `TechnicalDetails/DeliveryFile/File/URI` |
  | `Contributor/Role` | credits for composer, lyricist, producer, engineers and arranger (declared, distributor verified); other roles are not imported |
  | the one `Release` (not `TrackRelease`) | release: `ReleaseId/ICPN`, `ReleaseType` (Single, SingleResourceRelease, EP, otherwise album; compilation when multi-artist), `OriginalReleaseDate` or `ReleaseDate`, `ResourceGroup` items in `SequenceNumber` order (nested groups = discs) |
  | `DealList/ReleaseDeal/Deal/DealTerms` | rights grants for every track: `TerritoryCode` (Worldwide = WORLD); `UseType` OnDemandStream, NonInteractiveStream, Stream map to stream, and PermanentDownload, Download map to download; `ValidityPeriod` end (`EndDateTime`, or `EndDate` through the end of that day) |

- **Deal handling**:
  - Deals with the same uses and end become one grant per track with all their territories, since deliveries often send one deal per country.
  - A deal that starts in the future is not granted now, which would give rights early. It is reported, and waits for the update step.
  - An ended deal, and uses Rabit does not offer (ringtones and the like), are reported and skipped.
- **Refused, never guessed**:
  - other ERN versions;
  - `ExcludedTerritoryCode`;
  - more than one main Release;
  - a Release without a display artist or tracks;
  - file URIs that are absolute, carry a scheme, use backslashes or leave the delivery folder;
  - a release (ICPN) or recording (ISRC) already in the catalog, rather than duplicating it;
  - `PurgeReleaseMessage` until the update step exists.
- **Untrusted input**: the XML parser does not expand entities (no billion laughs) and resolves nothing external. Paths are checked again where files are opened.
- **CLI**: `pnpm --filter @rabit/server catalog:ddex <message.xml> [--dry-run]`.

## Next step (Proposed)
- **Updates**: a later NewReleaseMessage for the same ICPN updates the release and its recordings, matched by ICPN and ISRC.
- **Takedowns**: ERN 4 expresses a takedown by adding an end to an existing deal's `ValidityPeriod` (XSD, Deal). It becomes the grant's `valid_to`, and sessions are revoked within the 60 s edge window.
- **Future deals**: a deal that starts later becomes a grant with `valid_from`.
- **Purges**: `PurgeReleaseMessage` removes a release that cannot be taken down normally.
- **More metadata**: `ParentalWarningType` (explicit flag, CQ-LEG-3), `ContainsAI` (integrity), and Image resources for real artwork (CQ-CAT-4).
- **Acknowledgements** to the sender (ERN choreography), once a licensor's delivery spec names its protocol.

## Consequences
- A licensor's ERN 4.3 delivery for a new release can be ingested and played under its deals.
- Until the next step, a re-delivery is refused, and a takedown must be applied by an operator (grant status) rather than by the message.
