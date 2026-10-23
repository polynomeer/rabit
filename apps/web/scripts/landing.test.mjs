// Unit tests for the waitlist landing draft's pure logic (node --test; Node strips the
// TypeScript types on import). The page itself is checked by hand on the dev server.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickVariant, VARIANTS } from '../src/landing/variants.ts';
import { submitWaitlist, validate } from '../src/landing/waitlist.ts';

const entry = (over = {}) => ({
  email: 'listener@example.com',
  segments: ['digger'],
  services: ['melon'],
  adult: true,
  consent: true,
  variant: 'a',
  ...over,
});

test('?v= picks the message for previews and per-message links', () => {
  for (const v of VARIANTS) assert.equal(pickVariant(`?v=${v}`), v);
});

test('an unknown ?v= falls back to a random message', () => {
  assert.equal(
    pickVariant('?v=z', () => 0.99),
    'c',
  );
  assert.equal(
    pickVariant('', () => 0),
    'a',
  );
});

test('a complete entry has no errors', () => {
  assert.deepEqual(validate(entry()), []);
});

test('every missing answer is reported in form order', () => {
  assert.deepEqual(
    validate(
      entry({ email: 'not-an-email', segments: [], services: [], adult: false, consent: false }),
    ),
    ['email', 'segments', 'services', 'adult', 'consent'],
  );
});

test('minors and entries without consent are refused', () => {
  assert.deepEqual(validate(entry({ adult: false })), ['adult']);
  assert.deepEqual(validate(entry({ consent: false })), ['consent']);
});

test('the draft sends nothing', async () => {
  assert.deepEqual(await submitWaitlist(entry()), { status: 'not-connected' });
});
