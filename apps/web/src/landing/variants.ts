import type { MessageKey } from '../i18n';

/**
 * The three messages of the waitlist experiment (E2): each leads with a different
 * value — A the unified archive (H1/H2), B digging (H3), C trust (H8). Only the hero
 * and the three points differ; the rest of the page is the same, so a difference in
 * sign-ups can be put down to the message.
 */
export const VARIANTS = ['a', 'b', 'c'] as const;
export type Variant = (typeof VARIANTS)[number];

export interface VariantCopy {
  title: MessageKey;
  lede: MessageKey;
  points: readonly [MessageKey, MessageKey, MessageKey];
}

export const COPY: Readonly<Record<Variant, VariantCopy>> = {
  a: {
    title: 'landing.a.title',
    lede: 'landing.a.lede',
    points: ['landing.a.point1', 'landing.a.point2', 'landing.a.point3'],
  },
  b: {
    title: 'landing.b.title',
    lede: 'landing.b.lede',
    points: ['landing.b.point1', 'landing.b.point2', 'landing.b.point3'],
  },
  c: {
    title: 'landing.c.title',
    lede: 'landing.c.lede',
    points: ['landing.c.point1', 'landing.c.point2', 'landing.c.point3'],
  },
};

const STORAGE_KEY = 'rabit.landing.variant';

const isVariant = (v: string | null | undefined): v is Variant => VARIANTS.some((x) => x === v);

/**
 * Picks the message for this visitor: `?v=a|b|c` wins (previews and per-message links),
 * then the one this browser saw before, else one at random. The choice is kept only in
 * this browser's storage — no cookie, nothing that identifies the visitor.
 */
export function pickVariant(search: string, random: () => number = Math.random): Variant {
  const asked = new URLSearchParams(search).get('v');
  if (isVariant(asked)) return asked;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private window, settings): fall through to a fresh pick.
  }
  if (isVariant(stored)) return stored;
  const picked = VARIANTS.at(Math.floor(random() * VARIANTS.length)) ?? 'a';
  try {
    localStorage.setItem(STORAGE_KEY, picked);
  } catch {
    // Without storage the visitor may see another message next time; the count stays fair.
  }
  return picked;
}
