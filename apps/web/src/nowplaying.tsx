import { OWNERSHIP_TEXT } from './api';
import { Cover, Icon, RabitSymbol } from './brand';
import { t, tCode } from './i18n';
import { coverOf, Progress, usePlayer, Waveform } from './player';
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
      <p className="eyebrow">Now playing</p>
      <div className="now-cover">
        <Cover id={coverOf(current)} size={320} round={28} />
      </div>
      <div className="now-title">
        <div>
          <h2 id="now-h">{current.title}</h2>
          <p className="muted">
            {current.subtitle}
            {current.cover_id?.startsWith('rel_') ? (
              <>
                {current.subtitle ? ' · ' : ''}
                <a href={entityHref(current.cover_id)}>{t('now.album')}</a>
              </>
            ) : null}
          </p>
        </div>
        {current.ownership ? (
          <span className={`badge own-${current.ownership}`}>
            {tCode(OWNERSHIP_TEXT, current.ownership)}
          </span>
        ) : null}
      </div>
      {player.quality ? <p className="small muted">{player.quality}</p> : null}
      {player.peaks && player.peaks.length > 0 ? (
        <Waveform peaks={player.peaks} audio={player.audio} />
      ) : null}
      <Progress audio={player.audio} />
      <div className="now-controls">
        <button
          type="button"
          className="round"
          aria-label={t('player.previous')}
          onClick={player.previous}
        >
          <Icon name="previous" size={22} />
        </button>
        <button
          type="button"
          className="round primary big"
          aria-label={player.playing ? t('player.pause') : t('player.resume')}
          onClick={player.toggle}
        >
          <Icon name={player.playing ? 'pause' : 'play'} size={28} />
        </button>
        <button
          type="button"
          className="round"
          aria-label={t('player.next')}
          disabled={index + 1 >= queue.length}
          onClick={player.next}
        >
          <Icon name="next" size={22} />
        </button>
      </div>
      {player.message ? (
        <p role="status" className="warn">
          {player.message}
        </p>
      ) : null}
      {current.recording_id ? (
        <div className="now-actions">
          <a className="dig-cta" href={digHref(current.recording_id)}>
            <RabitSymbol size={22} />
            Go deeper in music
          </a>
          <a className="button" href={entityHref(current.recording_id)}>
            <Icon name="credits" size={16} />
            {t('now.credits')}
          </a>
        </div>
      ) : null}
      {queue.length > 1 ? (
        <section aria-labelledby="queue-h">
          <h3 id="queue-h" className="eyebrow">
            {t('now.queue')}
          </h3>
          <ol className="queue">
            {queue.map((entry, i) => (
              <li key={`${entry.key}-${String(i)}`}>
                <button
                  type="button"
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => {
                    player.jump(i);
                  }}
                >
                  <span className="queue-title">{entry.title}</span>
                  {entry.subtitle ? <span className="muted small">{entry.subtitle}</span> : null}
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </section>
  );
}
