import type { Module } from '../../app/modules.js';
import { catalogJobs } from './jobs.js';
import { catalogRoutes, type CatalogPlayability } from './routes.js';

export {
  entitySummary,
  entitySummaries,
  recordingExists,
  releaseExists,
  recordingSource,
  getRecording,
  getRelease,
  creditsOf,
  artistsOf,
  type EntitySummary,
} from './entities.js';
export { activeGrant, createGrant } from './rights.js';
export { ingestCatalog, manifestSchema, type CatalogManifest } from './ingest.js';
export type { CatalogPlayability, Playability } from './routes.js';

export function catalogModule(deps: { playability: CatalogPlayability }): Module {
  return {
    name: 'catalog',
    routes: catalogRoutes(deps),
    jobs: catalogJobs,
    schedules: [{ kind: 'catalog.expire_grants', everyMs: 5 * 60_000 }],
  };
}
