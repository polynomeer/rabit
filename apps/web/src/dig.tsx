import { useEffect, useRef, useState } from 'react';
import {
  api,
  get,
  type Connection,
  type DigSession,
  type EntitySummary,
  type Evidence,
} from './api';
import { formatDate, t, tCode, type MessageKey } from './i18n';
import { BlindDigPanel } from './blind';
import { Icon, Mark } from './brand';
import { CrateDigPanel } from './crate';
import { usePlayer } from './player';
import { digSessionHref, entityHref, replaceRoute, tabHref } from './route';
import { Status } from './views';

/** DIG axis code → label (use with `tCode`). */
export const AXIS_TEXT: Record<string, MessageKey> = {
  credits: 'dig.axis.credits',
  same_producer: 'dig.axis.same_producer',
  session_musicians: 'dig.axis.session_musicians',
  artists: 'dig.axis.artists',
  members: 'dig.axis.members',
  member_of: 'dig.axis.member_of',
  tracks: 'dig.axis.tracks',
  releases: 'dig.axis.releases',
  same_label: 'dig.axis.same_label',
  samples: 'dig.axis.samples',
  sampled_by: 'dig.axis.sampled_by',
  covers: 'dig.axis.covers',
  covered_by: 'dig.axis.covered_by',
  remix_of: 'dig.axis.remix_of',
  remixes: 'dig.axis.remixes',
  influenced_by: 'dig.axis.influenced_by',
  influences: 'dig.axis.influences',
};
const GROUP_TEXT: Record<string, MessageKey> = {
  people: 'dig.group.people',
  history: 'dig.group.history',
  sound: 'dig.group.sound',
  place: 'dig.group.place',
};
export const POPULARITY = [
  ['any', 'dig.popularity.any'],
  ['below_top_50', 'dig.popularity.below_top_50'],
  ['deep_cuts', 'dig.popularity.deep_cuts'],
  ['obscure', 'dig.popularity.obscure'],
] as const satisfies readonly (readonly [string, MessageKey])[];

const ROLE_TEXT: Record<string, MessageKey> = {
  composer: 'credit.role.composer',
  lyricist: 'credit.role.lyricist',
  producer: 'credit.role.producer',
  engineer: 'credit.role.engineer',
  mixing_engineer: 'credit.role.mixing_engineer',
  mastering_engineer: 'credit.role.mastering_engineer',
  performer: 'credit.role.performer',
  featured_artist: 'credit.role.featured_artist',
  arranger: 'credit.role.arranger',
};

/** A credit role code in the client's language; unknown roles show as sent. */
export const roleText = (role: string) => tCode(ROLE_TEXT, role);

const REASON_TEXT: Record<string, MessageKey> = {
  'relation.samples': 'dig.reason.relation.samples',
  'relation.sampled_by': 'dig.reason.relation.sampled_by',
  'relation.covers': 'dig.reason.relation.covers',
  'relation.covered_by': 'dig.reason.relation.covered_by',
  'relation.remix_of': 'dig.reason.relation.remix_of',
  'relation.remixes': 'dig.reason.relation.remixes',
  'relation.influenced_by': 'dig.reason.relation.influenced_by',
  'relation.influences': 'dig.reason.relation.influences',
  'relation.member_of': 'dig.reason.relation.member_of',
  'relation.members': 'dig.reason.relation.members',
  credit: 'dig.reason.credit',
  credited_as: 'dig.reason.credited_as',
  same_producer: 'dig.reason.same_producer',
  same_session_player: 'dig.reason.same_session_player',
  main_artist: 'dig.reason.main_artist',
  on_release: 'dig.reason.on_release',
  recording_by_artist: 'dig.reason.recording_by_artist',
  appears_on: 'dig.reason.appears_on',
  released_on_label: 'dig.reason.released_on_label',
  release_by_artist: 'dig.reason.release_by_artist',
  same_label: 'dig.reason.same_label',
};

/**
 * The connection's reason in the client's language. Falls back to the server's
 * English sentence for unknown codes and for trail nodes stored before codes existed.
 */
export function reasonText(e: Evidence): string {
  const r = e.reason;
  if (!r) return e.explanation;
  const p = r.params;
  if (r.code === 'credit' && p['instrument'])
    return t('dig.reason.creditInstrument', { ...p, role: roleText(p['role'] ?? '') });
  if (r.code === 'same_session_player' && p['instrument'])
    return t('dig.reason.same_session_playerInstrument', p);
  const key = REASON_TEXT[r.code];
  if (!key) return e.explanation;
  return t(key, p['role'] ? { ...p, role: roleText(p['role']) } : p);
}

/** Verified fact vs declared vs ML estimate are always distinguishable (DIG-018). */
export function EvidenceLine({ e }: { e: Evidence }) {
  const basis =
    e.basis === 'verified_fact'
      ? t('dig.evidence.verified')
      : e.basis === 'declared'
        ? t('dig.evidence.declared')
        : t('dig.evidence.inferred', { percent: Math.round((e.confidence ?? 0) * 100) });
  return (
    <span className={`small evidence basis-${e.basis}`}>
      <Icon name={e.basis === 'ml_inferred' ? 'spark' : 'credits'} size={14} />
      {reasonText(e)} — <em>{basis}</em>
      {e.license_status && e.license_status !== 'not_applicable' ? (
        <span className="muted"> · {t('dig.evidence.license', { status: e.license_status })}</span>
      ) : null}
    </span>
  );
}

export function DigSessionView({ id }: { id: string }) {
  const player = usePlayer();
  const [session, setSession] = useState<DigSession | null>(null);
  const [axes, setAxes] = useState<{ axis: string; group: string; count: number }[]>([]);
  const [axis, setAxis] = useState<string | null>(null);
  const [pop, setPop] = useState<string>('any');
  const [conns, setConns] = useState<Connection[]>([]);
  const [inferred, setInferred] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);

  const node = session?.trail.find((n) => n.seq === session.current_seq) ?? null;
  const nodeEntity = node?.entity.entity_id ?? null;
  const nodeKey = node ? `${String(node.seq)}:${node.entity.entity_id}` : null;
  const ended = session?.state === 'ended';

  // Each effect ignores responses that arrive after its inputs changed, so a slow
  // or duplicate response can never overwrite the user's newer choice.
  useEffect(() => {
    let stale = false;
    setSession(null);
    void get<DigSession>(`/v1/dig-sessions/${id}`).then((r) => {
      if (!stale) setSession(r);
    });
    return () => {
      stale = true;
    };
  }, [id]);

  useEffect(() => {
    if (!nodeEntity) return;
    let stale = false;
    void get<{ axes: typeof axes }>(`/v1/dig/entities/${nodeEntity}/axes`).then((r) => {
      if (stale) return;
      setAxes(r.axes);
      setAxis(r.axes[0]?.axis ?? null);
    });
    return () => {
      stale = true;
    };
    // Keyed by the point, not the session object: renaming the session or saving a
    // point must not reset the chosen axis; a new point starts on its first axis.
  }, [nodeKey, nodeEntity]);

  useEffect(() => {
    if (!nodeEntity || !axis) {
      setConns([]);
      return;
    }
    let stale = false;
    void get<{ items: Connection[] }>(
      `/v1/dig/entities/${nodeEntity}/connections?axis=${axis}&popularity=${pop}&include_inferred=${inferred}&limit=50`,
    ).then((r) => {
      if (!stale) setConns(r.items);
    });
    return () => {
      stale = true;
    };
  }, [nodeEntity, axis, pop, inferred]);

  // Session changes run one at a time, in order. Concurrent ones (a quick second
  // click) could otherwise answer out of order, and an older session state would
  // overwrite a newer one — e.g. a saved point hiding the step taken just before.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const change = (method: string, path: string, body?: unknown) => {
    if (!session) return Promise.resolve();
    const run = queue.current.then(async () => {
      const { data } = await api<DigSession>(
        method,
        `/v1/dig-sessions/${session.dig_session_id}${path}`,
        body,
      );
      setSession(data);
    });
    queue.current = run.catch(() => undefined);
    return run;
  };
  const step = (c: Connection) =>
    change('POST', '/steps', {
      entity_id: c.entity.entity_id,
      axis: c.axis,
      ...(c.via.relation_id ? { relation_id: c.via.relation_id } : {}),
      ...(c.via.credit_id ? { credit_id: c.via.credit_id } : {}),
    });
  const update = (patch: { title?: string | null; saved?: boolean }) => change('PATCH', '', patch);
  const act = (seq: number, action: 'played' | 'saved') =>
    change('POST', `/nodes/${String(seq)}/actions`, { action });
  const end = () => change('POST', '/end');
  const back = (seq: number) => change('POST', '/cursor', { seq });

  if (!session) return <p role="status">{t('common.loading')}</p>;

  const groups = [...new Set(axes.map((a) => a.group))];
  return (
    <section aria-labelledby="dig-h" className="dig">
      <p className="eyebrow">Rabbit hole</p>
      <h2 id="dig-h">DIG</h2>
      <SessionHeader
        session={session}
        onRename={(title) => void update({ title })}
        onSave={(saved) => update({ saved })}
        onEnd={() => void end()}
      />
      <nav aria-label={t('dig.trail')} className="trail">
        <span className="eyebrow" aria-hidden="true">
          Trail
        </span>
        {session.trail.map((n) => (
          <button
            key={n.seq}
            type="button"
            aria-current={n.seq === session.current_seq ? 'step' : undefined}
            className={n.seq === session.current_seq ? 'current' : ''}
            onClick={() => void back(n.seq)}
          >
            {n.via_axis ? (
              <span className="muted small">{tCode(AXIS_TEXT, n.via_axis)} → </span>
            ) : null}
            {n.entity.name}
            {n.saved ? <span aria-label={t('dig.trail.saved')}> ★</span> : null}
            {n.played ? <span aria-label={t('dig.trail.played')}> ♪</span> : null}
          </button>
        ))}
      </nav>
      {session.empty_state ? <p className="muted">{session.empty_state.message}</p> : null}
      {node ? (
        <Node
          entity={node.entity}
          saved={node.saved}
          onPlay={
            node.entity.entity_type === 'recording'
              ? () => {
                  player.play([
                    {
                      key: node.entity.entity_id,
                      title: node.entity.name,
                      subtitle: node.entity.subtitle,
                      recording_id: node.entity.entity_id,
                    },
                  ]);
                  void act(node.seq, 'played');
                }
              : null
          }
          onSave={() => void act(node.seq, 'saved')}
        />
      ) : null}

      <div className="axes" role="tablist" aria-label={t('dig.axes')}>
        {groups.map((g) => (
          <div
            key={g}
            className={
              axes.some((a) => a.group === g && a.axis === axis)
                ? 'axis-group active'
                : 'axis-group'
            }
          >
            <span className="group">{tCode(GROUP_TEXT, g)}</span>
            {axes
              .filter((a) => a.group === g)
              .map((a) => (
                <button
                  key={a.axis}
                  type="button"
                  role="tab"
                  aria-selected={axis === a.axis}
                  onClick={() => {
                    setAxis(a.axis);
                  }}
                >
                  {tCode(AXIS_TEXT, a.axis)} <span className="muted">{a.count}</span>
                </button>
              ))}
          </div>
        ))}
      </div>
      <div className="filters">
        <label>
          {t('dig.filter.popularity')}{' '}
          <select
            value={pop}
            onChange={(e) => {
              setPop(e.target.value);
            }}
          >
            {POPULARITY.map(([v, l]) => (
              <option key={v} value={v}>
                {t(l)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={inferred}
            onChange={(e) => {
              setInferred(e.target.checked);
            }}
          />{' '}
          {t('dig.filter.inferred')}
        </label>
      </div>
      <ul className="connections" aria-label={t('common.connections')}>
        {conns.map((c) => (
          <li
            key={`${c.entity.entity_id}:${c.via.credit_id ?? c.via.relation_id ?? ''}`}
            className={`basis-${c.evidence.basis}`}
          >
            <EntityMark entity={c.entity} size={52} />
            <div className="conn-main">
              <strong>
                <a href={entityHref(c.entity.entity_id)}>{c.entity.name}</a>
              </strong>{' '}
              <span className="muted">{c.entity.subtitle}</span>
              <br />
              <EvidenceLine e={c.evidence} />
              {c.playability ? (
                <>
                  {' '}
                  · <Status p={c.playability} />
                </>
              ) : null}
            </div>
            <div className="actions">
              {c.entity.entity_type === 'recording' && c.playability?.playable ? (
                <button
                  type="button"
                  onClick={() => {
                    player.play([
                      {
                        key: c.entity.entity_id,
                        title: c.entity.name,
                        subtitle: c.entity.subtitle,
                        recording_id: c.entity.entity_id,
                      },
                    ]);
                  }}
                >
                  {t('dig.conn.preview')}
                </button>
              ) : null}
              {ended ? null : (
                <button type="button" className="primary" onClick={() => void step(c)}>
                  {t('dig.conn.follow')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="card dig-summary">
        <p className="small muted">
          {t('dig.summary', {
            nodes: session.summary.nodes,
            artists: session.summary.distinct_artists,
            axes: session.summary.axes_used.join(', ') || '-',
            played: session.summary.played,
            saved: session.summary.saved,
          })}
        </p>
        <button
          type="button"
          onClick={() =>
            void api<{ title: string }>(
              'POST',
              `/v1/dig-sessions/${session.dig_session_id}/playlist`,
              {},
            ).then(
              ({ data }) => {
                setSaved(t('dig.playlist.saved', { title: data.title }));
              },
              () => {
                setSaved(t('dig.playlist.failed'));
              },
            )
          }
        >
          {t('dig.playlist.create')}
        </button>
        {saved ? (
          <p role="status">
            {saved} <a href={tabHref('Playlists')}>{t('dig.playlist.view')}</a>
          </p>
        ) : null}
      </div>
    </section>
  );
}

const ENTITY_TEXT: Record<string, MessageKey> = {
  recording: 'common.recording',
  release: 'common.release',
  artist: 'dig.entity.artist',
  person: 'dig.entity.person',
  label: 'dig.entity.label',
};

/** Catalog items get their stand-in cover; people, artists and labels an initial. */
function EntityMark({ entity, size }: { entity: EntitySummary; size: number }) {
  return <Mark id={entity.entity_id} kind={entity.entity_type} name={entity.name} size={size} />;
}

function Node({
  entity,
  saved,
  onPlay,
  onSave,
}: {
  entity: EntitySummary;
  saved: boolean;
  onPlay: (() => void) | null;
  onSave: () => void;
}) {
  return (
    <div className="node" aria-live="polite">
      <div className="node-mark">
        <EntityMark entity={entity} size={104} />
      </div>
      <p className="eyebrow">{tCode(ENTITY_TEXT, entity.entity_type)}</p>
      <strong className="node-name">
        <a href={entityHref(entity.entity_id)}>{entity.name}</a>
      </strong>
      {entity.subtitle ? <span className="muted">{entity.subtitle}</span> : null}
      <div className="actions">
        {onPlay ? (
          <button type="button" className="primary" onClick={onPlay}>
            {t('dig.node.play')}
          </button>
        ) : null}
        <button type="button" onClick={onSave} disabled={saved} aria-pressed={saved}>
          {saved ? t('dig.node.saved') : t('dig.node.save')}
        </button>
      </div>
    </div>
  );
}

/** Title, keep-in-history and end; an ended session stays readable but cannot grow. */
function SessionHeader({
  session,
  onRename,
  onSave,
  onEnd,
}: {
  session: DigSession;
  onRename: (title: string | null) => void;
  onSave: (saved: boolean) => Promise<void>;
  onEnd: () => void;
}) {
  // Optimistic: the box follows the click at once and reverts if the server refuses.
  const [kept, setKept] = useState(session.saved);
  useEffect(() => {
    setKept(session.saved);
  }, [session.saved]);
  return (
    <div className="session-bar">
      <form
        aria-label={t('dig.session.title')}
        onSubmit={(e) => {
          e.preventDefault();
          const v = (e.currentTarget.elements.namedItem('title') as HTMLInputElement).value.trim();
          onRename(v === '' ? null : v);
        }}
      >
        <input
          name="title"
          aria-label={t('dig.session.title')}
          placeholder={t('dig.session.untitled')}
          defaultValue={session.title ?? ''}
          key={session.title ?? ''}
          maxLength={200}
        />
        <button type="submit">{t('dig.session.saveTitle')}</button>
      </form>
      <label>
        <input
          type="checkbox"
          checked={kept}
          onChange={(e) => {
            const next = e.target.checked;
            setKept(next);
            onSave(next).catch(() => {
              setKept(!next);
            });
          }}
        />{' '}
        {t('dig.session.keep')}
      </label>
      {session.state === 'ended' ? (
        <span className="badge">{t('dig.session.ended')}</span>
      ) : (
        <button type="button" onClick={onEnd}>
          {t('dig.session.end')}
        </button>
      )}
    </div>
  );
}

/** `#/dig/<entity>`: starts one session, then replaces the URL with the session's own. */
export function DigStart({ entityId }: { entityId: string }) {
  // StrictMode runs effects twice in development; the ref keeps it to one session.
  const started = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (started.current === entityId) return;
    started.current = entityId;
    api<DigSession>('POST', '/v1/dig-sessions', { entity_id: entityId }).then(
      ({ data }) => {
        replaceRoute(digSessionHref(data.dig_session_id));
      },
      () => {
        setFailed(true);
      },
    );
  }, [entityId]);
  return <p role="status">{failed ? t('dig.start.failed') : t('dig.start.preparing')}</p>;
}

export interface SessionSummary {
  dig_session_id: string;
  title: string | null;
  saved: boolean;
  state: 'active' | 'ended';
  start_entity: EntitySummary | null;
  nodes: number;
  started_at: string;
}

/** `#/dig`: earlier explorations, to resume or revisit. */
export function DigHome() {
  const [onlySaved, setOnlySaved] = useState(false);
  const [items, setItems] = useState<SessionSummary[] | null>(null);
  useEffect(() => {
    let stale = false;
    void get<{ items: SessionSummary[] }>(
      `/v1/dig-sessions?limit=20${onlySaved ? '&saved=true' : ''}`,
    ).then((r) => {
      if (!stale) setItems(r.items);
    });
    return () => {
      stale = true;
    };
  }, [onlySaved]);
  return (
    <section aria-labelledby="dig-home-h" className="dig-home">
      <p className="eyebrow">Rabbit hole</p>
      <h2 id="dig-home-h">DIG</h2>
      <p className="lede">{t('dig.home.lede')}</p>
      <p className="muted">{t('dig.home.hint')}</p>
      <div className="dig-modes">
        <BlindDigPanel />
        <CrateDigPanel />
      </div>
      <h3 className="eyebrow section-title">{t('dig.home.history')}</h3>
      <label>
        <input
          type="checkbox"
          checked={onlySaved}
          onChange={(e) => {
            setOnlySaved(e.target.checked);
          }}
        />{' '}
        {t('dig.home.onlySaved')}
      </label>
      <ul className="list history" aria-label={t('dig.home.history')}>
        {(items ?? []).map((s) => (
          <li key={s.dig_session_id}>
            {s.start_entity ? <EntityMark entity={s.start_entity} size={44} /> : null}
            <div className="history-main">
              <strong>
                <a href={digSessionHref(s.dig_session_id)}>
                  {s.title ??
                    (s.start_entity
                      ? t('dig.home.startedFrom', { name: s.start_entity.name })
                      : t('dig.home.untitled'))}
                </a>
              </strong>{' '}
              <span className="muted small">
                {t('dig.home.meta', { nodes: s.nodes, date: formatDate(s.started_at) })}
              </span>{' '}
              {s.saved ? <span className="badge">{t('dig.home.kept')}</span> : null}{' '}
              {s.state === 'ended' ? <span className="badge">{t('dig.home.ended')}</span> : null}
            </div>
          </li>
        ))}
        {items !== null && items.length === 0 ? (
          <li className="muted">{t('dig.home.empty')}</li>
        ) : null}
      </ul>
    </section>
  );
}
