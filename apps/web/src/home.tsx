import { useEffect, useState } from 'react';
import { get, type LibraryItem } from './api';
import { Cover, Icon, type IconName } from './brand';
import { EntityMark, type SessionSummary } from './dig';
import { formatDate, t, type MessageKey } from './i18n';
import { digSessionHref, entityHref, navigate, searchHref, tabHref, type Tab } from './route';
import { DecadeShelf, NewReleasesShelf, OnSaleShelf } from './shelves';

const AREAS: readonly { tab: Tab; icon: IconName; label: string; hint: MessageKey }[] = [
  { tab: 'Search', icon: 'search', label: 'Search', hint: 'home.area.search' },
  { tab: 'DIG', icon: 'dig', label: 'DIG', hint: 'home.area.dig' },
  { tab: 'Archive', icon: 'archive', label: 'Archive', hint: 'home.area.archive' },
  { tab: 'Studio', icon: 'studio', label: 'Studio', hint: 'home.area.studio' },
];

/**
 * `#/home`: the start screen — search, the product areas, catalog shelves (new
 * releases, albums on sale, a crate per decade), recent DIG sessions and saves.
 */
export function Home() {
  const [recent, setRecent] = useState<SessionSummary[] | null>(null);
  const [saved, setSaved] = useState<LibraryItem[]>([]);
  useEffect(() => {
    let stale = false;
    // Catalog saves only: private audio lives in Archive and Studio.
    get<{ items: LibraryItem[] }>('/v1/library?limit=24').then(
      (r) => {
        if (!stale) setSaved(r.items.filter((i) => i.ref_type !== 'audio_source').slice(0, 6));
      },
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, []);
  useEffect(() => {
    let stale = false;
    get<{ items: SessionSummary[] }>('/v1/dig-sessions?limit=3').then(
      (r) => {
        if (!stale) setRecent(r.items);
      },
      () => {
        if (!stale) setRecent([]);
      },
    );
    return () => {
      stale = true;
    };
  }, []);
  return (
    <section className="home" aria-labelledby="home-h">
      <h2 id="home-h" className="greeting">
        {t('home.greeting')}
      </h2>
      <form
        role="search"
        className="search-row"
        onSubmit={(e) => {
          e.preventDefault();
          const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value.trim();
          navigate(q ? searchHref(q) : tabHref('Search'));
        }}
      >
        <label className="search-field">
          <Icon name="search" size={18} />
          <input
            name="q"
            type="search"
            aria-label={t('home.search')}
            placeholder={t('home.search')}
          />
        </label>
        <button type="submit">{t('home.searchSubmit')}</button>
      </form>
      <nav aria-label={t('home.areas')}>
        <ul className="areas">
          {AREAS.map((a) => (
            <li key={a.tab}>
              <a className={`area area-${a.icon}`} href={tabHref(a.tab)}>
                <span className="area-icon">
                  <Icon name={a.icon} size={19} />
                </span>
                <span className="area-name">{a.label}</span>
                <span className="area-hint">{t(a.hint)}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <NewReleasesShelf />
      <OnSaleShelf />
      <DecadeShelf />
      <section aria-labelledby="home-continue-h">
        <div className="section-head">
          <h3 id="home-continue-h">{t('home.continue')}</h3>
          <a href={tabHref('DIG')}>{t('home.continueAll')}</a>
        </div>
        {recent === null ? (
          <p className="muted">{t('common.loading')}</p>
        ) : recent.length === 0 ? (
          <p className="muted">{t('home.continueEmpty')}</p>
        ) : (
          <ul className="session-cards">
            {recent.map((s) => (
              <li key={s.dig_session_id}>
                <a href={digSessionHref(s.dig_session_id)}>
                  {s.start_entity ? <EntityMark entity={s.start_entity} size={52} /> : null}
                  <span className="session-card-text">
                    <strong>
                      {s.title ??
                        (s.start_entity
                          ? t('dig.home.startedFrom', { name: s.start_entity.name })
                          : t('dig.home.untitled'))}
                    </strong>
                    <span className="muted small">
                      {t('dig.home.meta', { nodes: s.nodes, date: formatDate(s.started_at) })}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      {saved.length > 0 ? (
        <section aria-labelledby="home-saved-h">
          <div className="section-head">
            <h3 id="home-saved-h">{t('home.saved')}</h3>
            <a href={tabHref('Archive')}>{t('home.savedAll')}</a>
          </div>
          <ul className="cover-grid">
            {saved.map((i) => (
              <li key={i.library_item_id}>
                <a href={entityHref(i.ref_id)}>
                  <Cover id={i.primary_release_id ?? i.ref_id} size={160} round={10} />
                  <strong>{i.title ?? t('common.untitled')}</strong>
                  {i.subtitle ? <span className="muted small">{i.subtitle}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
