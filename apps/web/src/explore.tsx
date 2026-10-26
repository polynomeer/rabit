import { useEffect, useState } from 'react';
import { api, ApiError, get, type EntitySummary } from './api';
import { featureOn } from './features';
import { formatDate, t } from './i18n';
import { preciseDate } from './journey';
import { usePlayer, type TimeMachine } from './player';
import { entityHref, navigate, nowPlayingHref, rediscoverHref, timeMachineHref } from './route';

/**
 * Exploration inside DIG (D10): Time Radio (ADR-0034) plays music that was out by a
 * chosen date, through the account queue. The date only narrows what is suggested;
 * whether a track plays is decided as for every start, by the listener's own plan
 * and licence country (EXP-027). Nothing here takes a region.
 */
interface Coverage {
  cutoff: string;
  releases_out: number;
  releases_uncertain: number;
  releases_undated: number;
  playable_releases: number;
  playable_sampled: boolean;
}

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The end of `date` (YYYY-MM-DD) in this browser's zone, as an ISO moment with offset. */
function endOfDay(date: string): string {
  return new Date(`${date}T23:59:59`).toISOString();
}

/** DIG home: the way into exploration, shown while one of its flags is on. */
export function ExplorePanel() {
  const time = featureOn('exploration_time_machine', false);
  const again = featureOn('exploration_rediscover', false);
  if (!time && !again) return null;
  return (
    <section aria-labelledby="explore-h" className="card explore-card">
      <h3 id="explore-h">{t('explore.title')}</h3>
      <p className="small muted">{t('explore.hint')}</p>
      <div className="actions">
        {time ? (
          <a className="button" href={timeMachineHref}>
            {t('explore.timeMachine')}
          </a>
        ) : null}
        {again ? (
          <a className="button" href={rediscoverHref}>
            {t('explore.rediscover')}
          </a>
        ) : null}
      </div>
    </section>
  );
}

export function TimeMachineSetup() {
  const player = usePlayer();
  const [date, setDate] = useState(
    () => player.timeMachine?.cutoff ?? `${String(new Date().getFullYear() - 40)}-06-15`,
  );
  const [mode, setMode] = useState<TimeMachine['mode']>(player.timeMachine?.mode ?? 'free_explore');
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '1900-01-01' && date <= today();

  useEffect(() => {
    if (!valid) return;
    let stale = false;
    const timer = setTimeout(() => {
      const q = new URLSearchParams({ cutoff_at: endOfDay(date), time_zone: zone() });
      get<Coverage>(`/v1/dig/time-machine/coverage?${q.toString()}`).then(
        (c) => {
          if (!stale) setCoverage(c);
        },
        () => {
          if (!stale) setCoverage(null);
        },
      );
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [date, valid]);

  const go = () => {
    setBusy(true);
    setMsg(null);
    player.startTimeMachine({ cutoff_at: endOfDay(date), time_zone: zone(), mode }).then(
      () => {
        navigate(nowPlayingHref);
      },
      (e: unknown) => {
        setBusy(false);
        setMsg(e instanceof ApiError ? e.message : String(e));
      },
    );
  };

  if (!featureOn('exploration_time_machine', false))
    return <p role="status">{t('details.notFound')}</p>;

  return (
    <section aria-labelledby="tm-h" className="time-setup">
      <button
        type="button"
        className="link"
        onClick={() => {
          history.back();
        }}
      >
        {t('details.back')}
      </button>
      <div className="time-setup-grid">
        <form
          aria-labelledby="tm-h"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !busy) go();
          }}
        >
          <div className="tm-head">
            <h2 id="tm-h">{t('tm.title')}</h2>
            <p className="muted">{t('tm.lede')}</p>
          </div>
          <fieldset>
            <legend>{t('tm.when')}</legend>
            <label className="tm-date">
              {t('tm.date')}
              <input
                type="date"
                required
                min="1900-01-01"
                max={today()}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                }}
              />
            </label>
            <p className="small muted">{t('tm.dateNote', { zone: zone() })}</p>
          </fieldset>
          <fieldset>
            <legend>{t('tm.what')}</legend>
            <label className="tm-mode">
              <input
                type="radio"
                name="tm-mode"
                checked={mode === 'free_explore'}
                onChange={() => {
                  setMode('free_explore');
                }}
              />
              <span>
                <strong>{t('tm.mode.free')}</strong>
                <span className="small muted">{t('tm.mode.freeHint')}</span>
              </span>
            </label>
            <label className="tm-mode">
              <input
                type="radio"
                name="tm-mode"
                checked={mode === 'hidden'}
                onChange={() => {
                  setMode('hidden');
                }}
              />
              <span>
                <strong>{t('tm.mode.hidden')}</strong>
                <span className="small muted">{t('tm.mode.hiddenHint')}</span>
              </span>
            </label>
            <label className="tm-mode disabled">
              <input type="radio" name="tm-mode" disabled />
              <span>
                <strong>{t('tm.mode.charts')}</strong>
                <span className="small muted">{t('tm.mode.chartsHint')}</span>
              </span>
            </label>
          </fieldset>
          <button type="submit" className="button primary" disabled={!valid || busy}>
            {t('tm.go', { date: valid ? formatDate(`${date}T00:00:00`) : '' })}
          </button>
          {msg ? (
            <p role="status" className="small">
              {msg}
            </p>
          ) : null}
        </form>
        <aside aria-labelledby="tm-cov-h" className="card">
          <h3 id="tm-cov-h">{t('tm.coverage')}</h3>
          {coverage ? (
            <dl className="tm-counts">
              <dt>{t('tm.cov.out')}</dt>
              <dd>{coverage.releases_out}</dd>
              <dt>{t('tm.cov.uncertain')}</dt>
              <dd>{coverage.releases_uncertain}</dd>
              <dt>{t('tm.cov.playable')}</dt>
              <dd>
                {coverage.playable_releases}
                {coverage.playable_sampled ? '+' : ''}
              </dd>
            </dl>
          ) : (
            <p className="small muted">{t('common.loading')}</p>
          )}
          <p className="small muted">{t('tm.cov.note')}</p>
        </aside>
      </div>
    </section>
  );
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Above the queue while Time Radio is on: its cutoff, a month on, and the way out. */
export function TimeMachineBanner() {
  const player = usePlayer();
  const tm = player.timeMachine;
  const [msg, setMsg] = useState<string | null>(null);
  if (!tm) return null;
  return (
    <div role="region" aria-label={t('tm.banner')} className="tm-banner">
      <strong>{t('tm.banner.title', { date: preciseDate(tm.cutoff, 'day') })}</strong>
      <span className="small muted">
        {tm.mode === 'hidden' ? t('tm.mode.hidden') : t('tm.mode.free')}
      </span>
      <div className="tm-banner-actions">
        <button
          type="button"
          className="link small"
          onClick={() => {
            setMsg(null);
            player.advanceTimeMachine(1).then(
              (n) => {
                setMsg(t('tm.advanced', { count: n }));
              },
              (e: unknown) => {
                setMsg(e instanceof ApiError ? e.message : String(e));
              },
            );
          }}
        >
          {t('tm.nextMonth')}
        </button>
        <a className="small" href={timeMachineHref}>
          {t('tm.change')}
        </a>
        <button
          type="button"
          className="link small"
          onClick={() => {
            void player.updateSettings({ mode: 'queue' });
          }}
        >
          {t('tm.stop')}
        </button>
      </div>
      {msg ? (
        <p role="status" className="small">
          {msg}
        </p>
      ) : null}
    </div>
  );
}

interface RediscoverItem {
  library_item_id: string;
  recording: EntitySummary;
  saved_at: string;
  note: string | null;
  history: 'played' | 'none';
  last_qualified_at: string | null;
  qualified_plays: number;
  release_date: string | null;
  date_precision: 'day' | 'month' | 'year' | null;
}

const WINDOWS = [90, 180, 365] as const;
const daysAgo = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

/**
 * Rediscover (EX-06, ADR-0035): saved tracks not played for a while, with when they
 * were saved and when they came out. Only Rabit's own saves and qualified plays are
 * used; with no recorded play the page says so instead of guessing.
 */
export function RediscoverView() {
  const player = usePlayer();
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(180);
  const [items, setItems] = useState<RediscoverItem[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let stale = false;
    setItems(null);
    get<{ items: RediscoverItem[] }>(`/v1/me/rediscover?inactive_days=${String(days)}`).then(
      (r) => {
        if (!stale) setItems(r.items);
      },
      (e: unknown) => {
        if (!stale) setMsg(e instanceof ApiError ? e.message : String(e));
      },
    );
    return () => {
      stale = true;
    };
  }, [days, tick]);

  if (!featureOn('exploration_rediscover', false))
    return <p role="status">{t('details.notFound')}</p>;

  const entries = (items ?? []).map((i) => ({
    key: i.library_item_id,
    title: i.recording.name,
    subtitle: i.recording.subtitle,
    recording_id: i.recording.entity_id,
    cover_id: i.recording.primary_release_id ?? i.recording.entity_id,
  }));

  return (
    <section aria-labelledby="rd-h" className="rediscover">
      <button
        type="button"
        className="link"
        onClick={() => {
          history.back();
        }}
      >
        {t('details.back')}
      </button>
      <div className="rd-head">
        <div>
          <h2 id="rd-h">{t('rd.title')}</h2>
          <p className="muted">{t('rd.lede', { days })}</p>
        </div>
        <button
          type="button"
          className="button primary"
          disabled={entries.length === 0}
          onClick={() => {
            player.play(entries, 0);
          }}
        >
          {t('rd.playAll')}
        </button>
      </div>
      <div role="note" className="card rd-note">
        <span className="small">{t('rd.privacy')}</span>
        <button
          type="button"
          className="link small"
          onClick={() => {
            setMsg(null);
            api('DELETE', '/v1/me/rediscover/history').then(
              () => {
                setMsg(t('rd.cleared'));
                setTick((n) => n + 1);
              },
              (e: unknown) => {
                setMsg(e instanceof ApiError ? e.message : String(e));
              },
            );
          }}
        >
          {t('rd.clear')}
        </button>
      </div>
      <fieldset className="chips">
        <legend>{t('rd.window')}</legend>
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            aria-pressed={w === days}
            onClick={() => {
              setDays(w);
            }}
          >
            {t('rd.windowDays', { days: w })}
          </button>
        ))}
      </fieldset>
      {msg ? (
        <p role="status" className="small">
          {msg}
        </p>
      ) : null}
      {items === null ? (
        <p role="status">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="muted">{t('rd.empty', { days })}</p>
      ) : (
        <ul className="list rd-list" aria-label={t('rd.list')}>
          {items.map((i, at) => (
            <li key={i.library_item_id}>
              <div className="rd-main">
                <a href={entityHref(i.recording.entity_id)}>
                  <strong>{i.recording.name}</strong>
                </a>
                <span className="small muted">
                  {i.recording.subtitle ? `${i.recording.subtitle} · ` : ''}
                  {t('rd.released', { date: preciseDate(i.release_date, i.date_precision) })}
                </span>
                <span className="small">
                  {t('rd.saved', { date: formatDate(i.saved_at) })} ·{' '}
                  <span className="muted">
                    {i.last_qualified_at
                      ? t('rd.lastPlayed', { days: daysAgo(i.last_qualified_at) })
                      : t('rd.noHistory')}
                  </span>
                </span>
                {i.note ? <span className="small rd-memo">{i.note}</span> : null}
              </div>
              <button
                type="button"
                className="round quiet"
                aria-label={t('rd.play', { title: i.recording.name })}
                onClick={() => {
                  player.play(entries, at);
                }}
              >
                ▶
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
