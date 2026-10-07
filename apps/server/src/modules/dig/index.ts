import type { Module } from '../../app/modules.js';
import type { AccountDataDeleter } from '../identity/index.js';
import type { ExportSection } from '../library/index.js';
import { digRoutes } from './routes.js';
import type { DigDeps } from './service.js';

export type { DigDeps } from './service.js';
export { connectionsFor, axesFor, type DigAxis } from './connections.js';

export const deleteAccountDig: AccountDataDeleter = async (ctx, account) => {
  await ctx.db.deleteFrom('dig_session').where('user_id', '=', account.userId).execute();
  await ctx.db.deleteFrom('blind_dig').where('user_id', '=', account.userId).execute();
};

/** Blind Digging rounds and decisions belong to the DIG history in the export. */
export const blindDigExportSection: ExportSection = async (ctx, userId) => {
  const rounds = await ctx.db
    .selectFrom('blind_dig')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('created_at')
    .execute();
  const items = rounds.length
    ? await ctx.db
        .selectFrom('blind_dig_item')
        .select(['blind_dig_id', 'position', 'recording_id', 'decision', 'decided_at'])
        .where(
          'blind_dig_id',
          'in',
          rounds.map((r) => r.id),
        )
        .orderBy('position')
        .execute()
    : [];
  return [
    'blind_digs',
    rounds.map((r) => ({
      blind_dig_id: r.id,
      popularity: r.popularity,
      started_at: r.created_at.toISOString(),
      items: items
        .filter((i) => i.blind_dig_id === r.id)
        .map(({ blind_dig_id: _, decided_at, ...i }) => ({
          ...i,
          decided_at: decided_at?.toISOString() ?? null,
        })),
    })),
  ];
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
