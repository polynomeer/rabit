import type { MessageKey } from '../i18n';
import type { Variant } from './variants';

/** Answers to the waitlist form; the segment question mirrors screener question 4. */
export const SEGMENTS = ['digger', 'collector', 'creator', 'recorder', 'none'] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABEL: Readonly<Record<Segment, MessageKey>> = {
  digger: 'landing.form.segment.digger',
  collector: 'landing.form.segment.collector',
  creator: 'landing.form.segment.creator',
  recorder: 'landing.form.segment.recorder',
  none: 'landing.form.segment.none',
};

/** Music services asked about; VIBE is here for H12 (it closes on 2026-12-31). */
export const SERVICES = [
  'melon',
  'youtube_music',
  'spotify',
  'genie',
  'flo',
  'vibe',
  'apple_music',
  'bugs',
  'soundcloud',
  'other',
  'none',
] as const;
export type Service = (typeof SERVICES)[number];

export interface WaitlistEntry {
  email: string;
  segments: Segment[];
  services: Service[];
  adult: boolean;
  consent: boolean;
  variant: Variant;
}

export type WaitlistField = 'email' | 'segments' | 'services' | 'adult' | 'consent';

export const FIELD_ERROR: Readonly<Record<WaitlistField, MessageKey>> = {
  email: 'landing.form.error.email',
  segments: 'landing.form.error.segments',
  services: 'landing.form.error.services',
  adult: 'landing.form.error.adult',
  consent: 'landing.form.error.consent',
};

// A light shape check; the address is proven only by an invitation reaching it.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The fields that block sign-up, in form order. Minors are refused (Q01 is open). */
export function validate(entry: WaitlistEntry): WaitlistField[] {
  const errors: WaitlistField[] = [];
  if (!EMAIL.test(entry.email.trim()) || entry.email.length > 254) errors.push('email');
  if (entry.segments.length === 0) errors.push('segments');
  if (entry.services.length === 0) errors.push('services');
  if (!entry.adult) errors.push('adult');
  if (!entry.consent) errors.push('consent');
  return errors;
}

export type SubmitResult = { status: 'not-connected' };

/**
 * Draft: nothing is sent or stored. Keeping waitlist e-mails needs owner decisions
 * first — where they are stored and for how long, and the privacy notice
 * (docs/plans/waitlist-landing.md). Until then the form only checks its answers.
 */
export function submitWaitlist(_entry: WaitlistEntry): Promise<SubmitResult> {
  return Promise.resolve({ status: 'not-connected' });
}
