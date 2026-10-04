import type { Config } from '../platform/config.js';
import { createDb, pingDb, type Db } from '../platform/db/db.js';
import { CursorCodec } from '../platform/http/cursor.js';
import type { Logger } from '../platform/logger.js';
import type { BlobStore } from '../platform/storage/blob-store.js';
import { S3BlobStore } from '../platform/storage/s3-blob-store.js';

/** Shared infrastructure handed to modules. Created once per process. */
export interface AppContext {
  config: Config;
  log: Logger;
  db: Db;
  blobs: BlobStore;
  cursors: CursorCodec;
}

export function createContext(config: Config, log: Logger): AppContext {
  return {
    config,
    log,
    db: createDb(config.db.url, config.db.poolMax),
    blobs: new S3BlobStore(config.s3),
    cursors: new CursorCodec(config.secrets.cursor),
  };
}

export function readinessChecks(ctx: AppContext): Record<string, () => Promise<void>> {
  return {
    database: () => pingDb(ctx.db),
    storage: () => ctx.blobs.ping(),
  };
}

export async function closeContext(ctx: AppContext): Promise<void> {
  await ctx.db.destroy();
}
