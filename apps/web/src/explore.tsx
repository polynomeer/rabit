import { useEffect, useState } from 'react';
import { ApiError, get } from './api';
import { featureOn } from './features';
import { formatDate, t } from './i18n';
import { preciseDate } from './journey';
import { usePlayer, type TimeMachine } from './player';
import { navigate, nowPlayingHref, timeMachineHref } from './route';

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
  if (!featureOn('exploration_time_machine', false)) return null;
  return (
    <section aria-labelledby="explore-h" className="card explore-card">
      <h3 id="explore-h">{t('explore.title')}</h3>
      <p className="small muted">{t('explore.hint')}</p>
      <a className="button" href={timeMachineHref}>
        {t('explore.timeMachine')}
      </a>
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
