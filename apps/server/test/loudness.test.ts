import { describe, expect, it } from 'vitest';
import { loudnessGain, renditionsOf } from '../src/modules/playback/sessions.js';

describe('loudness normalisation gain (ADR-0008 amendment 2026-10-20)', () => {
  it('turns a loud master down to the target', () => {
    expect(loudnessGain({ integrated_lufs: -7.2, true_peak_dbtp: 0.4 }, -14)).toEqual({
      integrated_lufs: -7.2,
      true_peak_dbtp: 0.4,
      target_lufs: -14,
      gain_db: -6.8,
    });
  });

  it('raises a quiet track only as far as its true peak allows', () => {
    expect(loudnessGain({ integrated_lufs: -20, true_peak_dbtp: -3 }, -14)?.gain_db).toBe(2);
    expect(loudnessGain({ integrated_lufs: -20, true_peak_dbtp: -10 }, -14)?.gain_db).toBe(6);
  });

  it('is absent when the audio was not measured', () => {
    expect(loudnessGain({}, -14)).toBeNull();
    expect(loudnessGain(null, -14)).toBeNull();
    expect(loudnessGain({ integrated_lufs: -9 }, -14)).toBeNull();
  });
});

describe('rendition ladder in sessions (ADR-0008 amendment 2026-10-20)', () => {
  it('reads the ladder from the version, or falls back to the single legacy rendition', () => {
    expect(renditionsOf({ renditions_kbps: [96, 160, 256] })).toEqual([96, 160, 256]);
    expect(renditionsOf({ integrated_lufs: -9 })).toBeNull();
    expect(renditionsOf({ renditions_kbps: [] })).toBeNull();
    expect(renditionsOf(null)).toBeNull();
  });
});
