import { OWNERSHIP_TEXT } from './api';
import { Icon } from './brand';
import { t, tCode } from './i18n';
import { EntryArt, Progress, usePlayer, Waveform } from './player';
import { QueuePanel } from './queue';
import { digHref, entityHref, tabHref } from './route';

/**
 * `#/now`: the full player (BRD §6 "Calm Playback" — no promotion while playing).
 * Exploring from here (DIG, credits) leaves playback running.
 */
export function NowPlaying() {
  const player = usePlayer();
  const { current, queue, index } = player;
  if (!current)
    return (
      <section className="now-playing" aria-labelledby="now-h">
        <p className="eyebrow">Now playing</p>
        <h2 id="now-h">{t('player.idle')}</h2>
        <p>
          <a href={tabHref('Search')}>{t('now.find')}</a>
        </p>
      </section>
    );
  return (
    <section className="now-playing" aria-labelledby="now-h">
      <div className="now-main">
        <div className="now-cover">
          <EntryArt entry={current} size={480} />
        </div>
        <div className="now-title">
          <div>
            <p className="eyebrow">Now playing</p>
            <h2 id="now-h">{current.title}</h2>
            {current.subtitle ? <p className="muted">{current.subtitle}</p> : null}
          </div>
          {current.ownership && tCode(OWNERSHIP_TEXT, current.ownership) !== current.subtitle ? (
            <span className={`badge own-${current.ownership}`}>
              {tCode(OWNERSHIP_TEXT, current.ownership)}
            </span>
          ) : null}
        </div>
        {player.peaks && player.peaks.length > 0 ? (
          <Waveform peaks={player.peaks} audio={player.audio} />
        ) : null}
        <Progress audio={player.audio} />
        {player.quality ? <p className="small muted now-quality">{player.quality}</p> : null}
        <div className="now-controls">
          <button
            type="button"
            className="round"
            aria-label={t('player.previous')}
            onClick={player.previous}
          >
            <Icon name="previous" size={26} />
          </button>
          <button
            type="button"
            className="round primary big"
            aria-label={player.playing ? t('player.pause') : t('player.resume')}
            onClick={player.toggle}
          >
            <Icon name={player.playing ? 'pause' : 'play'} size={30} />
          </button>
          <button
            type="button"
            className="round"
            aria-label={t('player.next')}
            disabled={index + 1 >= queue.length}
            onClick={player.next}
          >
            <Icon name="next" size={26} />
          </button>
        </div>
        {player.message ? (
          <p role="status" className="warn">
            {player.message}
          </p>
        ) : null}
      </div>
      <div className="now-side">
        {current.recording_id && !current.hidden ? (
          <>
            <a className="dig-cta" href={digHref(current.recording_id)}>
              <span className="dig-cta-eyebrow">DIG</span>
              <strong>{t('now.dig')}</strong>
              <span className="dig-cta-hint">{t('now.digHint')}</span>
            </a>
            <div className="now-actions">
              <a className="button" href={entityHref(current.recording_id)}>
                <Icon name="credits" size={16} />
                {t('now.credits')}
              </a>
              {current.cover_id?.startsWith('rel_') ? (
                <a className="button" href={entityHref(current.cover_id)}>
                  {t('now.album')}
                </a>
              ) : null}
            </div>
          </>
        ) : null}
        <QueuePanel />
      </div>
    </section>
  );
}
