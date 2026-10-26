import { posix } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { CatalogManifest } from './ingest.js';

/**
 * DDEX ERN 4.3 (ADR-0030): a NewReleaseMessage from a licensor becomes a catalog
 * manifest. The message is untrusted input: entities are not expanded, file URIs must
 * stay inside the delivery folder, and anything this importer cannot represent
 * faithfully (excluded territories, a deal that starts later) is refused or reported,
 * never guessed. Updates and takedowns of an existing release are a later step.
 */
export class ErnError extends Error {}

export interface ErnConversion {
  manifest: CatalogManifest;
  /** The release's ICPN and the recordings' ISRCs, to refuse a second delivery. */
  icpn: string | null;
  isrcs: string[];
  /** Who sent it: grants carry `ddex:<sender>:` so an update touches only its own. */
  senderId: string;
  messageId: string;
  /** Deals not turned into grants, with why (ended, use or territory not supported). */
  skippedDeals: string[];
}

/** A PurgeReleaseMessage: take the release out of the licensor's deals (ADR-0030). */
export interface ErnPurge {
  icpn: string;
  senderId: string;
  messageId: string;
}

type Node = Record<string, unknown>;

const NAMESPACE = /^http:\/\/ddex\.net\/xml\/ern\/43\d?$/;
/** Elements that may repeat; the parser returns them as arrays even when there is one. */
const REPEATED = new Set([
  'Party',
  'PartyName',
  'SoundRecording',
  'Image',
  'Release',
  'TrackRelease',
  'DisplayArtist',
  'Contributor',
  'Role',
  'ResourceGroup',
  'ResourceGroupContentItem',
  'ReleaseDeal',
  'DealReleaseReference',
  'Deal',
  'TerritoryCode',
  'ExcludedTerritoryCode',
  'UseType',
  'CommercialModelType',
  'DeliveryFile',
  'TechnicalDetails',
  'DisplayTitleText',
  'ReleaseLabelReference',
  'ReleaseId',
  'ReleaseType',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  // No entity expansion: a delivery cannot grow itself (billion laughs).
  processEntities: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => REPEATED.has(name),
});

const arr = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : v ? [v as Node] : []);
/** Text of an element that may carry attributes. */
function text(v: unknown): string | undefined {
  const first = Array.isArray(v) ? (v as unknown[])[0] : v;
  if (typeof first === 'string') return first.trim() || undefined;
  if (first && typeof first === 'object' && '#text' in first) {
    const t = (first as Node)['#text'];
    return typeof t === 'string' ? t.trim() || undefined : undefined;
  }
  return undefined;
}
const node = (v: unknown): Node => arr(v)[0] ?? {};
const seq = (n: Node) => Number(text(n['SequenceNumber']) ?? n['@_SequenceNumber'] ?? 0);

/** Manifest keys are lowercase; DDEX references are case-sensitive letters and digits. */
const keyOf = (prefix: string, ref: string) =>
  `${prefix}-${ref.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`.slice(0, 64);

/** A file URI from the delivery: relative, inside the delivery folder, no scheme. */
export function deliveryPath(uri: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('/') || uri.includes('\\')) {
    throw new ErnError(`File URI must be relative to the delivery: ${uri}`);
  }
  const normal = posix.normalize(uri);
  if (normal.startsWith('..') || normal === '.') {
    throw new ErnError(`File URI leaves the delivery folder: ${uri}`);
  }
  return normal;
}

const CREDIT_ROLES: Record<string, NonNullable<CatalogManifest['credits']>[number]['role']> = {
  Composer: 'composer',
  ComposerLyricist: 'composer',
  Lyricist: 'lyricist',
  Producer: 'producer',
  Engineer: 'engineer',
  RecordingEngineer: 'engineer',
  MixingEngineer: 'mixing_engineer',
  MasteringEngineer: 'mastering_engineer',
  Arranger: 'arranger',
};

const STREAM_USES = new Set(['OnDemandStream', 'NonInteractiveStream', 'Stream']);
const DOWNLOAD_USES = new Set(['PermanentDownload', 'Download']);

function releaseType(n: Node): 'album' | 'single' | 'ep' | 'compilation' {
  const t = text(n['ReleaseType']) ?? 'Album';
  if (text(n['IsMultiArtistCompilation']) === 'true') return 'compilation';
  if (t === 'EP') return 'ep';
  if (['Single', 'SingleResourceRelease', 'MultimediaSingle', 'VideoSingle'].includes(t)) {
    return 'single';
  }
  return 'album';
}

/**
 * A release date with its precision (ADR-0033): `2019-03-09`, `2019-03` or `2019`.
 * Partial dates become the first day of their month or year, marked as such.
 */
function releaseDateOf(
  v: unknown,
): { date: string; precision: 'day' | 'month' | 'year' } | undefined {
  const t = text(v);
  if (!t) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return { date: t.slice(0, 10), precision: 'day' };
  if (/^\d{4}-\d{2}$/.test(t)) return { date: `${t}-01`, precision: 'month' };
  if (/^\d{4}$/.test(t)) return { date: `${t}-01-01`, precision: 'year' };
  return undefined;
}

/** A date, or the date part of a date-time; partial dates (a year) are dropped. */
function dateOf(v: unknown): string | undefined {
  const t = text(v);
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : undefined;
}

type Root = 'NewReleaseMessage' | 'PurgeReleaseMessage';

/** Parses an ERN 4.3 message and returns its root element and which one it is. */
function parseRoot(xml: string): { root: Root; msg: Node } {
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch (e) {
    throw new ErnError(`Not well-formed XML: ${(e as Error).message}`);
  }
  const root: Root | undefined =
    'NewReleaseMessage' in doc
      ? 'NewReleaseMessage'
      : 'PurgeReleaseMessage' in doc
        ? 'PurgeReleaseMessage'
        : undefined;
  if (!root) throw new ErnError('Not an ERN NewReleaseMessage or PurgeReleaseMessage.');
  // The parser drops namespace declarations; read the root element's from the source.
  const rootTag = new RegExp(`<(?:[\\w.-]+:)?${root}\\b[^>]*>`).exec(xml)?.[0] ?? '';
  const declared = [...rootTag.matchAll(/xmlns(?::[\w.-]+)?\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
  if (!declared.some((ns) => ns !== undefined && NAMESPACE.test(ns))) {
    throw new ErnError('Only ERN 4.3 (namespace http://ddex.net/xml/ern/43x) is supported.');
  }
  return { root, msg: doc[root] as Node };
}

function senderOf(msg: Node) {
  const header = node(msg['MessageHeader']);
  const sender = node(header['MessageSender']);
  return {
    senderName: text(node(arr(sender['PartyName'])[0])['FullName']) ?? 'Unknown licensor',
    senderId: text(sender['PartyId']) ?? 'unknown',
    messageId: text(header['MessageId']) ?? 'unknown',
  };
}

/** Reads either message: a release to create or update, or one to purge. */
export function readErn(
  xml: string,
  now = new Date(),
): { kind: 'release'; conversion: ErnConversion } | { kind: 'purge'; purge: ErnPurge } {
  const { root, msg } = parseRoot(xml);
  if (root === 'PurgeReleaseMessage') {
    const icpn = text(node(node(msg['PurgedRelease'])['ReleaseId'])['ICPN']);
    if (!icpn || !/^\d{12,14}$/.test(icpn)) {
      throw new ErnError('A purge must name the release by its ICPN.');
    }
    const { senderId, messageId } = senderOf(msg);
    return { kind: 'purge', purge: { icpn, senderId, messageId } };
  }
  return { kind: 'release', conversion: convert(msg, now) };
}

/** Converts one ERN 4.3 NewReleaseMessage. Throws ErnError on what it cannot import. */
export function ernToManifest(xml: string, now = new Date()): ErnConversion {
  const { root, msg } = parseRoot(xml);
  if (root !== 'NewReleaseMessage') throw new ErnError('Not an ERN NewReleaseMessage.');
  return convert(msg, now);
}

function convert(msg: Node, now: Date): ErnConversion {
  const { senderName, senderId, messageId } = senderOf(msg);

  const parties = new Map<string, string>();
  for (const p of arr(node(msg['PartyList'])['Party'])) {
    const ref = text(p['PartyReference']);
    const name = text(node(arr(p['PartyName'])[0])['FullName']);
    if (ref && name) parties.set(ref, name.slice(0, 300));
  }
  const partyName = (ref: string) => {
    const name = parties.get(ref);
    if (!name) throw new ErnError(`Unknown party reference: ${ref}`);
    return name;
  };

  const artists = new Map<string, { key: string; name: string }>();
  const people = new Map<string, { key: string; name: string }>();
  const labels = new Map<string, { key: string; name: string }>();
  const artistKey = (ref: string) => {
    if (!artists.has(ref)) artists.set(ref, { key: keyOf('a', ref), name: partyName(ref) });
    return keyOf('a', ref);
  };
  const personKey = (ref: string) => {
    if (!people.has(ref)) people.set(ref, { key: keyOf('p', ref), name: partyName(ref) });
    return keyOf('p', ref);
  };
  const labelKey = (ref: string) => {
    if (!labels.has(ref)) labels.set(ref, { key: keyOf('l', ref), name: partyName(ref) });
    return keyOf('l', ref);
  };

  /** Main artists in display order; all display artists when none is marked main. */
  const mainArtists = (n: Node) => {
    const shown = arr(n['DisplayArtist']).sort(
      (a, b) => Number(a['@_SequenceNumber'] ?? 0) - Number(b['@_SequenceNumber'] ?? 0),
    );
    const main = shown.filter((d) => text(d['DisplayArtistRole']) === 'MainArtist');
    return (main.length > 0 ? main : shown)
      .map((d) => text(d['ArtistPartyReference']))
      .filter((r): r is string => r !== undefined)
      .map(artistKey);
  };

  const resources = node(msg['ResourceList']);
  const recordings: CatalogManifest['recordings'] = [];
  const credits: NonNullable<CatalogManifest['credits']> = [];
  const recordingKeys = new Map<string, string>();
  const isrcs: string[] = [];
  for (const r of arr(resources['SoundRecording'])) {
    const ref = text(r['ResourceReference']);
    const title = text(r['DisplayTitleText']);
    if (!ref || !title) throw new ErnError('A SoundRecording lacks its reference or title.');
    const key = keyOf('r', ref);
    recordingKeys.set(ref, key);
    const isrc = text(node(node(r['SoundRecordingEdition'])['ResourceId'])['ISRC']);
    const validIsrc = isrc && /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(isrc) ? isrc : undefined;
    if (validIsrc) isrcs.push(validIsrc);
    const files = arr(node(r['TechnicalDetails'])['DeliveryFile'])
      .map((f) => text(node(f['File'])['URI']))
      .filter((u): u is string => u !== undefined);
    const artistsOf = mainArtists(r);
    if (artistsOf.length === 0) throw new ErnError(`SoundRecording ${ref} has no display artist.`);
    recordings.push({
      key,
      title: title.slice(0, 300),
      ...(validIsrc ? { isrc: validIsrc } : {}),
      artists: artistsOf,
      ...(files[0] ? { audio: deliveryPath(files[0]) } : {}),
    });
    for (const c of arr(r['Contributor'])) {
      const who = text(c['ContributorPartyReference']);
      if (!who) continue;
      for (const role of arr(c['Role'])) {
        const mapped = CREDIT_ROLES[text(role['Value']) ?? text(role) ?? ''];
        if (!mapped) continue;
        credits.push({
          subject: key,
          contributor: personKey(who),
          role: mapped,
          creation_method: 'unknown',
          basis: 'declared',
          verification_state: 'distributor_verified',
        });
      }
    }
  }
  if (recordings.length === 0) throw new ErnError('The message has no SoundRecording.');

  const releases = arr(node(msg['ReleaseList'])['Release']);
  if (releases.length !== 1) throw new ErnError('Exactly one main Release is supported.');
  const release = releases[0] as Node;
  const releaseRef = text(release['ReleaseReference']);
  const releaseTitle = text(release['DisplayTitleText']);
  if (!releaseRef || !releaseTitle) throw new ErnError('The Release lacks reference or title.');

  // Tracks in order: resource groups (discs) and their items by SequenceNumber.
  const tracks: string[] = [];
  const walk = (group: Node) => {
    const items = [
      ...arr(group['ResourceGroupContentItem']).map((i) => ({ i, g: null as Node | null })),
      ...arr(group['ResourceGroup']).map((g) => ({ i: null as Node | null, g })),
    ].sort((a, b) => seq(a.i ?? a.g ?? {}) - seq(b.i ?? b.g ?? {}));
    for (const { i, g } of items) {
      if (g) walk(g);
      const ref = i ? text(i['ReleaseResourceReference']) : undefined;
      const key = ref ? recordingKeys.get(ref) : undefined;
      if (key && !tracks.includes(key)) tracks.push(key);
    }
  };
  for (const g of arr(release['ResourceGroup'])) walk(g);
  if (tracks.length === 0) throw new ErnError('The Release lists none of the SoundRecordings.');

  // The front cover: an Image resource of that type, with its file in the delivery.
  const coverImage = arr(resources['Image']).find((im) => text(im['Type']) === 'FrontCoverImage');
  const coverUri = coverImage
    ? text(node(node(coverImage['TechnicalDetails'])['File'])['URI'])
    : undefined;
  const cover = coverUri ? deliveryPath(coverUri) : undefined;

  const icpn = text(node(release['ReleaseId'])['ICPN']);
  const validIcpn = icpn && /^\d{12,14}$/.test(icpn) ? icpn : null;
  const labelRef = text(release['ReleaseLabelReference']);
  const released =
    releaseDateOf(release['OriginalReleaseDate']) ?? releaseDateOf(release['ReleaseDate']);
  const releaseArtists = mainArtists(release);
  if (releaseArtists.length === 0) throw new ErnError('The Release has no display artist.');
  // Before the manifest is assembled, so the label is in its list.
  const label = labelRef ? labelKey(labelRef) : undefined;

  // Deals of the main release become grants for its tracks. Deals with the same uses,
  // start and end differ only in territory (often one deal per country): one grant each.
  // A deal that starts later becomes a grant from that moment (ADR-0016 checks it).
  const terms = new Map<
    string,
    {
      uses: ('stream' | 'download')[];
      start: string | null;
      end: Date | null;
      territories: Set<string>;
    }
  >();
  const skippedDeals: string[] = [];
  for (const rd of arr(node(msg['DealList'])['ReleaseDeal'])) {
    const refs = arr(rd['DealReleaseReference']).map((r) => text(r));
    if (!refs.includes(releaseRef)) continue;
    for (const [n, deal] of arr(rd['Deal']).entries()) {
      const dealTerms = node(deal['DealTerms']);
      const dealName = `deal ${String(n + 1)}`;
      if (arr(dealTerms['ExcludedTerritoryCode']).length > 0) {
        throw new ErnError(`${dealName}: excluded territories are not supported yet.`);
      }
      const period = node(dealTerms['ValidityPeriod']);
      const start = text(period['StartDateTime']) ?? dateOf(period['StartDate']);
      const endText = text(period['EndDateTime']) ?? dateOf(period['EndDate']);
      // An end date covers that whole day (DDEX: start and end dates are included).
      const end = endText
        ? endText.length === 10
          ? new Date(`${endText}T23:59:59.999Z`)
          : new Date(endText)
        : null;
      if (end && end <= now) {
        skippedDeals.push(`${dealName}: ended ${endText ?? ''}`);
        continue;
      }
      const uses = new Set<'stream' | 'download'>();
      for (const u of arr(dealTerms['UseType'])) {
        const v = text(u) ?? '';
        if (STREAM_USES.has(v)) uses.add('stream');
        if (DOWNLOAD_USES.has(v)) uses.add('download');
      }
      if (uses.size === 0) {
        skippedDeals.push(`${dealName}: no streaming or download use`);
        continue;
      }
      const territories = arr(dealTerms['TerritoryCode'])
        .map((t) => text(t))
        .filter((t): t is string => t !== undefined)
        .map((t) => (t === 'Worldwide' ? 'WORLD' : t))
        .filter((t) => /^([A-Z]{2}|WORLD)$/.test(t));
      if (territories.length === 0) {
        skippedDeals.push(`${dealName}: no supported territory`);
        continue;
      }
      const sorted = [...uses].sort();
      const from = start ? new Date(start.length === 10 ? `${start}T00:00:00Z` : start) : null;
      if (from && Number.isNaN(from.getTime())) {
        throw new ErnError(`${dealName}: start is not a date: ${start ?? ''}`);
      }
      const startIso = from?.toISOString() ?? null;
      const key = `${sorted.join(',')}|${startIso ?? ''}|${end?.toISOString() ?? ''}`;
      const same = terms.get(key) ?? {
        uses: sorted,
        start: startIso,
        end,
        territories: new Set<string>(),
      };
      for (const t of territories) same.territories.add(t);
      terms.set(key, same);
    }
  }
  const grants: NonNullable<CatalogManifest['grants']> = [];
  for (const t of terms.values()) {
    for (const recording of tracks) {
      grants.push({
        recording,
        rights_holder: senderName.slice(0, 200),
        territories: [...t.territories],
        uses: t.uses,
        contract_ref: `ddex:${senderId}:${messageId}:${t.uses.join('+')}`.slice(0, 200),
        ...(t.start ? { valid_from: t.start } : {}),
        ...(t.end ? { valid_to: t.end.toISOString() } : {}),
      });
    }
  }

  return {
    manifest: {
      source: `ddex:${senderId}:${messageId}`.slice(0, 100),
      artists: [...artists.values()],
      people: [...people.values()],
      labels: [...labels.values()],
      recordings,
      releases: [
        {
          key: keyOf('rel', releaseRef),
          title: releaseTitle.slice(0, 300),
          type: releaseType(release),
          ...(label ? { label } : {}),
          ...(released ? { date: released.date, date_precision: released.precision } : {}),
          ...(validIcpn ? { upc: validIcpn } : {}),
          ...(cover ? { cover } : {}),
          artists: releaseArtists,
          tracks,
        },
      ],
      credits,
      grants,
    },
    icpn: validIcpn,
    isrcs,
    senderId,
    messageId,
    skippedDeals,
  };
}
