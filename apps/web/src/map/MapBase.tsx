import { useEffect, useRef, useState } from 'react';
import {
  Map as MapLibre,
  NavigationControl,
  AttributionControl,
  addProtocol,
  setWorkerUrl,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { t } from '../i18n';
import { ATTRIBUTION, basemapStyle, CITY_ZOOM, currentMapTheme, MIN_ZOOM } from './style';

/**
 * The map base (ADR-0038), loaded only on map screens. MapLibre draws our own
 * OpenStreetMap tiles; no request leaves our origins. The camera stops at city level.
 */

// The worker ships as a hashed file from our origin (CSP worker-src 'self').
setWorkerUrl(workerUrl);
// One PMTiles reader for the page: tiles are byte ranges of one file.
const pmtiles = new Protocol();
addProtocol('pmtiles', pmtiles.tile);

export type MapProblem = 'webgl' | 'tiles';

export interface MapBaseProps {
  label: string;
  center?: [number, number];
  zoom?: number;
  onProblem?: (problem: MapProblem) => void;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function MapBase({
  label,
  center = [127.0, 37.5],
  zoom = 3,
  onProblem,
}: MapBaseProps) {
  const box = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<MapProblem | null>(null);

  useEffect(() => {
    const container = box.current;
    if (!container) return;
    const report = (p: MapProblem) => {
      setProblem(p);
      onProblem?.(p);
    };
    let map: MapLibre;
    try {
      map = new MapLibre({
        container,
        style: basemapStyle(currentMapTheme(), window.location.origin),
        center,
        zoom,
        minZoom: MIN_ZOOM,
        maxZoom: CITY_ZOOM,
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false,
        attributionControl: false,
        fadeDuration: reducedMotion() ? 0 : 300,
        localIdeographFontFamily: "'Noto Sans KR Variable', sans-serif",
        locale: {
          // MapLibre's canvas is the map region; it carries the screen's label.
          'Map.Title': label,
          'NavigationControl.ZoomIn': t('map.zoomIn'),
          'NavigationControl.ZoomOut': t('map.zoomOut'),
          'AttributionControl.ToggleAttribution': t('map.attribution'),
        },
      });
    } catch {
      // No WebGL (old device, blocked GPU): the page still offers the list.
      report('webgl');
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    // OSM attribution stays visible even before (or without) the tile file (ODbL).
    map.addControl(
      new AttributionControl({ compact: false, customAttribution: ATTRIBUTION }),
      'bottom-right',
    );
    let tilesFailed = false;
    map.on('error', (e) => {
      // A source error carries the source id; the tile file is the only source.
      if ('sourceId' in e && e.sourceId === 'protomaps' && !tilesFailed) {
        tilesFailed = true;
        report('tiles');
      }
    });

    // Follow the page theme: the OS setting or a forced <html data-theme>.
    let theme = currentMapTheme();
    const restyle = () => {
      const next = currentMapTheme();
      if (next === theme) return;
      theme = next;
      map.setStyle(basemapStyle(next, window.location.origin));
    };
    const media = window.matchMedia('(prefers-color-scheme: light)');
    media.addEventListener('change', restyle);
    const observer = new MutationObserver(restyle);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      media.removeEventListener('change', restyle);
      observer.disconnect();
      map.remove();
    };
    // The camera is set once; later prop changes do not move a map the user is panning.
  }, []);

  return (
    <div className="map-base">
      <div ref={box} className="map-canvas" />
      {problem ? (
        <p role="status" className="map-problem">
          {t(problem === 'webgl' ? 'map.noWebgl' : 'map.noTiles')}
        </p>
      ) : null}
    </div>
  );
}
