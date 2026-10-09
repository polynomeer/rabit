import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, get } from './api';
import { Icon } from './brand';
import { formatDate, formatDateTime, t, type MessageKey } from './i18n';
import { entityHref, opsHref, OPS_SECTIONS, type OpsSection } from './route';

/**
 * Operator console (OPS-010, R18). Every change and every look at a user's data
 * carries a reason, which the server audits; nothing here shows private content
 * (OPS-007, T30). The server enforces the operator role and MFA on every call.
 */
const SECTION_TEXT: Record<OpsSection, MessageKey> = {
  users: 'ops.section.users',
  reports: 'ops.section.reports',
  jobs: 'ops.section.jobs',
  rights: 'ops.section.rights',
  sales: 'ops.section.sales',
};
/** Button labels for the status an entitlement or rights grant is moved to. */
const GRANT_STATUS_ACTION: Record<'active' | 'suspended' | 'revoked', MessageKey> = {
  active: 'ops.status.reactivate',
  suspended: 'ops.status.suspend',
  revoked: 'ops.status.revoke',
};
const REPORT_STATUS_ACTION: Record<'triaged' | 'actioned' | 'dismissed', MessageKey> = {
  triaged: 'ops.reports.triage',
  actioned: 'ops.reports.action.actioned',
  dismissed: 'ops.reports.dismiss',
};

function errorText(e: unknown): string {
  if (e instanceof ApiError) return t('error.withCode', { message: e.message, code: e.code });
  return e instanceof Error ? e.message : String(e);
}

const idem = () => ({ 'idempotency-key': `ops-${crypto.randomUUID()}` });

/** Runs one operator action and reports its outcome in a status line. */
function useAction() {
  const [msg, setMsg] = useState<string | null>(null);
  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setMsg(t('ops.action.running', { label }));
    try {
      await fn();
      setMsg(t('ops.action.done', { label }));
      return true;
    } catch (e) {
      setMsg(t('ops.action.failed', { label, error: errorText(e) }));
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
  if (allowed === null) return <p role="status">{t('common.loading')}</p>;
  if (!allowed)
    return (
      <section aria-labelledby="ops-h">
        <h2 id="ops-h">{t('ops.heading')}</h2>
        <p role="status">{t('ops.forbidden')}</p>
      </section>
    );
  const valid = reason.trim().length >= 3;
  return (
    <section aria-labelledby="ops-h" className="ops">
      <p className="eyebrow">Operator console</p>
      <h2 id="ops-h">{t('ops.heading')}</h2>
      <nav aria-label={t('ops.menu')} className="subnav">
        {OPS_SECTIONS.map((s) => (
          <a key={s} href={opsHref(s)} aria-current={s === section ? 'page' : undefined}>
            {t(SECTION_TEXT[s])}
          </a>
        ))}
      </nav>
      <label className={valid ? 'reason' : 'reason missing'}>
        <span className="reason-label">
          <Icon name="ops" size={18} />
          {t('ops.reason')}
        </span>
        <input
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
          maxLength={500}
          placeholder={t('ops.reason.placeholder')}
        />
      </label>
      {!valid ? <p className="small muted">{t('ops.reason.required')}</p> : null}
      {section === 'users' ? <Users reason={reason} valid={valid} /> : null}
      {section === 'reports' ? <Reports reason={reason} valid={valid} /> : null}
      {section === 'jobs' ? <Jobs reason={reason} valid={valid} /> : null}
      {section === 'rights' ? <Rights reason={reason} valid={valid} /> : null}
      {section === 'sales' ? <Sales reason={reason} valid={valid} /> : null}
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
      run(t('ops.users.lookup'), async () => {
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
        aria-label={t('ops.users.lookupForm')}
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void load(userId.trim());
        }}
      >
        <input
          aria-label={t('ops.users.id')}
          placeholder={t('ops.users.id.placeholder')}
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value);
          }}
          pattern="usr_[0-9A-HJKMNP-TV-Z]{26}"
          required
        />
        <button type="submit" disabled={!valid}>
          {t('ops.users.summary.load')}
        </button>
      </form>
      <Status msg={msg} />
      {summary ? (
        <div className="card" aria-label={t('ops.users.summary')}>
          <p className="small muted">{t('ops.users.summary.note')}</p>
          {Object.entries(summary.sections).map(([name, data]) => (
            <section key={name} aria-label={t('ops.users.summary.section', { name })}>
              <h3>{name}</h3>
              <Facts data={data} />
            </section>
          ))}
          <h3>{t('ops.users.entitlements')}</h3>
          <ul className="list" aria-label={t('ops.users.entitlements.list')}>
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
                          void run(t('ops.users.entitlement.action', { status: s }), () =>
                            api(
                              'POST',
                              `/v1/ops/entitlements/${e.entitlement_id}/status`,
                              { status: s, reason },
                              { 'if-match': `"${String(e.version)}"` },
                            ),
                          ).then(after)
                        }
                      >
                        {t(GRANT_STATUS_ACTION[s])}
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
        aria-label={t('ops.users.country.form')}
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const country = (e.currentTarget.elements.namedItem('country') as HTMLInputElement).value;
          void run(t('ops.users.country.form'), () =>
            api('PUT', `/v1/ops/users/${userId}/license-country`, {
              license_country: country.toUpperCase(),
              reason,
            }),
          ).then(done);
        }}
      >
        <label>
          {t('ops.users.country')}{' '}
          <input name="country" pattern="[A-Za-z]{2}" maxLength={2} required size={3} />
        </label>
        <button type="submit" disabled={!valid}>
          {t('ops.users.country.submit')}
        </button>
      </form>
      <form
        aria-label={t('ops.users.subscription.form')}
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget.elements;
          const state = (f.namedItem('state') as HTMLSelectElement).value;
          const until = (f.namedItem('until') as HTMLInputElement).value;
          void run(t('ops.users.subscription.form'), () =>
            api('PUT', `/v1/ops/users/${userId}/subscription`, {
              state,
              paid_through: new Date(`${until}T23:59:59Z`).toISOString(),
              reason,
            }),
          ).then(done);
        }}
      >
        <label>
          {t('ops.users.subscription.state')}{' '}
          <select name="state" defaultValue="active">
            <option value="active">active</option>
            <option value="past_due">past_due</option>
            <option value="cancelled">cancelled</option>
            <option value="expired">expired</option>
          </select>
        </label>
        <label>
          {t('ops.users.subscription.until')}{' '}
          <input name="until" type="date" defaultValue={in30Days} required />
        </label>
        <button type="submit" disabled={!valid}>
          {t('ops.users.subscription.submit')}
        </button>
      </form>
      <form
        aria-label={t('ops.users.grant.form')}
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget.elements;
          const scope = (f.namedItem('scope') as HTMLSelectElement).value;
          const resource = (f.namedItem('resource') as HTMLInputElement).value.trim();
          void run(t('ops.users.grant.form'), () =>
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
          {t('ops.users.grant.scope')}{' '}
          <select name="scope" defaultValue="release">
            <option value="release">{t('common.release')}</option>
            <option value="recording">{t('common.recording')}</option>
          </select>
        </label>
        <input
          name="resource"
          aria-label={t('ops.users.grant.resource')}
          placeholder="rel_… / rec_…"
          pattern="(rel|rec)_[0-9A-HJKMNP-TV-Z]{26}"
          required
        />
        <button type="submit" disabled={!valid}>
          {t('ops.users.grant.submit')}
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
        {t('common.status')}{' '}
        <select
          aria-label={t('ops.reports.status')}
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
      <ul className="list" aria-label={t('ops.reports.list')}>
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
              <span className="small muted">{formatDateTime(r.created_at)}</span>
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
                      void run(t('ops.reports.action', { status: s }), () =>
                        api('POST', `/v1/ops/reports/${r.report_id}/status`, {
                          status: s,
                          reason,
                        }),
                      ).then((ok) => {
                        if (ok) load();
                      })
                    }
                  >
                    {t(REPORT_STATUS_ACTION[s])}
                  </button>
                ))}
            </div>
          </li>
        ))}
        {items.length === 0 ? <li className="muted">{t('ops.reports.empty')}</li> : null}
      </ul>
      <p className="small muted">{t('ops.reports.note')}</p>
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
        {t('common.status')}{' '}
        <select
          aria-label={t('ops.jobs.status')}
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
      <ul className="list" aria-label={t('ops.jobs.list')}>
        {items.map((j) => (
          <li key={j.job_id}>
            <div>
              <strong>{j.kind}</strong>{' '}
              <span className="small">
                {t('ops.jobs.attempts', {
                  status: j.status,
                  attempts: j.attempts,
                  max: j.max_attempts,
                  date: formatDateTime(j.updated_at),
                })}
              </span>
              {j.last_error ? <p className="small warn job-error">{j.last_error}</p> : null}
            </div>
            {j.status === 'dead' || j.status === 'failed' ? (
              <div className="actions">
                <button
                  type="button"
                  disabled={!valid}
                  onClick={() =>
                    void run(t('ops.jobs.retry'), () =>
                      api('POST', `/v1/ops/jobs/${j.job_id}/retry`, { reason }),
                    ).then((ok) => {
                      if (ok) load();
                    })
                  }
                >
                  {t('ops.jobs.retry')}
                </button>
              </div>
            ) : null}
          </li>
        ))}
        {items.length === 0 ? <li className="muted">{t('ops.jobs.empty')}</li> : null}
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
      run(t('ops.rights.lookup'), async () => {
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
        aria-label={t('ops.rights.lookupForm')}
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void load(recordingId.trim());
        }}
      >
        <input
          aria-label={t('ops.rights.recordingId')}
          placeholder="rec_…"
          value={recordingId}
          onChange={(e) => {
            setRecordingId(e.target.value);
          }}
          pattern="rec_[0-9A-HJKMNP-TV-Z]{26}"
          required
        />
        <button type="submit">{t('ops.rights.lookup')}</button>
      </form>
      <Status msg={msg} />
      {loaded ? (
        <>
          <p>
            <a href={entityHref(loaded)}>{t('ops.rights.viewRecording')}</a>
          </p>
          <ul className="list" aria-label={t('ops.rights.list')}>
            {grants.map((g) => (
              <li key={g.rights_grant_id}>
                <div className="small">
                  <strong>{g.status}</strong> · {g.rights_holder} · {g.territories.join(', ')} ·{' '}
                  {g.uses.join(', ')} · {formatDate(g.valid_from)} ~{' '}
                  {g.valid_to ? formatDate(g.valid_to) : t('common.noEndDate')} · {g.contract_ref} ·
                  v{g.version}
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
                          void run(t('ops.rights.action', { status: s }), () =>
                            api(
                              'POST',
                              `/v1/ops/rights-grants/${g.rights_grant_id}/status`,
                              { status: s, reason },
                              { 'if-match': `"${String(g.version)}"` },
                            ),
                          ).then(reload)
                        }
                      >
                        {t(GRANT_STATUS_ACTION[s])}
                      </button>
                    ))}
                </div>
              </li>
            ))}
            {grants.length === 0 ? <li className="muted">{t('ops.rights.empty')}</li> : null}
          </ul>
          <form
            aria-label={t('ops.rights.add')}
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget.elements;
              const v = (n: string) => (f.namedItem(n) as HTMLInputElement).value.trim();
              const until = v('valid_to');
              void run(t('ops.rights.add'), () =>
                api(
                  'POST',
                  '/v1/ops/rights-grants',
                  {
                    recording_id: loaded,
                    rights_holder: v('holder'),
                    territories: v('territories')
                      .split(',')
                      .map((territory) => territory.trim().toUpperCase())
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
            <h3>{t('ops.rights.add.heading')}</h3>
            <Field label={t('ops.rights.holder')}>
              <input name="holder" required maxLength={200} />
            </Field>
            <Field label={t('ops.rights.territories')}>
              <input name="territories" required placeholder="KR, JP" />
            </Field>
            <Field label={t('ops.rights.validFrom')}>
              <input
                name="valid_from"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </Field>
            <Field label={t('ops.rights.validTo')}>
              <input name="valid_to" type="date" />
            </Field>
            <Field label={t('ops.rights.contract')}>
              <input name="contract" required maxLength={200} />
            </Field>
            <button type="submit" disabled={!valid}>
              {t('ops.rights.add')}
            </button>
          </form>
          <div className="card danger">
            <h3>{t('ops.rights.removal.heading')}</h3>
            <p className="small">{t('ops.rights.removal.note')}</p>
            <button
              type="button"
              disabled={!valid}
              onClick={() => {
                if (!confirm(t('ops.rights.removal.confirm'))) return;
                void run(t('ops.rights.removal.submit'), () =>
                  api('POST', `/v1/ops/recordings/${loaded}/audio-removal`, { reason }, idem()),
                ).then(reload);
              }}
            >
              {t('ops.rights.removal.submit')}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ——— Sales (ADR-0018, provisional) ———

interface Offer {
  offer_id: string;
  territories: string[];
  price: { amount_minor: number; currency: string; tax_minor: number };
  status: string;
  version: number;
}
interface OpsOrder {
  order_id: string;
  status: string;
  user_id: string;
  release_id: string;
  release_title: string;
  provider: string;
  price: { amount_minor: number; currency: string; tax_minor: number };
  created_at: string;
  paid_at: string | null;
  version: number;
  events: { payment_event_id: string; type: string; status: string; detail: string | null }[];
  refunds: { refund_id: string; status: string; amount_minor: number; requested_by: string }[];
  ledger: {
    journal_id: string;
    kind: string;
    account: string;
    debit_minor: number;
    credit_minor: number;
  }[];
}

const won = (m: { amount_minor: number; currency: string }) =>
  new Intl.NumberFormat('ko-KR', { style: 'currency', currency: m.currency }).format(
    m.amount_minor,
  );

function Sales({ reason, valid }: Props) {
  return (
    <div>
      <ReleaseOffers reason={reason} valid={valid} />
      <OrderLookup reason={reason} valid={valid} />
    </div>
  );
}

/** Offers of one release: put it on sale, or withdraw the current offer. */
function ReleaseOffers({ reason, valid }: Props) {
  const [releaseId, setReleaseId] = useState('');
  const [loaded, setLoaded] = useState<string | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const { msg, run } = useAction();
  const fetchOffers = (id: string) =>
    get<{ items: Offer[] }>(`/v1/ops/releases/${id}/offers`).then((r) => {
      setOffers(r.items);
      setLoaded(id);
    });
  const reload = (ok: boolean) => {
    if (ok && loaded) void fetchOffers(loaded).catch(() => undefined);
  };
  return (
    <section className="card" aria-labelledby="offers-h">
      <h3 id="offers-h">{t('ops.sales.offers.heading')}</h3>
      <form
        aria-label={t('ops.sales.offers.lookupForm')}
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(t('ops.sales.lookup'), () => fetchOffers(releaseId.trim()));
        }}
      >
        <input
          aria-label={t('ops.sales.releaseId')}
          placeholder="rel_…"
          value={releaseId}
          onChange={(e) => {
            setReleaseId(e.target.value);
          }}
          pattern="rel_[0-9A-HJKMNP-TV-Z]{26}"
          required
        />
        <button type="submit">{t('ops.sales.lookup')}</button>
      </form>
      <Status msg={msg} />
      {loaded ? (
        <>
          <p>
            <a href={entityHref(loaded)}>{t('ops.sales.viewRelease')}</a>
          </p>
          <ul className="list" aria-label={t('ops.sales.offers.list')}>
            {offers.map((o) => (
              <li key={o.offer_id}>
                <div className="small">
                  <strong>
                    {o.status === 'on_sale' ? t('ops.sales.onSale') : t('ops.sales.withdrawn')}
                  </strong>{' '}
                  · {won(o.price)} · {o.territories.join(', ')} · <code>{o.offer_id}</code>
                </div>
                {o.status === 'on_sale' ? (
                  <div className="actions">
                    <button
                      type="button"
                      disabled={!valid}
                      onClick={() =>
                        void run(t('ops.sales.withdraw'), () =>
                          api('POST', `/v1/ops/offers/${o.offer_id}/withdraw`, { reason }),
                        ).then(reload)
                      }
                    >
                      {t('ops.sales.withdraw')}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
            {offers.length === 0 ? <li className="muted">{t('ops.sales.offers.empty')}</li> : null}
          </ul>
          <form
            aria-label={t('ops.sales.create')}
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget.elements;
              const v = (n: string) => (f.namedItem(n) as HTMLInputElement).value.trim();
              void run(t('ops.sales.create'), () =>
                api('POST', '/v1/ops/offers', {
                  release_id: loaded,
                  territories: v('territories')
                    .split(',')
                    .map((x) => x.trim().toUpperCase())
                    .filter(Boolean),
                  price_minor: Number(v('price')),
                  reason,
                }),
              ).then(reload);
            }}
          >
            <h4>{t('ops.sales.create')}</h4>
            <p className="small muted">{t('ops.sales.create.note')}</p>
            <Field label={t('ops.sales.price')}>
              <input name="price" type="number" min={100} max={10_000_000} step={100} required />
            </Field>
            <Field label={t('ops.sales.territories')}>
              <input name="territories" required defaultValue="KR" />
            </Field>
            <button type="submit" disabled={!valid}>
              {t('ops.sales.create')}
            </button>
          </form>
        </>
      ) : null}
    </section>
  );
}

/** One order with its provider events, refunds and ledger lines; full refund. */
function OrderLookup({ reason, valid }: Props) {
  const [orderId, setOrderId] = useState('');
  const [order, setOrder] = useState<OpsOrder | null>(null);
  const { msg, run } = useAction();
  const fetchOrder = (id: string) => get<OpsOrder>(`/v1/ops/orders/${id}`).then(setOrder);
  return (
    <section className="card" aria-labelledby="order-h">
      <h3 id="order-h">{t('ops.sales.order.heading')}</h3>
      <form
        aria-label={t('ops.sales.order.lookupForm')}
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(t('ops.sales.lookup'), () => fetchOrder(orderId.trim()));
        }}
      >
        <input
          aria-label={t('ops.sales.orderId')}
          placeholder="ord_…"
          value={orderId}
          onChange={(e) => {
            setOrderId(e.target.value);
          }}
          pattern="ord_[0-9A-HJKMNP-TV-Z]{26}"
          required
        />
        <button type="submit">{t('ops.sales.lookup')}</button>
      </form>
      <Status msg={msg} />
      {order ? (
        <>
          <Facts
            data={{
              status: order.status,
              release: order.release_title,
              price: won(order.price),
              vat: won({ ...order.price, amount_minor: order.price.tax_minor }),
              user_id: order.user_id,
              provider: order.provider,
              created_at: formatDateTime(order.created_at),
              paid_at: order.paid_at ? formatDateTime(order.paid_at) : null,
            }}
          />
          <h4>{t('ops.sales.order.events')}</h4>
          <ul className="list small" aria-label={t('ops.sales.order.events')}>
            {order.events.map((e) => (
              <li key={e.payment_event_id}>
                {e.type} · <strong>{e.status}</strong>
                {e.detail ? ` · ${e.detail}` : ''}
              </li>
            ))}
          </ul>
          <h4>{t('ops.sales.order.ledger')}</h4>
          <table className="small" aria-label={t('ops.sales.order.ledger')}>
            <thead>
              <tr>
                <th>{t('ops.sales.ledger.kind')}</th>
                <th>{t('ops.sales.ledger.account')}</th>
                <th>{t('ops.sales.ledger.debit')}</th>
                <th>{t('ops.sales.ledger.credit')}</th>
              </tr>
            </thead>
            <tbody>
              {order.ledger.map((l, i) => (
                <tr key={`${l.journal_id}-${String(i)}`}>
                  <td>{l.kind}</td>
                  <td>{l.account}</td>
                  <td>{l.debit_minor || ''}</td>
                  <td>{l.credit_minor || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {order.refunds.length > 0 ? (
            <ul className="list small" aria-label={t('ops.sales.order.refunds')}>
              {order.refunds.map((r) => (
                <li key={r.refund_id}>
                  {t('ops.sales.order.refund')} · <strong>{r.status}</strong> · {r.requested_by}
                </li>
              ))}
            </ul>
          ) : null}
          {order.status === 'fulfilled' || order.status === 'paid' ? (
            <div className="actions">
              <button
                type="button"
                disabled={!valid}
                onClick={() => {
                  if (!confirm(t('ops.sales.refund.confirm'))) return;
                  void run(t('ops.sales.refund'), () =>
                    api(
                      'POST',
                      `/v1/ops/orders/${order.order_id}/refunds`,
                      { reason },
                      { 'if-match': `"${String(order.version)}"` },
                    ),
                  ).then((ok) => {
                    if (ok) void fetchOrder(order.order_id).catch(() => undefined);
                  });
                }}
              >
                {t('ops.sales.refund')}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
