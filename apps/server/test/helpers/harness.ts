import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApiApp } from '../../src/app/api.js';
import { createContext, type AppContext } from '../../src/app/context.js';
import { buildMediaApp } from '../../src/app/media.js';
import { allModules } from '../../src/app/registry.js';
import { buildWorker, type WorkerProcess } from '../../src/app/worker.js';
import { resolvePrincipal } from '../../src/modules/identity/index.js';
import { loadConfig } from '../../src/platform/config.js';
import type { DevIssuer } from '../../src/platform/http/auth.js';
import { ulid } from '../../src/platform/ids.js';
import { createLogger } from '../../src/platform/logger.js';

export interface Harness {
  ctx: AppContext;
  api: FastifyInstance;
  media: FastifyInstance;
  worker: WorkerProcess;
  issuer: DevIssuer;
  /** Creates a user (first request provisions the account) and returns a bearer token. */
  user(opts?: { operator?: boolean; subject?: string }): Promise<TestUser>;
  close(): Promise<void>;
}

export interface TestUser {
  token: string;
  subject: string;
  userId: string;
  workspaceId: string;
  headers: Record<string, string>;
}

export async function createHarness(env: Record<string, string> = {}): Promise<Harness> {
  const config = loadConfig({ ...process.env, ...env });
  const ctx = createContext(
    config,
    createLogger({ level: process.env['TEST_LOG_LEVEL'] ?? 'silent', name: 'test' }),
  );
  const modules = allModules();
  const { app: api, devIssuer } = await buildApiApp(ctx, modules, (t) =>
    resolvePrincipal(ctx.db, t),
  );
  const media = await buildMediaApp(ctx);
  await api.ready();
  await media.ready();
  const worker = buildWorker(ctx, modules);
  if (!devIssuer) throw new Error('dev issuer required for tests');
  return {
    ctx,
    api,
    media,
    worker,
    issuer: devIssuer,
    async user(opts = {}) {
      const subject = opts.subject ?? `user-${ulid()}`;
      const token = await devIssuer.issue({ subject, operator: opts.operator ?? false });
      const headers = { authorization: `Bearer ${token}` };
      const me = await api.inject({ method: 'GET', url: '/v1/me', headers });
      if (me.statusCode !== 200) throw new Error(`provisioning failed: ${me.body}`);
      const body = me.json<{ user_id: string; personal_workspace_id: string }>();
      return {
        token,
        subject,
        userId: body.user_id,
        workspaceId: body.personal_workspace_id,
        headers,
      };
    },
    async close() {
      await api.close();
      await media.close();
      await ctx.db.destroy();
    },
  };
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Full upload flow: intent → presigned PUT → finalize (no worker run). */
export async function uploadBytes(
  h: Harness,
  u: TestUser,
  bytes: Buffer,
  opts: { intent?: 'private_upload' | 'audio_log'; filename?: string } = {},
): Promise<{ uploadId: string; audioSourceId: string; finalize: unknown }> {
  const intent = await h.api.inject({
    method: 'POST',
    url: '/v1/uploads',
    headers: u.headers,
    payload: {
      intent: opts.intent ?? 'private_upload',
      size_bytes: bytes.length,
      sha256: sha256Hex(bytes),
      filename: opts.filename ?? 'take.wav',
    },
  });
  if (intent.statusCode !== 201)
    throw new Error(`intent failed ${intent.statusCode}: ${intent.body}`);
  const i = intent.json<{
    upload: { upload_id: string };
    upload_url: string;
    upload_headers: Record<string, string>;
  }>();
  const put = await fetch(i.upload_url, { method: 'PUT', headers: i.upload_headers, body: bytes });
  if (!put.ok) throw new Error(`PUT failed ${put.status}: ${await put.text()}`);
  const fin = await h.api.inject({
    method: 'POST',
    url: `/v1/uploads/${i.upload.upload_id}/finalize`,
    headers: { ...u.headers, 'idempotency-key': `fin-${i.upload.upload_id}` },
  });
  if (fin.statusCode !== 202) throw new Error(`finalize failed ${fin.statusCode}: ${fin.body}`);
  const f = fin.json<{ audio_source_id: string }>();
  return { uploadId: i.upload.upload_id, audioSourceId: f.audio_source_id, finalize: f };
}

/** Uploads and runs the worker until the source is processed. */
export async function uploadReady(
  h: Harness,
  u: TestUser,
  bytes: Buffer,
  opts: { intent?: 'private_upload' | 'audio_log'; filename?: string } = {},
): Promise<string> {
  const r = await uploadBytes(h, u, bytes, opts);
  await h.worker.drain();
  return r.audioSourceId;
}

/** Path part of an absolute media URL, for `media.inject`. */
export function mediaPath(url: string): string {
  return new URL(url).pathname;
}
