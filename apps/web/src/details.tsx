import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, get, type Connection, type EntitySummary, type Playability } from './api';
import { AXIS_TEXT, EvidenceLine } from './dig';
import { usePlayer, type QueueEntry } from './player';
import { digHref, entityHref } from './route';
import { Status } from './views';

interface Ref {
  entity_id: string;
  name: string;
}
interface Recording {
  recording_id: string;
  title: string;
  artists: Ref[];
  duration_ms: number | null;
  isrc: string | null;
  releases: { release_id: string; title: string }[];
  playability: Playability;
}
interface Release {
  release_id: string;
  title: string;
  release_type: string;
  artists: Ref[];
  label: Ref | null;
  release_date: string | null;
  tracks: {
    disc_no: number;
    position: number;
    recording_id: string;
    title: string;
    duration_ms: number | null;
    playability: Playability;
  }[];
}
interface Passport {
  creation: {
    stage: string;
    method: string;
    verification_state: string | null;
    basis: string | null;
  }[];
  credits: {
    credit_id: string;
    contributor: Ref;
    role: string;
    instrument: string | null;
    creation_method: string;
    basis: string;
    verification_state: string;
  }[];
  claims: { claim_type: string; value: string; issuer: string; verification_state: string }[];
  integrity: { axis: string; value: string; basis: string }[];
}

const STAGE_TEXT: Record<string, string> = {
  composition: '작곡',
  lyrics: '작사',
  vocals: '보컬',
  instruments: '연주',
  mixing: '믹싱',
  mastering: '마스터링',
  artwork: '아트워크',
};
const METHOD_TEXT: Record<string, string> = {
  human: '사람',
  ai_assisted: 'AI 보조',
  ai_generated: 'AI 생성',
  unknown: '알 수 없음',
};
const VERIFICATION_TEXT: Record<string, string> = {
  self_declared: '본인 신고',
  distributor_verified: '유통사 확인',
  signature_valid: '서명 확인',
  process_evidence_reviewed: '제작 증거 검토',
  rights_reviewed: '권리 검토',
};
const BASIS_TEXT: Record<string, string> = {
  verified_fact: '검증된 사실',
  declared: '신고된 정보',
  ml_inferred: '추정',
  automated: '자동 판정',
  reviewed: '검토됨',
};
const INTEGRITY_TEXT: Record<string, string> = {
  ai_generation: 'AI 생성 여부',
  technical_quality: '기술 품질',
  spam_risk: '스팸 위험',
  rights_status: '권리 상태',
  recommendation_eligibility: '추천 대상',
};
const REPORT_REASONS = [
  ['wrong_credit', '크레딧 오류'],
  ['wrong_relation', '관계 오류'],
  ['undisclosed_ai', 'AI 사용 미표기'],
  ['spam', '스팸'],
  ['impersonation', '사칭'],
  ['rights_infringement', '권리 침해'],
  ['other', '기타'],
] as const;
const TYPE_TEXT: Record<string, string> = {
  artist: '아티스트',
  person: '인물',
  label: '레이블',
  album: '앨범',
  single: '싱글',
  ep: 'EP',
  compilation: '컴필레이션',
};

const label = (map: Record<string, string>, v: string | null) => (v ? (map[v] ?? v) : '—');

function duration(ms: number | null): string {
  if (ms === null) return '';
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

function Links({ refs }: { refs: Ref[] }) {
  return (
    <>
      {refs.map((r, i) => (
        <span key={r.entity_id}>
          {i > 0 ? ', ' : ''}
          <a href={entityHref(r.entity_id)}>{r.name}</a>
        </span>
      ))}
    </>
  );
}

/** Loads one resource; a 404 is shown as "not found" instead of an error. */
// T is the caller's expected response shape (validated server-side by the contract).
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function useResource<T>(path: string): { data: T | null; missing: boolean } {
  const [state, setState] = useState<{ data: T | null; missing: boolean }>({
    data: null,
    missing: false,
  });
  useEffect(() => {
    let stale = false;
    setState({ data: null, missing: false });
    get<T>(path).then(
      (data) => {
        if (!stale) setState({ data, missing: false });
      },
      (e: unknown) => {
        if (!stale && e instanceof ApiError && e.status === 404)
          setState({ data: null, missing: true });
      },
    );
    return () => {
      stale = true;
    };
  }, [path]);
  return state;
}

function Page({
  title,
  kind,
  missing,
  children,
}: {
  title: string | null;
  kind: string;
  missing: boolean;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby="detail-h" className="detail">
      <button
        type="button"
        className="link"
        onClick={() => {
          history.back();
        }}
      >
        ← 뒤로
      </button>
      {missing ? (
        <p role="status">찾을 수 없습니다.</p>
      ) : title === null ? (
        <p role="status">불러오는 중…</p>
      ) : (
        <>
          <p className="badge">{kind}</p>
          <h2 id="detail-h">{title}</h2>
          {children}
        </>
      )}
    </section>
  );
}

function SaveButton({ refType, refId }: { refType: 'recording' | 'release'; refId: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          api('POST', '/v1/library', { ref_type: refType, ref_id: refId }).then(
            () => {
              setMsg('라이브러리에 저장했습니다.');
            },
            (e: unknown) => {
              setMsg(
                e instanceof ApiError && e.code === 'ALREADY_EXISTS'
                  ? '이미 라이브러리에 있습니다.'
                  : '저장하지 못했습니다.',
              );
            },
          );
        }}
      >
        라이브러리에 저장
      </button>
      {msg ? <span role="status"> {msg}</span> : null}
    </>
  );
}

/** Reports go to triage; they never remove anything automatically (takedown-workflow §3). */
function ReportForm({ subjectType, subjectId }: { subjectType: string; subjectId: string }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!open)
    return (
      <p>
        <button
          type="button"
          className="link"
          onClick={() => {
            setOpen(true);
          }}
        >
          정보가 잘못되었나요? 신고하기
        </button>
        {msg ? <span role="status"> {msg}</span> : null}
      </p>
    );
  return (
    <form
      className="card"
      aria-label="신고"
      onSubmit={(e) => {
        e.preventDefault();
        const f = e.currentTarget.elements;
        const reason = (f.namedItem('reason') as HTMLSelectElement).value;
        const details = (f.namedItem('details') as HTMLTextAreaElement).value.trim();
        api<{ status: string }>('POST', '/v1/reports', {
          subject_type: subjectType,
          subject_id: subjectId,
          reason_code: reason,
          ...(details ? { details } : {}),
        }).then(
          () => {
            setOpen(false);
            setMsg('신고가 접수되었습니다. 검토 후 처리됩니다.');
          },
          (err: unknown) => {
            setMsg(
              err instanceof ApiError && err.status === 429
                ? '신고가 너무 많습니다. 잠시 후 다시 시도하세요.'
                : '신고를 보내지 못했습니다.',
            );
          },
        );
      }}
    >
      <h3>신고</h3>
      <label>
        사유{' '}
        <select name="reason" required defaultValue="wrong_credit">
          {REPORT_REASONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        설명 (선택) <textarea name="details" maxLength={2000} rows={3} />
      </label>
      <div className="actions">
        <button type="submit">신고 보내기</button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
          }}
        >
          취소
        </button>
      </div>
      {msg ? <p role="status">{msg}</p> : null}
    </form>
  );
}

/** Music Passport (TRU-001..012): per-stage creation, credits, claims, independent axes. */
function PassportView({ recordingId }: { recordingId: string }) {
  const { data: p } = useResource<Passport>(`/v1/recordings/${recordingId}/passport`);
  if (!p) return null;
  return (
    <section aria-labelledby="passport-h" className="card">
      <h3 id="passport-h">Music Passport</h3>
      <table className="passport">
        <caption className="small muted">
          단계별 제작 방식. 신고되지 않은 단계는 &lsquo;알 수 없음&rsquo;입니다.
        </caption>
        <thead>
          <tr>
            <th scope="col">단계</th>
            <th scope="col">방식</th>
            <th scope="col">근거</th>
          </tr>
        </thead>
        <tbody>
          {p.creation.map((c) => (
            <tr key={c.stage}>
              <th scope="row">{label(STAGE_TEXT, c.stage)}</th>
              <td>{label(METHOD_TEXT, c.method)}</td>
              <td className="small">
                {c.basis ? label(BASIS_TEXT, c.basis) : '—'}
                {c.verification_state ? ` · ${label(VERIFICATION_TEXT, c.verification_state)}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.credits.length > 0 ? (
        <>
          <h4>크레딧</h4>
          <ul className="list">
            {p.credits.map((c) => (
              <li key={c.credit_id}>
                <div>
                  <a href={entityHref(c.contributor.entity_id)}>{c.contributor.name}</a>{' '}
                  <span className="muted">
                    {c.role}
                    {c.instrument ? ` (${c.instrument})` : ''}
                  </span>
                  <br />
                  <span className="small">
                    {label(METHOD_TEXT, c.creation_method)} · {label(BASIS_TEXT, c.basis)} ·{' '}
                    {label(VERIFICATION_TEXT, c.verification_state)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {p.claims.length > 0 ? (
        <>
          <h4>권리·출처 주장</h4>
          <ul className="list">
            {p.claims.map((c, i) => (
              <li key={`${c.claim_type}:${String(i)}`} className="small">
                {c.claim_type === 'creation_method' ? label(METHOD_TEXT, c.value) : c.value} —{' '}
                {c.issuer} · {label(VERIFICATION_TEXT, c.verification_state)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h4>무결성</h4>
      <p className="small muted">하나의 점수가 아니라 서로 독립된 축입니다.</p>
      {p.integrity.length === 0 ? <p className="small">아직 판정된 축이 없습니다.</p> : null}
      <dl className="integrity">
        {p.integrity.map((x) => (
          <div key={x.axis}>
            <dt>{label(INTEGRITY_TEXT, x.axis)}</dt>
            <dd>
              {x.value} <span className="small muted">({label(BASIS_TEXT, x.basis)})</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function RecordingDetail({ id }: { id: string }) {
  const player = usePlayer();
  const { data: r, missing } = useResource<Recording>(`/v1/recordings/${id}`);
  return (
    <Page title={r?.title ?? null} kind="곡" missing={missing}>
      {r ? (
        <>
          <p>
            <Links refs={r.artists} />
            {r.duration_ms !== null ? (
              <span className="muted"> · {duration(r.duration_ms)}</span>
            ) : null}
            {r.isrc ? <span className="muted small"> · ISRC {r.isrc}</span> : null}
          </p>
          {r.releases.length > 0 ? (
            <p>
              수록:{' '}
              {r.releases.map((rel, i) => (
                <span key={rel.release_id}>
                  {i > 0 ? ', ' : ''}
                  <a href={entityHref(rel.release_id)}>{rel.title}</a>
                </span>
              ))}
            </p>
          ) : null}
          <p>
            <Status p={r.playability} />
          </p>
          <div className="actions">
            <button
              type="button"
              disabled={!r.playability.playable}
              onClick={() => {
                player.play([
                  {
                    key: r.recording_id,
                    title: r.title,
                    subtitle: r.artists.map((a) => a.name).join(', '),
                    recording_id: r.recording_id,
                  },
                ]);
              }}
            >
              재생
            </button>
            <a className="button" href={digHref(r.recording_id)}>
              DIG
            </a>
            <SaveButton refType="recording" refId={r.recording_id} />
          </div>
          <PassportView recordingId={r.recording_id} />
          <ReportForm subjectType="recording" subjectId={r.recording_id} />
        </>
      ) : null}
    </Page>
  );
}

export function ReleaseDetail({ id }: { id: string }) {
  const player = usePlayer();
  const { data: r, missing } = useResource<Release>(`/v1/releases/${id}`);
  const queue: QueueEntry[] =
    r?.tracks.map((t) => ({
      key: t.recording_id,
      title: t.title,
      subtitle: r.artists.map((a) => a.name).join(', '),
      recording_id: t.recording_id,
    })) ?? [];
  return (
    <Page
      title={r?.title ?? null}
      kind={label(TYPE_TEXT, r?.release_type ?? null)}
      missing={missing}
    >
      {r ? (
        <>
          <p>
            <Links refs={r.artists} />
            {r.release_date ? <span className="muted"> · {r.release_date}</span> : null}
            {r.label ? (
              <>
                {' '}
                · <a href={entityHref(r.label.entity_id)}>{r.label.name}</a>
              </>
            ) : null}
          </p>
          <div className="actions">
            <a className="button" href={digHref(r.release_id)}>
              DIG
            </a>
            <SaveButton refType="release" refId={r.release_id} />
          </div>
          <ol className="list tracks" aria-label="트랙">
            {r.tracks.map((t, i) => (
              <li key={`${String(t.disc_no)}-${String(t.position)}`}>
                <div>
                  <a href={entityHref(t.recording_id)}>{t.title}</a>{' '}
                  <span className="muted small">{duration(t.duration_ms)}</span>{' '}
                  <Status p={t.playability} />
                </div>
                <div className="actions">
                  <button
                    type="button"
                    disabled={!t.playability.playable}
                    onClick={() => {
                      player.play(queue, i);
                    }}
                  >
                    재생
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <ReportForm subjectType="release" subjectId={r.release_id} />
        </>
      ) : null}
    </Page>
  );
}

/** Artists, people and labels: what they connect to, along the DIG axes. */
export function EntityDetail({ id }: { id: string }) {
  const { data: e, missing } = useResource<EntitySummary>(`/v1/entities/${id}`);
  const [axes, setAxes] = useState<{ axis: string; count: number }[]>([]);
  const [axis, setAxis] = useState<string | null>(null);
  const [conns, setConns] = useState<Connection[]>([]);
  useEffect(() => {
    let stale = false;
    void get<{ axes: { axis: string; count: number }[] }>(`/v1/dig/entities/${id}/axes`).then(
      (r) => {
        if (stale) return;
        setAxes(r.axes);
        setAxis(r.axes[0]?.axis ?? null);
      },
    );
    return () => {
      stale = true;
    };
  }, [id]);
  useEffect(() => {
    if (!axis) return;
    let stale = false;
    void get<{ items: Connection[] }>(
      `/v1/dig/entities/${id}/connections?axis=${axis}&limit=50`,
    ).then((r) => {
      if (!stale) setConns(r.items);
    });
    return () => {
      stale = true;
    };
  }, [id, axis]);
  return (
    <Page title={e?.name ?? null} kind={label(TYPE_TEXT, e?.entity_type ?? null)} missing={missing}>
      {e ? (
        <>
          {e.subtitle ? <p className="muted">{e.subtitle}</p> : null}
          <div className="actions">
            <a className="button" href={digHref(e.entity_id)}>
              여기서 DIG 시작
            </a>
          </div>
          <div className="axes" role="tablist" aria-label="연결 축">
            {axes.map((a) => (
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
          <ul className="list" aria-label="연결">
            {conns.map((c) => (
              <li key={`${c.entity.entity_id}:${c.via.credit_id ?? c.via.relation_id ?? ''}`}>
                <div>
                  <a href={entityHref(c.entity.entity_id)}>{c.entity.name}</a>{' '}
                  <span className="muted">{c.entity.subtitle}</span>
                  <br />
                  <EvidenceLine e={c.evidence} />
                </div>
              </li>
            ))}
          </ul>
          {e.entity_type === 'artist' ? (
            <ReportForm subjectType="artist" subjectId={e.entity_id} />
          ) : null}
        </>
      ) : null}
    </Page>
  );
}
