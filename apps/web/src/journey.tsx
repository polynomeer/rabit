import { useEffect, useState } from 'react';
import { ApiError, get, type EntitySummary } from './api';
import { Cover, type Artwork } from './brand';
import { formatDate, formatMonth, t, tCode, type MessageKey } from './i18n';
import { compareHref, entityHref } from './route';

/**
 * Artist Journey (EX-02) and album compare (EX-03): an artist's releases and dated
 * relations in date order, from catalog facts. Dates never show more precision than
 * stored (EXP-024); the historical view keeps only what was out by a chosen date.
 */
type Precision = 'day' | 'month' | 'year';
interface FactEvidence {
  basis: 'verified_fact' | 'declared' | 'ml_inferred';
  verification_state: string;
  source: string;
  confidence: number | null;
}
interface JourneyRelease {
  release_id: string;
  title: string;
  release_type: 'album' | 'single' | 'ep' | 'compilation';
  release_date: string | null;
  date_precision: Precision | null;
  role: 'main' | 'with';
  label: EntitySummary | null;
  tracks: number;
  duration_ms: number | null;
  artwork: Artwork;
  evidence: FactEvidence;
}
interface JourneyEvent {
  relation_id: string;
  relation_type: 'member_of' | 'signed_to';
  direction: 'outgoing' | 'incoming';
  other: EntitySummary;
  valid_from: string;
  valid_to: string | null;
  evidence: FactEvidence;
}
interface Journey {
  artist: EntitySummary;
  view: 'modern' | 'historical';
  cutoff: string | null;
  timeline: (
    { kind: 'release'; release: JourneyRelease } | { kind: 'event'; event: JourneyEvent }
  )[];
  undated: JourneyRelease[];
  coverage: {
    releases: number;
    dated: number;
    undated: number;
    after_cutoff: number;
    undated_events: number;
  };
  truncated: boolean;
}
interface Comparison {
  artist: EntitySummary;
  releases: (JourneyRelease & {
    producers: { entity: EntitySummary; evidence: FactEvidence }[];
    guests: EntitySummary[];
  })[];
  shared: { producers: EntitySummary[]; guests: EntitySummary[]; label: EntitySummary | null };
}

const TYPE_TEXT: Record<string, MessageKey> = {
  album: 'journey.type.album',
  single: 'journey.type.single',
  ep: 'journey.type.ep',
  compilation: 'journey.type.compilation',
};
const BASIS_TEXT: Record<string, MessageKey> = {
  verified_fact: 'dig.evidence.verified',
  declared: 'dig.evidence.declared',
};

/** A date with only the precision it has: "2011. 3. 9.", "2021년 6월", "2014년 (연도만 알려짐)". */
export function preciseDate(date: string | null, precision: Precision | null): string {
  if (!date || !precision) return t('journey.undatedShort');
  if (precision === 'year') return t('journey.yearOnly', { year: date.slice(0, 4) });
  if (precision === 'month')
    return t('journey.monthOnly', { month: formatMonth(`${date}T00:00:00`) });
  return formatDate(`${date}T00:00:00`);
}

const yearOf = (item: Journey['timeline'][number]) =>
  item.kind === 'release'
    ? (item.release.release_date ?? '').slice(0, 4)
    : item.event.valid_from.slice(0, 4);

function minutes(ms: number | null): string {
  return ms === null
    ? t('journey.lengthUnknown')
    : t('journey.minutes', { n: Math.round(ms / 60000) });
}

function eventText(e: JourneyEvent, artist: string): string {
  if (e.relation_type === 'signed_to') return t('journey.event.signed', { label: e.other.name });
  return e.direction === 'outgoing'
    ? t('journey.event.joined', { group: e.other.name })
    : t('journey.event.member', { member: e.other.name, artist });
}

function basisText(e: FactEvidence): string {
  return e.basis === 'ml_inferred'
    ? t('dig.evidence.inferred', { percent: Math.round((e.confidence ?? 0) * 100) })
    : tCode(BASIS_TEXT, e.basis);
}

function useJourney(artistId: string, cutoff: string | null) {
  const [state, setState] = useState<{ key: string; data: Journey | null; missing: boolean }>({
    key: '',
    data: null,
    missing: false,
  });
  const key = `${artistId}|${cutoff ?? ''}`;
  useEffect(() => {
    let stale = false;
    // The listener picks a calendar date; its end in UTC names exactly that date.
    const q = cutoff ? `?cutoff_at=${encodeURIComponent(`${cutoff}T23:59:59Z`)}&time_zone=UTC` : '';
    get<Journey>(`/v1/dig/artists/${artistId}/journey${q}`).then(
      (data) => {
        if (!stale) setState({ key, data, missing: false });
      },
      (e: unknown) => {
        if (!stale && e instanceof ApiError && e.status === 404)
          setState({ key, data: null, missing: true });
      },
    );
    return () => {
      stale = true;
    };
  }, [artistId, cutoff, key]);
  return state.key === key ? state : { key, data: null, missing: false };
}

function ReleaseCard({
  r,
  picked,
  onPick,
}: {
  r: JourneyRelease;
  picked: boolean;
  onPick: (() => void) | null;
}) {
  return (
    <div className={picked ? 'journey-release picked' : 'journey-release'}>
      <Cover id={r.release_id} size={64} round={10} art={r.artwork} />
      <div className="journey-release-body">
        <span className="journey-title">
          <span className="type-chip">{tCode(TYPE_TEXT, r.release_type)}</span>
          <a href={entityHref(r.release_id)}>{r.title}</a>
        </span>
        <span className="small muted">
          {preciseDate(r.release_date, r.date_precision)}
          {r.label ? ` · ${r.label.name}` : ''}
          {r.role === 'with' ? ` · ${t('journey.with')}` : ''}
        </span>
        <span className="small muted">
          {t('journey.tracks', { count: r.tracks })} · {minutes(r.duration_ms)}
        </span>
      </div>
      {onPick ? (
        <label className="journey-pick">
          <input type="checkbox" checked={picked} onChange={onPick} />
          {t('journey.compare')}
        </label>
      ) : null}
    </div>
  );
}

export function JourneyView({ artistId }: { artistId: string }) {
  const [cutoff, setCutoff] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const { data, missing } = useJourney(artistId, cutoff);

  const toggle = (id: string) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  };
  const [a, b] = picked;

  return (
    <section aria-labelledby="journey-h" className="detail journey">
      <button
        type="button"
        className="link"
        onClick={() => {
          history.back();
        }}
      >
        {t('details.back')}
      </button>
      {missing ? <p role="status">{t('details.notFound')}</p> : null}
      {!missing && !data ? <p role="status">{t('common.loading')}</p> : null}
      {data ? (
        <>
          <div className="journey-hero">
            <p className="eyebrow">{t('journey.eyebrow')}</p>
            <h2 id="journey-h">{data.artist.name}</h2>
            <p className="muted">
              {t('journey.summary', {
                dated: data.coverage.dated,
                undated: data.coverage.undated,
              })}
            </p>
          </div>
          <div className="journey-controls">
            <div role="radiogroup" aria-label={t('journey.view')} className="chips">
              <button
                type="button"
                role="radio"
                aria-checked={cutoff === null}
                onClick={() => {
                  setCutoff(null);
                }}
              >
                {t('journey.view.modern')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={cutoff !== null}
                onClick={() => {
                  if (draft) setCutoff(draft);
                }}
                disabled={!draft}
              >
                {t('journey.view.historical')}
              </button>
            </div>
            <label className="journey-cutoff">
              {t('journey.cutoff')}
              <input
                type="date"
                value={draft}
                min="1900-01-01"
                max="2100-12-31"
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (cutoff !== null && e.target.value) setCutoff(e.target.value);
                }}
              />
            </label>
            {a && b ? (
              <a className="button" href={compareHref(artistId, a, b)}>
                {t('journey.compareTwo')}
              </a>
            ) : (
              <span className="small muted">{t('journey.pickTwo', { count: picked.length })}</span>
            )}
          </div>
          {data.view === 'historical' ? (
            <p className="small muted" role="note">
              {t('journey.historicalNote', {
                date: preciseDate(data.cutoff, 'day'),
                after: data.coverage.after_cutoff,
                undated: data.coverage.undated,
              })}
            </p>
          ) : null}
          {data.timeline.length === 0 ? (
            <p className="muted">{t('journey.empty')}</p>
          ) : (
            <ol className="journey-line" aria-label={t('journey.timeline')}>
              {data.timeline.map((item, i) => {
                const year = yearOf(item);
                const prev = i > 0 ? data.timeline[i - 1] : undefined;
                const first = !prev || yearOf(prev) !== year;
                return (
                  <li
                    key={item.kind === 'release' ? item.release.release_id : item.event.relation_id}
                    className={item.kind === 'event' ? 'event' : undefined}
                  >
                    <span className="journey-year" aria-hidden={!first}>
                      {first ? year : ''}
                    </span>
                    {item.kind === 'release' ? (
                      <ReleaseCard
                        r={item.release}
                        picked={picked.includes(item.release.release_id)}
                        onPick={() => {
                          toggle(item.release.release_id);
                        }}
                      />
                    ) : (
                      <div className="journey-event">
                        <strong>{eventText(item.event, data.artist.name)}</strong>
                        <span className="small muted">
                          {preciseDate(item.event.valid_from, 'day')}
                          {item.event.valid_to
                            ? ` – ${preciseDate(item.event.valid_to, 'day')}`
                            : ''}{' '}
                          · {basisText(item.event.evidence)}
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {data.undated.length > 0 ? (
            <section aria-labelledby="journey-undated-h" className="journey-undated">
              <h3 id="journey-undated-h">{t('journey.undated')}</h3>
              <ul className="list">
                {data.undated.map((r) => (
                  <li key={r.release_id}>
                    <ReleaseCard
                      r={r}
                      picked={picked.includes(r.release_id)}
                      onPick={() => {
                        toggle(r.release_id);
                      }}
                    />
                  </li>
                ))}
              </ul>
              <p className="small muted">{t('journey.undatedNote')}</p>
            </section>
          ) : null}
          {data.truncated ? <p className="small muted">{t('journey.truncated')}</p> : null}
        </>
      ) : null}
    </section>
  );
}

export function CompareView({ artistId, a, b }: { artistId: string; a: string; b: string }) {
  const [state, setState] = useState<{ data: Comparison | null; error: string | null }>({
    data: null,
    error: null,
  });
  useEffect(() => {
    let stale = false;
    setState({ data: null, error: null });
    get<Comparison>(`/v1/dig/artists/${artistId}/compare?release_a=${a}&release_b=${b}`).then(
      (data) => {
        if (!stale) setState({ data, error: null });
      },
      (e: unknown) => {
        if (stale) return;
        setState({
          data: null,
          error:
            e instanceof ApiError && e.status === 422
              ? t('compare.otherArtist')
              : t('details.notFound'),
        });
      },
    );
    return () => {
      stale = true;
    };
  }, [artistId, a, b]);
  const { data, error } = state;
  const names = (list: EntitySummary[]) =>
    list.length ? list.map((e) => e.name).join(', ') : t('compare.none');

  return (
    <section aria-labelledby="compare-h" className="detail compare">
      <button
        type="button"
        className="link"
        onClick={() => {
          history.back();
        }}
      >
        {t('details.back')}
      </button>
      {error ? <p role="status">{error}</p> : null}
      {!error && !data ? <p role="status">{t('common.loading')}</p> : null}
      {data ? (
        <>
          <p className="eyebrow">{data.artist.name}</p>
          <h2 id="compare-h">{t('compare.title')}</h2>
          <div className="compare-heads">
            {data.releases.map((r) => (
              <div key={r.release_id} className="compare-head">
                <Cover id={r.release_id} size={96} round={12} art={r.artwork} />
                <span className="type-chip">{tCode(TYPE_TEXT, r.release_type)}</span>
                <a href={entityHref(r.release_id)}>
                  <strong>{r.title}</strong>
                </a>
              </div>
            ))}
          </div>
          <table className="compare-table">
            <caption className="visually-hidden">{t('compare.table')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('compare.fact')}</th>
                {data.releases.map((r) => (
                  <th key={r.release_id} scope="col">
                    {r.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{t('compare.date')}</th>
                {data.releases.map((r) => (
                  <td key={r.release_id}>{preciseDate(r.release_date, r.date_precision)}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">{t('compare.label')}</th>
                {data.releases.map((r) => (
                  <td key={r.release_id}>{r.label?.name ?? t('compare.none')}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">{t('compare.tracks')}</th>
                {data.releases.map((r) => (
                  <td key={r.release_id}>
                    {t('journey.tracks', { count: r.tracks })} · {minutes(r.duration_ms)}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">{t('compare.producers')}</th>
                {data.releases.map((r) => (
                  <td key={r.release_id}>
                    {r.producers.length
                      ? r.producers.map((p, i) => (
                          <span key={p.entity.entity_id}>
                            {i > 0 ? ', ' : ''}
                            <a href={entityHref(p.entity.entity_id)}>{p.entity.name}</a>{' '}
                            <span className="small muted">({basisText(p.evidence)})</span>
                          </span>
                        ))
                      : t('compare.none')}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">{t('compare.guests')}</th>
                {data.releases.map((r) => (
                  <td key={r.release_id}>{names(r.guests)}</td>
                ))}
              </tr>
            </tbody>
          </table>
          <section aria-labelledby="compare-shared-h">
            <h3 id="compare-shared-h">{t('compare.shared')}</h3>
            <ul className="list">
              <li>
                {t('compare.producers')}: {names(data.shared.producers)}
              </li>
              <li>
                {t('compare.guests')}: {names(data.shared.guests)}
              </li>
              <li>
                {t('compare.label')}: {data.shared.label?.name ?? t('compare.none')}
              </li>
            </ul>
            <p className="small muted">{t('compare.source')}</p>
          </section>
        </>
      ) : null}
    </section>
  );
}
