import { createHash } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { ulid } from '../../src/platform/ids.js';
import { BUCKETS } from '../../src/platform/storage/blob-store.js';
import { S3BlobStore } from '../../src/platform/storage/s3-blob-store.js';
import { testContext } from '../helpers/context.js';

const ctx = testContext();
afterAll(() => ctx.db.destroy());

function sha256b64(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('base64');
}

async function putVia(url: string, headers: Record<string, string>, body: Buffer) {
  return fetch(url, { method: 'PUT', headers, body });
}

describe('S3 blob store', () => {
  it('accepts a presigned PUT only with the exact bytes declared (T10)', async () => {
    const body = Buffer.from(`hello ${ulid()}`);
    const key = `test/${ulid()}`;
    const signed = await ctx.blobs.presignPut(BUCKETS.quarantine, key, {
      bytes: body.length,
      sha256Base64: sha256b64(body),
      expiresInSeconds: 60,
    });

    const wrong = Buffer.from('x'.repeat(body.length));
    const bad = await putVia(signed.url, signed.headers, wrong);
    expect(bad.ok).toBe(false);
    expect(await ctx.blobs.head(BUCKETS.quarantine, key)).toBeNull();

    const good = await putVia(signed.url, signed.headers, body);
    expect(good.ok).toBe(true);
    const head = await ctx.blobs.head(BUCKETS.quarantine, key);
    expect(head?.bytes).toBe(body.length);
    expect(head?.checksumSha256).toBe(sha256b64(body));
  });

  it('rejects a presigned PUT whose signed headers are altered', async () => {
    const body = Buffer.from('abc');
    const key = `test/${ulid()}`;
    const signed = await ctx.blobs.presignPut(BUCKETS.quarantine, key, {
      bytes: body.length,
      sha256Base64: sha256b64(body),
      expiresInSeconds: 60,
    });
    const bigger = Buffer.from('abcdef');
    const res = await putVia(
      signed.url,
      {
        ...signed.headers,
        'content-length': String(bigger.length),
        'x-amz-checksum-sha256': sha256b64(bigger),
      },
      bigger,
    );
    expect(res.ok).toBe(false);
  });

  it('copies, streams, lists and deletes by prefix', async () => {
    const prefix = `test/${ulid()}/`;
    await ctx.blobs.put(BUCKETS.privateMedia, `${prefix}a`, Buffer.from('a'), {
      contentType: 'text/plain',
    });
    await ctx.blobs.copy(
      { bucket: BUCKETS.privateMedia, key: `${prefix}a` },
      { bucket: BUCKETS.privateMedia, key: `${prefix}b` },
    );
    expect((await ctx.blobs.listPrefix(BUCKETS.privateMedia, prefix)).sort()).toEqual([
      `${prefix}a`,
      `${prefix}b`,
    ]);
    const s = await ctx.blobs.getStream(BUCKETS.privateMedia, `${prefix}b`);
    expect(s?.bytes).toBe(1);
    s?.body.destroy();
    expect(await ctx.blobs.deletePrefix(BUCKETS.privateMedia, prefix)).toBe(2);
    expect(await ctx.blobs.listPrefix(BUCKETS.privateMedia, prefix)).toEqual([]);
    await expect(ctx.blobs.deletePrefix(BUCKETS.privateMedia, 'x/')).rejects.toThrow();
  });

  it('returns null for missing objects', async () => {
    expect(await ctx.blobs.head(BUCKETS.quarantine, `missing/${ulid()}`)).toBeNull();
    expect(await ctx.blobs.getStream(BUCKETS.quarantine, `missing/${ulid()}`)).toBeNull();
  });
});

describe('S3 blob store timeouts', () => {
  // A storage endpoint that accepts connections but never answers, like the
  // SeaweedFS state that left processing jobs hanging for their whole lease.
  let server: Server;
  let endpoint: string;
  const sockets: Socket[] = [];
  afterAll(async () => {
    for (const s of sockets) s.destroy();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  });

  it('fails an unanswered storage request instead of waiting forever', async () => {
    server = createServer((socket) => {
      sockets.push(socket); // read nothing, answer nothing
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => {
        resolve();
      }),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    endpoint = `http://127.0.0.1:${String(address.port)}`;
    const store = new S3BlobStore(
      { ...ctx.config.s3, endpoint, publicEndpoint: endpoint },
      { connectionTimeoutMs: 500, idleTimeoutMs: 500, maxAttempts: 1 },
    );
    const started = Date.now();
    await expect(
      store.copy(
        { bucket: BUCKETS.quarantine, key: 'a' },
        { bucket: BUCKETS.privateOriginals, key: 'b' },
      ),
    ).rejects.toThrow();
    await expect(store.head(BUCKETS.quarantine, 'a')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
