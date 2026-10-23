import { useState, type ReactNode } from 'react';

/**
 * The rabbit symbol (BRD §2.1): a side profile with two ears and an eye. Shape S2,
 * chosen 2026-10-13 from the canvas candidates: ears set apart and a larger eye, so
 * both ears and the eye stay distinct down to 16 px. The eye is a cut-out, so the
 * mark sits on any surface. Keep in sync with public/favicon.svg and icons/*.svg.
 */
/**
 * OQ-BRD-05 (decided 2026-10-13): the symbol is never drawn below 16 px, and it keeps
 * clear space of at least a quarter of its height on every side (around the symbol or
 * the symbol+wordmark lockup; the gap inside the lockup is not clear space).
 */
export const SYMBOL_MIN_PX = 16;

export function RabitSymbol({ size = 28, title }: { size?: number; title?: string }) {
  const px = Math.max(SYMBOL_MIN_PX, size);
  return (
    <svg
      className="symbol"
      width={px}
      height={px}
      viewBox="0 0 100 100"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g fill="currentColor">
        <ellipse cx="55" cy="25" rx="7" ry="24" transform="rotate(22 55 25)" />
        <ellipse cx="75" cy="42" rx="6.5" ry="19" transform="rotate(68 75 42)" />
        {/* The eye is a hole in the head (even-odd), so no id-bearing mask is needed. */}
        <path
          fillRule="evenodd"
          d="M17 70C15 56 27 47 42 47c16 0 24 12 19 25-4 8-11 12-14 21-8-8-28-9-30-23zM27.5 62a4.6 4.6 0 1 0 9.2 0 4.6 4.6 0 1 0-9.2 0z"
        />
      </g>
    </svg>
  );
}

const ICONS = {
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  dig: (
    <>
      <circle cx="12" cy="5.5" r="2.5" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
      <path d="M12 8v4m0 0-4.6 4.6M12 12l4.6 4.6" />
    </>
  ),
  archive: (
    <>
      <rect x="3.5" y="4" width="17" height="5" rx="1" />
      <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9m-9 4h4" />
    </>
  ),
  studio: (
    <>
      <path d="M6 4v16M12 4v16M18 4v16" />
      <rect x="4" y="13" width="4" height="3" rx="1" />
      <rect x="10" y="7" width="4" height="3" rx="1" />
      <rect x="16" y="11" width="4" height="3" rx="1" />
    </>
  ),
  playlists: (
    <>
      <path d="M4 6h12M4 12h12M4 18h7" />
      <circle cx="17.5" cy="17.5" r="2.5" />
      <path d="M20 17.5V9" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </>
  ),
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" />,
  pause: (
    <>
      <rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
      <rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
    </>
  ),
  next: (
    <>
      <path d="M6 6v12l9-6z" fill="currentColor" />
      <path d="M18 6v12" />
    </>
  ),
  previous: (
    <>
      <path d="M18 6v12L9 12z" fill="currentColor" />
      <path d="M6 6v12" />
    </>
  ),
  back: <path d="m15 5-7 7 7 7" />,
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </>
  ),
  spark: <path d="M12 4l1.6 4.8L18.5 10l-4.9 1.4L12 16l-1.6-4.6L5.5 10l4.9-1.2z" />,
  credits: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z" />
      <path d="m8.8 12 2.3 2.3 4.2-4.6" />
    </>
  ),
  ops: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z" />
      <path d="m8.8 12 2.3 2.3 4.2-4.6" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

/** Stroke icons; always decorative — the control around them carries the name. */
export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

/** Brand-palette compositions for covers; picked by id so a release always looks the same. */
const COVER_PALETTES: readonly (readonly [string, string, string])[] = [
  ['#2b2540', '#eb7b4c', '#f4f1ec'],
  ['#1f2a26', '#a9b5ab', '#eb7b4c'],
  ['#3a2219', '#f4f1ec', '#7865c8'],
  ['#e9e3d8', '#7865c8', '#111111'],
  ['#18202e', '#eb7b4c', '#a9b5ab'],
  ['#2e2b27', '#d8cfc2', '#59615b'],
];

/**
 * FNV-1a. The previous `h * 31 + c` reduced to the sum of the characters modulo 6 and
 * 30 (31 ≡ 1), so ids ingested together often drew the same cover side by side.
 */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Stand-in artwork: the catalog has no cover images yet, so each release or track
 * gets a fixed abstract composition. Decorative — the title next to it names it.
 */
/** Signed cover URLs by edge in pixels (ADR-0031), from the API. */
export type Artwork = Partial<Record<'300' | '600' | '1200', string>> | null | undefined;

/**
 * A release's cover: the real one when the API gave its URLs (the browser picks the
 * size for the screen), otherwise, or if it fails to load, the stand-in drawn from
 * the id.
 */
export function Cover({
  id,
  size,
  round = 12,
  art,
}: {
  id: string;
  size: number;
  round?: number;
  art?: Artwork;
}) {
  const [broken, setBroken] = useState(false);
  const small = art?.['300'];
  if (art && small && !broken) {
    const srcSet = (['300', '600', '1200'] as const)
      .filter((k) => art[k])
      .map((k) => `${art[k] ?? ''} ${k}w`)
      .join(', ');
    return (
      <img
        className="cover"
        src={small}
        srcSet={srcSet}
        sizes={`${String(size)}px`}
        width={size}
        height={size}
        alt=""
        loading="lazy"
        decoding="async"
        style={{ borderRadius: round }}
        onError={() => {
          setBroken(true);
        }}
      />
    );
  }
  return <StandInCover id={id} size={size} round={round} />;
}

function StandInCover({ id, size, round }: { id: string; size: number; round: number }) {
  const [bg, disc, line] = COVER_PALETTES[hash(id) % COVER_PALETTES.length] ?? [
    '#2b2540',
    '#eb7b4c',
    '#f4f1ec',
  ];
  // The same composition everywhere; the disc moves and grows a little per release.
  const shift = (hash(`${id}:x`) % 30) - 15;
  const lift = (hash(`${id}:y`) % 13) - 6;
  const radius = 26 + (hash(`${id}:r`) % 10);
  return (
    <svg
      className="cover"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      style={{ borderRadius: round }}
    >
      <rect width="100" height="100" fill={bg} />
      <circle cx={61 + shift / 2} cy={43 + lift} r={radius} fill={disc} />
      <rect y="64" width="100" height="1.4" fill={line} />
      <rect y="70" width="100" height="0.8" fill={line} opacity="0.6" />
      <rect y="75" width="100" height="0.5" fill={line} opacity="0.35" />
    </svg>
  );
}

/** First user-perceived character (grapheme), so Hangul and emoji stay whole. */
function initial(name: string): string {
  const first = new Intl.Segmenter().segment(name.trim())[Symbol.iterator]().next();
  return first.done ? '?' : first.value.segment.toUpperCase();
}

/**
 * The small picture beside any item: a stand-in cover for catalog recordings and
 * releases, an icon tile for private audio and Audio Logs, an initial for people,
 * artists and labels. Always decorative — the item's title names it.
 */
export function Mark({
  id,
  kind,
  name,
  size,
}: {
  id: string;
  kind: string;
  name: string;
  size: number;
}) {
  if (kind === 'recording' || kind === 'release')
    return <Cover id={id} size={size} round={size / 4} />;
  if (kind === 'audio_log' || kind === 'private_audio' || kind === 'audio_source')
    return (
      <span
        className={kind === 'audio_log' ? 'item-tile log' : 'item-tile'}
        style={{ width: size, height: size, borderRadius: size / 4 }}
        aria-hidden="true"
      >
        <Icon name={kind === 'audio_log' ? 'mic' : 'studio'} size={Math.round(size * 0.4)} />
      </span>
    );
  return (
    <span
      className={`entity-initial kind-${kind}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {initial(name)}
    </span>
  );
}
