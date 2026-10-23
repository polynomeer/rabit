import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deliveryPath, ernToManifest, ErnError, ingestErn } from '../src/modules/catalog/index.js';
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
    <MessageSender><PartyId>PADPIDA2026TIDAL</PartyId><PartyName><FullName>Tidal Room Records</FullName></PartyName></MessageSender>
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
      <DisplayTitleText>푸른 밤</DisplayTitleText>
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
      <DisplayTitleText>새벽의 노래</DisplayTitleText>
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
          // Starts next year: granting now would give rights early.
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
        valid_to: '2027-12-31T23:59:59.999Z',
      }),
      expect.objectContaining({ recording: 'r-a2', territories: ['WORLD'] }),
    ]);
    expect(c.skippedDeals).toEqual([
      expect.stringContaining('deal 2: starts 2027-01-01'),
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
    expect(refused(message({ root: 'PurgeReleaseMessage' }))).toThrow(/PurgeReleaseMessage/);
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

describe('ERN 4.3 ingest', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it('ingests a delivery once and refuses the same release again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rabit-ddex-'));
    await writeFile(join(dir, 'a1.wav'), fixtures.wav());
    const suffix = String(Date.now()).slice(-7);
    const icpn = `88${suffix}0001`;
    const xml = message({
      icpn,
      isrc: [`KRA40${suffix}`, `KRB40${suffix}`],
      uri: 'a1.wav',
    });
    const result = await ingestErn(h.ctx, xml, dir, NOW);
    expect(result.skippedDeals).toEqual([]);
    await h.worker.drain();

    const release = await h.ctx.db
      .selectFrom('release')
      .select(['id', 'title'])
      .where('upc', '=', icpn)
      .executeTakeFirstOrThrow();
    expect(release.title).toBe('새벽의 노래');
    const tracks = await h.ctx.db
      .selectFrom('release_track as t')
      .innerJoin('recording as r', 'r.id', 't.recording_id')
      .select(['r.title', 'r.isrc'])
      .where('t.release_id', '=', release.id)
      .orderBy('t.position')
      .execute();
    expect(tracks.map((t) => t.title)).toEqual(['푸른 밤', '여름의 끝']);
    const grants = await h.ctx.db
      .selectFrom('rights_grant')
      .select(['territories', 'rights_holder'])
      .where('recording_id', '=', result.ids['r-a1'] ?? '')
      .execute();
    expect(grants).toEqual([
      expect.objectContaining({ territories: ['KR', 'JP'], rights_holder: 'Tidal Room Records' }),
    ]);

    await expect(ingestErn(h.ctx, xml, dir, NOW)).rejects.toThrow(/already in the catalog/);
  });
});
