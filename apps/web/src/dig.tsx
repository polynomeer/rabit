import { useEffect, useState } from 'react';
import {
  api,
  get,
  type Connection,
  type DigSession,
  type EntitySummary,
  type Evidence,
} from './api';
import { usePlayer } from './player';
import { entityHref } from './route';
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

export function Dig({ start }: { start: string | null }) {
  const player = usePlayer();
  const [session, setSession] = useState<DigSession | null>(null);
  const [axes, setAxes] = useState<{ axis: string; group: string; count: number }[]>([]);
  const [axis, setAxis] = useState<string | null>(null);
  const [pop, setPop] = useState<string>('any');
  const [conns, setConns] = useState<Connection[]>([]);
  const [inferred, setInferred] = useState(true);

  const node = session?.trail.find((n) => n.seq === session.current_seq) ?? null;

  // Each effect ignores responses that arrive after its inputs changed, so a slow
  // or duplicate response can never overwrite the user's newer choice.
  useEffect(() => {
    if (!start) return;
    let stale = false;
    void api<DigSession>('POST', '/v1/dig-sessions', { entity_id: start }).then((r) => {
      if (!stale) setSession(r.data);
    });
    return () => {
      stale = true;
    };
  }, [start]);

  useEffect(() => {
    if (!node) return;
    let stale = false;
    void get<{ axes: typeof axes }>(`/v1/dig/entities/${node.entity.entity_id}/axes`).then((r) => {
      if (stale) return;
      setAxes(r.axes);
      setAxis(r.axes[0]?.axis ?? null);
    });
    return () => {
      stale = true;
    };
  }, [node]);

  useEffect(() => {
    if (!node || !axis) {
      setConns([]);
      return;
    }
    let stale = false;
    void get<{ items: Connection[] }>(
      `/v1/dig/entities/${node.entity.entity_id}/connections?axis=${axis}&popularity=${pop}&include_inferred=${inferred}&limit=50`,
    ).then((r) => {
      if (!stale) setConns(r.items);
    });
    return () => {
      stale = true;
    };
  }, [node, axis, pop, inferred]);

  const step = async (c: Connection) => {
    if (!session) return;
    const { data } = await api<DigSession>(
      'POST',
      `/v1/dig-sessions/${session.dig_session_id}/steps`,
      {
        entity_id: c.entity.entity_id,
        axis: c.axis,
        ...(c.via.relation_id ? { relation_id: c.via.relation_id } : {}),
        ...(c.via.credit_id ? { credit_id: c.via.credit_id } : {}),
      },
    );
    setSession(data);
  };
  const back = async (seq: number) => {
    if (!session) return;
    setSession(
      (await api<DigSession>('POST', `/v1/dig-sessions/${session.dig_session_id}/cursor`, { seq }))
        .data,
    );
  };

  if (!start) return <p className="muted">Search에서 곡이나 사람을 찾아 DIG를 시작하세요.</p>;
  if (!session) return <p role="status">불러오는 중…</p>;

  const groups = [...new Set(axes.map((a) => a.group))];
  return (
    <section aria-labelledby="dig-h" className="dig">
      <h2 id="dig-h">DIG</h2>
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
          </button>
        ))}
      </nav>
      {session.empty_state ? <p className="muted">{session.empty_state.message}</p> : null}
      {node ? <Node entity={node.entity} /> : null}

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
              <button type="button" onClick={() => void step(c)}>
                따라가기
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="small muted">
        {session.summary.nodes}개 지점 · 아티스트 {session.summary.distinct_artists}명 · 축:{' '}
        {session.summary.axes_used.join(', ') || '-'}
      </p>
      <button
        type="button"
        onClick={() =>
          void api('POST', `/v1/dig-sessions/${session.dig_session_id}/playlist`, {}).then(() => {
            alert('트레일을 플레이리스트로 저장했습니다.');
          })
        }
      >
        트레일을 플레이리스트로
      </button>
    </section>
  );
}

function Node({ entity }: { entity: EntitySummary }) {
  return (
    <div className="node" aria-live="polite">
      <span className="badge">{entity.entity_type}</span>{' '}
      <strong>
        <a href={entityHref(entity.entity_id)}>{entity.name}</a>
      </strong>{' '}
      <span className="muted">{entity.subtitle}</span>
    </div>
  );
}
