import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { closeContext, createContext } from '../app/context.js';
import { ingestCatalog, manifestSchema } from '../modules/catalog/index.js';
import { loadConfig } from '../platform/config.js';
import { createLogger } from '../platform/logger.js';

/**
 * Ingests a catalog manifest (JSON) with audio files referenced relative to it.
 * For licensed or self-made content only (CAT-008). Usage:
 *   pnpm --filter @rabit/server catalog:ingest path/to/manifest.json
 */
const path = process.argv[2];
const config = loadConfig();
const log = createLogger({ level: config.logLevel, name: 'catalog-ingest' });
if (!path) {
  log.error('usage: catalog:ingest <manifest.json>');
  process.exit(2);
}
const ctx = createContext(config, log);
try {
  const manifestPath = resolve(path);
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  const base = dirname(manifestPath);
  const result = await ingestCatalog(ctx, manifest, (ref) => readFile(resolve(base, ref)));
  log.info(
    { entities: Object.keys(result.ids).length, audio: Object.keys(result.sources).length },
    'catalog ingested; processing queued',
  );
} catch (err) {
  log.error({ err }, 'catalog ingest failed');
  process.exitCode = 1;
} finally {
  await closeContext(ctx);
}
