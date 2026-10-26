import { useCallback, useEffect, useState } from 'react';
import { ApiError, get, type Schemas } from './api';
import type { paths } from './api-schema';
import { formatDateTime, t, type MessageKey } from './i18n';

/**
 * Alpha validation metrics in the operator console (ADR-0032): gate C over a sign-up
 * cohort, as counts and rates only. The server withholds any rate over fewer than
 * `min_group` people; the console never asks for or shows a person.
 */
type Metrics =
  paths['/v1/ops/metrics/alpha']['get']['responses']['200']['content']['application/json'];
type Rate = Schemas['CohortRate'];

/**
 * Proposed thresholds from the validation plan (gate C and the hypothesis table);
 * the owner confirms them. A metric without one is shown for reading only.
 */
const TARGET = {
  week4: 0.25,
  playlistMixers: 0.4,
  keptSessions: 0.3,
} as const;

const DAY = 86_400_000;
// Cohorts are Korean calendar days (ADR-0032), so the defaults are too.
const koreanDay = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(ms));

function percent(r: number) {
  return `${Math.round(r * 1000) / 10}%`;
}

function RateText({ r }: { r: Rate }) {
  if (r.suppressed || r.count === null || r.rate === null)
    return <span className="muted">{t('ops.metrics.suppressed', { of: r.of })}</span>;
  return <>{t('ops.metrics.rate', { count: r.count, of: r.of, percent: percent(r.rate) })}</>;
}

function Verdict({ r, target }: { r: Rate; target: number | undefined }) {
  if (target === undefined) return <span className="muted">—</span>;
  if (r.suppressed || r.rate === null)
    return <span className="muted">{t('ops.metrics.notYet')}</span>;
  return r.rate >= target ? (
    <span className="ok">{t('ops.metrics.met', { target: percent(target) })}</span>
  ) : (
    <span className="warn">{t('ops.metrics.notMet', { target: percent(target) })}</span>
  );
}

interface Row {
  label: MessageKey;
  hypothesis: string;
  rate: Rate;
  target?: number;
}

export function MetricsSection() {
  const [from, setFrom] = useState(() => koreanDay(Date.now() - 56 * DAY));
  const [to, setTo] = useState(() => koreanDay(Date.now()));
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    get<Metrics>(`/v1/ops/metrics/alpha?from=${from}&to=${to}`).then(setData, (e: unknown) => {
      setData(null);
      setError(e instanceof ApiError ? e.message : String(e));
    });
  }, [from, to]);
  useEffect(load, [load]);

  const week4 = data?.retention.find((w) => w.week === 4);
  const rows: Row[] = data
    ? [
        ...(week4
          ? [
              {
                label: 'ops.metrics.week4' as const,
                hypothesis: 'H4',
                rate: week4,
                target: TARGET.week4,
              },
            ]
          : []),
        {
          label: 'ops.metrics.playlistMixers',
          hypothesis: 'H2',
          rate: data.mixed_library.playlist_mixers,
          target: TARGET.playlistMixers,
        },
        {
          label: 'ops.metrics.ownAudioPlayers',
          hypothesis: 'H2',
          rate: data.mixed_library.own_audio_players,
        },
        { label: 'ops.metrics.diggers', hypothesis: 'H3', rate: data.digging.diggers },
        {
          label: 'ops.metrics.keptSessions',
          hypothesis: 'H3',
          rate: data.digging.kept_sessions,
          target: TARGET.keptSessions,
        },
        { label: 'ops.metrics.collectors', hypothesis: 'H5', rate: data.collection.collectors },
        {
          label: 'ops.metrics.collectors20',
          hypothesis: 'H5',
          rate: data.collection.collectors_20_plus,
        },
      ]
    : [];

  return (
    <div className="ops-metrics">
      <p className="small muted">{t('ops.metrics.lede')}</p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <label>
          {t('ops.metrics.from')}{' '}
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
            required
          />
        </label>
        <label>
          {t('ops.metrics.to')}{' '}
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
            }}
            required
          />
        </label>
      </form>
      {error ? (
        <p role="alert" className="warn">
          {error}
        </p>
      ) : null}
      {data ? (
        <>
          <p role="status" className="small">
            {t('ops.metrics.cohort', {
              people: data.cohort.people,
              min: data.min_group,
              at: formatDateTime(data.generated_at),
            })}
          </p>
          <table>
            <caption>{t('ops.metrics.gateCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('ops.metrics.metric')}</th>
                <th scope="col">{t('ops.metrics.hypothesis')}</th>
                <th scope="col">{t('ops.metrics.value')}</th>
                <th scope="col">{t('ops.metrics.target')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{t(r.label)}</th>
                  <td>{r.hypothesis}</td>
                  <td>
                    <RateText r={r.rate} />
                  </td>
                  <td>
                    <Verdict r={r.rate} target={r.target} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>{t('ops.metrics.retention')}</h3>
          <table>
            <caption>{t('ops.metrics.retentionCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('ops.metrics.week')}</th>
                <th scope="col">{t('ops.metrics.value')}</th>
              </tr>
            </thead>
            <tbody>
              {data.retention.map((w) => (
                <tr key={w.week}>
                  <th scope="row">{t('ops.metrics.weekN', { week: w.week })}</th>
                  <td>
                    <RateText r={w} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">{t('ops.metrics.note')}</p>
        </>
      ) : null}
    </div>
  );
}
