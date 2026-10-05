import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.js';
import {
  BUCKETS,
  type BlobStore,
  type Bucket,
  type ObjectHead,
  type PresignedPut,
} from './blob-store.js';

function isMissing(err: unknown): boolean {
  if (err instanceof NoSuchKey || err instanceof NotFound) return true;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

/**
 * Network limits for storage calls. Without them a storage endpoint that accepts a
 * connection but never answers holds the caller until its job lease or the client
 * gives up — 30 minutes for audio processing. `idleTimeoutMs` bounds silence on a
 * socket, not the total time, so large transfers are not cut off; a failed call
 * follows the normal retry/DLQ path of its job.
 */
export interface StorageNetworkOptions {
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  maxAttempts: number;
}

const DEFAULT_NETWORK: StorageNetworkOptions = {
  connectionTimeoutMs: 5_000,
  idleTimeoutMs: 30_000,
  maxAttempts: 3,
};

export class S3BlobStore implements BlobStore {
  private readonly client: S3Client;
  /** Separate client for presigning with the endpoint that clients can reach. */
  private readonly publicClient: S3Client;
  private readonly prefix: string;
  /** Encryption parameters sent on every write. */
  private readonly sse:
    | { ServerSideEncryption: 'AES256' }
    | { ServerSideEncryption: 'aws:kms'; SSEKMSKeyId: string; BucketKeyEnabled: true };
  /** The same, as headers a presigned PUT must carry (they are signed). */
  private readonly sseHeaders: Record<string, string>;

  constructor(cfg: Config['s3'], network: StorageNetworkOptions = DEFAULT_NETWORK) {
    this.prefix = cfg.bucketPrefix;
    if (cfg.sse.mode === 'aws:kms') {
      this.sse = {
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: cfg.sse.kmsKeyId,
        BucketKeyEnabled: true,
      };
      this.sseHeaders = {
        'x-amz-server-side-encryption': 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id': cfg.sse.kmsKeyId,
        'x-amz-server-side-encryption-bucket-key-enabled': 'true',
      };
    } else {
      this.sse = { ServerSideEncryption: 'AES256' };
      this.sseHeaders = { 'x-amz-server-side-encryption': 'AES256' };
    }
    const base = {
      region: cfg.region,
      ...(cfg.credentials ? { credentials: cfg.credentials } : {}),
      forcePathStyle: cfg.forcePathStyle,
      // Only send/validate checksums when an operation requires it; presigned PUTs
      // carry an explicit SHA-256 that the client must match.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
      maxAttempts: network.maxAttempts,
      requestHandler: {
        connectionTimeout: network.connectionTimeoutMs,
        socketTimeout: network.idleTimeoutMs,
      },
    };
    this.client = new S3Client({ ...base, ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}) });
    this.publicClient = new S3Client({
      ...base,
      ...(cfg.publicEndpoint ? { endpoint: cfg.publicEndpoint } : {}),
    });
  }

  /** Logical namespace (ADR-0004, stored in the database) → this environment's bucket. */
  private physical(bucket: Bucket): string {
    return `${this.prefix}${bucket.slice('rabit'.length)}`;
  }

  async presignPut(
    bucket: Bucket,
    key: string,
    opts: { bytes: number; sha256Base64: string; expiresInSeconds: number },
  ): Promise<PresignedPut> {
    const cmd = new PutObjectCommand({
      Bucket: this.physical(bucket),
      Key: key,
      ContentLength: opts.bytes,
      ChecksumSHA256: opts.sha256Base64,
      ...this.sse,
    });
    const sseNames = Object.keys(this.sseHeaders);
    const url = await getSignedUrl(this.publicClient, cmd, {
      expiresIn: opts.expiresInSeconds,
      // These headers become part of the signature: the client cannot change them.
      signableHeaders: new Set(['content-length', 'x-amz-checksum-sha256', ...sseNames]),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256', ...sseNames]),
    });
    return {
      url,
      method: 'PUT',
      headers: {
        'content-length': String(opts.bytes),
        'x-amz-checksum-sha256': opts.sha256Base64,
        ...this.sseHeaders,
      },
      expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000),
    };
  }

  async presignGet(
    bucket: Bucket,
    key: string,
    opts: { expiresInSeconds: number; downloadName?: string },
  ): Promise<{ url: string; expiresAt: Date }> {
    const cmd = new GetObjectCommand({
      Bucket: this.physical(bucket),
      Key: key,
      ...(opts.downloadName
        ? { ResponseContentDisposition: `attachment; filename="${opts.downloadName}"` }
        : {}),
    });
    const url = await getSignedUrl(this.publicClient, cmd, { expiresIn: opts.expiresInSeconds });
    return { url, expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000) };
  }

  async head(bucket: Bucket, key: string): Promise<ObjectHead | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.physical(bucket), Key: key, ChecksumMode: 'ENABLED' }),
      );
      return {
        bytes: out.ContentLength ?? 0,
        checksumSha256: out.ChecksumSHA256,
        contentType: out.ContentType,
      };
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async put(
    bucket: Bucket,
    key: string,
    body: Buffer | Readable,
    opts: { contentType: string; bytes?: number },
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.physical(bucket),
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        ...this.sse,
        ...(opts.bytes !== undefined ? { ContentLength: opts.bytes } : {}),
      }),
    );
  }

  async copy(
    from: { bucket: Bucket; key: string },
    to: { bucket: Bucket; key: string },
  ): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        CopySource: `${this.physical(from.bucket)}/${encodeURIComponent(from.key).replace(/%2F/g, '/')}`,
        Bucket: this.physical(to.bucket),
        Key: to.key,
        ...this.sse,
      }),
    );
  }

  async getStream(
    bucket: Bucket,
    key: string,
  ): Promise<{ body: Readable; bytes: number; contentType: string | undefined } | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.physical(bucket), Key: key }),
      );
      if (!out.Body) return null;
      return {
        body: out.Body as Readable,
        bytes: out.ContentLength ?? 0,
        contentType: out.ContentType,
      };
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async download(bucket: Bucket, key: string, filePath: string): Promise<boolean> {
    const obj = await this.getStream(bucket, key);
    if (!obj) return false;
    await pipeline(obj.body, createWriteStream(filePath));
    return true;
  }

  async delete(bucket: Bucket, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.physical(bucket), Key: key }));
  }

  async listPrefix(bucket: Bucket, prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const out = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.physical(bucket),
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const o of out.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  async deletePrefix(bucket: Bucket, prefix: string): Promise<number> {
    if (prefix.length < 8 || !prefix.endsWith('/')) {
      // Guard against accidentally deleting a whole bucket.
      throw new Error('deletePrefix requires a specific prefix ending with "/"');
    }
    const keys = await this.listPrefix(bucket, prefix);
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.physical(bucket),
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
    return keys.length;
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.physical(BUCKETS.quarantine) }));
  }
}

export function toReadable(buf: Buffer): Readable {
  return Readable.from(buf);
}
