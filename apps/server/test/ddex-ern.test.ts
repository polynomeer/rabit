import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activeGrants,
  createGrant,
  deliveryPath,
  ernToManifest,
  ErnError,
  ingestErn,
  readErn,
} from '../src/modules/catalog/index.js';
import { ulid } from '../src/platform/ids.js';
import { fixtures } from './helpers/audio-fixtures.js';
import { createHarness, type Harness } from './helpers/harness.js';

/**
 * DDEX ERN 4.3 ingest (ADR-0030). The messages follow the ERN 4.3.2 schema; the
 * content is made up (no third-party sample is copied).
 */
const NOW = new Date('2026-10-24T00:00:00Z');

interface Opts {
  icpn?: string;
  isrc?: [string, string];
  uri?: string;
  deals?: string;
  namespace?: string;
  root?: string;
  sender?: string;
  title?: string;
  trackTitle?: string;
}

function message(o: Opts = {}) {
  const [isrc1, isrc2] = o.isrc ?? ['KRA402600001', 'KRA402600002'];
  const ns = o.namespace ?? 'http://ddex.net/xml/ern/432';
  const root = o.root ?? 'NewReleaseMessage';
  const deals =
    o.deals ??
    `<Deal><DealTerms><TerritoryCode>KR</TerritoryCode><TerritoryCode>JP</TerritoryCode>
       <ValidityPeriod><StartDateTime>2026-01-01T00:00:00Z</StartDateTime></ValidityPeriod>
       <CommercialModelType>SubscriptionModel</CommercialModelType>
       <UseType>OnDemandStream</UseType><UseType>NonInteractiveStream</UseType></DealTerms></Deal>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<ern:${root} xmlns:ern="${ns}" LanguageAndScriptCode="ko">
  <MessageHeader>
    <MessageThreadId>T1</MessageThreadId><MessageId>MSG-${ulid()}</MessageId>
    <MessageSender><PartyId>${o.sender ?? 'PADPIDA2026TIDAL'}</PartyId><PartyName><FullName>Tidal Room Records</FullName></PartyName></MessageSender>
    <MessageRecipient><PartyId>PADPIDA2026RABIT</PartyId><PartyName><FullName>Rabit</FullName></PartyName></MessageRecipient>
    <MessageCreatedDateTime>2026-10-20T09:00:00Z</MessageCreatedDateTime>
  </MessageHeader>
  <PartyList>
    <Party><PartyReference>PArtist</PartyReference><PartyName><FullName>새벽빛</FullName></PartyName></Party>
    <Party><PartyReference>PProducer</PartyReference><PartyName><FullName>Marguerite Okonkwo</FullName></PartyName></Party>
    <Party><PartyReference>PLabel</PartyReference><PartyName><FullName>Tidal Room Records</FullName></PartyName></Party>
  </PartyList>
  <ResourceList>
    <SoundRecording>
      <ResourceReference>A1</ResourceReference><Type>MusicalWorkSoundRecording</Type>
      <SoundRecordingEdition><ResourceId><ISRC>${isrc1}</ISRC></ResourceId></SoundRecordingEdition>
      <DisplayTitleText>${o.trackTitle ?? '푸른 밤'}</DisplayTitleText>
      <DisplayArtist SequenceNumber="1"><ArtistPartyReference>PArtist</ArtistPartyReference><DisplayArtistRole>MainArtist</DisplayArtistRole></DisplayArtist>
      <Contributor><ContributorPartyReference>PProducer</ContributorPartyReference><Role>Producer</Role></Contributor>
      <Duration>PT3M20S</Duration><ParentalWarningType>NotExplicit</ParentalWarningType>
      <TechnicalDetails><TechnicalResourceDetailsReference>T1</TechnicalResourceDetailsReference>
        <DeliveryFile><Type>AudioFile</Type><File><URI>${o.uri ?? 'resources/a1.wav'}</URI></File></DeliveryFile>
      </TechnicalDetails>
    </SoundRecording>
    <SoundRecording>
      <ResourceReference>A2</ResourceReference><Type>MusicalWorkSoundRecording</Type>
      <SoundRecordingEdition><ResourceId><ISRC>${isrc2}</ISRC></ResourceId></SoundRecordingEdition>
      <DisplayTitleText>여름의 끝</DisplayTitleText>
      <DisplayArtist SequenceNumber="1"><ArtistPartyReference>PArtist</ArtistPartyReference><DisplayArtistRole>MainArtist</DisplayArtistRole></DisplayArtist>
      <Duration>PT2M10S</Duration><ParentalWarningType>NotExplicit</ParentalWarningType>
    </SoundRecording>
  </ResourceList>
  <ReleaseList>
    <Release>
      <ReleaseReference>R0</ReleaseReference><ReleaseType>Album</ReleaseType>
      <ReleaseId><ICPN>${o.icpn ?? '8800000000017'}</ICPN></ReleaseId>
      <DisplayTitleText>${o.title ?? '새벽의 노래'}</DisplayTitleText>
      <DisplayArtist SequenceNumber="1"><ArtistPartyReference>PArtist</ArtistPartyReference><DisplayArtistRole>MainArtist</DisplayArtistRole></DisplayArtist>
      <ReleaseLabelReference>PLabel</ReleaseLabelReference>
      <OriginalReleaseDate>2026-03-01</OriginalReleaseDate>
      <ResourceGroup>
        <SequenceNumber>1</SequenceNumber>
        <ResourceGroupContentItem><SequenceNumber>2</SequenceNumber><ReleaseResourceReference>A2</ReleaseResourceReference></ResourceGroupContentItem>
        <ResourceGroupContentItem><SequenceNumber>1</SequenceNumber><ReleaseResourceReference>A1</ReleaseResourceReference></ResourceGroupContentItem>
      </ResourceGroup>
    </Release>
    <TrackRelease><ReleaseReference>R1</ReleaseReference><ReleaseResourceReference>A1</ReleaseResourceReference></TrackRelease>
  </ReleaseList>
  <DealList><ReleaseDeal><DealReleaseReference>R0</DealReleaseReference>${deals}</ReleaseDeal></DealList>
</ern:${root}>`;
}

const deal = (terms: string) => `<Deal><DealTerms>${terms}</DealTerms></Deal>`;

describe('ERN 4.3 conversion', () => {
  it('maps parties, recordings, track order, credits and deals', () => {
    const c = ernToManifest(message(), NOW);
    const m = c.manifest;
    expect(m.artists).toEqual([{ key: 'a-partist', name: '새벽빛' }]);
    expect(m.labels).toEqual([{ key: 'l-plabel', name: 'Tidal Room Records' }]);
    expect(m.recordings.map((r) => [r.key, r.title, r.isrc, r.audio ?? null])).toEqual([
      ['r-a1', '푸른 밤', 'KRA402600001', 'resources/a1.wav'],
      ['r-a2', '여름의 끝', 'KRA402600002', null],
    ]);
    expect(m.releases?.[0]).toMatchObject({
      title: '새벽의 노래',
      type: 'album',
      label: 'l-plabel',
      date: '2026-03-01',
      upc: '8800000000017',
      artists: ['a-partist'],
      // By SequenceNumber, not document order.
      tracks: ['r-a1', 'r-a2'],
    });
    expect(m.credits).toEqual([
      expect.objectContaining({ subject: 'r-a1', contributor: 'p-pproducer', role: 'producer' }),
    ]);
    expect(m.grants).toHaveLength(2);
    expect(m.grants?.[0]).toMatchObject({
      recording: 'r-a1',
      rights_holder: 'Tidal Room Records',
      territories: ['KR', 'JP'],
      uses: ['stream'],
    });
    expect(c.icpn).toBe('8800000000017');
    expect(c.skippedDeals).toEqual([]);
  });

  it('turns deal periods into grant ends, and skips deals it cannot honour yet', () => {
    const c = ernToManifest(
      message({
        deals: [
          // Worldwide downloads until the end of 2027 (an end date covers that day).
          deal(`<TerritoryCode>Worldwide</TerritoryCode><ValidityPeriod><StartDate>2026-01-01</StartDate>
            <EndDate>2027-12-31</EndDate></ValidityPeriod><UseType>PermanentDownload</UseType>`),
          // Starts next year: a grant from then on, not before.
          deal(`<TerritoryCode>KR</TerritoryCode><ValidityPeriod><StartDateTime>2027-01-01T00:00:00Z</StartDateTime>
            </ValidityPeriod><UseType>OnDemandStream</UseType>`),
          // Already ended.
          deal(`<TerritoryCode>KR</TerritoryCode><ValidityPeriod><StartDate>2025-01-01</StartDate>
            <EndDate>2025-12-31</EndDate></ValidityPeriod><UseType>OnDemandStream</UseType>`),
          // Ringtones are not something Rabit offers.
          deal(`<TerritoryCode>KR</TerritoryCode><ValidityPeriod><StartDate>2026-01-01</StartDate>
            </ValidityPeriod><UseType>UseAsRingtone</UseType>`),
        ].join(''),
      }),
      NOW,
    );
    expect(c.manifest.grants).toEqual([
      expect.objectContaining({
        recording: 'r-a1',
        territories: ['WORLD'],
        uses: ['download'],
        valid_from: '2026-01-01T00:00:00.000Z',
        valid_to: '2027-12-31T23:59:59.999Z',
      }),
      expect.objectContaining({ recording: 'r-a2', territories: ['WORLD'] }),
      expect.objectContaining({
        recording: 'r-a1',
        territories: ['KR'],
        uses: ['stream'],
        valid_from: '2027-01-01T00:00:00.000Z',
      }),
      expect.objectContaining({ recording: 'r-a2', valid_from: '2027-01-01T00:00:00.000Z' }),
    ]);
    expect(c.skippedDeals).toEqual([
      expect.stringContaining('deal 3: ended 2025-12-31'),
      expect.stringContaining('deal 4: no streaming or download use'),
    ]);
  });

  it('merges per-country deals with the same terms into one grant per track', () => {
    const country = (c: string) =>
      deal(`<TerritoryCode>${c}</TerritoryCode><ValidityPeriod><StartDate>2026-01-01</StartDate>
        </ValidityPeriod><UseType>OnDemandStream</UseType>`);
    const c = ernToManifest(message({ deals: ['KR', 'JP', 'US'].map(country).join('') }), NOW);
    expect(c.manifest.grants?.map((g) => [g.recording, g.territories])).toEqual([
      ['r-a1', ['KR', 'JP', 'US']],
      ['r-a2', ['KR', 'JP', 'US']],
    ]);
  });

  it('refuses what it cannot import faithfully', () => {
    const refused = (xml: string) => () => ernToManifest(xml, NOW);
    expect(refused(message({ namespace: 'http://ddex.net/xml/ern/382' }))).toThrow(ErnError);
    expect(refused(message({ root: 'PurgeReleaseMessage' }))).toThrow(/NewReleaseMessage/);
    expect(
      refused(
        message({
          deals: deal('<ExcludedTerritoryCode>KR</ExcludedTerritoryCode><UseType>Stream</UseType>'),
        }),
      ),
    ).toThrow(/excluded territories/);
    expect(refused('<NewReleaseMessage><unclosed></NewReleaseMessage>')).toThrow(ErnError);
    expect(refused('<Something/>')).toThrow(/NewReleaseMessage/);
  });

  it('keeps file URIs inside the delivery folder', () => {
    expect(deliveryPath('resources/./a1.wav')).toBe('resources/a1.wav');
    for (const bad of [
      '../secret.wav',
      'resources/../../x.wav',
      '/etc/passwd',
      'file:///etc/passwd',
      'https://evil.test/a.wav',
      'C:\\x.wav',
    ]) {
      expect(() => deliveryPath(bad), bad).toThrow(ErnError);
    }
    expect(() => ernToManifest(message({ uri: '../../etc/passwd' }), NOW)).toThrow(
      /leaves the delivery/,
    );
  });

  it('does not expand entities (no billion laughs)', () => {
    const bomb = message()
      .replace(
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>`,
      )
      .replace(
        '<DisplayTitleText>푸른 밤</DisplayTitleText>',
        '<DisplayTitleText>&lol2;</DisplayTitleText>',
      );
    const c = ernToManifest(bomb, NOW);
    expect(c.manifest.recordings[0]?.title).toBe('&lol2;');
  });
});

function purge(icpn: string, sender = 'PADPIDA2026TIDAL') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ern:PurgeReleaseMessage xmlns:ern="http://ddex.net/xml/ern/432">
  <MessageHeader><MessageThreadId>T2</MessageThreadId><MessageId>PURGE-${ulid()}</MessageId>
    <MessageSender><PartyId>${sender}</PartyId><PartyName><FullName>Tidal Room Records</FullName></PartyName></MessageSender>
    <MessageCreatedDateTime>2026-10-24T09:00:00Z</MessageCreatedDateTime></MessageHeader>
  <PurgedRelease><ReleaseId><ICPN>${icpn}</ICPN></ReleaseId></PurgedRelease>
</ern:PurgeReleaseMessage>`;
}

describe('ERN 4.3 purge message', () => {
  it('reads the release to purge by ICPN', () => {
    const p = readErn(purge('8800000000017'), NOW);
    expect(p).toMatchObject({
      kind: 'purge',
      purge: { icpn: '8800000000017', senderId: 'PADPIDA2026TIDAL' },
    });
    expect(() => readErn(purge('not-an-icpn'), NOW)).toThrow(/ICPN/);
  });
});

describe('ERN 4.3 ingest, updates and takedowns', () => {
  let h: Harness;
  let dir: string;
  beforeAll(async () => {
    h = await createHarness();
    dir = await mkdtemp(join(tmpdir(), 'rabit-ddex-'));
    await writeFile(join(dir, 'a1.wav'), fixtures.wav());
  });
  afterAll(() => h.close());

  /** A release of its own for each test: unique ICPN and ISRCs. */
  async function delivered(extra: Opts = {}) {
    const suffix = ulid()
      .slice(-7)
      .replace(/[^0-9]/g, '7')
      .padStart(7, '7');
    const base: Opts = {
      icpn: `88${suffix}0001`,
      isrc: [`KRA40${suffix}`, `KRB40${suffix}`],
      uri: 'a1.wav',
      ...extra,
    };
    const created = await ingestErn(h.ctx, message(base), dir, NOW);
    expect(created.action).toBe('created');
    await h.worker.drain();
    const release = await h.ctx.db
      .selectFrom('release')
      .select('id')
      .where('upc', '=', base.icpn ?? '')
      .executeTakeFirstOrThrow();
    const tracks = await h.ctx.db
      .selectFrom('release_track')
      .select('recording_id')
      .where('release_id', '=', release.id)
      .orderBy('position')
      .execute();
    return { base, releaseId: release.id, recordings: tracks.map((t) => t.recording_id) };
  }

  const grantsOf = (recordingId: string) =>
    h.ctx.db
      .selectFrom('rights_grant')
      .select(['territories', 'uses', 'status', 'valid_from', 'valid_to', 'contract_ref'])
      .where('recording_id', '=', recordingId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();

  const streamsIn = async (recordingId: string, country: string, at = NOW) =>
    (await activeGrants(h.ctx.db, [recordingId], country, 'stream', at)).has(recordingId);

  it('creates a release once; the same message again changes nothing', async () => {
    const { base, releaseId, recordings } = await delivered();
    expect(await streamsIn(recordings[0] ?? '', 'KR')).toBe(true);
    const again = await ingestErn(h.ctx, message(base), dir, NOW);
    expect(again).toMatchObject({
      action: 'updated',
      release_id: releaseId,
      grants: { created: 0, ended: 0, moved: 0 },
      renamed: 0,
    });
  });

  it('takes a release down when its deal gains an end, and revokes sessions', async () => {
    const { base, recordings } = await delivered();
    const ended = deal(`<TerritoryCode>KR</TerritoryCode><TerritoryCode>JP</TerritoryCode>
      <ValidityPeriod><StartDateTime>2026-01-01T00:00:00Z</StartDateTime>
      <EndDateTime>2026-10-23T12:00:00Z</EndDateTime></ValidityPeriod>
      <UseType>OnDemandStream</UseType><UseType>NonInteractiveStream</UseType>`);
    const r = await ingestErn(h.ctx, message({ ...base, deals: ended }), dir, NOW);
    expect(r).toMatchObject({ action: 'updated', grants: { created: 0, ended: 2, moved: 0 } });
    for (const rec of recordings) expect(await streamsIn(rec, 'KR')).toBe(false);
    expect((await grantsOf(recordings[0] ?? ''))[0]?.status).toBe('expired');
    // The change is announced, so sessions under the grant are revoked (ADR-0016).
    const events = await h.ctx.db
      .selectFrom('outbox_event')
      .select('payload')
      .where('type', '=', 'RightsGrantChanged')
      .where(sql<boolean>`payload->>'recording_id' = ${recordings[0] ?? ''}`)
      .execute();
    expect(events.map((e) => (e.payload as { status: string }).status)).toContain('expired');
  });

  it('schedules a future end, ends deals no longer sent and adds new ones', async () => {
    const { base, recordings } = await delivered();
    const rec = recordings[0] ?? '';
    const deals = [
      // KR and JP until the end of the year: the grant gets that end.
      deal(`<TerritoryCode>KR</TerritoryCode><TerritoryCode>JP</TerritoryCode>
        <ValidityPeriod><StartDateTime>2026-01-01T00:00:00Z</StartDateTime>
        <EndDate>2026-12-31</EndDate></ValidityPeriod>
        <UseType>OnDemandStream</UseType><UseType>NonInteractiveStream</UseType>`),
      // Downloads from next year: a new grant that waits for its start.
      deal(`<TerritoryCode>KR</TerritoryCode><ValidityPeriod><StartDate>2027-01-01</StartDate>
        </ValidityPeriod><UseType>PermanentDownload</UseType>`),
    ].join('');
    const r = await ingestErn(h.ctx, message({ ...base, deals }), dir, NOW);
    expect(r).toMatchObject({ grants: { created: 2, ended: 0, moved: 2 } });
    expect(await streamsIn(rec, 'KR')).toBe(true);
    expect(await streamsIn(rec, 'KR', new Date('2027-01-02T00:00:00Z'))).toBe(false);
    const downloads = await activeGrants(h.ctx.db, [rec], 'KR', 'download', NOW);
    expect(downloads.has(rec)).toBe(false);
    const later = await activeGrants(
      h.ctx.db,
      [rec],
      'KR',
      'download',
      new Date('2027-01-02T00:00:00Z'),
    );
    expect(later.has(rec)).toBe(true);

    // Only JP is sent now: the KR+JP grant ends, a JP grant takes its place.
    const jpOnly = deal(`<TerritoryCode>JP</TerritoryCode><ValidityPeriod>
      <StartDateTime>2026-01-01T00:00:00Z</StartDateTime></ValidityPeriod>
      <UseType>OnDemandStream</UseType><UseType>NonInteractiveStream</UseType>`);
    const narrowed = await ingestErn(h.ctx, message({ ...base, deals: jpOnly }), dir, NOW);
    // Ended: the KR+JP stream grant and the download grant, on both tracks.
    expect(narrowed).toMatchObject({ grants: { created: 2, ended: 4, moved: 0 } });
    expect(await streamsIn(rec, 'KR')).toBe(false);
    expect(await streamsIn(rec, 'JP')).toBe(true);
  });

  it('updates titles, and refuses track list changes and other licensors', async () => {
    const { base, releaseId } = await delivered();
    const renamed = await ingestErn(
      h.ctx,
      message({ ...base, title: '새벽의 노래 (리마스터)', trackTitle: '푸른 밤 (2026)' }),
      dir,
      NOW,
    );
    expect(renamed).toMatchObject({ renamed: 2 });
    const release = await h.ctx.db
      .selectFrom('release')
      .select('title')
      .where('id', '=', releaseId)
      .executeTakeFirstOrThrow();
    expect(release.title).toBe('새벽의 노래 (리마스터)');

    const otherTracks = message({ ...base, isrc: [base.isrc?.[0] ?? '', 'KRC402699999'] });
    await expect(ingestErn(h.ctx, otherTracks, dir, NOW)).rejects.toThrow(/track list/);
    const otherSender = message({ ...base, sender: 'PADPIDA2026OTHER' });
    await expect(ingestErn(h.ctx, otherSender, dir, NOW)).rejects.toThrow(/not delivered by/);
  });

  it('purges the licensor grants and leaves an operator grant alone', async () => {
    const { base, recordings } = await delivered();
    const rec = recordings[0] ?? '';
    await createGrant(
      h.ctx.db,
      { type: 'system', id: null },
      {
        recording_id: rec,
        rights_holder: 'Direct licence',
        territories: ['US'],
        uses: ['stream'],
        valid_from: new Date(0).toISOString(),
        contract_ref: 'OPS-DIRECT-1',
      },
      'test: a grant outside the delivery',
      null,
    );
    await expect(
      ingestErn(h.ctx, purge(base.icpn ?? '', 'PADPIDA2026OTHER'), dir, NOW),
    ).resolves.toMatchObject({
      grants: { ended: 0 },
    });
    const p = await ingestErn(h.ctx, purge(base.icpn ?? ''), dir, NOW);
    expect(p).toMatchObject({ action: 'purged', grants: { ended: 2 } });
    expect(await streamsIn(rec, 'KR')).toBe(false);
    expect(await streamsIn(rec, 'US')).toBe(true);
    await expect(ingestErn(h.ctx, purge('8899999999999'), dir, NOW)).rejects.toThrow(
      /not in the catalog/,
    );
  });
});
