"""
NASA FIRMS NRT active-fire hotspot fetcher with 30-minute in-memory TTL cache,
bounded memory footprint, failure cooldown, and static snapshot fallback for live demo resilience.
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
    from backend.spatial import get_effective_envelope, parse_bbox, parse_polygon, validate_area_limit
except ImportError:
    from spatial import get_effective_envelope, parse_bbox, parse_polygon, validate_area_limit

load_dotenv()
logger = logging.getLogger("firms_live")

# Default demo region: Punjab / Haryana (18.6 sq deg, well under 200 sq deg limit)
DEFAULT_BBOX = (73.8, 27.6, 77.6, 32.5)

# Only active VIIRS NRT instruments as of Nov 2026
SOURCES = ["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"]

# Caching and failure resilience configuration
CACHE_TTL_SECONDS = 30 * 60       # 30 minutes for successful responses
MAX_CACHE_SIZE = 100              # Maximum cached envelopes
FAILURE_COOLDOWN_SECONDS = 60.0   # 60-second cooldown after upstream failures

# 30-minute in-memory cache: (rounded_bbox, days) -> (timestamp, features)
_cache: Dict[Tuple[float, float, float, float, int], Tuple[float, List[Dict[str, Any]]]] = {}
_last_failure_time: float = 0.0


def _prune_cache(now: float) -> None:
    """Evict expired entries and enforce MAX_CACHE_SIZE using LRU/FIFO."""
    global _cache
    # 1. Remove expired entries
    expired_keys = [k for k, (t, _) in _cache.items() if now - t >= CACHE_TTL_SECONDS]
    for k in expired_keys:
        del _cache[k]

    # 2. Enforce capacity limit
    if len(_cache) > MAX_CACHE_SIZE:
        sorted_keys = sorted(_cache.keys(), key=lambda k: _cache[k][0])
        excess = len(_cache) - MAX_CACHE_SIZE
        for k in sorted_keys[:excess]:
            del _cache[k]


def is_in_failure_cooldown(now: float) -> bool:
    """Check if upstream FIRMS is currently in failure cooldown."""
    global _last_failure_time
    return (now - _last_failure_time) < FAILURE_COOLDOWN_SECONDS


def record_failure(now: float) -> None:
    """Record an upstream failure timestamp to activate cooldown."""
    global _last_failure_time
    _last_failure_time = now


def reset_failure_cooldown() -> None:
    """Reset failure cooldown after successful upstream response."""
    global _last_failure_time
    _last_failure_time = 0.0


def clear_cache() -> None:
    """Helper to clear in-memory cache (used primarily for unit testing)."""
    global _cache, _last_failure_time
    _cache.clear()
    _last_failure_time = 0.0


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
    """
    Fetch and parse CSV for a single FIRMS VIIRS source.
    Ensures MAP_KEY is never leaked in exceptions or log messages.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    firms_days = max(1, min(days, 5))
    bbox_str = f"{min_lon},{min_lat},{max_lon},{max_lat}"
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{map_key}/{source}/{bbox_str}/{firms_days}"

    with httpx.Client(timeout=10.0) as client:
        try:
            resp = client.get(url)
        except Exception as exc:
            sanitized_exc = str(exc).replace(map_key, "[REDACTED]")
            raise RuntimeError(f"FIRMS connection failed: {sanitized_exc}") from None

        if resp.status_code != 200:
            sanitized_body = resp.text.strip().replace(map_key, "[REDACTED]")
            raise RuntimeError(f"FIRMS API HTTP {resp.status_code}: {sanitized_body}")
        return parse_firms_csv(resp.text, default_source=source)


def fetch_live_hotspots(
    bbox: Tuple[float, float, float, float],
    days: int,
) -> Tuple[List[Dict[str, Any]], str]:
    """
    Fetch live VIIRS NRT hotspots with 30-min TTL caching, failure cooldown, and snapshot fallback.
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

    # 1. Prune expired entries
    _prune_cache(now)

    # 2. Check in-memory cache hit
    if cache_key in _cache:
        cached_time, cached_features = _cache[cache_key]
        if now - cached_time < CACHE_TTL_SECONDS:
            return cached_features, "cache"

    # 3. Check upstream failure cooldown (avoid hammering failing upstream)
    if is_in_failure_cooldown(now):
        logger.info(
            f"FIRMS upstream in failure cooldown (< {FAILURE_COOLDOWN_SECONDS:.0f}s); serving snapshot fallback"
        )
        return filter_features_by_bbox(load_fallback_features(), bbox), "snapshot_fallback"

    # 4. Check API key
    map_key = get_map_key()
    if not map_key:
        logger.info("No FIRMS_MAP_KEY configured, serving snapshot fallback")
        return filter_features_by_bbox(load_fallback_features(), bbox), "snapshot_fallback"

    # 5. Query FIRMS API for NOAA-20 and NOAA-21
    try:
        combined_features: List[Dict[str, Any]] = []
        for source in SOURCES:
            source_features = fetch_firms_source(map_key, source, bbox, days)
            combined_features.extend(source_features)

        # Successful fetch: reset cooldown and store in cache
        reset_failure_cooldown()
        _cache[cache_key] = (now, combined_features)
        _prune_cache(now)
        return combined_features, "live"

    except Exception as e:
        record_failure(now)
        err_msg = str(e).replace(map_key, "[REDACTED]")
        logger.warning(
            f"FIRMS live fetch failed ({err_msg}); entering {FAILURE_COOLDOWN_SECONDS:.0f}s cooldown and using snapshot fallback"
        )
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
    Determines query envelope, validates the 200 sq deg area safety limit,
    fetches/caches/falls back, filters by polygon if provided, and returns GeoJSON FeatureCollection.
    """
    # 1. Compute effective query envelope and enforce 200 sq deg limit
    envelope = get_effective_envelope(bbox=bbox, polygon=polygon)
    if envelope:
        validate_area_limit(envelope)
        target_bbox = envelope
    else:
        target_bbox = DEFAULT_BBOX

    parsed_poly_geom_str: Optional[str] = None
    if polygon:
        parsed_poly_geom_str, _ = parse_polygon(polygon)

    # 2. Fetch candidate features (live, cache, or fallback)
    features, source_type = fetch_live_hotspots(target_bbox, days)

    # 3. If polygon was passed, apply exact polygon point containment
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
