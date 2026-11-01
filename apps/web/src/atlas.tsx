import { lazy, Suspense } from 'react';
import { featureOn } from './features';
import { t } from './i18n';

/**
 * The DIG map screen (ADR-0038). MapLibre and the tile reader load only here. Every
 * map view has an equivalent list (ATL-001); until artist and release regions have a
 * lawful source (Q10) the map shows its base and the list says why it is empty.
 */
const MapBase = lazy(() => import('./map/MapBase'));

export function MapView() {
  if (!featureOn('exploration_map', false)) return <p role="status">{t('details.notFound')}</p>;
  return (
    <section aria-labelledby="map-h" className="atlas">
      <h2 id="map-h">{t('map.title')}</h2>
      <p className="muted">{t('map.lede')}</p>
      <Suspense fallback={<p role="status">{t('map.loading')}</p>}>
        <MapBase label={t('map.region')} />
      </Suspense>
      <section aria-labelledby="map-list-h" className="card">
        <h3 id="map-list-h">{t('map.list')}</h3>
        <p className="small muted">{t('map.listEmpty')}</p>
      </section>
    </section>
  );
}
