import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, get, type Connection, type EntitySummary, type Playability } from './api';
import { Cover } from './brand';
import { AddToCollection } from './collection';
import { LabelTimelineView } from './labels';
import { AddToPlaylist } from './playlist-add';
import { AXIS_TEXT, EvidenceLine, roleText } from './dig';
import { t, tCode, type MessageKey } from './i18n';
import { usePlayer, type QueueEntry } from './player';
import { PurchasePanel } from './purchase';
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

const STAGE_TEXT: Record<string, MessageKey> = {
  composition: 'details.stage.composition',
  lyrics: 'details.stage.lyrics',
  vocals: 'details.stage.vocals',
  instruments: 'details.stage.instruments',
  mixing: 'details.stage.mixing',
  mastering: 'details.stage.mastering',
  artwork: 'details.stage.artwork',
};
const METHOD_TEXT: Record<string, MessageKey> = {
  human: 'details.method.human',
  ai_assisted: 'details.method.ai_assisted',
  ai_generated: 'details.method.ai_generated',
  unknown: 'details.method.unknown',
};
const VERIFICATION_TEXT: Record<string, MessageKey> = {
  self_declared: 'details.verification.self_declared',
  distributor_verified: 'details.verification.distributor_verified',
  signature_valid: 'details.verification.signature_valid',
  process_evidence_reviewed: 'details.verification.process_evidence_reviewed',
  rights_reviewed: 'details.verification.rights_reviewed',
};
const BASIS_TEXT: Record<string, MessageKey> = {
  verified_fact: 'details.basis.verified_fact',
  declared: 'details.basis.declared',
  ml_inferred: 'details.basis.ml_inferred',
  automated: 'details.basis.automated',
  reviewed: 'details.basis.reviewed',
};
const INTEGRITY_TEXT: Record<string, MessageKey> = {
  ai_generation: 'details.integrity.ai_generation',
  technical_quality: 'details.integrity.technical_quality',
  spam_risk: 'details.integrity.spam_risk',
  rights_status: 'details.integrity.rights_status',
  recommendation_eligibility: 'details.integrity.recommendation_eligibility',
};
const REPORT_REASONS = [
  ['wrong_credit', 'details.report.reason.wrong_credit'],
  ['wrong_relation', 'details.report.reason.wrong_relation'],
  ['undisclosed_ai', 'details.report.reason.undisclosed_ai'],
  ['spam', 'details.report.reason.spam'],
  ['impersonation', 'details.report.reason.impersonation'],
  ['rights_infringement', 'details.report.reason.rights_infringement'],
  ['other', 'details.report.reason.other'],
] as const satisfies readonly (readonly [string, MessageKey])[];
const TYPE_TEXT: Record<string, MessageKey> = {
  artist: 'details.type.artist',
  person: 'details.type.person',
  label: 'details.type.label',
  album: 'details.type.album',
  single: 'details.type.single',
  ep: 'details.type.ep',
  compilation: 'details.type.compilation',
};

const label = (map: Record<string, MessageKey>, v: string | null) => (v ? tCode(map, v) : '—');

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

/**
 * Loads one resource; a 404 is shown as "not found" instead of an error. Bumping
 * `reload` reads it again while the current data stays on screen.
 */
// T is the caller's expected response shape (validated server-side by the contract).
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function useResource<T>(path: string, reload = 0): { data: T | null; missing: boolean } {
  const [state, setState] = useState<{ data: T | null; missing: boolean; path: string }>({
    data: null,
    missing: false,
    path,
  });
  useEffect(() => {
    let stale = false;
    setState((s) => (s.path === path ? s : { data: null, missing: false, path }));
    get<T>(path).then(
      (data) => {
        if (!stale) setState({ data, missing: false, path });
      },
      (e: unknown) => {
        if (!stale && e instanceof ApiError && e.status === 404)
          setState({ data: null, missing: true, path });
      },
    );
    return () => {
      stale = true;
    };
  }, [path, reload]);
  // A new path shows nothing until it loads, never the previous resource.
  return state.path === path ? state : { data: null, missing: false };
}

function Page({
  title,
  kind,
  missing,
  coverId,
  children,
}: {
  title: string | null;
  kind: string;
  missing: boolean;
  /** Recordings and releases show their (stand-in) cover next to the title. */
  coverId?: string | undefined;
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
        {t('details.back')}
      </button>
      {missing ? (
        <p role="status">{t('details.notFound')}</p>
      ) : title === null ? (
        <p role="status">{t('common.loading')}</p>
      ) : (
        <>
          <div className={coverId ? 'detail-head with-cover' : 'detail-head'}>
            {coverId ? <Cover id={coverId} size={168} round={20} /> : null}
            <div>
              <p className="eyebrow">{kind}</p>
              <h2 id="detail-h">{title}</h2>
            </div>
          </div>
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
              setMsg(t('details.library.saved'));
            },
            (e: unknown) => {
              setMsg(
                e instanceof ApiError && e.code === 'ALREADY_EXISTS'
                  ? t('details.library.exists')
                  : t('details.library.failed'),
              );
            },
          );
        }}
      >
        {t('details.library.save')}
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
          {t('details.report.open')}
        </button>
        {msg ? <span role="status"> {msg}</span> : null}
      </p>
    );
  return (
    <form
      className="card"
      aria-label={t('details.report.form')}
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
            setMsg(t('details.report.received'));
          },
          (err: unknown) => {
            setMsg(
              err instanceof ApiError && err.status === 429
                ? t('details.report.tooMany')
                : t('details.report.failed'),
            );
          },
        );
      }}
    >
      <h3>{t('details.report.heading')}</h3>
      <label>
        {t('details.report.reason')}{' '}
        <select name="reason" required defaultValue="wrong_credit">
          {REPORT_REASONS.map(([v, l]) => (
            <option key={v} value={v}>
              {t(l)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('details.report.details')} <textarea name="details" maxLength={2000} rows={3} />
      </label>
      <div className="actions">
        <button type="submit">{t('details.report.submit')}</button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
          }}
        >
          {t('common.cancel')}
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
        <caption className="small muted">{t('details.passport.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('details.passport.stage')}</th>
            <th scope="col">{t('details.passport.method')}</th>
            <th scope="col">{t('details.passport.basis')}</th>
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
          <h4>{t('details.passport.credits')}</h4>
          <ul className="list">
            {p.credits.map((c) => (
              <li key={c.credit_id}>
                <div>
                  <a href={entityHref(c.contributor.entity_id)}>{c.contributor.name}</a>{' '}
                  <span className="muted">
                    {roleText(c.role)}
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
          <h4>{t('details.passport.claims')}</h4>
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
      <h4>{t('details.passport.integrity')}</h4>
      <p className="small muted">{t('details.passport.integrityNote')}</p>
      {p.integrity.length === 0 ? (
        <p className="small">{t('details.passport.integrityEmpty')}</p>
      ) : null}
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
    <Page
      title={r?.title ?? null}
      kind={t('common.recording')}
      missing={missing}
      coverId={r?.releases[0]?.release_id ?? r?.recording_id}
    >
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
              {t('details.recording.appearsOn')}{' '}
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
              className="primary"
              disabled={!r.playability.playable}
              onClick={() => {
                player.play([
                  {
                    key: r.recording_id,
                    title: r.title,
                    subtitle: r.artists.map((a) => a.name).join(', '),
                    recording_id: r.recording_id,
                    cover_id: r.releases[0]?.release_id,
                  },
                ]);
              }}
            >
              {t('common.play')}
            </button>
            <a className="button" href={digHref(r.recording_id)}>
              DIG
            </a>
            <SaveButton refType="recording" refId={r.recording_id} />
            <AddToPlaylist refType="recording" refId={r.recording_id} />
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
  // Bumped after a purchase so the tracks' playability is read again.
  const [reload, setReload] = useState(0);
  const { data: r, missing } = useResource<Release>(`/v1/releases/${id}`, reload);
  const queue: QueueEntry[] =
    r?.tracks.map((track) => ({
      key: track.recording_id,
      title: track.title,
      subtitle: r.artists.map((a) => a.name).join(', '),
      recording_id: track.recording_id,
      cover_id: r.release_id,
    })) ?? [];
  const firstPlayable = r?.tracks.findIndex((track) => track.playability.playable) ?? -1;
  return (
    <Page
      title={r?.title ?? null}
      kind={label(TYPE_TEXT, r?.release_type ?? null)}
      missing={missing}
      coverId={r?.release_id}
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
          <p className="small muted">
            {t('details.release.summary', {
              count: r.tracks.length,
              minutes: Math.round(
                r.tracks.reduce((sum, track) => sum + (track.duration_ms ?? 0), 0) / 60_000,
              ),
            })}
          </p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={firstPlayable < 0}
              onClick={() => {
                player.play(queue, firstPlayable);
              }}
            >
              {t('details.release.playAll')}
            </button>
            <a className="button" href={digHref(r.release_id)}>
              DIG
            </a>
            <SaveButton refType="release" refId={r.release_id} />
            <AddToCollection
              releaseId={r.release_id}
              title={r.title}
              artist={r.artists.map((x) => x.name).join(', ')}
            />
          </div>
          <PurchasePanel
            releaseId={r.release_id}
            onPurchased={() => {
              setReload((n) => n + 1);
            }}
          />
          <ol className="tracks" aria-label={t('details.release.tracks')}>
            {r.tracks.map((track, i) => (
              <li
                key={`${String(track.disc_no)}-${String(track.position)}`}
                className={
                  player.current?.recording_id === track.recording_id ? 'current' : undefined
                }
              >
                <span className="track-no" aria-hidden="true">
                  {track.position}
                </span>
                <div className="track-main">
                  <a href={entityHref(track.recording_id)}>{track.title}</a>{' '}
                  <span className="muted small">{duration(track.duration_ms)}</span>{' '}
                  <Status p={track.playability} />
                </div>
                <div className="actions">
                  <button
                    type="button"
                    disabled={!track.playability.playable}
                    onClick={() => {
                      player.play(queue, i);
                    }}
                  >
                    {t('common.play')}
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
              {t('details.entity.startDig')}
            </a>
          </div>
          {e.entity_type === 'label' ? <LabelTimelineView labelId={e.entity_id} /> : null}
          <div className="axes" role="tablist" aria-label={t('details.entity.axes')}>
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
                {tCode(AXIS_TEXT, a.axis)} <span className="muted">{a.count}</span>
              </button>
            ))}
          </div>
          <ul className="list" aria-label={t('common.connections')}>
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
