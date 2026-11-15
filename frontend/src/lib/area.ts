import type { Polygon, MultiPolygon } from 'geojson';

/**
 * Largest area (bounding box, in square degrees) we let people query.
 *
 * The largest preset, California, is ~100 deg². A drawn area of ~6,600 deg² took the Render
 * free instance (512 MB) down for about a minute on 2026-11-15, most likely through /live
 * pulling a huge FIRMS download. The hotspot CSV export also grows with area (India-sized ≈ 86 MB,
 * world ≈ 540 MB). Twice California leaves room for every preset and most real questions.
 */
export const MAX_AREA_DEG2 = 200;
export const CALIFORNIA_DEG2 = 100;

export type Bounds = [number, number, number, number];

export function geometryBounds(geom: Polygon | MultiPolygon): Bounds {
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
  const pts = rings.flat();
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function boundsDeg2(b: Bounds): number {
  return Math.abs(b[2] - b[0]) * Math.abs(b[3] - b[1]);
}

export function areaDeg2(area: { bbox?: Bounds; polygon?: Polygon | MultiPolygon }): number {
  if (area.bbox) return boundsDeg2(area.bbox);
  if (area.polygon) return boundsDeg2(geometryBounds(area.polygon));
  return 0;
}
