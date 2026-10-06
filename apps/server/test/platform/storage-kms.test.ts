import { CreateBucketCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { CreateKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BUCKETS } from '../../src/platform/storage/blob-store.js';
import { S3BlobStore } from '../../src/platform/storage/s3-blob-store.js';

/**
 * SSE-KMS as production runs it (ADR-0004/0012), against an S3 + KMS emulator.
 * Runs only when LOCALSTACK_ENDPOINT is set, e.g.
 *   docker run -d -p 127.0.0.1:4566:4566 localstack/localstack:4
 *   LOCALSTACK_ENDPOINT=http://127.0.0.1:4566 pnpm --filter @rabit/server test storage-kms
 */
const endpoint = process.env['LOCALSTACK_ENDPOINT'] ?? '';
const credentials = { accessKeyId: 'test', secretAccessKey: 'test' };
const region = 'ap-northeast-2';

describe.runIf(endpoint !== '')('S3 with SSE-KMS (LocalStack)', () => {
  async function setup() {
    const kms = new KMSClient({ endpoint, region, credentials });
    const key = await kms.send(new CreateKeyCommand({ Description: 'rabit test' }));
    const keyArn = key.KeyMetadata?.Arn ?? '';
    const prefix = `rabit-kms-${randomBytes(3).toString('hex')}`;
    const raw = new S3Client({ endpoint, region, credentials, forcePathStyle: true });
    for (const b of Object.values(BUCKETS)) {
      await raw.send(
        new CreateBucketCommand({
          Bucket: `${prefix}${b.slice('rabit'.length)}`,
          CreateBucketConfiguration: { LocationConstraint: region },
        }),
      );
    }
    const store = new S3BlobStore({
      endpoint,
      publicEndpoint: endpoint,
      region,
      credentials,
      forcePathStyle: true,
      bucketPrefix: prefix,
      sse: { mode: 'aws:kms', kmsKeyId: keyArn },
    });
    return { kms, keyArn, prefix, raw, store };
  }

  it('encrypts browser uploads, server writes and copies with the customer key', async () => {
    const { keyArn, prefix, raw, store } = await setup();
    const body = randomBytes(1024);
    const sha = createHash('sha256').update(body).digest('base64');

    const put = await store.presignPut(BUCKETS.quarantine, 'u/one', {
      bytes: body.length,
      sha256Base64: sha,
      expiresInSeconds: 60,
    });
    const res = await fetch(put.url, { method: 'PUT', headers: put.headers, body });
    expect(res.status, await res.text()).toBe(200);

    await store.put(BUCKETS.privateMedia, 'p/two', body, { contentType: 'audio/aac' });
    await store.copy(
      { bucket: BUCKETS.quarantine, key: 'u/one' },
      { bucket: BUCKETS.privateOriginals, key: 'o/one' },
    );
    for (const [bucket, key] of [
      ['quarantine', 'u/one'],
      ['private-media', 'p/two'],
      ['private-originals', 'o/one'],
    ] as const) {
      const head = await raw.send(
        new HeadObjectCommand({ Bucket: `${prefix}-${bucket}`, Key: key }),
      );
      expect(head.ServerSideEncryption, `${bucket}/${key}`).toBe('aws:kms');
      expect(head.SSEKMSKeyId, `${bucket}/${key}`).toBe(keyArn);
    }
    expect((await store.head(BUCKETS.quarantine, 'u/one'))?.bytes).toBe(body.length);
  });

  it('refuses a presigned upload whose encryption headers were changed', async () => {
    const { kms, store } = await setup();
    const other = await kms.send(new CreateKeyCommand({ Description: 'attacker' }));
    const body = randomBytes(64);
    const put = await store.presignPut(BUCKETS.quarantine, 'u/tampered', {
      bytes: body.length,
      sha256Base64: createHash('sha256').update(body).digest('base64'),
      expiresInSeconds: 60,
    });
    const res = await fetch(put.url, {
      method: 'PUT',
      headers: {
        ...put.headers,
        'x-amz-server-side-encryption-aws-kms-key-id': other.KeyMetadata?.Arn ?? '',
      },
      body,
    });
    expect(res.status).toBe(403);
  });
});
