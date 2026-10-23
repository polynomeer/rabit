import { useEffect, useState, type ReactNode } from 'react';
import { get, type Schemas } from './api';
import { Cover } from './brand';
import { t } from './i18n';
import { formatPrice } from './purchase';
import { entityHref, tabHref } from './route';

/**
 * Catalog shelves on the home screen: new releases, albums on sale and a crate per
 * decade. Each shelf is one row of covers (a scrolling row on phones).
 */

type Release = Schemas['ReleaseCard'];
type Artist = Schemas['EntitySummary'];

const SHELF_SIZE = 6;
const DECADES = [1970, 1980, 1990, 2000, 2010, 2020];

/** Loads a list once; null while loading, [] on failure (the shelf says it is empty). */
// T is the caller's expected item shape (validated server-side by the contract).
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function useList<T>(path: string | null): T[] | null {
  const [items, setItems] = useState<{ path: string; items: T[] } | null>(null);
  useEffect(() => {
    if (!path) return;
    let stale = false;
    get<{ items: T[] }>(path).then(
      (r) => {
        if (!stale) setItems({ path, items: r.items });
      },
      () => {
        if (!stale) setItems({ path, items: [] });
      },
    );
    return () => {
      stale = true;
    };
  }, [path]);
  return items && items.path === path ? items.items : null;
}

const year = (r: Release) => (r.release_date ? r.release_date.slice(0, 4) : null);
const byline = (artists: Artist[], r: Release) =>
  [artists.map((a) => a.name).join(', '), year(r)].filter(Boolean).join(' · ');

function Tile({
  release,
  artists,
  price,
  note,
}: {
  release: Release;
  artists: Artist[];
  price?: string;
  /** The editor's line about the pick (editorial shelves). */
  note?: string | null;
}) {
  return (
    <li>
      <a href={entityHref(release.release_id)}>
        <Cover id={release.release_id} size={160} round={10} />
        <strong>{release.title}</strong>
        <span className="muted small">{byline(artists, release)}</span>
        {price ? <span className="small price">{price}</span> : null}
        {note ? <span className="small shelf-note">{note}</span> : null}
      </a>
    </li>
  );
}

function Shelf({
  id,
  title,
  label,
  empty,
  children,
  count,
}: {
  id: string;
  title: string;
  label: string;
  empty: string;
  children: ReactNode;
  /** null while loading. */
  count: number | null;
}) {
  return (
    <section aria-labelledby={`${id}-h`}>
      <div className="section-head">
        <h3 id={`${id}-h`}>{title}</h3>
      </div>
      {count === null ? (
        <p className="muted">{t('common.loading')}</p>
      ) : count === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="cover-grid shelf" aria-label={label}>
          {children}
        </ul>
      )}
    </section>
  );
}

type EditorialShelf = Schemas['EditorialShelfLive'];

/**
 * Shelves the editors picked (ADR-0029), already filtered by the server to what plays
 * in the listener's region; nothing shows while loading or when there are none.
 */
export function EditorialShelves() {
  const [shelves, setShelves] = useState<EditorialShelf[]>([]);
  useEffect(() => {
    let stale = false;
    get<{ shelves: EditorialShelf[] }>('/v1/editorial/shelves').then(
      (r) => {
        if (!stale) setShelves(r.shelves);
      },
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, []);
  return (
    <>
      {shelves.map((s) => (
        <section key={s.shelf_id} aria-labelledby={`${s.shelf_id}-h`}>
          <div className="section-head">
            <h3 id={`${s.shelf_id}-h`}>{s.title}</h3>
          </div>
          {s.description ? <p className="muted">{s.description}</p> : null}
          <ul className="cover-grid shelf" aria-label={s.title}>
            {s.items.map((i) => (
              <Tile key={i.release.release_id} {...i} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function NewReleasesShelf() {
  const items = useList<{ release: Release; artists: Artist[] }>(
    `/v1/dig/new-releases?size=${String(SHELF_SIZE)}`,
  );
  return (
    <Shelf
      id="home-new"
      title={t('home.new')}
      label={t('home.new')}
      empty={t('home.newEmpty')}
      count={items?.length ?? null}
    >
      {items?.map((i) => (
        <Tile key={i.release.release_id} {...i} />
      ))}
    </Shelf>
  );
}

export function OnSaleShelf() {
  const items = useList<{
    offer_id: string;
    release: Release;
    artists: Artist[];
    price: Schemas['Money'];
  }>(`/v1/offers?limit=${String(SHELF_SIZE)}`);
  return (
    <Shelf
      id="home-sale"
      title={t('home.onSale')}
      label={t('home.onSale')}
      empty={t('home.onSaleEmpty')}
      count={items?.length ?? null}
    >
      {items?.map((i) => (
        <Tile
          key={i.offer_id}
          release={i.release}
          artists={i.artists}
          price={formatPrice(i.price)}
        />
      ))}
    </Shelf>
  );
}

/** A small crate (Crate Digging, DIG-009) for the chosen decade; another one per pick. */
export function DecadeShelf() {
  const [decade, setDecade] = useState(2020);
  const items = useList<{ release: Release; artists: Artist[] }>(
    `/v1/dig/crate?from=${String(decade)}&to=${String(decade + 9)}&size=${String(SHELF_SIZE)}`,
  );
  return (
    <section aria-labelledby="home-decades-h">
      <div className="section-head">
        <h3 id="home-decades-h">{t('home.decades')}</h3>
        <a href={tabHref('DIG')}>{t('home.decadesAll')}</a>
      </div>
      <div className="chips" role="group" aria-label={t('home.decades')}>
        {DECADES.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={d === decade}
            onClick={() => {
              setDecade(d);
            }}
          >
            {t('crate.decade', { decade: d })}
          </button>
        ))}
      </div>
      {items === null ? (
        <p className="muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="muted">{t('home.decadesEmpty')}</p>
      ) : (
        <ul
          className="cover-grid shelf"
          aria-label={t('home.decadeList', { decade: t('crate.decade', { decade }) })}
        >
          {items.map((i) => (
            <Tile key={i.release.release_id} {...i} />
          ))}
        </ul>
      )}
    </section>
  );
}
