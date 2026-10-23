import { resolve, sep } from 'node:path';
import type { AppContext } from '../../app/context.js';
import { ErnError, ernToManifest } from './ddex.js';
import { ingestCatalog, manifestSchema } from './ingest.js';

/**
 * Ingests one ERN 4.3 delivery (ADR-0030): the message and the files it names, which
 * must lie inside `deliveryDir`. A release or recording already in the catalog is
 * refused rather than duplicated: updates and takedowns of existing releases match
 * them by ICPN and ISRC and are a later step.
 */
export async function ingestErn(
  ctx: AppContext,
  xml: string,
  deliveryDir: string,
  now = new Date(),
) {
  const c = ernToManifest(xml, now);
  if (c.icpn) {
    const known = await ctx.db
      .selectFrom('release')
      .select('id')
      .where('upc', '=', c.icpn)
      .executeTakeFirst();
    if (known) throw new ErnError(`Release ${c.icpn} is already in the catalog (${known.id}).`);
  }
  if (c.isrcs.length > 0) {
    const known = await ctx.db
      .selectFrom('recording')
      .select('isrc')
      .where('isrc', 'in', c.isrcs)
      .execute();
    if (known.length > 0) {
      throw new ErnError(
        `Recordings already in the catalog: ${known.map((k) => k.isrc).join(', ')}`,
      );
    }
  }
  const root = resolve(deliveryDir);
  const manifest = manifestSchema.parse(c.manifest);
  const result = await ingestCatalog(ctx, manifest, (ref) => {
    const path = resolve(root, ref);
    // ernToManifest already refuses such URIs; the files are opened here, so check again.
    if (!path.startsWith(root + sep)) {
      return Promise.reject(new ErnError(`File outside the delivery: ${ref}`));
    }
    return Promise.resolve({ path });
  });
  return { ...result, skippedDeals: c.skippedDeals };
}
