import { layers, LIGHT, DARK, type Flavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';

/**
 * The DIG map base (ADR-0038): OpenStreetMap vector tiles from our own origin, drawn
 * in Rabit's palette with land, sea, borders and place names only — no roads, POIs
 * or buildings. Nothing finer than a city is requested or shown.
 */

/** City level: the closest the map goes, and the deepest zoom in the tile file. */
export const CITY_ZOOM = 10;
export const MIN_ZOOM = 1;

/** Served next to the web client (publish: infra/aws/scripts/publish-basemap.sh). */
export const BASEMAP_PATH = '/map/v1/basemap.pmtiles';
export const GLYPHS_PATH = '/map/v1/fonts/{fontstack}/{range}.pbf';

export const ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap 기여자</a>';

export type MapTheme = 'light' | 'dark';

/** Matches the design canvas map tokens (sea, land, border) in both themes. */
const PALETTE: Record<
  MapTheme,
  { sea: string; land: string; border: string; label: string; halo: string }
> = {
  light: { sea: '#dce3e6', land: '#f7f4ee', border: '#c9c2b6', label: '#5b5852', halo: '#f7f4ee' },
  dark: { sea: '#121116', land: '#24232a', border: '#3a3842', label: '#a9a4ae', halo: '#121116' },
};

/** Layer ids from @protomaps/basemaps that the map keeps; every other layer is dropped. */
const KEEP = /^(background|earth|water|boundaries(_country)?|places_(country|region|locality))$/;

export function basemapStyle(theme: MapTheme, origin: string): StyleSpecification {
  const p = PALETTE[theme];
  const flavor: Flavor = {
    ...(theme === 'dark' ? DARK : LIGHT),
    background: p.sea,
    earth: p.land,
    water: p.sea,
    boundaries: p.border,
    country_label: p.label,
    state_label: p.label,
    state_label_halo: p.halo,
    city_label: p.label,
    city_label_halo: p.halo,
  };
  return {
    version: 8,
    glyphs: `${origin}${GLYPHS_PATH}`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${origin}${BASEMAP_PATH}`,
        maxzoom: CITY_ZOOM,
      },
    },
    layers: layers('protomaps', flavor, { lang: 'ko' }).filter((l) => KEEP.test(l.id)),
  };
}

/** The page's colour theme: `<html data-theme>` wins over the OS setting (ADR-0022). */
export function currentMapTheme(): MapTheme {
  const forced = document.documentElement.getAttribute('data-theme');
  if (forced === 'light' || forced === 'dark') return forced;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
