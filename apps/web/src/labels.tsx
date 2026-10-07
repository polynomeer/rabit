import { useEffect, useState } from 'react';
import { get, type EntitySummary } from './api';
import { t } from './i18n';
import { entityHref } from './route';

/** Label Digging, basic (DIG-011): releases by year and each artist's years on the label. */
interface LabelTimeline {
  years: {
    year: number | null;
    releases: {
      release_id: string;
      title: string;
      release_date: string | null;
      artists: EntitySummary[];
    }[];
  }[];
  artists: {
    artist: EntitySummary;
    first_year: number | null;
    last_year: number | null;
    releases: number;
  }[];
  truncated: boolean;
}

function span(first: number | null, last: number | null): string {
  if (first === null) return t('labels.undated');
  return first === last ? String(first) : `${String(first)}–${String(last)}`;
}

export function LabelTimelineView({ labelId }: { labelId: string }) {
  const [data, setData] = useState<LabelTimeline | null>(null);
  useEffect(() => {
    let stale = false;
    void get<LabelTimeline>(`/v1/dig/labels/${labelId}/timeline`).then((r) => {
      if (!stale) setData(r);
    });
    return () => {
      stale = true;
    };
  }, [labelId]);
  if (!data) return null;
  return (
    <section aria-labelledby="label-timeline-h" className="label-timeline">
      <h3 id="label-timeline-h">{t('labels.timeline')}</h3>
      <ol className="list" aria-label={t('labels.years')}>
        {data.years.map((y) => (
          <li key={y.year ?? 'undated'}>
            <strong>{y.year ?? t('labels.undated')}</strong>
            <ul>
              {y.releases.map((r) => (
                <li key={r.release_id}>
                  <a href={entityHref(r.release_id)}>{r.title}</a>
                  {r.artists.length > 0 ? (
                    <span className="muted">
                      {' · '}
                      {r.artists.map((a, i) => (
                        <span key={a.entity_id}>
                          {i > 0 ? ', ' : ''}
                          <a href={entityHref(a.entity_id)}>{a.name}</a>
                        </span>
                      ))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <h3>{t('labels.artists')}</h3>
      <ul className="list" aria-label={t('labels.artists')}>
        {data.artists.map((a) => (
          <li key={a.artist.entity_id}>
            <a href={entityHref(a.artist.entity_id)}>{a.artist.name}</a>{' '}
            <span className="muted">
              {span(a.first_year, a.last_year)} · {t('labels.releaseCount', { count: a.releases })}
            </span>
          </li>
        ))}
      </ul>
      {data.truncated ? <p className="small muted">{t('labels.truncated')}</p> : null}
    </section>
  );
}
