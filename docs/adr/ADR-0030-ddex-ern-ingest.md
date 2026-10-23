# ADR-0030: Catalog deliveries as DDEX ERN 4.3

- Status: Accepted (new releases; updates, takedowns and purges since 2026-10-24) / Proposed (explicit and AI flags, artwork, acknowledgements)
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
  - recordings (ISRC) already in the catalog under another release, rather than duplicating them.
- **Untrusted input**: the XML parser does not expand entities (no billion laughs) and resolves nothing external. Paths are checked again where files are opened.
- **CLI**: `pnpm --filter @rabit/server catalog:ddex <message.xml> [--dry-run]`.

## Updates, takedowns and purges (2026-10-24)
- **Same release again**: a NewReleaseMessage whose ICPN is already in the catalog updates that release. This is allowed only if the same sender (`MessageSender/PartyId`) delivered it. Otherwise it is refused, and an operator resolves it.
- **Track list**: tracks are matched by ISRC. A message that changes the track list is refused (new audio needs an operator's look).
- **Titles**: release and track title changes are applied and reindexed.
- **Grants**: the sender's grants (contract reference `ddex:<sender>:…`) are matched to the message's deals by uses, territories and start.
  - A changed end is applied. An end at or before now is a takedown: the grant expires at once, and the change is announced so sessions are revoked (ADR-0016). This is how ERN 4 expresses takedowns, per the XSD's Deal definition.
  - A grant withdrawn before it ever started is revoked.
  - A deal the sender no longer sends ends now.
  - A new deal becomes a grant. A deal that starts later is a grant from that moment (`valid_from`); new deliveries get the same.
  - Grants of other licensors and grants made by operators are never touched.
- **PurgeReleaseMessage**, release named by ICPN: the sender's grants on it end now. Removing audio and metadata stays an operator action, because other grants may remain.

## Still open (Proposed)
- `ParentalWarningType` (explicit flag, CQ-LEG-3), `ContainsAI` (integrity), and Image resources for real artwork (CQ-CAT-4).
- Track list changes inside an update.
- Acknowledgements to the sender (ERN choreography), once a licensor's delivery spec names its protocol.

## Consequences
- A licensor's ERN 4.3 deliveries create releases, keep their deals current and take them down without an operator, within the session revocation window.
- A takedown can only narrow what a sender's own deliveries granted.
