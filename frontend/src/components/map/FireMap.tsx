import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { TerraDraw, TerraDrawPolygonMode, TerraDrawRectangleMode, TerraDrawSelectMode, TerraDrawRenderMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { useSelection } from '../../hooks/useSelection';
import { useLive } from '../../hooks/useLive';
import { RegionPresets } from './RegionPresets';
import { LiveHotspotsLayer } from './LiveHotspotsLayer';
import { SampleDataBadge } from '../ui/SampleDataBadge';
import type { Polygon, MultiPolygon } from 'geojson';

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

export const FireMap: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);

  const { area, startMonth, endMonth, setStartMonth, setEndMonth, setPolygon } = useSelection();
  const { data: liveData, isMock: liveIsMock, error: liveError } = useLive(7);

  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [showLive, setShowLive] = useState<boolean>(true);
  // Flips true once the 'load' handler has added the AOI + live sources/layers
  const [mapLoaded, setMapLoaded] = useState<boolean>(false);

  const isLive404 = liveError?.status === 404;

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const initialCenter: [number, number] = [75.5, 30.0];

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: initialCenter,
      zoom: 5.2,
      fadeDuration: 300,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
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

        td.on('finish', () => {
          const snapshot = td.getSnapshot();
          if (snapshot && snapshot.length > 0) {
            const latestFeature = snapshot[snapshot.length - 1];
            if (
              latestFeature.geometry.type === 'Polygon' ||
              (latestFeature.geometry.type as string) === 'MultiPolygon'
            ) {
              setPolygon(
                latestFeature.geometry as Polygon | MultiPolygon,
                'Custom Drawn Boundary'
              );
              setIsDrawing(false);
              td.setMode('render');
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
    };
  }, [setPolygon]);

  // Update AOI boundary & fly smoothly to target region
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const source = map.getSource('aoi-source') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    let feature: GeoJSON.Feature | null = null;

    if (area.polygon) {
      feature = {
        type: 'Feature',
        geometry: area.polygon,
        properties: {},
      };
    } else if (area.bbox && area.bbox.length === 4) {
      const [minX, minY, maxX, maxY] = area.bbox;
      feature = {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [minX, minY],
              [maxX, minY],
              [maxX, maxY],
              [minX, maxY],
              [minX, minY],
            ],
          ],
        },
        properties: {},
      };
    }

    source.setData({
      type: 'FeatureCollection',
      features: feature ? [feature] : [],
    });

    if (area.bbox && area.bbox.length === 4) {
      const [minX, minY, maxX, maxY] = area.bbox;
      map.fitBounds(
        [
          [minX, minY],
          [maxX, maxY],
        ],
        {
          padding: 60,
          duration: 520,
          easing: (t) => t * (2 - t),
        }
      );
    }
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
    } else {
      drawRef.current.setMode('polygon');
      setIsDrawing(true);
    }
  }, [isDrawing]);

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
                    type="text"
                    value={startMonth}
                    onChange={(e) => setStartMonth(e.target.value)}
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
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="end-month-input" className="label-mono" style={{ fontSize: '0.6875rem', display: 'block', marginBottom: '4px' }}>
                    To
                  </label>
                  <input
                    id="end-month-input"
                    type="text"
                    value={endMonth}
                    onChange={(e) => setEndMonth(e.target.value)}
                    placeholder="2026-11"
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--color-bg-base)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '7px 8px',
                      color: 'var(--color-text-primary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.8125rem',
                      outline: 'none',
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

            <LiveHotspotsLayer showLive={showLive} onToggleLive={setShowLive} />
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
                {area.name ? area.name.replace(/\s*\(.*?\)\s*/g, '') : 'Selected Area'} • NOAA-20/21 • {isLive404 ? 'NRT Inactive' : 'Last 7 days'}
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
