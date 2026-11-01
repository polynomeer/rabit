// The DIG map style (ADR-0038): only our origin, only land/sea/borders/places, city zoom cap.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { basemapStyle, CITY_ZOOM } from '../src/map/style.ts';

const origin = 'https://app.example.test';

test('every URL in the style is on our own origin', () => {
  for (const theme of ['light', 'dark']) {
    const style = basemapStyle(theme, origin);
    assert.ok(style.glyphs.startsWith(`${origin}/map/v1/`));
    assert.equal(style.sources.protomaps.url, `pmtiles://${origin}/map/v1/basemap.pmtiles`);
    assert.equal(style.sprite, undefined);
  }
});

test('no roads, POIs, buildings or address labels', () => {
  const ids = basemapStyle('light', origin).layers.map((l) => l.id);
  assert.deepEqual(ids, [
    'background',
    'earth',
    'water',
    'boundaries_country',
    'boundaries',
    'places_region',
    'places_locality',
    'places_country',
  ]);
});

test('tiles stop at city level', () => {
  assert.equal(CITY_ZOOM, 10);
  assert.equal(basemapStyle('dark', origin).sources.protomaps.maxzoom, CITY_ZOOM);
});

test('the two themes differ only in colour', () => {
  const light = basemapStyle('light', origin);
  const dark = basemapStyle('dark', origin);
  assert.deepEqual(
    light.layers.map((l) => l.id),
    dark.layers.map((l) => l.id),
  );
  assert.notEqual(
    light.layers[0].paint['background-color'],
    dark.layers[0].paint['background-color'],
  );
});
