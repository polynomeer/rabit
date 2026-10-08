import { useEffect, useState } from 'react';
import { get } from './api';
import { Icon, type IconName } from './brand';
import type { SessionSummary } from './dig';
import { formatDate, t, type MessageKey } from './i18n';
import { digSessionHref, navigate, searchHref, tabHref, type Tab } from './route';

const AREAS: readonly { tab: Tab; icon: IconName; label: string; hint: MessageKey }[] = [
  { tab: 'Search', icon: 'search', label: 'Listen', hint: 'home.area.search' },
  { tab: 'DIG', icon: 'dig', label: 'DIG', hint: 'home.area.dig' },
  { tab: 'Archive', icon: 'archive', label: 'Archive', hint: 'home.area.archive' },
  { tab: 'Studio', icon: 'studio', label: 'Studio', hint: 'home.area.studio' },
];

/** `#/home`: the start screen — search, the product areas and recent DIG sessions. */
export function Home() {
  const [recent, setRecent] = useState<SessionSummary[] | null>(null);
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
        className="search-field"
        onSubmit={(e) => {
          e.preventDefault();
          const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value.trim();
          navigate(q ? searchHref(q) : tabHref('Search'));
        }}
      >
        <Icon name="search" size={18} />
        <input
          name="q"
          type="search"
          aria-label={t('home.search')}
          placeholder={t('home.search')}
        />
        <button type="submit" className="visually-hidden">
          {t('home.searchSubmit')}
        </button>
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
      <section aria-labelledby="home-continue-h">
        <div className="section-head">
          <h3 id="home-continue-h" className="eyebrow">
            {t('home.continue')}
          </h3>
          <a href={tabHref('DIG')}>{t('home.continueAll')}</a>
        </div>
        {recent === null ? (
          <p className="muted">{t('common.loading')}</p>
        ) : recent.length === 0 ? (
          <p className="muted">{t('home.continueEmpty')}</p>
        ) : (
          <ul className="list">
            {recent.map((s) => (
              <li key={s.dig_session_id}>
                <a href={digSessionHref(s.dig_session_id)}>
                  {s.title ??
                    (s.start_entity
                      ? t('dig.home.startedFrom', { name: s.start_entity.name })
                      : t('dig.home.untitled'))}
                </a>
                <span className="muted small">
                  {t('dig.home.meta', { nodes: s.nodes, date: formatDate(s.started_at) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
