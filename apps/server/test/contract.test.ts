import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { registeredRoutes } from '../src/platform/http/app.js';
import { fixtures } from './helpers/audio-fixtures.js';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, uploadReady, type Harness, type TestUser } from './helpers/harness.js';

const SPEC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/05-api/openapi.yaml',
);
type ResponseObj = { $ref?: string; content?: Record<string, { schema?: unknown }> };
const spec = parseYaml(readFileSync(SPEC_PATH, 'utf8')) as {
  paths: Record<string, Record<string, { responses?: Record<string, ResponseObj> }>>;
};
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** `/v1/x/{id}` ↔ `/v1/x/:id` */
const toFastify = (p: string) => p.replace(/\{([^}]+)\}/g, ':$1');

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema({ ...spec, $id: 'openapi' });

function validate(method: string, path: string, status: number, body: unknown): void {
  const res = spec.paths[path]?.[method]?.responses?.[String(status)];
  expect(res, `${method} ${path} ${status} is documented`).toBeDefined();
  // Shared responses (`$ref: '#/components/responses/Error'`) are resolved by pointer.
  const base = res?.$ref
    ? `openapi${res.$ref}`
    : `openapi#/paths/${path.replace(/~/g, '~0').replace(/\//g, '~1')}/${method}/responses/${status}`;
  const pointer = `${base}/content/application~1json/schema`;
  const v = ajv.getSchema(pointer);
  expect(v, pointer).toBeDefined();
  const ok = v!(body);
  expect(ok, `${method.toUpperCase()} ${path} ${status}: ${ajv.errorsText(v!.errors)}`).toBe(true);
}

let h: Harness;
let u: TestUser;
let ids: Record<string, string>;
let ops: Awaited<ReturnType<typeof asOperator>>;

beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  ids = (await seedCatalog(h)).ids;
  u = await h.user();
  await ops.setCountry(u, 'KR');
  await ops.subscribe(u);
});
afterAll(() => h.close());

describe('OpenAPI contract (ADR-0010)', () => {
  it('every implemented route is in the spec, and every spec operation is implemented', () => {
    const implemented = new Set(
      [...registeredRoutes(h.api), ...registeredRoutes(h.media)]
        .filter((r) => r.url !== '*')
        .map((r) => `${r.method} ${r.url}`),
    );
    const specified = new Set<string>();
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const m of METHODS) if (ops[m]) specified.add(`${m.toUpperCase()} ${toFastify(path)}`);
    }
    const missingFromSpec = [...implemented].filter((r) => !specified.has(r)).sort();
    const missingFromCode = [...specified].filter((r) => !implemented.has(r)).sort();
    expect(missingFromSpec).toEqual([]);
    expect(missingFromCode).toEqual([]);
  });

  it('responses of the main resources match their schemas', async () => {
    const get = async (url: string, path: string) => {
      const r = await h.api.inject({ url, headers: u.headers });
      validate('get', path, r.statusCode, r.json());
      return r.json();
    };
    await get('/v1/me', '/v1/me');
    const src = await uploadReady(h, u, fixtures.wav(), { intent: 'audio_log' });
    await get(`/v1/audio-sources/${src}`, '/v1/audio-sources/{audio_source_id}');
    await get('/v1/audio-sources', '/v1/audio-sources');
    await get(`/v1/audio-sources/${src}/waveform`, '/v1/audio-sources/{audio_source_id}/waveform');
    const log = await h.api.inject({
      method: 'POST',
      url: '/v1/audio-logs',
      headers: u.headers,
      payload: {
        audio_source_id: src,
        title: 'x',
        recorded_at: new Date().toISOString(),
        recorded_tz: 'UTC',
      },
    });
    validate('post', '/v1/audio-logs', 201, log.json());
    await get(`/v1/recordings/${ids['r1']}`, '/v1/recordings/{recording_id}');
    await get(`/v1/recordings/${ids['r1']}/passport`, '/v1/recordings/{recording_id}/passport');
    await get(`/v1/releases/${ids['album']}`, '/v1/releases/{release_id}');
    await get(`/v1/entities/${ids['band']}`, '/v1/entities/{entity_id}');
    await get('/v1/entitlements', '/v1/entitlements');
    await get('/v1/subscription', '/v1/subscription');
    await get('/v1/library', '/v1/library');
    await get(`/v1/search?q=Tone`, '/v1/search');
    await get(`/v1/dig/entities/${ids['r1']}/axes`, '/v1/dig/entities/{entity_id}/axes');
    await get(
      `/v1/dig/entities/${ids['r1']}/connections?axis=credits`,
      '/v1/dig/entities/{entity_id}/connections',
    );

    const play = await h.api.inject({
      method: 'POST',
      url: '/v1/playback-sessions',
      headers: u.headers,
      payload: { recording_id: ids['r1'], device_id: 'device-test-1' },
    });
    validate('post', '/v1/playback-sessions', 201, play.json());

    const pl = await h.api.inject({
      method: 'POST',
      url: '/v1/playlists',
      headers: u.headers,
      payload: { title: 'c' },
    });
    validate('post', '/v1/playlists', 201, pl.json());
    const add = await h.api.inject({
      method: 'POST',
      url: `/v1/playlists/${pl.json().playlist_id}/items`,
      headers: { ...u.headers, 'if-match': pl.headers.etag as string },
      payload: { ref_type: 'audio_source', ref_id: src },
    });
    validate('post', '/v1/playlists/{playlist_id}/items', 201, add.json());
    await get('/v1/playlists', '/v1/playlists');
    await get(`/v1/playlists/${pl.json().playlist_id}`, '/v1/playlists/{playlist_id}');
    await get(
      `/v1/playlists/${pl.json().playlist_id}/items?limit=1`,
      '/v1/playlists/{playlist_id}/items',
    );

    const dig = await h.api.inject({
      method: 'POST',
      url: '/v1/dig-sessions',
      headers: u.headers,
      payload: { entity_id: ids['r1'] },
    });
    validate('post', '/v1/dig-sessions', 201, dig.json());
    await get('/v1/dig-sessions', '/v1/dig-sessions');

    const err = await h.api.inject({
      url: '/v1/audio-sources/asr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      headers: u.headers,
    });
    validate('get', '/v1/audio-sources/{audio_source_id}', 404, err.json());
  });
  it('commerce responses match their schemas', async () => {
    const offer = await h.api.inject({
      method: 'POST',
      url: '/v1/ops/offers',
      headers: ops.op.headers,
      payload: {
        release_id: ids['album'],
        territories: ['KR'],
        price_minor: 11000,
        reason: 'contract',
      },
    });
    validate('post', '/v1/ops/offers', offer.statusCode, offer.json());
    const listed = await h.api.inject({
      url: `/v1/ops/releases/${ids['album']}/offers`,
      headers: ops.op.headers,
    });
    validate('get', '/v1/ops/releases/{release_id}/offers', listed.statusCode, listed.json());
    const ro = await h.api.inject({
      url: `/v1/releases/${ids['album']}/offer`,
      headers: u.headers,
    });
    validate('get', '/v1/releases/{release_id}/offer', ro.statusCode, ro.json());
    const created = await h.api.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { ...u.headers, 'idempotency-key': 'contract-order-1' },
      payload: { offer_id: offer.json().offer_id },
    });
    validate('post', '/v1/orders', created.statusCode, created.json());
    const id = created.json().order_id as string;
    const one = await h.api.inject({ url: `/v1/orders/${id}`, headers: u.headers });
    validate('get', '/v1/orders/{order_id}', one.statusCode, one.json());
    const list = await h.api.inject({ url: '/v1/orders', headers: u.headers });
    validate('get', '/v1/orders', list.statusCode, list.json());
    const plan = await h.api.inject({ url: '/v1/subscription/plan', headers: u.headers });
    validate('get', '/v1/subscription/plan', plan.statusCode, plan.json());
    const sub = await h.api.inject({ url: '/v1/subscription', headers: u.headers });
    validate('get', '/v1/subscription', sub.statusCode, sub.json());
    const opsView = await h.api.inject({ url: `/v1/ops/orders/${id}`, headers: ops.op.headers });
    validate('get', '/v1/ops/orders/{order_id}', opsView.statusCode, opsView.json());
  });
});
