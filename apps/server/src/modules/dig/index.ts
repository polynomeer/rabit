import type { Module } from '../../app/modules.js';
import type { AccountDataDeleter } from '../identity/index.js';
import type { ExportSection } from '../library/index.js';
import { digRoutes } from './routes.js';
import type { DigDeps } from './service.js';

export type { DigDeps } from './service.js';
export { connectionsFor, axesFor, type DigAxis } from './connections.js';

export const deleteAccountDig: AccountDataDeleter = async (ctx, account) => {
  await ctx.db.deleteFrom('dig_session').where('user_id', '=', account.userId).execute();
};

/** DIG history belongs to the user's archive and is exported with it. */
export const digExportSection: ExportSection = async (ctx, userId) => {
  const sessions = await ctx.db
    .selectFrom('dig_session')
    .selectAll()
    .where('user_id', '=', userId)
    .execute();
  const nodes = sessions.length
    ? await ctx.db
        .selectFrom('dig_trail_node')
        .select(['session_id', 'seq', 'parent_seq', 'entity_id', 'via_axis', 'played', 'saved'])
        .where(
          'session_id',
          'in',
          sessions.map((s) => s.id),
        )
        .orderBy('seq')
        .execute()
    : [];
  return [
    'dig_sessions',
    sessions.map((s) => ({
      dig_session_id: s.id,
      title: s.title,
      saved: s.saved,
      started_at: s.started_at.toISOString(),
      trail: nodes.filter((n) => n.session_id === s.id).map(({ session_id: _, ...n }) => n),
    })),
  ];
};

export function digModule(deps: DigDeps): Module {
  return { name: 'dig', routes: digRoutes(deps) };
}
