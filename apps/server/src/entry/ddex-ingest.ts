import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { closeContext, createContext } from '../app/context.js';
import { ernToManifest, ingestErn } from '../modules/catalog/index.js';
import { loadConfig } from '../platform/config.js';
import { createLogger } from '../platform/logger.js';

/**
 * Ingests a DDEX ERN 4.3 delivery (ADR-0030): the NewReleaseMessage XML and the audio
 * files it names, relative to the message. `--dry-run` only converts and reports.
 *   pnpm --filter @rabit/server catalog:ddex path/to/delivery/message.xml [--dry-run]
 */
const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const config = loadConfig();
const log = createLogger({ level: config.logLevel, name: 'ddex-ingest' });
if (!path) {
  log.error('usage: catalog:ddex <message.xml> [--dry-run]');
  process.exit(2);
}
const messagePath = resolve(path);
const xml = await readFile(messagePath, 'utf8');
if (dryRun) {
  try {
    const c = ernToManifest(xml);
    log.info(
      {
        source: c.manifest.source,
        release: c.manifest.releases?.[0]?.title,
        icpn: c.icpn,
        recordings: c.manifest.recordings.length,
        grants: c.manifest.grants?.length ?? 0,
        skippedDeals: c.skippedDeals,
      },
      'converted (dry run, nothing stored)',
    );
  } catch (err) {
    log.error({ err }, 'delivery refused');
    process.exitCode = 1;
  }
} else {
  const ctx = createContext(config, log);
  try {
    const result = await ingestErn(ctx, xml, dirname(messagePath));
    log.info(
      {
        entities: Object.keys(result.ids).length,
        audio: Object.keys(result.sources).length,
        skippedDeals: result.skippedDeals,
      },
      'delivery ingested; processing queued',
    );
  } catch (err) {
    log.error({ err }, 'delivery refused');
    process.exitCode = 1;
  } finally {
    await closeContext(ctx);
  }
}
