import type { Readable } from 'node:stream';

/** Bucket namespaces (ADR-0004). Never mixed: private vs catalog vs quarantine vs exports. */
export const BUCKETS = {
  quarantine: 'rabit-quarantine',
  privateOriginals: 'rabit-private-originals',
  privateMedia: 'rabit-private-media',
  catalogOriginals: 'rabit-catalog-originals',
  catalogMedia: 'rabit-catalog-media',
  exports: 'rabit-exports',
} as const;

export type Bucket = (typeof BUCKETS)[keyof typeof BUCKETS];

export interface ObjectHead {
  bytes: number;
  /** Base64 SHA-256 checksum stored by the storage service, when available. */
  checksumSha256: string | undefined;
  contentType: string | undefined;
}

export interface PresignedPut {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface BlobStore {
  /** Presigned PUT bound to exact length and SHA-256 (base64) checksum. */
  presignPut(
    bucket: Bucket,
    key: string,
    opts: { bytes: number; sha256Base64: string; expiresInSeconds: number },
  ): Promise<PresignedPut>;
  presignGet(
    bucket: Bucket,
    key: string,
    opts: { expiresInSeconds: number; downloadName?: string },
  ): Promise<{ url: string; expiresAt: Date }>;
  head(bucket: Bucket, key: string): Promise<ObjectHead | null>;
  put(
    bucket: Bucket,
    key: string,
    body: Buffer | Readable,
    opts: { contentType: string; bytes?: number },
  ): Promise<void>;
  copy(from: { bucket: Bucket; key: string }, to: { bucket: Bucket; key: string }): Promise<void>;
  getStream(
    bucket: Bucket,
    key: string,
  ): Promise<{ body: Readable; bytes: number; contentType: string | undefined } | null>;
  /** Downloads an object to a local file path. Returns false when it does not exist. */
  download(bucket: Bucket, key: string, filePath: string): Promise<boolean>;
  delete(bucket: Bucket, key: string): Promise<void>;
  /** Deletes every object under a prefix. Returns the number deleted. */
  deletePrefix(bucket: Bucket, prefix: string): Promise<number>;
  listPrefix(bucket: Bucket, prefix: string): Promise<string[]>;
  ping(): Promise<void>;
}
