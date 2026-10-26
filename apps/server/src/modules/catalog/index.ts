import type { Module } from '../../app/modules.js';
import { catalogJobs } from './jobs.js';
import { catalogRoutes, type CatalogPlayability } from './routes.js';

export {
  entitySummary,
  entitySummaries,
  recordingExists,
  releaseExists,
  recordingSource,
  recordingSources,
  getRecording,
  getRelease,
  creditsOf,
  artistsOf,
  primaryReleases,
  releaseSummaries,
  type EntitySummary,
} from './entities.js';
export { activeGrant, activeGrants, createGrant } from './rights.js';
export { detachCatalogSource } from './entities.js';
export { ingestCatalog, manifestSchema, type CatalogManifest } from './ingest.js';
export {
  deliveryPath,
  ernToManifest,
  ErnError,
  readErn,
  type ErnConversion,
  type ErnPurge,
} from './ddex.js';
export { ingestErn } from './ddex-ingest.js';
export { artworkObject, artworkUrls, ARTWORK_SIZES } from './artwork.js';
export type { CatalogPlayability, Playability } from './routes.js';

export function catalogModule(deps: { playability: CatalogPlayability }): Module {
  return {
    name: 'catalog',
    routes: catalogRoutes(deps),
    jobs: catalogJobs,
    schedules: [{ kind: 'catalog.expire_grants', everyMs: 5 * 60_000 }],
  };
}
