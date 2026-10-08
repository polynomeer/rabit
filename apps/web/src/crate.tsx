import { useState } from 'react';
import { get, type EntitySummary } from './api';
import { TIER_TEXT } from './blind';
import { POPULARITY } from './dig';
import { t, tCode } from './i18n';
import { entityHref } from './route';
import { errorText } from './views';

/**
 * Crate Digging, private (DIG-009): flip through a random crate of albums from an
 * era and a popularity level. Every album has something the user can play.
 */
interface CrateItem {
  release: { release_id: string; title: string; release_date: string | null };
  artists: EntitySummary[];
  label: EntitySummary | null;
  playable_tracks: number;
  popularity_tier: string;
}

const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];

export function CrateDigPanel() {
  const [items, setItems] = useState<CrateItem[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const dig = (form: HTMLFormElement) => {
    const decade = (form.elements.namedItem('decade') as HTMLSelectElement).value;
    const popularity = (form.elements.namedItem('popularity') as HTMLSelectElement).value;
    const q = new URLSearchParams({ popularity, size: '12' });
    if (decade) {
      q.set('from', decade);
      q.set('to', String(Number(decade) + 9));
    }
    setMsg(null);
    get<{ items: CrateItem[] }>(`/v1/dig/crate?${q.toString()}`).then(
      (r) => {
        setItems(r.items);
        if (r.items.length === 0) setMsg(t('crate.empty'));
      },
      (e: unknown) => {
        setMsg(errorText(e));
      },
    );
  };

  return (
    <section aria-labelledby="crate-h" className="card">
      <h3 id="crate-h">{t('crate.title')}</h3>
      <p className="small muted">{t('crate.hint')}</p>
      <form
        className="inline"
        aria-label={t('crate.form')}
        onSubmit={(e) => {
          e.preventDefault();
          dig(e.currentTarget);
        }}
      >
        <label htmlFor="crate-decade">{t('crate.era')}</label>
        <select id="crate-decade" name="decade" defaultValue="">
          <option value="">{t('crate.anyEra')}</option>
          {DECADES.map((d) => (
            <option key={d} value={d}>
              {t('crate.decade', { decade: d })}
            </option>
          ))}
        </select>{' '}
        <label htmlFor="crate-popularity">{t('dig.filter.popularity')}</label>
        <select id="crate-popularity" name="popularity" defaultValue="any">
          {POPULARITY.map(([v, key]) => (
            <option key={v} value={v}>
              {t(key)}
            </option>
          ))}
        </select>{' '}
        <button type="submit">{items ? t('crate.again') : t('crate.dig')}</button>
      </form>
      {msg ? <p role="status">{msg}</p> : null}
      {items && items.length > 0 ? (
        <ul className="list" aria-label={t('crate.list')}>
          {items.map((i) => (
            <li key={i.release.release_id}>
              <div>
                <strong>
                  <a href={entityHref(i.release.release_id)}>{i.release.title}</a>
                </strong>{' '}
                <span className="muted">
                  {i.artists.map((a) => a.name).join(', ')}
                  {i.release.release_date ? ` · ${i.release.release_date.slice(0, 4)}` : ''}
                  {i.label ? ` · ${i.label.name}` : ''}
                </span>
                <p className="small muted">
                  {t('crate.playable', { count: i.playable_tracks })} ·{' '}
                  {tCode(TIER_TEXT, i.popularity_tier)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
