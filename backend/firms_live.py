"""
NASA FIRMS NRT active-fire hotspot fetcher with 30-minute in-memory TTL cache
and static snapshot fallback for live demo resilience.
Sources: VIIRS_NOAA20_NRT + VIIRS_NOAA21_NRT only (S-NPP ceased Nov 2, 2026).
"""

import csv
import io
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException
import shapely.geometry as sg
from shapely.prepared import prep

try:
    from backend.spatial import parse_bbox, parse_polygon
except ImportError:
    from spatial import parse_bbox, parse_polygon

load_dotenv()
logger = logging.getLogger("firms_live")

# Default demo region: Punjab / Haryana
DEFAULT_BBOX = (73.8, 27.6, 77.6, 32.5)

# Only active VIIRS NRT instruments as of Nov 2026
SOURCES = ["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"]

# 30-minute in-memory cache: (rounded_bbox, days) -> (timestamp, features)
CACHE_TTL_SECONDS = 30 * 60
_cache: Dict[Tuple[float, float, float, float, int], Tuple[float, List[Dict[str, Any]]]] = {}


def get_map_key() -> Optional[str]:
    """Retrieve FIRMS MAP_KEY from environment."""
    key = os.getenv("FIRMS_MAP_KEY", "").strip()
    return key if key and key != "your_key_here" else None


def get_fallback_path() -> Path:
    """Resolve path to live snapshot fallback GeoJSON file."""
    candidates = [
        Path("../data-sample/live_snapshot_fallback.json"),
        Path("data-sample/live_snapshot_fallback.json"),
        Path(__file__).resolve().parent.parent / "data-sample" / "live_snapshot_fallback.json",
    ]
    for c in candidates:
        if c.exists():
            return c
    return candidates[0]


def load_fallback_features() -> List[Dict[str, Any]]:
    """Load pre-packaged static hotspot fallback features."""
    fallback_path = get_fallback_path()
    try:
        with open(fallback_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("features", [])
    except Exception as e:
        logger.warning(f"Could not load fallback snapshot from {fallback_path}: {e}")
        return []


def format_satellite_name(sat: str) -> str:
    """Normalize satellite name string."""
    sat_upper = sat.upper().strip()
    if sat_upper in ("N20", "NOAA20", "NOAA-20"):
        return "NOAA-20"
    if sat_upper in ("N21", "NOAA21", "NOAA-21"):
        return "NOAA-21"
    return sat


def format_confidence(conf: str) -> str:
    """Normalize VIIRS confidence string."""
    c = conf.lower().strip()
    if c in ("h", "high"):
        return "high"
    if c in ("n", "nominal"):
        return "nominal"
    if c in ("l", "low"):
        return "low"
    return conf


def parse_firms_csv(csv_text: str, default_source: str) -> List[Dict[str, Any]]:
    """
    Parse FIRMS Area CSV rows, applying AGENTS.md rules:
    - Keep vegetation fires only (type == 0 if present)
    - Drop low confidence detections (confidence in 'l', 'low')
    """
    features: List[Dict[str, Any]] = []
    reader = csv.DictReader(io.StringIO(csv_text.strip()))

    for row in reader:
        # Check vegetation fire type if present (NRT often omits 'type')
        if "type" in row and row["type"].strip() != "":
            raw_type = row["type"].strip()
            if raw_type not in ("0", 0):
                continue

        # Drop low confidence
        conf_raw = row.get("confidence", "").strip().lower()
        if conf_raw in ("l", "low"):
            continue

        try:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
            frp = float(row.get("frp", 0.0) or 0.0)
            bright_ti4 = float(row.get("bright_ti4", 0.0) or 0.0)
        except (ValueError, KeyError):
            continue

        sat_raw = row.get("satellite") or default_source
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat],
            },
            "properties": {
                "satellite": format_satellite_name(sat_raw),
                "acq_date": row.get("acq_date", ""),
                "acq_time": row.get("acq_time", ""),
                "confidence": format_confidence(conf_raw),
                "frp": round(frp, 2),
                "bright_ti4": round(bright_ti4, 2),
            },
        }
        features.append(feature)

    return features


def fetch_firms_source(
    map_key: str,
    source: str,
    bbox: Tuple[float, float, float, float],
    days: int,
) -> List[Dict[str, Any]]:
    """Fetch and parse CSV for a single FIRMS VIIRS source."""
    min_lon, min_lat, max_lon, max_lat = bbox
    # FIRMS Area API expects [1..5] days for VIIRS area endpoints
    firms_days = max(1, min(days, 5))
    bbox_str = f"{min_lon},{min_lat},{max_lon},{max_lat}"
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{map_key}/{source}/{bbox_str}/{firms_days}"

    with httpx.Client(timeout=10.0) as client:
        resp = client.get(url)
        if resp.status_code != 200:
            raise RuntimeError(f"FIRMS API HTTP {resp.status_code}: {resp.text.strip()}")
        return parse_firms_csv(resp.text, default_source=source)


def fetch_live_hotspots(
    bbox: Tuple[float, float, float, float],
    days: int,
) -> Tuple[List[Dict[str, Any]], str]:
    """
    Fetch live VIIRS NRT hotspots with 30-min TTL caching and snapshot fallback.
    Returns:
        (features, source_type) where source_type is 'live', 'cache', or 'snapshot_fallback'
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    cache_key = (
        round(min_lon, 2),
        round(min_lat, 2),
        round(max_lon, 2),
        round(max_lat, 2),
        days,
    )
    now = time.time()

    # 1. Check in-memory cache
    if cache_key in _cache:
        cached_time, cached_features = _cache[cache_key]
        if now - cached_time < CACHE_TTL_SECONDS:
            return cached_features, "cache"

    # 2. Check API key
    map_key = get_map_key()
    if not map_key:
        logger.info("No FIRMS_MAP_KEY configured, serving snapshot fallback")
        return filter_features_by_bbox(load_fallback_features(), bbox), "snapshot_fallback"

    # 3. Query FIRMS API for NOAA-20 and NOAA-21
    try:
        combined_features: List[Dict[str, Any]] = []
        for source in SOURCES:
            source_features = fetch_firms_source(map_key, source, bbox, days)
            combined_features.extend(source_features)

        # Cache live result
        _cache[cache_key] = (now, combined_features)
        return combined_features, "live"

    except Exception as e:
        logger.warning(f"FIRMS live fetch failed ({e}), using snapshot fallback")
        return filter_features_by_bbox(load_fallback_features(), bbox), "snapshot_fallback"


def filter_features_by_bbox(
    features: List[Dict[str, Any]],
    bbox: Tuple[float, float, float, float],
) -> List[Dict[str, Any]]:
    """Filter point features by bounding box."""
    min_lon, min_lat, max_lon, max_lat = bbox
    filtered = []
    for f in features:
        coords = f.get("geometry", {}).get("coordinates")
        if coords and len(coords) >= 2:
            lon, lat = coords[0], coords[1]
            if min_lon <= lon <= max_lon and min_lat <= lat <= max_lat:
                filtered.append(f)
    return filtered


def filter_features_by_polygon(
    features: List[Dict[str, Any]],
    polygon_geojson_str: str,
) -> List[Dict[str, Any]]:
    """Filter point features to only those inside the exact GeoJSON polygon."""
    geom_dict = json.loads(polygon_geojson_str)
    shapely_geom = sg.shape(geom_dict)
    prep_geom = prep(shapely_geom)

    filtered = []
    for f in features:
        coords = f.get("geometry", {}).get("coordinates")
        if coords and len(coords) >= 2:
            pt = sg.Point(coords[0], coords[1])
            if prep_geom.contains(pt) or prep_geom.intersects(pt):
                filtered.append(f)
    return filtered


def get_live_hotspots_geojson(
    days: int = 7,
    bbox: Optional[str] = None,
    polygon: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Main orchestrator for GET /live:
    Determines query envelope, fetches/caches/falls back, filters by polygon if provided,
    and returns GeoJSON FeatureCollection.
    """
    target_bbox = DEFAULT_BBOX
    parsed_poly_geom_str: Optional[str] = None

    if bbox:
        target_bbox = parse_bbox(bbox)

    if polygon:
        parsed_poly_geom_str, poly_bounds = parse_polygon(polygon)
        if bbox:
            # Intersect bounds
            target_bbox = (
                max(target_bbox[0], poly_bounds[0]),
                max(target_bbox[1], poly_bounds[1]),
                min(target_bbox[2], poly_bounds[2]),
                min(target_bbox[3], poly_bounds[3]),
            )
        else:
            target_bbox = poly_bounds

    # Fetch candidate features (live, cache, or fallback)
    features, source_type = fetch_live_hotspots(target_bbox, days)

    # If polygon was passed, apply exact polygon point containment
    if parsed_poly_geom_str:
        features = filter_features_by_polygon(features, parsed_poly_geom_str)

    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "source": source_type,
            "count": len(features),
            "days_requested": days,
        },
    }
