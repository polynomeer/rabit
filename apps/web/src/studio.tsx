import { useEffect, useState } from 'react';
import { get, type LibraryItem } from './api';
import { Upload } from './archive';
import { Mark } from './brand';
import { formatDate, t } from './i18n';
import { usePlayer } from './player';
import { tabHref } from './route';
import { Status, toEntry } from './views';

const RECENT = 5;

/** `#/studio`: private uploads and Audio Log recordings (Create, BRD §7). */
export function Studio() {
  const player = usePlayer();
  const [added, setAdded] = useState(0);
  const [mine, setMine] = useState<LibraryItem[] | null>(null);
  // Private audio and Audio Logs only (catalog items belong to the Archive), newest first.
  useEffect(() => {
    let stale = false;
    get<{ items: LibraryItem[] }>('/v1/library?limit=100').then(
      (r) => {
        if (stale) return;
        setMine(
          r.items
            .filter((i) => i.ref_type === 'audio_source')
            .sort((a, b) => b.saved_at.localeCompare(a.saved_at))
            .slice(0, RECENT),
        );
      },
      () => {
        if (!stale) setMine([]);
      },
    );
    return () => {
      stale = true;
    };
  }, [added]);
  const playable = (mine ?? []).filter((i) => i.playability.playable);
  return (
    <section className="studio" aria-labelledby="studio-h">
      <h2 id="studio-h">Studio</h2>
      <p className="lede">{t('studio.intro')}</p>
      <Upload
        onDone={() => {
          setAdded((n) => n + 1);
        }}
      />
      <p className="note">{t('studio.rightsNote')}</p>
      <section aria-labelledby="studio-mine-h">
        <div className="section-head">
          <h3 id="studio-mine-h" className="eyebrow">
            {t('studio.mine')}
          </h3>
          <a href={tabHref('Archive')}>{t('studio.mineAll')}</a>
        </div>
        {mine === null ? (
          <p className="muted">{t('common.loading')}</p>
        ) : mine.length === 0 ? (
          <p className="muted">{t('studio.mineEmpty')}</p>
        ) : (
          <ul className="rows" aria-label={t('studio.mine')}>
            {mine.map((i) => {
              const kind = i.ownership === 'audio_log' ? 'audio_log' : 'private_audio';
              return (
                <li key={i.library_item_id}>
                  <Mark id={i.ref_id} kind={kind} name={i.title ?? ''} size={44} />
                  <div className="row-main">
                    <strong>{i.title ?? t('common.deletedTitle')}</strong>
                    <span className="muted small">
                      {t('studio.mineMeta', {
                        kind: kind === 'audio_log' ? 'Audio Log' : t('ownership.private'),
                        date: formatDate(i.saved_at),
                      })}
                    </span>
                    <Status p={i.playability} />
                  </div>
                  <button
                    type="button"
                    disabled={!i.playability.playable}
                    onClick={() => {
                      player.play(playable.map(toEntry), playable.indexOf(i));
                    }}
                  >
                    {t('common.play')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
