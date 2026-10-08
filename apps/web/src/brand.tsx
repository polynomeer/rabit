import type { ReactNode } from 'react';

/**
 * The rabbit symbol (BRD §2.1): a side profile with two ears and an eye.
 * A working redraw of the identity board until the final vector lands (OQ-BRD-05);
 * the eye is a cut-out so the mark sits on any surface.
 */
export function RabitSymbol({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg
      className="symbol"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g fill="currentColor">
        <ellipse cx="57" cy="27" rx="8.5" ry="25" transform="rotate(28 57 27)" />
        <ellipse cx="73" cy="44" rx="7.5" ry="20" transform="rotate(64 73 44)" />
        {/* The eye is a hole in the head (even-odd), so no id-bearing mask is needed. */}
        <path
          fillRule="evenodd"
          d="M18 72C15 58 28 47 44 47c16 0 23 13 17 26-4 8-11 11-14 20-7-8-25-9-29-21zM28.4 63a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0z"
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

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Stand-in artwork: the catalog has no cover images yet, so each release or track
 * gets a fixed abstract composition. Decorative — the title next to it names it.
 */
export function Cover({ id, size, round = 12 }: { id: string; size: number; round?: number }) {
  const [bg, disc, line] = COVER_PALETTES[hash(id) % COVER_PALETTES.length] ?? [
    '#2b2540',
    '#eb7b4c',
    '#f4f1ec',
  ];
  const shift = (hash(`${id}:x`) % 30) - 15;
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
      <circle cx={61 + shift / 2} cy="43" r="31" fill={disc} />
      <rect y="64" width="100" height="1.4" fill={line} />
      <rect y="70" width="100" height="0.8" fill={line} opacity="0.6" />
      <rect y="75" width="100" height="0.5" fill={line} opacity="0.35" />
    </svg>
  );
}
