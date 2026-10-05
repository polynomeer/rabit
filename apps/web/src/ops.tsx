import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, get } from './api';
import { entityHref, opsHref, OPS_SECTIONS, type OpsSection } from './route';

/**
 * Operator console (OPS-010, R18). Every change and every look at a user's data
 * carries a reason, which the server audits; nothing here shows private content
 * (OPS-007, T30). The server enforces the operator role and MFA on every call.
 */
const SECTION_TEXT: Record<OpsSection, string> = {
  users: '사용자 지원',
  reports: '신고',
  jobs: '작업 큐',
  rights: '카탈로그 권리',
};

function errorText(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (${e.code})`;
  return e instanceof Error ? e.message : String(e);
}

const idem = () => ({ 'idempotency-key': `ops-${crypto.randomUUID()}` });

/** Runs one operator action and reports its outcome in a status line. */
function useAction() {
  const [msg, setMsg] = useState<string | null>(null);
  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setMsg(`${label}…`);
    try {
      await fn();
      setMsg(`${label}: 완료`);
      return true;
    } catch (e) {
      setMsg(`${label}: 실패 — ${errorText(e)}`);
      return false;
    }
  }, []);
  return { msg, run };
}

function Status({ msg }: { msg: string | null }) {
  return msg ? (
    <p role="status" className="small">
      {msg}
    </p>
  ) : null;
}

export function OpsConsole({ section }: { section: OpsSection }) {
  const [reason, setReason] = useState('');
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    void get<{ is_operator: boolean }>('/v1/me').then((me) => {
      setAllowed(me.is_operator);
    });
  }, []);
  if (allowed === null) return <p role="status">불러오는 중…</p>;
  if (!allowed)
    return (
      <section aria-labelledby="ops-h">
        <h2 id="ops-h">운영</h2>
        <p role="status">운영자 권한이 필요합니다.</p>
      </section>
    );
  const valid = reason.trim().length >= 3;
  return (
    <section aria-labelledby="ops-h" className="ops">
      <h2 id="ops-h">운영</h2>
      <nav aria-label="운영 메뉴" className="subnav">
        {OPS_SECTIONS.map((s) => (
          <a key={s} href={opsHref(s)} aria-current={s === section ? 'page' : undefined}>
            {SECTION_TEXT[s]}
          </a>
        ))}
      </nav>
      <label className="reason">
        처리 사유 (감사 기록에 남습니다){' '}
        <input
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
          maxLength={500}
          placeholder="예: 티켓 4711, 계약 종료"
        />
      </label>
      {!valid ? (
        <p className="small muted">변경과 사용자 조회에는 3자 이상의 사유가 필요합니다.</p>
      ) : null}
      {section === 'users' ? <Users reason={reason} valid={valid} /> : null}
      {section === 'reports' ? <Reports reason={reason} valid={valid} /> : null}
      {section === 'jobs' ? <Jobs reason={reason} valid={valid} /> : null}
      {section === 'rights' ? <Rights reason={reason} valid={valid} /> : null}
    </section>
  );
}

interface Props {
  reason: string;
  valid: boolean;
}

// ——— Users ———

interface Entitlement {
  entitlement_id: string;
  scope: string;
  resource_id: string | null;
  origin: string;
  status: string;
  valid_to: string | null;
  version: number;
}
interface Summary {
  user_id: string;
  sections: Record<string, Record<string, unknown>>;
}

/** Counts and states only; nested objects are flattened one level (`storage.used_bytes`). */
function show(x: unknown): string {
  if (x === null || x === undefined) return '—';
  if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') return String(x);
  return JSON.stringify(x);
}

function Facts({ data }: { data: Record<string, unknown> }) {
  const rows: [string, string][] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const inner = Object.entries(v as Record<string, unknown>);
      if (inner.length === 0) rows.push([k, '—']);
      for (const [ik, iv] of inner) rows.push([`${k}.${ik}`, show(iv)]);
    } else if (!Array.isArray(v)) {
      rows.push([k, show(v)]);
    }
  }
  return (
    <dl className="facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Users({ reason, valid }: Props) {
  const [userId, setUserId] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const { msg, run } = useAction();
  const load = useCallback(
    (id: string) =>
      run('조회', async () => {
        setSummary(
          await get<Summary>(
            `/v1/ops/users/${id}/support-summary?reason=${encodeURIComponent(reason)}`,
          ),
        );
      }),
    [reason, run],
  );
  const id = summary?.user_id ?? '';
  const ents = (summary?.sections['subscription']?.['entitlements'] ?? []) as Entitlement[];
  // After a change the summary is reloaded quietly, keeping the change's outcome visible.
  const refresh = useCallback(async () => {
    if (!id) return;
    setSummary(
      await get<Summary>(
        `/v1/ops/users/${id}/support-summary?reason=${encodeURIComponent(reason)}`,
      ).catch(() => summary),
    );
  }, [id, reason, summary]);
  const after = async (ok: boolean) => {
    if (ok) await refresh();
  };

  return (
    <div>
      <form
        aria-label="사용자 조회"
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void load(userId.trim());
        }}
      >
        <input
          aria-label="사용자 ID"
          placeholder="usr_… (사용자의 Account 화면 지원 문의 ID)"
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value);
          }}
          pattern="usr_[0-9A-HJKMNP-TV-Z]{26}"
          required
        />
        <button type="submit" disabled={!valid}>
          지원 요약 조회
        </button>
      </form>
      <Status msg={msg} />
      {summary ? (
        <div className="card" aria-label="지원 요약">
          <p className="small muted">
            개수·상태·ID만 표시됩니다. 제목·메모·파일명·오디오는 볼 수 없습니다(OPS-007).
          </p>
          {Object.entries(summary.sections).map(([name, data]) => (
            <section key={name} aria-label={`요약: ${name}`}>
              <h4>{name}</h4>
              <Facts data={data} />
            </section>
          ))}
          <h4>이용권</h4>
          <ul className="list" aria-label="사용자 이용권">
            {ents.map((e) => (
              <li key={e.entitlement_id}>
                <div className="small">
                  {e.scope}
                  {e.resource_id ? (
                    <>
                      {' '}
                      <a href={entityHref(e.resource_id)}>{e.resource_id}</a>
                    </>
                  ) : null}{' '}
                  · {e.origin} · <strong>{e.status}</strong> · v{e.version}
                </div>
                <div className="actions">
                  {(['active', 'suspended', 'revoked'] as const)
                    .filter((s) => s !== e.status)
                    .map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={!valid || e.status === 'revoked'}
                        onClick={() =>
                          void run(`이용권 ${s}`, () =>
                            api(
                              'POST',
                              `/v1/ops/entitlements/${e.entitlement_id}/status`,
                              { status: s, reason },
                              { 'if-match': `"${String(e.version)}"` },
                            ),
                          ).then(after)
                        }
                      >
                        {s === 'active' ? '재활성' : s === 'suspended' ? '일시 중지' : '취소'}
                      </button>
                    ))}
                </div>
              </li>
            ))}
          </ul>
          <UserActions
            userId={id}
            reason={reason}
            valid={valid}
            run={run}
            onDone={() => void refresh()}
          />
        </div>
      ) : null}
    </div>
  );
}

function UserActions({
  userId,
  reason,
  valid,
  run,
  onDone,
}: {
  userId: string;
  reason: string;
  valid: boolean;
  run: (label: string, fn: () => Promise<unknown>) => Promise<boolean>;
  onDone: () => void;
}) {
  const in30Days = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const done = (ok: boolean) => {
    if (ok) onDone();
  };
  return (
    <div className="ops-actions">
      <form
        aria-label="라이선스 지역 변경"
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const country = (e.currentTarget.elements.namedItem('country') as HTMLInputElement).value;
          void run('라이선스 지역 변경', () =>
            api('PUT', `/v1/ops/users/${userId}/license-country`, {
              license_country: country.toUpperCase(),
              reason,
            }),
          ).then(done);
        }}
      >
        <label>
          라이선스 지역{' '}
          <input name="country" pattern="[A-Za-z]{2}" maxLength={2} required size={3} />
        </label>
        <button type="submit" disabled={!valid}>
          변경
        </button>
      </form>
      <form
        aria-label="구독 설정"
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget.elements;
          const state = (f.namedItem('state') as HTMLSelectElement).value;
          const until = (f.namedItem('until') as HTMLInputElement).value;
          void run('구독 설정', () =>
            api('PUT', `/v1/ops/users/${userId}/subscription`, {
              state,
              paid_through: new Date(`${until}T23:59:59Z`).toISOString(),
              reason,
            }),
          ).then(done);
        }}
      >
        <label>
          구독 상태{' '}
          <select name="state" defaultValue="active">
            <option value="active">active</option>
            <option value="past_due">past_due</option>
            <option value="cancelled">cancelled</option>
            <option value="expired">expired</option>
          </select>
        </label>
        <label>
          결제 기한 <input name="until" type="date" defaultValue={in30Days} required />
        </label>
        <button type="submit" disabled={!valid}>
          설정
        </button>
      </form>
      <form
        aria-label="이용권 부여"
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget.elements;
          const scope = (f.namedItem('scope') as HTMLSelectElement).value;
          const resource = (f.namedItem('resource') as HTMLInputElement).value.trim();
          void run('이용권 부여', () =>
            api(
              'POST',
              '/v1/ops/entitlements',
              { user_id: userId, scope, resource_id: resource, capabilities: ['play'], reason },
              idem(),
            ),
          ).then(done);
        }}
      >
        <label>
          범위{' '}
          <select name="scope" defaultValue="release">
            <option value="release">앨범</option>
            <option value="recording">곡</option>
          </select>
        </label>
        <input
          name="resource"
          aria-label="앨범 또는 곡 ID"
          placeholder="rel_… / rec_…"
          pattern="(rel|rec)_[0-9A-HJKMNP-TV-Z]{26}"
          required
        />
        <button type="submit" disabled={!valid}>
          부여
        </button>
      </form>
    </div>
  );
}

// ——— Reports ———

interface Report {
  report_id: string;
  subject_type: string;
  subject_id: string;
  reason_code: string;
  details: string | null;
  status: string;
  created_at: string;
}

function Reports({ reason, valid }: Props) {
  const [status, setStatus] = useState('received');
  const [items, setItems] = useState<Report[]>([]);
  const { msg, run } = useAction();
  const load = useCallback(() => {
    void get<{ items: Report[] }>(`/v1/ops/reports?status=${status}`).then((r) => {
      setItems(r.items);
    });
  }, [status]);
  useEffect(load, [load]);
  return (
    <div>
      <label>
        상태{' '}
        <select
          aria-label="신고 상태"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
          }}
        >
          {['received', 'triaged', 'actioned', 'dismissed'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <Status msg={msg} />
      <ul className="list" aria-label="신고 목록">
        {items.map((r) => (
          <li key={r.report_id}>
            <div>
              <strong>{r.reason_code}</strong>{' '}
              <span className="small">
                {r.subject_type}{' '}
                {['recording', 'release', 'artist'].includes(r.subject_type) ? (
                  <a href={entityHref(r.subject_id)}>{r.subject_id}</a>
                ) : (
                  r.subject_id
                )}
              </span>
              {r.details ? <p className="small report-details">{r.details}</p> : null}
              <span className="small muted">{new Date(r.created_at).toLocaleString()}</span>
            </div>
            <div className="actions">
              {(['triaged', 'actioned', 'dismissed'] as const)
                .filter((s) => s !== r.status)
                .map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!valid}
                    onClick={() =>
                      void run(`신고 ${s}`, () =>
                        api('POST', `/v1/ops/reports/${r.report_id}/status`, {
                          status: s,
                          reason,
                        }),
                      ).then((ok) => {
                        if (ok) load();
                      })
                    }
                  >
                    {s === 'triaged' ? '분류' : s === 'actioned' ? '조치' : '기각'}
                  </button>
                ))}
            </div>
          </li>
        ))}
        {items.length === 0 ? <li className="muted">해당 상태의 신고가 없습니다.</li> : null}
      </ul>
      <p className="small muted">
        신고는 자동으로 아무것도 삭제하지 않습니다. 조치는 권리·이용권 화면에서 따로 합니다.
      </p>
    </div>
  );
}

// ——— Jobs ———

interface Job {
  job_id: string;
  kind: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  updated_at: string;
}

function Jobs({ reason, valid }: Props) {
  const [status, setStatus] = useState('dead');
  const [items, setItems] = useState<Job[]>([]);
  const { msg, run } = useAction();
  const load = useCallback(() => {
    void get<{ items: Job[] }>(`/v1/ops/jobs?status=${status}&limit=50`).then((r) => {
      setItems(r.items);
    });
  }, [status]);
  useEffect(load, [load]);
  return (
    <div>
      <label>
        상태{' '}
        <select
          aria-label="작업 상태"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
          }}
        >
          {['dead', 'failed', 'queued', 'running', 'succeeded'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <Status msg={msg} />
      <ul className="list" aria-label="작업 목록">
        {items.map((j) => (
          <li key={j.job_id}>
            <div>
              <strong>{j.kind}</strong>{' '}
              <span className="small">
                {j.status} · 시도 {j.attempts}/{j.max_attempts} ·{' '}
                {new Date(j.updated_at).toLocaleString()}
              </span>
              {j.last_error ? <p className="small warn job-error">{j.last_error}</p> : null}
            </div>
            {j.status === 'dead' || j.status === 'failed' ? (
              <div className="actions">
                <button
                  type="button"
                  disabled={!valid}
                  onClick={() =>
                    void run('재시도', () =>
                      api('POST', `/v1/ops/jobs/${j.job_id}/retry`, { reason }),
                    ).then((ok) => {
                      if (ok) load();
                    })
                  }
                >
                  재시도
                </button>
              </div>
            ) : null}
          </li>
        ))}
        {items.length === 0 ? <li className="muted">해당 상태의 작업이 없습니다.</li> : null}
      </ul>
    </div>
  );
}

// ——— Rights ———

interface Grant {
  rights_grant_id: string;
  rights_holder: string;
  territories: string[];
  uses: string[];
  valid_from: string;
  valid_to: string | null;
  status: string;
  contract_ref: string;
  version: number;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      {label} {children}
    </label>
  );
}

function Rights({ reason, valid }: Props) {
  const [recordingId, setRecordingId] = useState('');
  const [loaded, setLoaded] = useState<string | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const { msg, run } = useAction();
  const load = useCallback(
    (id: string) =>
      run('권리 조회', async () => {
        setGrants((await get<{ items: Grant[] }>(`/v1/ops/recordings/${id}/rights-grants`)).items);
        setLoaded(id);
      }),
    [run],
  );
  // After a change the grants are reloaded quietly, keeping the change's outcome visible.
  const reload = (ok: boolean) => {
    if (!ok || !loaded) return;
    void get<{ items: Grant[] }>(`/v1/ops/recordings/${loaded}/rights-grants`).then(
      (r) => {
        setGrants(r.items);
      },
      () => undefined,
    );
  };
  return (
    <div>
      <form
        aria-label="곡 권리 조회"
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void load(recordingId.trim());
        }}
      >
        <input
          aria-label="곡 ID"
          placeholder="rec_…"
          value={recordingId}
          onChange={(e) => {
            setRecordingId(e.target.value);
          }}
          pattern="rec_[0-9A-HJKMNP-TV-Z]{26}"
          required
        />
        <button type="submit">권리 조회</button>
      </form>
      <Status msg={msg} />
      {loaded ? (
        <>
          <p>
            <a href={entityHref(loaded)}>곡 화면 보기</a>
          </p>
          <ul className="list" aria-label="권리 목록">
            {grants.map((g) => (
              <li key={g.rights_grant_id}>
                <div className="small">
                  <strong>{g.status}</strong> · {g.rights_holder} · {g.territories.join(', ')} ·{' '}
                  {g.uses.join(', ')} · {new Date(g.valid_from).toLocaleDateString()} ~{' '}
                  {g.valid_to ? new Date(g.valid_to).toLocaleDateString() : '기한 없음'} ·{' '}
                  {g.contract_ref} · v{g.version}
                </div>
                <div className="actions">
                  {(['active', 'suspended', 'revoked'] as const)
                    .filter((s) => s !== g.status)
                    .map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={!valid || g.status === 'revoked'}
                        onClick={() =>
                          void run(`권리 ${s}`, () =>
                            api(
                              'POST',
                              `/v1/ops/rights-grants/${g.rights_grant_id}/status`,
                              { status: s, reason },
                              { 'if-match': `"${String(g.version)}"` },
                            ),
                          ).then(reload)
                        }
                      >
                        {s === 'active' ? '재활성' : s === 'suspended' ? '일시 중지' : '취소'}
                      </button>
                    ))}
                </div>
              </li>
            ))}
            {grants.length === 0 ? <li className="muted">권리가 없습니다.</li> : null}
          </ul>
          <form
            aria-label="권리 추가"
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget.elements;
              const v = (n: string) => (f.namedItem(n) as HTMLInputElement).value.trim();
              const until = v('valid_to');
              void run('권리 추가', () =>
                api(
                  'POST',
                  '/v1/ops/rights-grants',
                  {
                    recording_id: loaded,
                    rights_holder: v('holder'),
                    territories: v('territories')
                      .split(',')
                      .map((t) => t.trim().toUpperCase())
                      .filter(Boolean),
                    uses: ['stream'],
                    valid_from: new Date(`${v('valid_from')}T00:00:00Z`).toISOString(),
                    ...(until ? { valid_to: new Date(`${until}T23:59:59Z`).toISOString() } : {}),
                    contract_ref: v('contract'),
                    reason,
                  },
                  idem(),
                ),
              ).then(reload);
            }}
          >
            <h4>권리 추가 (스트리밍)</h4>
            <Field label="권리자">
              <input name="holder" required maxLength={200} />
            </Field>
            <Field label="지역 (쉼표로 구분, WORLD 가능)">
              <input name="territories" required placeholder="KR, JP" />
            </Field>
            <Field label="시작일">
              <input
                name="valid_from"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </Field>
            <Field label="종료일 (선택)">
              <input name="valid_to" type="date" />
            </Field>
            <Field label="계약 참조">
              <input name="contract" required maxLength={200} />
            </Field>
            <button type="submit" disabled={!valid}>
              권리 추가
            </button>
          </form>
          <div className="card danger">
            <h4>음원 파일 삭제 (R10)</h4>
            <p className="small">
              유효하거나 일시 중지된 권리가 남아 있으면 거부됩니다. 재생이 즉시 막히고 원본·파생
              파일이 삭제됩니다. 메타데이터는 남습니다. 되돌릴 수 없습니다.
            </p>
            <button
              type="button"
              disabled={!valid}
              onClick={() => {
                if (!confirm('이 곡의 음원 파일을 삭제할까요? 되돌릴 수 없습니다.')) return;
                void run('음원 삭제', () =>
                  api('POST', `/v1/ops/recordings/${loaded}/audio-removal`, { reason }, idem()),
                ).then(reload);
              }}
            >
              음원 삭제
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
