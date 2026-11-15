"""
Spatial filtering helper module for Prometheus 375.
Handles bounding box (bbox) and GeoJSON polygon filtering using DuckDB spatial extension.
Enforces coordinate validity, boundary limits, and the 200 sq deg maximum envelope constraint.
"""

import json
import logging
import math
import os
import time
from functools import lru_cache
from typing import Any, List, Optional, Tuple
import duckdb
import numpy as np
from fastapi import HTTPException
import shapely
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


# ---------------------------------------------------------------------------
# Grid-cell index (no DuckDB spatial extension needed)
#
# harmonized.parquet is a regular 0.25° grid: every cell centroid sits exactly at
# k*0.25 + 0.125 in both lat and lon, one cell_id per (lat, lon). So "which cells
# are inside this polygon" is answered once per polygon in Python (shapely,
# vectorised) on at most a few thousand candidate centroids, and the parquet scan
# only matches an integer cell key. This replaces the per-row
# ST_Within(ST_Point(lon, lat), ST_GeomFromGeoJSON(?)) which (a) needed LOAD spatial
# on every request (0.3–2 s) and (b) evaluated the polygon per row (up to ~6 s).
# Same semantics as ST_Within: centroids strictly inside the polygon.
# ---------------------------------------------------------------------------

GRID_DEG = 0.25
_HALF = GRID_DEG / 2

# lat*4 = k + 0.5 exactly for every centroid, so floor() gives the integer index k.
CELL_KEY_SQL = "((CAST(floor(lat * 4) AS BIGINT) + 400) * 2000 + CAST(floor(lon * 4) AS BIGINT) + 1000)"

timing_logger = logging.getLogger("prometheus375.timing")
if os.getenv("TIMING_LOGS", "1") != "0" and not timing_logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("[timing] %(message)s"))
    timing_logger.addHandler(_h)
    timing_logger.setLevel(logging.INFO)
    timing_logger.propagate = False


def _cell_keys_np(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    return (np.floor(lat * 4).astype(np.int64) + 400) * 2000 + np.floor(lon * 4).astype(np.int64) + 1000


@lru_cache(maxsize=4)
def _existing_cells(parquet_path: str, mtime: float) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(sorted cell keys, lat, lon) of every cell present in the parquet. ~30k rows, cached per file version."""
    t0 = time.perf_counter()
    con = duckdb.connect(database=":memory:")
    try:
        arr = con.execute(
            "SELECT DISTINCT lat, lon FROM read_parquet(?)", [parquet_path]
        ).fetchnumpy()
    finally:
        con.close()
    lat = np.asarray(arr["lat"], dtype=float)
    lon = np.asarray(arr["lon"], dtype=float)
    keys = _cell_keys_np(lat, lon)
    order = np.argsort(keys)
    timing_logger.info("cell index built: %d cells in %.0f ms", len(keys), (time.perf_counter() - t0) * 1000)
    return keys[order], lat[order], lon[order]


def existing_cells(parquet_path: str) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    return _existing_cells(parquet_path, os.path.getmtime(parquet_path))


@lru_cache(maxsize=128)
def _polygon_cell_keys(geom_json_str: str, bounds: Tuple[float, float, float, float]) -> np.ndarray:
    """Integer keys of all 0.25° grid centroids strictly inside the polygon (within `bounds`)."""
    min_lon, min_lat, max_lon, max_lat = bounds
    lon_c = np.arange(math.ceil((min_lon - _HALF) / GRID_DEG), math.floor((max_lon - _HALF) / GRID_DEG) + 1) * GRID_DEG + _HALF
    lat_c = np.arange(math.ceil((min_lat - _HALF) / GRID_DEG), math.floor((max_lat - _HALF) / GRID_DEG) + 1) * GRID_DEG + _HALF
    if lon_c.size == 0 or lat_c.size == 0:
        return np.empty(0, dtype=np.int64)
    glon, glat = np.meshgrid(lon_c, lat_c)
    glon, glat = glon.ravel(), glat.ravel()
    geom = sg.shape(json.loads(geom_json_str))
    inside = shapely.contains_xy(geom, glon, glat)
    return np.sort(_cell_keys_np(glat[inside], glon[inside]))


def _resolve_bounds(
    bbox: Optional[str], polygon: Optional[str]
) -> Tuple[Optional[str], Optional[Tuple[float, float, float, float]]]:
    """Returns (polygon geojson or None, effective envelope or None)."""
    bbox_bounds = parse_bbox(bbox) if bbox else None
    if not polygon:
        return None, bbox_bounds
    geom_json_str, poly_bounds = parse_polygon(polygon)
    if bbox_bounds:
        b = (
            max(bbox_bounds[0], poly_bounds[0]),
            max(bbox_bounds[1], poly_bounds[1]),
            min(bbox_bounds[2], poly_bounds[2]),
            min(bbox_bounds[3], poly_bounds[3]),
        )
        if b[0] > b[2] or b[1] > b[3]:
            raise HTTPException(
                status_code=400,
                detail="Provided bbox and polygon do not intersect.",
            )
        return geom_json_str, b
    return geom_json_str, tuple(poly_bounds)


def selected_cell_keys(
    bbox: Optional[str] = None,
    polygon: Optional[str] = None,
    parquet_path: Optional[str] = None,
) -> Optional[np.ndarray]:
    """
    Keys of the grid cells selected by bbox/polygon. When parquet_path is given,
    only cells that actually exist in the data are returned (empty => outside coverage).
    Returns None when there is nothing to resolve (no spatial filter, or a plain bbox
    without parquet_path, where the SQL range filter is already exact).
    """
    t0 = time.perf_counter()
    geom_json_str, bounds = _resolve_bounds(bbox, polygon)
    t_parse = time.perf_counter()
    if bounds is None:
        return None

    if geom_json_str is not None:
        keys = _polygon_cell_keys(geom_json_str, tuple(bounds))
        t_pip = time.perf_counter()
        if parquet_path:
            keys = np.intersect1d(keys, existing_cells(parquet_path)[0], assume_unique=True)
    else:
        t_pip = t_parse
        if not parquet_path:
            return None
        ckeys, clat, clon = existing_cells(parquet_path)
        m = (clon >= bounds[0]) & (clon <= bounds[2]) & (clat >= bounds[1]) & (clat <= bounds[3])
        keys = ckeys[m]
    t_end = time.perf_counter()
    timing_logger.info(
        "cells: parse %.1f ms | point-in-polygon %.1f ms | match existing %.1f ms | %d cells",
        (t_parse - t0) * 1000, (t_pip - t_parse) * 1000, (t_end - t_pip) * 1000, len(keys),
    )
    return keys


def area_has_data(
    parquet_path: str,
    bbox: Optional[str] = None,
    polygon: Optional[str] = None,
) -> bool:
    """False when the bbox/polygon contains zero harmonized grid cells (outside data coverage)."""
    if not bbox and not polygon:
        return True
    keys = selected_cell_keys(bbox=bbox, polygon=polygon, parquet_path=parquet_path)
    return keys is None or len(keys) > 0


def build_spatial_filter(
    bbox: Optional[str] = None,
    polygon: Optional[str] = None,
    parquet_path: Optional[str] = None,
) -> Tuple[List[str], List[Any], bool]:
    """
    Construct SQL WHERE clauses and parameters for spatial filtering on cell centroids.
    Performs bbox prefiltering for high performance; polygons are resolved to a list of
    grid-cell keys in Python (see the grid-cell index above), so the DuckDB spatial
    extension is no longer needed (requires_spatial is always False; kept for callers).
    Returns:
        (conditions: list[str], params: list[Any], requires_spatial_ext: bool)
    """
    conditions: List[str] = []
    params: List[Any] = []

    geom_json_str, bounds = _resolve_bounds(bbox, polygon)
    if bounds is None:
        return conditions, params, False

    min_lon, min_lat, max_lon, max_lat = bounds
    # 1. Bounding box prefilter (parquet row-group pruning)
    conditions.append("lon >= ? AND lon <= ? AND lat >= ? AND lat <= ?")
    params.extend([min_lon, max_lon, min_lat, max_lat])

    if geom_json_str is not None:
        # 2. Exact polygon containment on cell centroids, via precomputed cell keys
        keys = selected_cell_keys(bbox=bbox, polygon=polygon, parquet_path=parquet_path)
        if keys is None or len(keys) == 0:
            conditions.append("FALSE")
        else:
            conditions.append(f"list_contains(?::BIGINT[], {CELL_KEY_SQL})")
            params.append([int(k) for k in keys])

    return conditions, params, False
