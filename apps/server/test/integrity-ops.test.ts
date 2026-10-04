import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/platform/ids.js';
import { fixtures } from './helpers/audio-fixtures.js';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, uploadBytes, type Harness, type TestUser } from './helpers/harness.js';

let h: Harness;
let ops: Awaited<ReturnType<typeof asOperator>>;
let cat: Awaited<ReturnType<typeof seedCatalog>>;
let u: TestUser;
const id = (k: string) => cat.ids[k]!;

beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  cat = await seedCatalog(h);
  u = await h.user();
});
afterAll(() => h.close());

describe('Music Passport (TRU-001..004, TRU-007)', () => {
  it('shows creation method per stage, defaulting to unknown, never assumed human', async () => {
    const p = (
      await h.api.inject({ url: `/v1/recordings/${id('r1')}/passport`, headers: u.headers })
    ).json();
    const stages = Object.fromEntries(
      p.creation.map((c: { stage: string; method: string; verification_state: string | null }) => [
        c.stage,
        [c.method, c.verification_state],
      ]),
    );
    expect(stages).toEqual({
      composition: ['human', 'distributor_verified'],
      lyrics: ['unknown', null],
      vocals: ['unknown', null],
      instruments: ['unknown', null],
      mixing: ['unknown', null],
      // AI-assisted mastering is not "AI-generated music".
      mastering: ['ai_assisted', 'self_declared'],
      artwork: ['unknown', null],
    });
    expect(p.credits.map((c: { role: string }) => c.role).sort()).toEqual([
      'performer',
      'producer',
    ]);
    expect(p.integrity).toEqual([]);
    expect(p.report_url).toMatch(/\/v1\/reports$/);
  });

  it('lists integrity axes separately and never exposes model scores', async () => {
    await h.ctx.db
      .insertInto('integrity_signal')
      .values({
        id: newId('integritySignal'),
        subject_entity_id: id('r2'),
        axis: 'ai_generation',
        value: 'likely_ai_generated',
        basis: 'automated',
        internal_score: 0.91,
        model_version: 'detector-test-0',
      })
      .execute();
    const signal = await h.api.inject({
      method: 'POST',
      url: '/v1/ops/integrity-signals',
      headers: ops.op.headers,
      payload: {
        subject_entity_id: id('r2'),
        axis: 'technical_quality',
        value: 'ok',
        reason: 'manual review',
      },
    });
    expect(signal.json()).toEqual({ axis: 'technical_quality', value: 'ok', basis: 'reviewed' });
    const p = (
      await h.api.inject({ url: `/v1/recordings/${id('r2')}/passport`, headers: u.headers })
    ).json();
    expect(p.integrity).toEqual(
      expect.arrayContaining([
        { axis: 'ai_generation', value: 'likely_ai_generated', basis: 'automated' },
        { axis: 'technical_quality', value: 'ok', basis: 'reviewed' },
      ]),
    );
    expect(JSON.stringify(p)).not.toMatch(/0\.91|internal_score|detector-test/);
  });

  it('returns 404 for unknown recordings', async () => {
    expect(
      (
        await h.api.inject({
          url: '/v1/recordings/rec_01ARZ3NDEKTSV4RRFFQ69G5FAV/passport',
          headers: u.headers,
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('integrity in DIG (DIG-020, TRU-008)', () => {
  const sampledBy = async () =>
    (
      await h.api.inject({
        url: `/v1/dig/entities/${id('r1')}/connections?axis=sampled_by`,
        headers: u.headers,
      })
    )
      .json()
      .items.map((i: { entity: { entity_id: string } }) => i.entity.entity_id);

  it('ignores automated signals but honours a reviewed exclusion', async () => {
    expect(await sampledBy()).toEqual([id('r3')]);
    await h.ctx.db
      .insertInto('integrity_signal')
      .values({
        id: newId('integritySignal'),
        subject_entity_id: id('r3'),
        axis: 'recommendation_eligibility',
        value: 'excluded',
        basis: 'automated',
        internal_score: 0.99,
        model_version: 'spam-test-0',
      })
      .execute();
    expect(await sampledBy()).toEqual([id('r3')]);

    const post = (value: string) =>
      h.api.inject({
        method: 'POST',
        url: '/v1/ops/integrity-signals',
        headers: ops.op.headers,
        payload: {
          subject_entity_id: id('r3'),
          axis: 'recommendation_eligibility',
          value,
          reason: 'spam review',
        },
      });
    expect((await post('excluded')).statusCode).toBe(201);
    expect(await sampledBy()).toEqual([]);
    // Direct catalog access and playback are unaffected by DIG eligibility.
    expect(
      (await h.api.inject({ url: `/v1/recordings/${id('r3')}`, headers: u.headers })).statusCode,
    ).toBe(200);
    expect((await post('eligible')).statusCode).toBe(201);
    expect(await sampledBy()).toEqual([id('r3')]);
  });
});

describe('reports (TRU-009, T21)', () => {
  it('accepts reports without changing anything, and triages them', async () => {
    const r = await h.api.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: u.headers,
      payload: {
        subject_type: 'credit',
        subject_id: (
          await h.ctx.db
            .selectFrom('credit')
            .select('id')
            .where('subject_entity_id', '=', id('r1'))
            .executeTakeFirstOrThrow()
        ).id,
        reason_code: 'wrong_credit',
        details: 'The bassist is wrong',
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe('received');
    const credits = (
      await h.api.inject({
        url: `/v1/dig/entities/${id('r1')}/connections?axis=credits`,
        headers: u.headers,
      })
    ).json();
    expect(credits.items).toHaveLength(2);

    const wrongType = await h.api.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: u.headers,
      payload: { subject_type: 'release', subject_id: id('r1'), reason_code: 'spam' },
    });
    expect(wrongType.statusCode).toBe(404);

    const list = (
      await h.api.inject({ url: '/v1/ops/reports?status=received', headers: ops.op.headers })
    ).json();
    expect(list.items.map((i: { report_id: string }) => i.report_id)).toContain(r.json().report_id);
    expect(JSON.stringify(list)).not.toContain(u.userId);
    const triage = (status: string) =>
      h.api.inject({
        method: 'POST',
        url: `/v1/ops/reports/${r.json().report_id}/status`,
        headers: ops.op.headers,
        payload: { status, reason: 'looked into it' },
      });
    expect((await triage('actioned')).statusCode).toBe(409);
    expect((await triage('triaged')).json().status).toBe('triaged');
    expect((await triage('dismissed')).json().status).toBe('dismissed');
    expect((await h.api.inject({ url: '/v1/ops/reports', headers: u.headers })).statusCode).toBe(
      403,
    );
  });

  it('rate-limits reporters', async () => {
    const reporter = await h.user();
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) {
      const r = await h.api.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: reporter.headers,
        payload: { subject_type: 'recording', subject_id: id('r2'), reason_code: 'spam' },
      });
      codes.push(r.statusCode);
    }
    expect(codes.filter((c) => c === 201)).toHaveLength(20);
    expect(codes.at(-1)).toBe(429);
  });
});

describe('operations console (OPS-010)', () => {
  it('lists dead jobs without payloads and retries a transiently failed job to success', async () => {
    const victim = await h.user();
    const { audioSourceId, uploadId } = await uploadBytes(h, victim, fixtures.wav());
    const original = h.ctx.blobs.download.bind(h.ctx.blobs);
    // Storage is down for this upload until the operator retries.
    let outage = true;
    h.ctx.blobs.download = (bucket, key, path) =>
      outage && key.startsWith(`${uploadId}/`)
        ? Promise.reject(new Error('storage outage'))
        : original(bucket, key, path);
    try {
      for (let i = 0; i < 6; i++) {
        await h.worker.drain();
        await h.ctx.db
          .updateTable('job')
          .set({ run_after: new Date() })
          .where('status', '=', 'queued')
          .where('kind', '=', 'audio.process')
          .execute();
      }
      const deadJob = await h.ctx.db
        .selectFrom('job')
        .select(['id', 'status'])
        .where('kind', '=', 'audio.process')
        .where('payload', '@>', JSON.stringify({ audio_source_id: audioSourceId }) as never)
        .executeTakeFirstOrThrow();
      expect(deadJob.status).toBe('dead');
      const failed = await h.ctx.db
        .selectFrom('audio_source')
        .select(['status', 'failure_code'])
        .where('id', '=', audioSourceId)
        .executeTakeFirstOrThrow();
      expect(failed).toEqual({ status: 'failed', failure_code: 'PROCESSING_FAILED' });

      const dead = (
        await h.api.inject({ url: '/v1/ops/jobs?status=dead&limit=100', headers: ops.op.headers })
      ).json();
      expect(dead.items.map((j: { job_id: string }) => j.job_id)).toContain(deadJob.id);
      expect(JSON.stringify(dead)).not.toContain(audioSourceId);

      expect(
        (
          await h.api.inject({
            method: 'POST',
            url: `/v1/ops/jobs/${deadJob.id}/retry`,
            headers: victim.headers,
            payload: { reason: 'retry' },
          })
        ).statusCode,
      ).toBe(403);
      outage = false;
      const retry = await h.api.inject({
        method: 'POST',
        url: `/v1/ops/jobs/${deadJob.id}/retry`,
        headers: ops.op.headers,
        payload: { reason: 'storage recovered' },
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toMatchObject({ status: 'queued', attempts: 0 });
      const again = await h.api.inject({
        method: 'POST',
        url: `/v1/ops/jobs/${deadJob.id}/retry`,
        headers: ops.op.headers,
        payload: { reason: 'again' },
      });
      expect(again.statusCode).toBe(409);
      await h.worker.drain();
      const after = await h.api.inject({
        url: `/v1/audio-sources/${audioSourceId}`,
        headers: victim.headers,
      });
      expect(after.json().status).toBe('ready');
      const log = await h.ctx.db
        .selectFrom('audit_log')
        .select('reason')
        .where('subject_id', '=', deadJob.id)
        .executeTakeFirstOrThrow();
      expect(log.reason).toBe('storage recovered');
    } finally {
      h.ctx.blobs.download = original;
    }
  });

  it('removes untrusted bytes immediately after a permanent media failure', async () => {
    const victim = await h.user();
    const { uploadId } = await uploadBytes(h, victim, fixtures.random());
    await h.worker.drain();
    const s = await h.ctx.db
      .selectFrom('upload_session')
      .select('quarantine_key')
      .where('id', '=', uploadId)
      .executeTakeFirstOrThrow();
    expect(await h.ctx.blobs.head('rabit-quarantine', s.quarantine_key)).toBeNull();
  });
});
