import { useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import { formatDate, t, type MessageKey } from './i18n';
import { TimeMachineBanner } from './explore';
import { preciseDate } from './journey';
import { EntryArt, usePlayer, type QueueEntry, type QueueReason } from './player';

/**
 * The play queue on Now Playing (ADR-0026): what was played (history), what plays
 * now, what the listener chose next and what autoplay suggests after it — each
 * suggestion with its reason (DSC-006), to keep or remove.
 */

const REASON_TEXT: Record<QueueReason['code'], MessageKey> = {
  samples: 'queue.reason.samples',
  sampled_by: 'queue.reason.sampled_by',
  covers: 'queue.reason.covers',
  covered_by: 'queue.reason.covered_by',
  remixes: 'queue.reason.remixes',
  remix_of: 'queue.reason.remix_of',
  same_producer: 'queue.reason.same_producer',
  influences: 'queue.reason.influences',
  influenced_by: 'queue.reason.influenced_by',
  same_artist: 'queue.reason.same_artist',
  member_project: 'queue.reason.member_project',
  same_label: 'queue.reason.same_label',
  same_decade: 'queue.reason.same_decade',
  time_machine: 'queue.reason.time_machine',
};

const SAVE_TITLE: Record<'all' | 'chosen' | 'suggested', MessageKey> = {
  all: 'queue.save.title.all',
  chosen: 'queue.save.title.chosen',
  suggested: 'queue.save.title.suggested',
};

export function reasonText(r: QueueReason): string {
  if (r.code === 'time_machine')
    return t('queue.reason.time_machine', {
      name: r.name ?? '',
      date: preciseDate(r.release_date ?? null, r.date_precision ?? null),
    });
  const text = t(REASON_TEXT[r.code], { name: r.name ?? '' });
  return r.basis === 'ml_inferred' ? `${text} · ${t('queue.inferred')}` : text;
}

/** Saves queue items as a new playlist, one item at a time (each needs the version). */
async function saveAsPlaylist(title: string, entries: QueueEntry[]) {
  const created = await api<{ playlist_id: string }>('POST', '/v1/playlists', { title });
  let etag = created.etag ?? '"1"';
  for (const e of entries) {
    const r = await api(
      'POST',
      `/v1/playlists/${created.data.playlist_id}/items`,
      e.audio_source_id
        ? { ref_type: 'audio_source', ref_id: e.audio_source_id }
        : { ref_type: 'recording', ref_id: e.recording_id },
      { 'if-match': etag },
    );
    etag = r.etag ?? etag;
  }
  return created.data.playlist_id;
}

function Row({
  entry,
  at,
  current,
  actions,
}: {
  entry: QueueEntry;
  at: number;
  current?: boolean;
  actions?: ReactNode;
}) {
  const player = usePlayer();
  return (
    <li className={entry.state === 'played' ? 'played' : undefined}>
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        disabled={entry.playable === false}
        onClick={() => {
          player.jump(at);
        }}
      >
        <EntryArt entry={entry} size={40} />
        <span className="queue-text">
          <span className="queue-title">{entry.title}</span>
          {entry.reason ? (
            <span className="small queue-reason">{reasonText(entry.reason)}</span>
          ) : entry.subtitle ? (
            <span className="muted small">{entry.subtitle}</span>
          ) : null}
          {entry.playable === false ? (
            <span className="muted small">{t('queue.unplayable')}</span>
          ) : null}
        </span>
      </button>
      {actions ? <span className="queue-actions">{actions}</span> : null}
    </li>
  );
}

export function QueuePanel() {
  const player = usePlayer();
  const { queue, index, settings } = player;
  const [msg, setMsg] = useState<string | null>(null);
  const history = queue.map((e, i) => ({ e, i })).filter(({ i }) => i < index);
  const upcoming = queue.map((e, i) => ({ e, i })).filter(({ i }) => i > index);
  const chosen = upcoming.filter(({ e }) => e.origin !== 'autoplay');
  const suggested = upcoming.filter(({ e }) => e.origin === 'autoplay');
  const current = queue[index];

  const act = (p: Promise<unknown>, done?: string) => {
    setMsg(null);
    p.then(
      () => {
        if (done) setMsg(done);
      },
      (e: unknown) => {
        setMsg(e instanceof ApiError ? e.message : String(e));
      },
    );
  };
  const save = (which: 'all' | 'chosen' | 'suggested') => {
    const list =
      which === 'all'
        ? queue
        : which === 'chosen'
          ? queue.filter((e) => e.origin !== 'autoplay')
          : suggested.map(({ e }) => e);
    const title = t(SAVE_TITLE[which], { date: formatDate(new Date().toISOString()) });
    act(saveAsPlaylist(title, list), t('queue.saved', { title }));
  };
  const remove = (e: QueueEntry) => (
    <button
      type="button"
      className="link small"
      aria-label={t('queue.remove', { title: e.title })}
      onClick={() => {
        act(player.remove(e));
      }}
    >
      {t('queue.removeShort')}
    </button>
  );

  return (
    <section aria-labelledby="queue-h" className="queue-panel">
      <div className="section-head">
        <h3 id="queue-h">{t('now.queue')}</h3>
        <details className="queue-menu">
          <summary>{t('queue.save')}</summary>
          <div role="group" aria-label={t('queue.save')}>
            <button
              type="button"
              onClick={() => {
                save('all');
              }}
            >
              {t('queue.save.all')}
            </button>
            <button
              type="button"
              onClick={() => {
                save('chosen');
              }}
            >
              {t('queue.save.chosen')}
            </button>
            <button
              type="button"
              disabled={suggested.length === 0}
              onClick={() => {
                save('suggested');
              }}
            >
              {t('queue.save.suggested')}
            </button>
          </div>
        </details>
      </div>
      <TimeMachineBanner />
      {msg ? (
        <p role="status" className="small">
          {msg}
        </p>
      ) : null}

      {history.length > 0 ? (
        <>
          <div className="queue-head">
            <h4 className="eyebrow">{t('queue.history')}</h4>
            <button
              type="button"
              className="link small"
              onClick={() => {
                act(player.clear('history'));
              }}
            >
              {t('queue.clearHistory')}
            </button>
          </div>
          <ol className="queue" aria-label={t('queue.history')}>
            {history.map(({ e, i }) => (
              <Row key={e.key} entry={e} at={i} />
            ))}
          </ol>
        </>
      ) : null}

      {current ? (
        <>
          <h4 className="eyebrow">{t('queue.now')}</h4>
          <ol className="queue" aria-label={t('queue.now')}>
            <Row entry={current} at={index} current />
          </ol>
        </>
      ) : null}

      <div className="queue-head">
        <h4 className="eyebrow">{t('queue.chosen')}</h4>
        {chosen.length > 0 ? (
          <button
            type="button"
            className="link small"
            onClick={() => {
              act(player.clear('upcoming'));
            }}
          >
            {t('queue.clearUpcoming')}
          </button>
        ) : null}
      </div>
      {chosen.length === 0 ? (
        <p className="muted small">{t('queue.chosenEmpty')}</p>
      ) : (
        <ol className="queue" aria-label={t('queue.chosen')}>
          {chosen.map(({ e, i }) => (
            <Row key={e.key} entry={e} at={i} actions={remove(e)} />
          ))}
        </ol>
      )}

      <div className="queue-head">
        <h4 className="eyebrow">{t('queue.suggested')}</h4>
        {/* Time Radio always suggests from its cutoff; the switch is for track-based autoplay. */}
        <label className="small queue-switch" hidden={player.timeMachine !== null}>
          <input
            type="checkbox"
            checked={settings.autoplay}
            onChange={(ev) => {
              act(player.updateSettings({ autoplay: ev.target.checked }));
            }}
          />{' '}
          {t('queue.autoplay')}
        </label>
      </div>
      {!settings.autoplay && !player.timeMachine ? (
        <p className="muted small">{t('queue.autoplayOff')}</p>
      ) : suggested.length === 0 ? (
        <p className="muted small">
          {player.timeMachine ? t('tm.suggestedEmpty') : t('queue.suggestedEmpty')}
        </p>
      ) : (
        <>
          <p className="muted small">
            {player.timeMachine
              ? t('tm.suggestedHint')
              : t('queue.suggestedHint', { title: current?.title ?? '' })}{' '}
            <button
              type="button"
              className="link small"
              onClick={() => {
                act(player.refreshSuggestions());
              }}
            >
              {t('queue.refresh')}
            </button>
          </p>
          <ol className="queue" aria-label={t('queue.suggested')}>
            {suggested.map(({ e, i }) => (
              <Row
                key={e.key}
                entry={e}
                at={i}
                actions={
                  <>
                    <button
                      type="button"
                      className="link small"
                      aria-label={t('queue.keep', { title: e.title })}
                      onClick={() => {
                        act(player.keep(e));
                      }}
                    >
                      {t('queue.keepShort')}
                    </button>{' '}
                    {remove(e)}
                  </>
                }
              />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/**
 * Queue actions next to "play" (ADR-0026): play next, add to the queue and, for one
 * track, start autoplay from it. Unplayable tracks are left out.
 */
export function QueueActions({
  entries,
  radio = false,
}: {
  entries: QueueEntry[];
  radio?: boolean;
}) {
  const player = usePlayer();
  const [msg, setMsg] = useState<string | null>(null);
  const playable = entries.filter((e) => e.playable !== false);
  const run = (p: Promise<unknown>, done: string) => {
    setMsg(null);
    p.then(
      () => {
        setMsg(done);
      },
      (e: unknown) => {
        setMsg(e instanceof ApiError ? e.message : String(e));
      },
    );
  };
  if (playable.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          run(player.enqueue(playable, 'next'), t('queue.addedNext'));
        }}
      >
        {t('queue.playNext')}
      </button>
      <button
        type="button"
        onClick={() => {
          run(player.enqueue(playable, 'end'), t('queue.added'));
        }}
      >
        {t('queue.add')}
      </button>
      {radio && playable[0] ? (
        <button
          type="button"
          onClick={() => {
            player.startRadio(playable[0] as QueueEntry);
          }}
        >
          {t('queue.startRadio')}
        </button>
      ) : null}
      {msg ? (
        <span role="status" className="small muted">
          {msg}
        </span>
      ) : null}
    </>
  );
}
