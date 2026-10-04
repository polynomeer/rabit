import { describe, expect, it } from 'vitest';
import { isIdOf, kindOf, newId, parseId, ulid } from '../../src/platform/ids.js';

describe('ids', () => {
  it('generates prefixed ULIDs', () => {
    const id = newId('audioSource');
    expect(id).toMatch(/^asr_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(isIdOf('audioSource', id)).toBe(true);
    expect(isIdOf('user', id)).toBe(false);
    expect(kindOf(id)).toBe('audioSource');
  });

  it('sorts by time', () => {
    expect(ulid(1_000) < ulid(2_000)).toBe(true);
  });

  it('rejects malformed ids', () => {
    expect(parseId('user', 'usr_123')).toBeNull();
    expect(parseId('user', 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(
      'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
    expect(parseId('user', 42)).toBeNull();
    expect(parseId('user', 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAU')).toBeNull(); // U is not Crockford
  });
});
