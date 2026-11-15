"""
Spatial filtering helper module for Prometheus 375.
Handles bounding box (bbox) and GeoJSON polygon filtering using DuckDB spatial extension.
Enforces coordinate validity, boundary limits, and the 200 sq deg maximum envelope constraint.
"""

import json
import math
from typing import Any, List, Optional, Tuple
import duckdb
from fastapi import HTTPException
import shapely.geometry as sg
import shapely.ops as ops

_SPATIAL_INITIALIZED = False

# Maximum query envelope area in square degrees per project safety limit (DECISIONS.md)
MAX_ENVELOPE_AREA_SQ_DEG = 200.0


def init_duckdb_spatial(con: duckdb.DuckDBPyConnection) -> None:
    """
    Ensure DuckDB's spatial extension is installed and loaded.
    Uses LOAD first (fast from cache), falling back to INSTALL + LOAD.
    """
    global _SPATIAL_INITIALIZED
    try:
        con.execute("LOAD spatial;")
        _SPATIAL_INITIALIZED = True
    except Exception:
        try:
            con.execute("INSTALL spatial; LOAD spatial;")
            _SPATIAL_INITIALIZED = True
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to load DuckDB spatial extension: {e}",
            )


def parse_bbox(bbox_str: str) -> Tuple[float, float, float, float]:
    """
    Parse and strictly validate a bounding box string format: minLon,minLat,maxLon,maxLat.
    Returns (min_lon, min_lat, max_lon, max_lat).
    Raises HTTPException(400) on malformed, non-finite, inverted, or out-of-range coordinates.
    """
    try:
        parts = [float(p.strip()) for p in bbox_str.split(",")]
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid bbox parameter format. Expected minLon,minLat,maxLon,maxLat: {e}",
        )

    if len(parts) != 4:
        raise HTTPException(
            status_code=400,
            detail=f"bbox must contain exactly 4 comma-separated numbers (got {len(parts)}).",
        )

    min_lon, min_lat, max_lon, max_lat = parts

    # 1. Non-finite coordinate rejection (NaN, Inf, -Inf)
    if not all(math.isfinite(c) for c in (min_lon, min_lat, max_lon, max_lat)):
        raise HTTPException(
            status_code=400,
            detail="bbox coordinates must be finite real numbers (NaN and Inf are not allowed).",
        )

    # 2. Geographic range checks
    if not (-90.0 <= min_lat <= 90.0 and -90.0 <= max_lat <= 90.0):
        raise HTTPException(
            status_code=400,
            detail=f"Latitude out of valid range [-90, 90]: minLat={min_lat}, maxLat={max_lat}.",
        )

    if not (-180.0 <= min_lon <= 180.0 and -180.0 <= max_lon <= 180.0):
        raise HTTPException(
            status_code=400,
            detail=f"Longitude out of valid range [-180, 180]: minLon={min_lon}, maxLon={max_lon}.",
        )

    # 3. Inverted coordinate checks
    if min_lon > max_lon:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid bbox: minLon ({min_lon}) cannot be greater than maxLon ({max_lon}).",
        )
    if min_lat > max_lat:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid bbox: minLat ({min_lat}) cannot be greater than maxLat ({max_lat}).",
        )

    return min_lon, min_lat, max_lon, max_lat


def parse_polygon(polygon_str: str) -> Tuple[str, Tuple[float, float, float, float]]:
    """
    Parse and validate a GeoJSON string representing a Polygon, MultiPolygon,
    Feature, or FeatureCollection.
    Returns:
        (geom_geojson_str, (min_lon, min_lat, max_lon, max_lat))
    Raises HTTPException(400) on malformed, non-finite, out-of-range, or invalid GeoJSON.
    """
    try:
        data = json.loads(polygon_str)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid polygon GeoJSON string: {e}",
        )

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=400,
            detail="GeoJSON must be a JSON object.",
        )

    gtype = data.get("type")
    if not gtype:
        raise HTTPException(
            status_code=400,
            detail="GeoJSON object missing 'type' field.",
        )

    try:
        if gtype == "FeatureCollection":
            features = data.get("features", [])
            if not features:
                raise ValueError("FeatureCollection has no features.")
            geoms = []
            for f in features:
                if isinstance(f, dict) and f.get("geometry"):
                    geoms.append(sg.shape(f["geometry"]))
            if not geoms:
                raise ValueError("No valid geometries found in FeatureCollection.")
            geom = ops.unary_union(geoms) if len(geoms) > 1 else geoms[0]
        elif gtype == "Feature":
            geometry_data = data.get("geometry")
            if not geometry_data:
                raise ValueError("Feature object missing 'geometry' field.")
            geom = sg.shape(geometry_data)
        elif gtype in ("Polygon", "MultiPolygon", "GeometryCollection"):
            geom = sg.shape(data)
        else:
            raise ValueError(f"Unsupported GeoJSON geometry type '{gtype}'. Expected Polygon or MultiPolygon.")

        if not geom.is_valid:
            geom = geom.buffer(0)
            if not geom.is_valid or geom.is_empty:
                raise ValueError("Geometry is self-intersecting or invalid.")

        bounds = geom.bounds  # (minx, miny, maxx, maxy) -> (min_lon, min_lat, max_lon, max_lat)
        min_lon, min_lat, max_lon, max_lat = bounds

        # Coordinate finiteness check
        if not all(math.isfinite(c) for c in (min_lon, min_lat, max_lon, max_lat)):
            raise ValueError("Polygon coordinates must be finite real numbers.")

        # Geographic range check
        if not (-180.0 <= min_lon <= 180.0 and -180.0 <= max_lon <= 180.0 and
                -90.0 <= min_lat <= 90.0 and -90.0 <= max_lat <= 90.0):
            raise ValueError(f"Polygon coordinates outside valid geographic range [-180..180, -90..90]: {bounds}")

        geom_json_str = json.dumps(sg.mapping(geom))
        return geom_json_str, bounds
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid GeoJSON polygon: {e}",
        )


def calculate_envelope_area(bbox: Tuple[float, float, float, float]) -> float:
    """Calculate bounding box envelope area in square degrees: (maxLon - minLon) * (maxLat - minLat)."""
    min_lon, min_lat, max_lon, max_lat = bbox
    return (max_lon - min_lon) * (max_lat - min_lat)


def validate_area_limit(
    envelope: Tuple[float, float, float, float],
    max_area: float = MAX_ENVELOPE_AREA_SQ_DEG,
) -> None:
    """
    Enforce backend spatial safety limit on query envelopes.
    Raises HTTPException(400) if the envelope area exceeds max_area.
    """
    area = calculate_envelope_area(envelope)
    if area > max_area + 1e-6:
        raise HTTPException(
            status_code=400,
            detail=f"Requested query envelope area ({area:.1f} sq deg) exceeds maximum allowed limit of {max_area:.0f} sq deg.",
        )


def get_effective_envelope(
    bbox: Optional[str] = None,
    polygon: Optional[str] = None,
) -> Optional[Tuple[float, float, float, float]]:
    """
    Calculate the effective bounding box query envelope from bbox, polygon, or both.
    If both are provided, computes their intersection envelope.
    Returns:
        (min_lon, min_lat, max_lon, max_lat) or None if neither provided.
    Raises HTTPException(400) on malformed coordinates or non-intersecting envelopes.
    """
    bbox_bounds: Optional[Tuple[float, float, float, float]] = None
    poly_bounds: Optional[Tuple[float, float, float, float]] = None

    if bbox:
        bbox_bounds = parse_bbox(bbox)

    if polygon:
        _, poly_bounds = parse_polygon(polygon)

    if bbox_bounds and poly_bounds:
        eff_min_lon = max(bbox_bounds[0], poly_bounds[0])
        eff_min_lat = max(bbox_bounds[1], poly_bounds[1])
        eff_max_lon = min(bbox_bounds[2], poly_bounds[2])
        eff_max_lat = min(bbox_bounds[3], poly_bounds[3])

        if eff_min_lon > eff_max_lon or eff_min_lat > eff_max_lat:
            raise HTTPException(
                status_code=400,
                detail="Provided bbox and polygon do not intersect.",
            )
        return (eff_min_lon, eff_min_lat, eff_max_lon, eff_max_lat)

    return bbox_bounds or poly_bounds


def build_spatial_filter(
    bbox: Optional[str] = None,
    polygon: Optional[str] = None,
) -> Tuple[List[str], List[Any], bool]:
    """
    Construct SQL WHERE clauses and parameters for spatial filtering on cell centroids.
    Performs bbox prefiltering for high performance.
    Returns:
        (conditions: list[str], params: list[Any], requires_spatial_ext: bool)
    """
    conditions: List[str] = []
    params: List[Any] = []
    requires_spatial = False

    bbox_bounds: Optional[Tuple[float, float, float, float]] = None

    if bbox:
        bbox_bounds = parse_bbox(bbox)

    if polygon:
        geom_json_str, poly_bounds = parse_polygon(polygon)
        requires_spatial = True

        # Intersect bounds if bbox was also provided
        if bbox_bounds:
            min_lon = max(bbox_bounds[0], poly_bounds[0])
            min_lat = max(bbox_bounds[1], poly_bounds[1])
            max_lon = min(bbox_bounds[2], poly_bounds[2])
            max_lat = min(bbox_bounds[3], poly_bounds[3])
            if min_lon > max_lon or min_lat > max_lat:
                raise HTTPException(
                    status_code=400,
                    detail="Provided bbox and polygon do not intersect.",
                )
        else:
            min_lon, min_lat, max_lon, max_lat = poly_bounds

        # 1. Bounding box prefilter for indexing/pruning
        conditions.append("lon >= ? AND lon <= ? AND lat >= ? AND lat <= ?")
        params.extend([min_lon, max_lon, min_lat, max_lat])

        # 2. Exact polygon containment on cell centroids
        conditions.append("ST_Within(ST_Point(lon, lat), ST_GeomFromGeoJSON(?))")
        params.append(geom_json_str)

    elif bbox_bounds:
        min_lon, min_lat, max_lon, max_lat = bbox_bounds
        conditions.append("lon >= ? AND lon <= ? AND lat >= ? AND lat <= ?")
        params.extend([min_lon, max_lon, min_lat, max_lat])

    return conditions, params, requires_spatial
