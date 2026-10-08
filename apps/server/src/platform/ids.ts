import { randomBytes } from 'node:crypto';

/** Entity prefixes (ADR-0015, docs/04-data/erd.md §1). */
export const ID_PREFIX = {
  user: 'usr',
  workspace: 'wsp',
  upload: 'upl',
  audioObject: 'aob',
  audioVersion: 'aov',
  audioSource: 'asr',
  audioAsset: 'ast',
  audioLog: 'alg',
  artist: 'art',
  person: 'per',
  label: 'lbl',
  release: 'rel',
  recording: 'rec',
  credit: 'crd',
  relation: 'mrl',
  rightsGrant: 'rgt',
  subscription: 'sub',
  entitlement: 'enl',
  offer: 'ofr',
  order: 'ord',
  refund: 'rfd',
  paymentEvent: 'pev',
  journal: 'jrn',
  mockPayment: 'mpy',
  playbackSession: 'pbs',
  listeningEvent: 'lev',
  libraryItem: 'lib',
  physicalItem: 'phy',
  playlist: 'pls',
  playlistItem: 'pli',
  export: 'exp',
  digSession: 'dgs',
  digNode: 'dgn',
  blindDig: 'bld',
  blindDigItem: 'bli',
  provenanceClaim: 'prc',
  integritySignal: 'isg',
  report: 'rpt',
  auditLog: 'adl',
  job: 'job',
  event: 'evt',
} as const;

export type IdKind = keyof typeof ID_PREFIX;

declare const idBrand: unique symbol;
/** Opaque, prefixed identifier. Different kinds cannot be mixed at compile time. */
export type Id<K extends IdKind> = string & { readonly [idBrand]: K };

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_PATTERN = '[0-9A-HJKMNP-TV-Z]{26}';

/** 26-character ULID: 48-bit millisecond timestamp + 80 random bits. */
export function ulid(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i++) {
    rand += CROCKFORD.charAt((bytes[i] ?? 0) % 32);
  }
  return time + rand;
}

export function newId<K extends IdKind>(kind: K, now?: number): Id<K> {
  return `${ID_PREFIX[kind]}_${ulid(now)}` as Id<K>;
}

const patterns = new Map<IdKind, RegExp>(
  (Object.keys(ID_PREFIX) as IdKind[]).map((k) => [
    k,
    new RegExp(`^${ID_PREFIX[k]}_${ULID_PATTERN}$`),
  ]),
);

export function isIdOf<K extends IdKind>(kind: K, raw: unknown): raw is Id<K> {
  return typeof raw === 'string' && (patterns.get(kind)?.test(raw) ?? false);
}

/** Returns the branded id, or null when the value is not an id of that kind. */
export function parseId<K extends IdKind>(kind: K, raw: unknown): Id<K> | null {
  return isIdOf(kind, raw) ? raw : null;
}

/** Kind of an id from its prefix, or null. */
export function kindOf(raw: string): IdKind | null {
  for (const k of Object.keys(ID_PREFIX) as IdKind[]) {
    if (patterns.get(k)?.test(raw)) return k;
  }
  return null;
}

export const ANY_ID_PATTERN = new RegExp(`^[a-z]{3}_${ULID_PATTERN}$`);
