import { useEffect, useRef, useState } from 'react';
import {
  api,
  get,
  type Connection,
  type DigSession,
  type EntitySummary,
  type Evidence,
} from './api';
import { usePlayer } from './player';
import { digSessionHref, entityHref, replaceRoute, tabHref } from './route';
import { Status } from './views';

export const AXIS_TEXT: Record<string, string> = {
  credits: 'Credits',
  same_producer: '같은 프로듀서',
  session_musicians: '세션 뮤지션',
  artists: '아티스트',
  members: '멤버',
  member_of: '소속',
  tracks: '수록곡',
  releases: '릴리스',
  same_label: '같은 레이블',
  samples: '샘플링한 곡',
  sampled_by: '이 곡을 샘플링',
  covers: '원곡',
  covered_by: '커버',
  remix_of: '원곡(리믹스)',
  remixes: '리믹스',
  influenced_by: '영향 받음',
  influences: '영향을 줌',
};
const GROUP_TEXT: Record<string, string> = {
  people: 'PEOPLE',
  history: 'HISTORY',
  sound: 'SOUND',
  place: 'PLACE',
};
const POPULARITY = [
  ['any', 'Any'],
  ['below_top_50', 'Below Top 50%'],
  ['deep_cuts', 'Deep Cuts'],
  ['obscure', 'Obscure'],
] as const;

/** Verified fact vs declared vs ML estimate are always distinguishable (DIG-018). */
export function EvidenceLine({ e }: { e: Evidence }) {
  const basis =
    e.basis === 'verified_fact'
      ? '검증된 사실'
      : e.basis === 'declared'
        ? '신고된 정보'
        : `추정 (신뢰도 ${Math.round((e.confidence ?? 0) * 100)}%)`;
  return (
    <span className="small">
      {e.explanation} — <em>{basis}</em>
      {e.license_status && e.license_status !== 'not_applicable' ? (
        <span className="muted"> · 이용허락: {e.license_status}</span>
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

  if (!session) return <p role="status">불러오는 중…</p>;

  const groups = [...new Set(axes.map((a) => a.group))];
  return (
    <section aria-labelledby="dig-h" className="dig">
      <h2 id="dig-h">DIG</h2>
      <SessionHeader
        session={session}
        onRename={(title) => void update({ title })}
        onSave={(saved) => update({ saved })}
        onEnd={() => void end()}
      />
      <nav aria-label="Digging Trail" className="trail">
        {session.trail.map((n) => (
          <button
            key={n.seq}
            type="button"
            aria-current={n.seq === session.current_seq ? 'step' : undefined}
            className={n.seq === session.current_seq ? 'current' : ''}
            onClick={() => void back(n.seq)}
          >
            {n.via_axis ? (
              <span className="muted small">{AXIS_TEXT[n.via_axis] ?? n.via_axis} → </span>
            ) : null}
            {n.entity.name}
            {n.saved ? <span aria-label="저장됨"> ★</span> : null}
            {n.played ? <span aria-label="들음"> ♪</span> : null}
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

      <div className="axes" role="tablist" aria-label="탐험 축">
        {groups.map((g) => (
          <div key={g}>
            <span className="group">{GROUP_TEXT[g] ?? g}</span>
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
                  {AXIS_TEXT[a.axis] ?? a.axis} <span className="muted">{a.count}</span>
                </button>
              ))}
          </div>
        ))}
      </div>
      <div className="filters">
        <label>
          인지도{' '}
          <select
            value={pop}
            onChange={(e) => {
              setPop(e.target.value);
            }}
          >
            {POPULARITY.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
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
          추정 관계 포함
        </label>
      </div>
      <ul className="list" aria-label="연결">
        {conns.map((c) => (
          <li key={`${c.entity.entity_id}:${c.via.credit_id ?? c.via.relation_id ?? ''}`}>
            <div>
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
                  미리듣기
                </button>
              ) : null}
              {ended ? null : (
                <button type="button" onClick={() => void step(c)}>
                  따라가기
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="small muted">
        {session.summary.nodes}개 지점 · 아티스트 {session.summary.distinct_artists}명 · 축:{' '}
        {session.summary.axes_used.join(', ') || '-'} · 들은 곡 {session.summary.played} · 저장{' '}
        {session.summary.saved}
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
              setSaved(`'${data.title}' 플레이리스트로 저장했습니다.`);
            },
            () => {
              setSaved('플레이리스트로 저장하지 못했습니다.');
            },
          )
        }
      >
        트레일을 플레이리스트로
      </button>
      {saved ? (
        <p role="status">
          {saved} <a href={tabHref('Playlists')}>플레이리스트 보기</a>
        </p>
      ) : null}
    </section>
  );
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
      <span className="badge">{entity.entity_type}</span>{' '}
      <strong>
        <a href={entityHref(entity.entity_id)}>{entity.name}</a>
      </strong>{' '}
      <span className="muted">{entity.subtitle}</span>
      <div className="actions">
        {onPlay ? (
          <button type="button" onClick={onPlay}>
            이 지점 재생
          </button>
        ) : null}
        <button type="button" onClick={onSave} disabled={saved} aria-pressed={saved}>
          {saved ? '저장한 지점' : '이 지점 저장'}
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
        aria-label="DIG 제목"
        onSubmit={(e) => {
          e.preventDefault();
          const v = (e.currentTarget.elements.namedItem('title') as HTMLInputElement).value.trim();
          onRename(v === '' ? null : v);
        }}
      >
        <input
          name="title"
          aria-label="DIG 제목"
          placeholder="제목 없는 탐험"
          defaultValue={session.title ?? ''}
          key={session.title ?? ''}
          maxLength={200}
        />
        <button type="submit">제목 저장</button>
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
        기록에 보관
      </label>
      {session.state === 'ended' ? (
        <span className="badge">끝난 탐험</span>
      ) : (
        <button type="button" onClick={onEnd}>
          탐험 끝내기
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
  return <p role="status">{failed ? 'DIG를 시작하지 못했습니다.' : '탐험을 준비하는 중…'}</p>;
}

interface SessionSummary {
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
    <section aria-labelledby="dig-home-h">
      <h2 id="dig-home-h">DIG</h2>
      <p className="muted">Search나 곡·아티스트 화면에서 DIG를 시작하세요.</p>
      <label>
        <input
          type="checkbox"
          checked={onlySaved}
          onChange={(e) => {
            setOnlySaved(e.target.checked);
          }}
        />{' '}
        보관한 탐험만
      </label>
      <ul className="list" aria-label="내 DIG 기록">
        {(items ?? []).map((s) => (
          <li key={s.dig_session_id}>
            <div>
              <strong>
                <a href={digSessionHref(s.dig_session_id)}>
                  {s.title ?? (s.start_entity ? `${s.start_entity.name}에서 시작` : '탐험')}
                </a>
              </strong>{' '}
              <span className="muted small">
                {s.nodes}개 지점 · {new Date(s.started_at).toLocaleDateString()}
              </span>{' '}
              {s.saved ? <span className="badge">보관</span> : null}{' '}
              {s.state === 'ended' ? <span className="badge">끝남</span> : null}
            </div>
          </li>
        ))}
        {items !== null && items.length === 0 ? (
          <li className="muted">아직 탐험 기록이 없습니다.</li>
        ) : null}
      </ul>
    </section>
  );
}
