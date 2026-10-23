import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

/** Editorial shelves (ADR-0029): curated, targeted, scheduled, and only what plays here. */
let h: Harness;
let ops: Awaited<ReturnType<typeof asOperator>>;
let cat: Awaited<ReturnType<typeof seedCatalog>>;
let unlicensed: Awaited<ReturnType<typeof seedCatalog>>;
let kr: TestUser;
let jp: TestUser;

beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  cat = await seedCatalog(h);
  unlicensed = await seedCatalog(h, { grant: false });
  kr = await h.user();
  await ops.setCountry(kr, 'KR');
  await ops.subscribe(kr);
  jp = await h.user();
  await ops.setCountry(jp, 'JP');
});
beforeEach(async () => {
  await h.ctx.db.deleteFrom('editorial_shelf').execute();
});
afterAll(() => h.close());

const save = (body: Record<string, unknown>, id?: string, who: TestUser = ops.op) =>
  h.api.inject({
    method: id ? 'PUT' : 'POST',
    url: `/v1/ops/editorial/shelves${id ? `/${id}` : ''}`,
    headers: who.headers,
    payload: { reason: 'weekly picks', ...body },
  });

const live = async (u: TestUser) => {
  const r = await h.api.inject({ url: '/v1/editorial/shelves', headers: u.headers });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{
    shelves: {
      shelf_id: string;
      title: string;
      items: { release: { release_id: string }; note: string | null; playable_tracks: number }[];
    }[];
  }>().shelves;
};

describe('editorial shelves', () => {
  it('shows a published shelf in its territory, in curated order, with notes', async () => {
    const created = await save({
      title: '이번 주의 발견',
      territories: ['KR'],
      items: [
        { release_id: cat.ids['single'], note: '조용한 밤에' },
        { release_id: cat.ids['album'] },
      ],
    });
    expect(created.statusCode, created.body).toBe(201);
    const shelf = created.json<{ shelf_id: string; published: boolean }>();
    expect(shelf.published).toBe(false);
    expect(await live(kr)).toEqual([]);

    const published = await save(
      {
        title: '이번 주의 발견',
        territories: ['KR'],
        published: true,
        items: [
          { release_id: cat.ids['single'], note: '조용한 밤에' },
          { release_id: cat.ids['album'] },
        ],
      },
      shelf.shelf_id,
    );
    expect(published.statusCode, published.body).toBe(200);
    const [seen] = await live(kr);
    expect(seen?.title).toBe('이번 주의 발견');
    expect(seen?.items.map((i) => i.release.release_id)).toEqual([
      cat.ids['single'],
      cat.ids['album'],
    ]);
    expect(seen?.items[0]?.note).toBe('조용한 밤에');
    // Another country does not see a KR shelf.
    expect(await live(jp)).toEqual([]);

    const log = await h.ctx.db
      .selectFrom('audit_log')
      .select(['action', 'reason'])
      .where('subject_id', '=', shelf.shelf_id)
      .orderBy('id')
      .execute();
    expect(log).toEqual([
      { action: 'editorial_shelf.created', reason: 'weekly picks' },
      { action: 'editorial_shelf.updated', reason: 'weekly picks' },
    ]);
  });

  it('keeps only releases available in the listener region and drops empty shelves', async () => {
    await save({
      title: 'Everywhere',
      published: true,
      items: [{ release_id: unlicensed.ids['album'] }, { release_id: cat.ids['album'] }],
    });
    const [seen] = await live(kr);
    expect(seen?.items.map((i) => i.release.release_id)).toEqual([cat.ids['album']]);
    // Nothing on it is licensed in JP: the shelf is left out there.
    expect(await live(jp)).toEqual([]);
  });

  it('respects the time window', async () => {
    const hour = 3_600_000;
    await save({
      title: 'Later',
      published: true,
      starts_at: new Date(Date.now() + hour).toISOString(),
      items: [{ release_id: cat.ids['album'] }],
    });
    await save({
      title: 'Over',
      published: true,
      starts_at: new Date(Date.now() - 2 * hour).toISOString(),
      ends_at: new Date(Date.now() - hour).toISOString(),
      items: [{ release_id: cat.ids['album'] }],
    });
    await save({
      title: 'Now',
      published: true,
      starts_at: new Date(Date.now() - hour).toISOString(),
      ends_at: new Date(Date.now() + hour).toISOString(),
      items: [{ release_id: cat.ids['album'] }],
    });
    expect((await live(kr)).map((s) => s.title)).toEqual(['Now']);
  });

  it('validates shelves and is for operators only', async () => {
    const album = cat.ids['album'];
    expect(
      (await save({ title: 'Dup', items: [{ release_id: album }, { release_id: album }] }))
        .statusCode,
    ).toBe(400);
    expect(
      (await save({ title: 'Unknown', items: [{ release_id: `rel_${'0'.repeat(26)}` }] }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await save({
          title: 'Backwards',
          starts_at: '2026-11-02T00:00:00.000Z',
          ends_at: '2026-11-01T00:00:00.000Z',
        })
      ).statusCode,
    ).toBe(400);
    expect((await save({ title: 'Lower case', territories: ['kr'] })).statusCode).toBe(400);
    expect((await save({ title: 'No reason', reason: undefined })).statusCode).toBe(400);
    expect((await save({ title: 'Listener' }, undefined, kr)).statusCode).toBe(403);
    const list = await h.api.inject({ url: '/v1/ops/editorial/shelves', headers: kr.headers });
    expect(list.statusCode).toBe(403);
  });

  it('deletes a shelf with a reason', async () => {
    const id = (await save({ title: 'Gone', published: true })).json<{ shelf_id: string }>()
      .shelf_id;
    const noReason = await h.api.inject({
      method: 'DELETE',
      url: `/v1/ops/editorial/shelves/${id}`,
      headers: ops.op.headers,
    });
    expect(noReason.statusCode).toBe(400);
    const del = await h.api.inject({
      method: 'DELETE',
      url: `/v1/ops/editorial/shelves/${id}?reason=campaign%20over`,
      headers: ops.op.headers,
    });
    expect(del.statusCode).toBe(204);
    const list = await h.api.inject({ url: '/v1/ops/editorial/shelves', headers: ops.op.headers });
    expect(list.json<{ items: unknown[] }>().items).toEqual([]);
  });
});
