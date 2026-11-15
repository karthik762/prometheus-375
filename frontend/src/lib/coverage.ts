import type { FeatureCollection, Polygon } from 'geojson';

/**
 * Extents of the 5 regions that have harmonized archive data.
 *
 * HARDCODED: the backend does not expose a region config endpoint and the pipeline
 * has no bbox table (regions = the FIRMS download rectangles). These are the cell
 * extents of backend/data/harmonized_<region>.parquet (min/max centroid ± 0.125°),
 * measured 2026-11-15. If the pipeline re-downloads a region, update these.
 * [minLon, minLat, maxLon, maxLat]
 */
export const COVERAGE_REGIONS: { id: string; name: string; bbox: [number, number, number, number] }[] = [
  { id: 'india', name: 'India', bbox: [68.25, 6.75, 97.5, 35.25] },
  { id: 'brazil', name: 'Brazil', bbox: [-74.0, -33.75, -32.25, 5.25] },
  { id: 'australia', name: 'Australia', bbox: [113.25, -43.75, 153.75, -9.0] },
  // The California download rectangle also covers most of Nevada
  { id: 'california', name: 'California', bbox: [-124.5, 32.5, -114.0, 42.25] },
  { id: 'greece', name: 'Greece', bbox: [19.5, 34.75, 28.25, 41.75] },
];

export const OUTSIDE_COVERAGE_TITLE = 'Outside our data coverage';
export const OUTSIDE_COVERAGE_TEXT =
  'Outside our data coverage — we cover India, Brazil, Australia, California, Greece';

export const coverageGeoJSON = (): FeatureCollection<Polygon> => ({
  type: 'FeatureCollection',
  features: COVERAGE_REGIONS.map(({ id, name, bbox: [w, s, e, n] }) => ({
    type: 'Feature',
    properties: { id, name },
    geometry: {
      type: 'Polygon',
      coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
    },
  })),
});
