import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { TerraDraw, TerraDrawPolygonMode, TerraDrawRectangleMode, TerraDrawSelectMode, TerraDrawRenderMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { useSelection, RECORD_START } from '../../hooks/useSelection';
import { useLive } from '../../hooks/useLive';
import { RegionPresets } from './RegionPresets';
import { LiveHotspotsLayer } from './LiveHotspotsLayer';
import { SampleDataBadge } from '../ui/SampleDataBadge';
import { LoadingState } from '../ui/States';
import { boundsDeg2, geometryBounds, MAX_AREA_DEG2, CALIFORNIA_DEG2 } from '../../lib/area';
import type { Polygon, MultiPolygon } from 'geojson';
import type { AreaSelection } from '../../api/types';
import { COVERAGE_REGIONS, coverageGeoJSON } from '../../lib/coverage';

// Esri World Dark Gray Canvas — no API key needed. (Carto's dark_all raster
// tiles now return an "API KEY REQUIRED" placeholder for every request.)
const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'esri-dark': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 16,
      attribution: 'Powered by Esri &middot; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'esri-dark-tiles',
      type: 'raster',
      source: 'esri-dark',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

// [[-180,-85],[180,85]], but with longitudes nudged inside ±180: MapLibre 5 wraps
// exactly 180° to 0°, sees a zero-width lng range, constrains to zoom = Infinity and
// crashes in _calcMatrices. (Its own renderWorldCopies:false default uses 180 - 1e-10.)
const ALMOST_180 = 180 - 1e-9;
const WORLD_BOUNDS: maplibregl.LngLatBoundsLike = [[-ALMOST_180, -85], [ALMOST_180, 85]];
const FIT_PADDING = 40;
const FIT_DURATION = 1200;

/** Zoom at which the 512px-tile world spans the container width exactly. */
function worldFitZoom(width: number): number {
  return width > 0 ? Math.max(0, Math.log2(width / 512)) : 0;
}

/**
 * fitBounds(bbox, {padding: 40, duration: 1200}). MapLibre's fitBounds silently
 * does nothing (console warning only) when the padding doesn't fit the canvas,
 * e.g. a narrow/mobile panel — so check with cameraForBounds and retry with
 * no padding instead of leaving the camera where it was.
 */
function flyToBounds(map: maplibregl.Map, bounds: maplibregl.LngLatBoundsLike) {
  const opts = { duration: FIT_DURATION, easing: (t: number) => t * (2 - t) };
  const padding = map.cameraForBounds(bounds, { padding: FIT_PADDING }) ? FIT_PADDING : 0;
  map.fitBounds(bounds, { ...opts, padding });
}

/** [[minLon,minLat],[maxLon,maxLat]] for a preset/bbox or a drawn polygon. */
function areaBounds(area: AreaSelection): maplibregl.LngLatBoundsLike | null {
  if (area.bbox && area.bbox.length === 4) {
    // Coerce + order-normalise so a stringy or swapped bbox can't break the fit
    const [a, b, c, d] = area.bbox.map(Number);
    if (![a, b, c, d].every(Number.isFinite)) return null;
    return [[Math.min(a, c), Math.min(b, d)], [Math.max(a, c), Math.max(b, d)]];
  }
  if (area.polygon) {
    const rings = area.polygon.type === 'Polygon' ? [area.polygon.coordinates] : area.polygon.coordinates;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of rings) {
      for (const ring of poly) {
        for (const [x, y] of ring) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
  }
  return null;
}

/** Show `area` as the dashed AOI outline (or clear it with null). */
function setAoiOutline(map: maplibregl.Map, area: AreaSelection | null) {
  const source = map.getSource('aoi-source') as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  let feature: GeoJSON.Feature | null = null;
  if (area?.polygon) {
    feature = { type: 'Feature', geometry: area.polygon, properties: {} };
  } else if (area?.bbox && area.bbox.length === 4) {
    const [minX, minY, maxX, maxY] = area.bbox;
    feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]],
      },
      properties: {},
    };
  }
  source.setData({ type: 'FeatureCollection', features: feature ? [feature] : [] });
}

export const FireMap: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);

  const { area, startMonth, endMonth, dataEnd, setStartMonth, setEndMonth, setPolygon } = useSelection();
  // type="month" falls back to text in some browsers, so also clamp typed values
  const clampToDataEnd = (m: string) => (/^\d{4}-\d{2}$/.test(m) && m > dataEnd ? dataEnd : m);
  // One live fetch shared by the map layer and the side panel (so "retry" refreshes both)
  const live = useLive(7);
  const { data: liveData, isMock: liveIsMock, error: liveError } = live;

  // Read through a ref so the map-init effect never re-runs (re-running it
  // destroys the map and snaps the camera back to the initial India view).
  const setPolygonRef = useRef(setPolygon);
  setPolygonRef.current = setPolygon;
  const areaRef = useRef(area);
  areaRef.current = area;

  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [showLive, setShowLive] = useState<boolean>(true);
  // Flips true once the 'load' handler has added the AOI + live sources/layers
  const [mapLoaded, setMapLoaded] = useState<boolean>(false);
  // Why the last drawn shape was rejected (too large), shown under the draw button
  const [drawNote, setDrawNote] = useState<string | null>(null);

  const isLive404 = liveError?.status === 404;

  // Screen readers otherwise hear just "Map". MapLibre's keyboard handler already
  // supports arrows (pan) and +/− (zoom) once the canvas has focus.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const name = area.name ? area.name.replace(/\s*\(.*?\)\s*/g, '') : 'the selected area';
    mapRef.current
      .getCanvas()
      .setAttribute('aria-label', `Map of ${name} with live fire hotspots from the last 7 days. Arrow keys pan, plus and minus zoom.`);
  }, [area.name, mapLoaded]);

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const initialCenter: [number, number] = [75.5, 30.0];

    const container = mapContainerRef.current;
    const map = new maplibregl.Map({
      container,
      style: MAP_STYLE,
      center: initialCenter,
      zoom: 5.2,
      fadeDuration: 300,
      // Exactly one copy of the world, never panned/zoomed past its edges
      renderWorldCopies: false,
      maxBounds: WORLD_BOUNDS,
      minZoom: worldFitZoom(container.clientWidth),
    });

    // Keep minZoom = "world fills the panel width" as the panel resizes (window resize,
    // mobile rotation, grid stacking under 900px).
    map.on('resize', () => {
      map.setMinZoom(worldFitZoom(map.getContainer().clientWidth));
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      // 0. Faint outline of the 5 regions with archive data, under everything else
      map.addSource('coverage-source', { type: 'geojson', data: coverageGeoJSON() });
      map.addLayer({
        id: 'coverage-outline',
        type: 'line',
        source: 'coverage-source',
        paint: {
          'line-color': '#9aa3ad',
          'line-width': 1,
          'line-opacity': 0.35,
          'line-dasharray': [1, 2],
        },
      });
      // Style has no glyphs, so labels are small HTML markers (top-left corner, inside)
      COVERAGE_REGIONS.forEach(({ name, bbox: [w, , , n] }) => {
        const el = document.createElement('div');
        el.textContent = 'Data coverage';
        el.title = `Data coverage: ${name}`;
        el.setAttribute('aria-hidden', 'true');
        el.style.cssText =
          'font: 500 10px/1 var(--font-mono, monospace); letter-spacing: .04em; color: rgba(190,198,206,.55);' +
          'padding: 3px 4px; pointer-events: none; white-space: nowrap;';
        new maplibregl.Marker({ element: el, anchor: 'top-left' }).setLngLat([w, n]).addTo(map);
      });

      // 1. Source and layers for Area of Interest outline
      map.addSource('aoi-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      map.addLayer({
        id: 'aoi-fill',
        type: 'fill',
        source: 'aoi-source',
        paint: {
          'fill-color': '#b89c6b',
          'fill-opacity': 0.08,
          'fill-opacity-transition': { duration: 300 },
        },
      });

      map.addLayer({
        id: 'aoi-outline',
        type: 'line',
        source: 'aoi-source',
        paint: {
          'line-color': '#b89c6b',
          'line-width': 2,
          'line-dasharray': [3, 2],
          'line-opacity': 0.9,
          'line-opacity-transition': { duration: 300 },
        },
      });

      // 2. Source and layers for Live VIIRS hotspots
      map.addSource('live-hotspots', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      map.addLayer({
        id: 'live-hotspots-glow',
        type: 'circle',
        source: 'live-hotspots',
        paint: {
          'circle-radius': 8,
          'circle-color': '#e6863f',
          'circle-opacity': 0.22,
          'circle-blur': 0.5,
          'circle-opacity-transition': { duration: 250 },
        },
      });

      map.addLayer({
        id: 'live-hotspots-core',
        type: 'circle',
        source: 'live-hotspots',
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['get', 'frp'],
            0, 3.5,
            20, 5.5,
            50, 7.5,
          ],
          'circle-color': [
            'match',
            ['get', 'satellite'],
            'NOAA-20', '#e6863f',
            'NOAA-21', '#c45a1e',
            '#f4b37a',
          ],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': 0.8,
          'circle-opacity': 0.92,
        },
      });

      // Popup on click
      map.on('click', 'live-hotspots-core', (e) => {
        if (!e.features || !e.features[0]) return;
        const feat = e.features[0];
        const geom = feat.geometry as GeoJSON.Point;
        const props = feat.properties as {
          satellite?: string;
          confidence?: string;
          frp?: number;
          acq_date?: string;
          acq_time?: string;
        };

        const html = `
          <div style="font-family: var(--font-sans); padding: 4px; font-size: 12px; color: #141625;">
            <strong>${props.satellite || 'VIIRS'} Detection</strong><br/>
            Date: ${props.acq_date || 'N/A'} ${props.acq_time || ''}<br/>
            FRP: <strong>${props.frp ? props.frp.toFixed(1) + ' MW' : 'N/A'}</strong><br/>
            Confidence: ${props.confidence === 'h' ? 'High' : 'Nominal'}
          </div>
        `;

        new maplibregl.Popup({ closeButton: true, offset: 10, className: 'editorial-tooltip' })
          .setLngLat(geom.coordinates as [number, number])
          .setHTML(html)
          .addTo(map);
      });

      map.on('mouseenter', 'live-hotspots-core', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'live-hotspots-core', () => {
        map.getCanvas().style.cursor = '';
      });

      // 3. Initialize Terra Draw
      try {
        const adapter = new TerraDrawMapLibreGLAdapter({ map });
        const td = new TerraDraw({
          adapter,
          modes: [
            new TerraDrawRenderMode({ modeName: 'render', styles: {} }),
            new TerraDrawPolygonMode({
              modeName: 'polygon',
              styles: {
                fillColor: '#b89c6b',
                fillOpacity: 0.15,
                outlineColor: '#e6863f',
                outlineWidth: 2,
              },
            }),
            new TerraDrawRectangleMode({
              modeName: 'rectangle',
              styles: {
                fillColor: '#b89c6b',
                fillOpacity: 0.15,
                outlineColor: '#e6863f',
                outlineWidth: 2,
              },
            }),
            new TerraDrawSelectMode({ modeName: 'select' }),
          ],
        });

        td.start();

        td.on('finish', (finishedId) => {
          const snapshot = td.getSnapshot();
          if (snapshot && snapshot.length > 0) {
            const latestFeature = snapshot.find((f) => f.id === finishedId) ?? snapshot[snapshot.length - 1];
            // Keep only the latest drawn area: drop every earlier polygon
            const staleIds = snapshot
              .filter((f) => f.id !== latestFeature.id && f.id != null)
              .map((f) => f.id as NonNullable<typeof f.id>);
            if (staleIds.length > 0) td.removeFeatures(staleIds);
            if (
              latestFeature.geometry.type === 'Polygon' ||
              (latestFeature.geometry.type as string) === 'MultiPolygon'
            ) {
              const geom = latestFeature.geometry as Polygon | MultiPolygon;
              const size = boundsDeg2(geometryBounds(geom));
              setIsDrawing(false);
              td.setMode('render');
              if (size > MAX_AREA_DEG2) {
                // Too big to query safely (a ~6,600 deg² area took the backend down): drop it
                td.clear();
                setAoiOutline(map, areaRef.current); // previous area stays active → show it again
                setDrawNote(
                  `That area is about ${Math.round(size / CALIFORNIA_DEG2)}× the size of California, ` +
                    `too large to query. Draw an area up to about twice California's size.`
                );
                return;
              }
              setDrawNote(null);
              setPolygonRef.current(geom, 'Custom Drawn Boundary');
            }
          }
        });

        drawRef.current = td;
      } catch (err) {
        console.warn('Terra Draw init note:', err);
      }
    });

    // Registered after the setup 'load' handler, so the sources exist when this runs
    map.on('load', () => setMapLoaded(true));

    mapRef.current = map;

    return () => {
      if (drawRef.current) {
        try { drawRef.current.stop(); } catch { /* ignore */ }
      }
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  // Update AOI boundary & fly smoothly to target region
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Camera first and unconditionally — it must not depend on the AOI source existing.
    const bounds = areaBounds(area);
    // Resize first (the container can change size after layout/reveal animations),
    // then fit on the next frame so the camera uses the real canvas dimensions.
    const raf = bounds
      ? requestAnimationFrame(() => {
          map.resize();
          flyToBounds(map, bounds);
        })
      : 0;

    // A preset/bbox replaced the drawn area → wipe the drawing (and any half-drawn polygon)
    const td = drawRef.current;
    if (td && area.type !== 'polygon') {
      try {
        td.clear();
        td.setMode('render');
      } catch { /* draw not started yet */ }
      setIsDrawing(false);
    }

    setAoiOutline(map, area);

    return () => cancelAnimationFrame(raf);
  }, [area, mapLoaded]);

  // Update live hotspots visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const shouldShow = showLive && !isLive404;

    const source = map.getSource('live-hotspots') as maplibregl.GeoJSONSource | undefined;
    if (source && liveData) {
      source.setData(shouldShow ? liveData : { type: 'FeatureCollection', features: [] });
    }

    if (map.getLayer('live-hotspots-glow')) {
      map.setLayoutProperty('live-hotspots-glow', 'visibility', shouldShow ? 'visible' : 'none');
    }
    if (map.getLayer('live-hotspots-core')) {
      map.setLayoutProperty('live-hotspots-core', 'visibility', shouldShow ? 'visible' : 'none');
    }
  }, [liveData, showLive, isLive404, mapLoaded]);

  const toggleDrawMode = useCallback(() => {
    if (!drawRef.current) return;
    if (isDrawing) {
      drawRef.current.setMode('render');
      setIsDrawing(false);
      // Cancelled without finishing → bring the current area's outline back
      if (mapRef.current) setAoiOutline(mapRef.current, area);
    } else {
      // Starting a new drawing: hide the current preset/area outline
      if (mapRef.current) setAoiOutline(mapRef.current, null);
      drawRef.current.setMode('polygon');
      setIsDrawing(true);
      setDrawNote(null);
    }
  }, [isDrawing, area]);

  return (
    <div id="explore" className="section" style={{ padding: 'var(--space-2xl) 0' }}>
      <div
        className="explore-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '280px 1fr',
          gap: 'var(--space-lg)',
          alignItems: 'stretch',
        }}
      >
        {/* Left Side: Editorial Area & Date Selection Panel */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            backgroundColor: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-md)',
            gap: 'var(--space-md)',
          }}
        >
          <div>
            <RegionPresets />

            {/* Date Range Inputs */}
            <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--color-border-subtle)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label htmlFor="start-month-input" className="label-mono" style={{ fontSize: '0.6875rem', display: 'block', marginBottom: '4px' }}>
                    From
                  </label>
                  <input
                    id="start-month-input"
                    type="month"
                    min={RECORD_START}
                    max={dataEnd}
                    value={startMonth}
                    onChange={(e) => setStartMonth(clampToDataEnd(e.target.value))}
                    placeholder="2001-01"
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--color-bg-base)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '7px 8px',
                      color: 'var(--color-text-primary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.8125rem',
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="end-month-input" className="label-mono" style={{ fontSize: '0.6875rem', display: 'block', marginBottom: '4px' }}>
                    To
                  </label>
                  <input
                    id="end-month-input"
                    type="month"
                    min={RECORD_START}
                    max={dataEnd}
                    value={endMonth}
                    onChange={(e) => setEndMonth(clampToDataEnd(e.target.value))}
                    placeholder={dataEnd}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--color-bg-base)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '7px 8px',
                      color: 'var(--color-text-primary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.8125rem',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Action: Draw your own area & Live layer control */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              type="button"
              onClick={toggleDrawMode}
              style={{
                width: '100%',
                padding: '9px 12px',
                backgroundColor: isDrawing ? 'var(--color-gold)' : 'transparent',
                color: isDrawing ? '#10121d' : 'var(--color-text-secondary)',
                border: '1px dashed var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8125rem',
                fontFamily: 'var(--font-sans)',
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 200ms ease-out',
              }}
            >
              {isDrawing ? 'Click points on map to close' : 'Draw your own area'}
            </button>

            {drawNote && (
              <div
                role="alert"
                style={{
                  fontSize: '0.75rem',
                  lineHeight: 1.4,
                  color: 'var(--color-gold)',
                  border: '1px solid rgba(184, 156, 107, 0.4)',
                  backgroundColor: 'rgba(184, 156, 107, 0.08)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 10px',
                }}
              >
                {drawNote}
              </div>
            )}

            <LiveHotspotsLayer live={live} showLive={showLive} onToggleLive={setShowLive} />
          </div>
        </div>

        {/* Right Side: Interactive Map */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div
            style={{
              position: 'relative',
              minHeight: '480px',
              backgroundColor: 'var(--color-bg-base)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              flex: 1,
            }}
          >
            <div
              ref={mapContainerRef}
              style={{ width: '100%', height: '100%', minHeight: '480px' }}
              aria-label="Geographic Fire Activity Map"
            />

            {/* Until the style + first tiles are in, the canvas is an empty dark box */}
            {!mapLoaded && (
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <LoadingState height="100%" message="Loading map…" subtext="Fetching basemap tiles" />
              </div>
            )}

            {/* Bottom Info Pill */}
            <div
              style={{
                position: 'absolute',
                bottom: '16px',
                left: '16px',
                backgroundColor: 'rgba(16, 18, 30, 0.92)',
                backdropFilter: 'blur(8px)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                zIndex: 10,
                pointerEvents: 'none',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: isLive404 ? 'var(--color-muted)' : 'var(--color-fire-4)',
                  boxShadow: isLive404 ? 'none' : '0 0 6px var(--color-fire-4)',
                }}
              />
              <span
                className="label-mono"
                style={{
                  fontSize: '0.6875rem',
                  color: 'var(--color-text-primary)',
                  letterSpacing: '0.04em',
                }}
              >
                {area.name ? area.name.replace(/\s*\(.*?\)\s*/g, '') : 'Selected Area'} • NOAA-20/21 • {isLive404 ? 'NRT Inactive' : liveError ? 'Live feed unavailable' : 'Last 7 days'}
              </span>
              {liveIsMock && !isLive404 && <SampleDataBadge style={{ marginLeft: '4px' }} />}
            </div>
          </div>

          {/* Note under map when Live fire data is 404 / unavailable */}
          {isLive404 && (
            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-text-tertiary)',
                padding: '4px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span style={{ color: 'var(--color-gold)' }}>Note:</span> Live fire telemetry (/live) isn't available yet on the connected server.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
