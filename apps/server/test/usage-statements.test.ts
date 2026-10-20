import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeUsageStatements, foldAccountUsage } from '../src/modules/playback/index.js';
import { purgeListeningEvents } from '../src/modules/playback/listening.js';
import { seoulMonth } from '../src/modules/playback/usage.js';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

/** Usage statements for rights holders (ADR-0025). Each test uses its own past year. */
let h: Harness;
let ops: Awaited<ReturnType<typeof asOperator>>;
let cat: Awaited<ReturnType<typeof seedCatalog>>;

beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  cat = await seedCatalog(h);
  // r1 stands for a full-length track (the 30 s rule); r2 stays a 2 s track (half).
  await h.ctx.db
    .updateTable('recording')
    .set({ duration_ms: 200_000 })
    .where('id', '=', cat.ids['r1']!)
    .execute();
});
afterAll(() => h.close());

async function listener() {
  const u = await h.user();
  await ops.setCountry(u, 'KR');
  await ops.subscribe(u);
  return u;
}

/**
 * One catalog session of `recording` that reports `playedMs` of listening, then
 * moved to `issuedAt` (the month it is reported in).
 */
async function listen(u: TestUser, recording: string, playedMs: number, issuedAt: Date) {
  const r = await h.api.inject({
    method: 'POST',
    url: '/v1/playback-sessions',
    headers: u.headers,
    payload: { recording_id: recording, device_id: 'device-usage-1' },
  });
  expect(r.statusCode, r.body).toBe(201);
  const sessionId = r.json<{ session_id: string }>().session_id;
  // Room on the wall clock for the reported listening time.
  await sql`UPDATE playback_session SET issued_at = now() - interval '10 minutes'
    WHERE id = ${sessionId}`.execute(h.ctx.db);
  const events = await h.api.inject({
    method: 'POST',
    url: '/v1/listening-events/batch',
    headers: u.headers,
    payload: {
      events: [
        { type: 'started', played: 0 },
        { type: 'heartbeat', played: Math.floor(playedMs / 2) },
        { type: 'ended', played: playedMs - Math.floor(playedMs / 2) },
      ].map((e, i) => ({
        event_id: randomUUID(),
        session_id: sessionId,
        sequence: i,
        type: e.type,
        position_ms: 1000,
        played_ms: e.played,
        client_time: new Date().toISOString(),
      })),
    },
  });
  expect(events.json().accepted, events.body).toBe(3);
  await sql`UPDATE playback_session SET issued_at = ${issuedAt} WHERE id = ${sessionId}`.execute(
    h.ctx.db,
  );
  return sessionId;
}

const lines = (month: string) =>
  h.ctx.db
    .selectFrom('usage_statement_line')
    .selectAll()
    .where('month', '=', `${month}-01`)
    .orderBy('recording_id')
    .execute();

describe('usage statements (ADR-0025)', () => {
  it('counts a session once when it reaches 30 s, or half of a shorter track', async () => {
    const [a, b] = [await listener(), await listener()];
    const at = new Date('2001-03-15T03:00:00Z');
    await listen(a, cat.ids['r1']!, 31_000, at);
    await listen(a, cat.ids['r1']!, 20_000, at); // too short: not a stream
    await listen(b, cat.ids['r1']!, 45_000, at);
    await listen(b, cat.ids['r2']!, 1_200, at); // 2 s track: half is enough
    await listen(b, cat.ids['r2']!, 900, at);

    expect(await closeUsageStatements(h.ctx.db, new Date('2001-04-05T00:00:00Z'))).toEqual([
      '2001-01-01',
      '2001-02-01',
      '2001-03-01',
    ]);
    const statement = await h.ctx.db
      .selectFrom('usage_statement')
      .selectAll()
      .where('month', '=', '2001-03-01')
      .executeTakeFirstOrThrow();
    expect(statement).toMatchObject({ policy: 'usage/v1', streams: 3, line_count: 2 });

    const byRec = Object.fromEntries((await lines('2001-03')).map((l) => [l.recording_id, l]));
    expect(byRec[cat.ids['r1']!]).toMatchObject({
      streams: 2,
      listeners: 2,
      played_ms: 76_000,
      territory: 'KR',
      access_origin: 'subscription',
      rights_holder: 'Fixture Rights Ltd',
    });
    expect(byRec[cat.ids['r2']!]).toMatchObject({ streams: 1, listeners: 1, played_ms: 1_200 });

    // Closing again changes nothing; a closed statement cannot be edited.
    expect(await closeUsageStatements(h.ctx.db, new Date('2001-04-20T00:00:00Z'))).toEqual([]);
    await expect(
      sql`UPDATE usage_statement_line SET streams = 99 WHERE month = '2001-03-01'`.execute(
        h.ctx.db,
      ),
    ).rejects.toThrow(/closed records/);
  });

  it('waits until three days after the month ends (Seoul time)', async () => {
    const u = await listener();
    // 2002-05-31 23:30 in Seoul is still May there.
    await listen(u, cat.ids['r1']!, 40_000, new Date('2002-05-31T14:30:00Z'));
    expect(await closeUsageStatements(h.ctx.db, new Date('2002-06-02T00:00:00Z'))).not.toContain(
      '2002-05-01',
    );
    expect(await closeUsageStatements(h.ctx.db, new Date('2002-06-04T00:00:00Z'))).toContain(
      '2002-05-01',
    );
    expect((await lines('2002-05')).map((l) => l.streams)).toEqual([1]);
    expect(seoulMonth(new Date('2002-05-31T15:30:00Z'))).toBe('2002-06-01');
  });

  it("keeps a deleted account's streams owed, without the account", async () => {
    const [stays, leaves] = [await listener(), await listener()];
    const at = new Date('2003-07-10T00:00:00Z');
    await listen(stays, cat.ids['r1']!, 35_000, at);
    await listen(leaves, cat.ids['r1']!, 50_000, at);
    await listen(leaves, cat.ids['r1']!, 60_000, at);

    expect(await foldAccountUsage(h.ctx.db, leaves.userId)).toBe(1);
    await h.ctx.db.deleteFrom('listening_event').where('user_id', '=', leaves.userId).execute();
    const carried = await h.ctx.db
      .selectFrom('usage_carryover')
      .selectAll()
      .where('month', '=', '2003-07-01')
      .execute();
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ streams: 2, played_ms: 110_000 });
    expect(Object.keys(carried[0]!)).not.toContain('user_id');

    await closeUsageStatements(h.ctx.db, new Date('2003-08-10T00:00:00Z'));
    expect(await lines('2003-07')).toEqual([
      expect.objectContaining({ streams: 3, listeners: 2, played_ms: 145_000 }),
    ]);
    // The carry-over is consumed by the close.
    expect(
      await h.ctx.db
        .selectFrom('usage_carryover')
        .select('id')
        .where('month', '=', '2003-07-01')
        .execute(),
    ).toHaveLength(0);
  });

  it('never purges listening events of a month that is not closed', async () => {
    const u = await listener();
    const session = await listen(u, cat.ids['r1']!, 40_000, new Date('2026-01-10T00:00:00Z'));
    // Old enough for the retention window, but its month was never closed.
    await sql`UPDATE listening_event SET received_at = '2026-01-10T00:10:00Z'
      WHERE session_id = ${session}`.execute(h.ctx.db);
    await purgeListeningEvents(h.ctx.db);
    const left = await h.ctx.db
      .selectFrom('listening_event')
      .select('id')
      .where('session_id', '=', session)
      .execute();
    expect(left).toHaveLength(3);
  });

  it('lists statements and exports lines as CSV to operators only', async () => {
    const list = await h.api.inject({ url: '/v1/ops/usage-statements', headers: ops.op.headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ month: '2001-03', streams: 3 })]),
    );
    const csv = await h.api.inject({
      url: '/v1/ops/usage-statements/2001-03/lines?format=csv',
      headers: ops.op.headers,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const rows = csv.body.trim().split('\r\n');
    expect(rows[0]).toBe(
      'month,isrc,recording_id,rights_holder,contract_ref,rights_grant_id,territory,access,streams,listeners,played_ms',
    );
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.includes(cat.ids['r1']!) && r.endsWith(',2,2,76000'))).toBe(true);

    const user = await listener();
    const denied = await h.api.inject({ url: '/v1/ops/usage-statements', headers: user.headers });
    expect(denied.statusCode).toBe(403);
    const missing = await h.api.inject({
      url: '/v1/ops/usage-statements/1999-01/lines',
      headers: ops.op.headers,
    });
    expect(missing.statusCode).toBe(404);
    const audited = await h.ctx.db
      .selectFrom('audit_log')
      .select('action')
      .where('action', '=', 'usage_statement.exported')
      .execute();
    expect(audited.length).toBeGreaterThanOrEqual(1);
  });
});
