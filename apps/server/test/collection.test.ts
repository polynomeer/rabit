import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectionExportSection, validGtin } from '../src/modules/collection/index.js';
import { newId } from '../src/platform/ids.js';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

let h: Harness;
let ops: Awaited<ReturnType<typeof asOperator>>;
let cat: Awaited<ReturnType<typeof seedCatalog>>;
beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  cat = await seedCatalog(h);
});
afterAll(() => h.close());

// A valid EAN-13 and the same code with a wrong check digit.
const EAN = '4006381333931';
const BAD_EAN = '4006381333932';

const create = (u: TestUser, payload: Record<string, unknown>) =>
  h.api.inject({ method: 'POST', url: '/v1/physical-items', headers: u.headers, payload });

describe('Physical Collection, manual registration (COL-001/002/007)', () => {
  it('records, lists, edits and removes a CD of a catalog release', async () => {
    const u = await h.user();
    const r = await create(u, {
      format: 'cd',
      title: 'Test Album (first pressing)',
      artist_name: 'The Test Tones',
      barcode: EAN,
      catalog_number: 'TT-001',
      release_id: cat.ids['album'],
      notes: 'Bought in 2004, obi strip intact',
    });
    expect(r.statusCode, r.body).toBe(201);
    const item = r.json();
    expect(item).toMatchObject({
      physical_item_id: expect.stringMatching(/^phy_/),
      format: 'cd',
      barcode: EAN,
      release: { release_id: cat.ids['album'] },
      verification_state: 'self_declared',
    });

    const list = await h.api.inject({ url: '/v1/physical-items', headers: u.headers });
    expect(list.json().items.map((i: { physical_item_id: string }) => i.physical_item_id)).toEqual([
      item.physical_item_id,
    ]);

    const patched = await h.api.inject({
      method: 'PATCH',
      url: `/v1/physical-items/${item.physical_item_id}`,
      headers: u.headers,
      payload: { notes: 'Disc slightly scratched', barcode: null },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json()).toMatchObject({ notes: 'Disc slightly scratched', barcode: null });

    const del = await h.api.inject({
      method: 'DELETE',
      url: `/v1/physical-items/${item.physical_item_id}`,
      headers: u.headers,
    });
    expect(del.statusCode).toBe(204);
    const gone = await h.api.inject({
      url: `/v1/physical-items/${item.physical_item_id}`,
      headers: u.headers,
    });
    expect(gone.statusCode).toBe(404);
  });

  it('pages a long collection', async () => {
    const u = await h.user();
    for (let i = 0; i < 5; i++) await create(u, { format: 'vinyl', title: `LP ${i}` });
    const seen: string[] = [];
    let cursor: string | null = null;
    type Page = { items: { title: string }[]; next_cursor: string | null };
    do {
      const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const res = await h.api.inject({
        url: `/v1/physical-items?limit=2${query}`,
        headers: u.headers,
      });
      const body: Page = res.json();
      seen.push(...body.items.map((i) => i.title));
      cursor = body.next_cursor;
    } while (cursor);
    expect(seen).toEqual(['LP 4', 'LP 3', 'LP 2', 'LP 1', 'LP 0']);
  });

  it('validates input and never lets the owner set the verification state', async () => {
    const u = await h.user();
    const bad = [
      { format: 'cd', title: 'x', barcode: BAD_EAN },
      { format: 'cd', title: 'x', barcode: '12345' },
      { format: 'minidisc', title: 'x' },
      { format: 'cd', title: '' },
      { format: 'cd', title: 'x', release_id: newId('release') },
      { format: 'cd', title: 'x', verification_state: 'evidence_reviewed' },
    ];
    for (const payload of bad) {
      const r = await create(u, payload);
      expect(r.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const ok = (await create(u, { format: 'cd', title: 'x' })).json();
    const r = await h.api.inject({
      method: 'PATCH',
      url: `/v1/physical-items/${ok.physical_item_id}`,
      headers: u.headers,
      payload: { verification_state: 'evidence_reviewed' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('is private to its owner (T04)', async () => {
    const owner = await h.user();
    const other = await h.user();
    const item = (await create(owner, { format: 'cassette', title: 'Mixtape 1998' })).json();
    const url = `/v1/physical-items/${item.physical_item_id}`;
    expect((await h.api.inject({ url, headers: other.headers })).statusCode).toBe(404);
    expect(
      (
        await h.api.inject({
          method: 'PATCH',
          url,
          headers: other.headers,
          payload: { title: 'mine now' },
        })
      ).statusCode,
    ).toBe(404);
    expect((await h.api.inject({ method: 'DELETE', url, headers: other.headers })).statusCode).toBe(
      404,
    );
    const list = await h.api.inject({ url: '/v1/physical-items', headers: other.headers });
    expect(list.json().items).toEqual([]);
    expect((await h.api.inject({ url, headers: owner.headers })).json().title).toBe('Mixtape 1998');
  });
});

describe('owning the CD never grants the digital master (COL-003)', () => {
  it('leaves catalog playback refused after registering the release', async () => {
    const u = await h.user();
    await ops.setCountry(u, 'KR');
    const play = () =>
      h.api.inject({
        method: 'POST',
        url: '/v1/playback-sessions',
        headers: u.headers,
        payload: { recording_id: cat.ids['r1'], device_id: 'device-col-003' },
      });
    const before = await play();
    expect(before.statusCode).toBe(403);
    await create(u, { format: 'cd', title: 'Test Album', release_id: cat.ids['album'] });
    const after = await play();
    expect(after.statusCode).toBe(403);
    expect(after.json().error.code).toBe(before.json().error.code);
    const ents = await h.ctx.db
      .selectFrom('entitlement')
      .select('id')
      .where('user_id', '=', u.userId)
      .execute();
    expect(ents).toEqual([]);
  });

  it('has no database path from physical items to entitlements', async () => {
    const refs = await sql<{ from_table: string; to_table: string }>`
      SELECT c.conrelid::regclass::text AS from_table, c.confrelid::regclass::text AS to_table
        FROM pg_constraint c
       WHERE c.contype = 'f'
         AND (c.conrelid = 'physical_item'::regclass OR c.confrelid = 'physical_item'::regclass)`.execute(
      h.ctx.db,
    );
    expect(refs.rows.map((r) => r.to_table).sort()).toEqual(['app_user', 'release']);
    expect(refs.rows.every((r) => r.from_table === 'physical_item')).toBe(true);
    const triggers = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_trigger
       WHERE tgrelid = 'physical_item'::regclass AND NOT tgisinternal`.execute(h.ctx.db);
    expect(triggers.rows[0]?.n).toBe(0);
  });

  it('keeps the collection module away from entitlement and playback code', () => {
    const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../src/modules/collection');
    const imports = readdirSync(dir).flatMap((f) =>
      [...readFileSync(join(dir, f), 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!),
    );
    expect(
      imports.filter((s) => /modules\/(entitlement|playback)|\/(entitlement|playback)\//.test(s)),
    ).toEqual([]);
    const entitlementSrc = resolve(dir, '../entitlement');
    for (const f of readdirSync(entitlementSrc)) {
      expect(readFileSync(join(entitlementSrc, f), 'utf8')).not.toMatch(/physical_item/);
    }
  });
});

describe('collection data follows the account', () => {
  it('is exported, summarized without content for support, and deleted with the account', async () => {
    const u = await h.user();
    await create(u, { format: 'vinyl', title: 'Secret Title', notes: 'private note' });
    const [name, rows] = await collectionExportSection(h.ctx, u.userId);
    expect(name).toBe('physical_items');
    expect(rows).toEqual([
      expect.objectContaining({ title: 'Secret Title', notes: 'private note' }),
    ]);

    const summary = await h.api.inject({
      url: `/v1/ops/users/${u.userId}/support-summary?reason=ticket%201`,
      headers: ops.op.headers,
    });
    expect(summary.statusCode, summary.body).toBe(200);
    expect(summary.body).toContain('physical_items_by_format');
    expect(summary.body).not.toContain('Secret Title');
    expect(summary.body).not.toContain('private note');

    const del = await h.api.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { ...u.headers, 'idempotency-key': `del-${u.userId}` },
    });
    expect(del.statusCode).toBe(202);
    await h.worker.drain();
    const left = await h.ctx.db
      .selectFrom('physical_item')
      .select('id')
      .where('user_id', '=', u.userId)
      .execute();
    expect(left).toEqual([]);
  });
});

describe('GTIN check digit', () => {
  it('accepts EAN-13, UPC-A and EAN-8 and rejects wrong check digits', () => {
    expect(validGtin('4006381333931')).toBe(true);
    expect(validGtin('036000291452')).toBe(true);
    expect(validGtin('96385074')).toBe(true);
    expect(validGtin('4006381333932')).toBe(false);
    expect(validGtin('123456789')).toBe(false);
  });
});
