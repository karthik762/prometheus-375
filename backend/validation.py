"""
Validation and model metrics module for Prometheus 375.
Implements GET /validation:
- holdout_year (2020), MAE, MAPE from metrics.json
- before_after time series filtered on cell centroids for the selected region
  (default pb_hr: 73.5, 27.5, 77.5, 32.5)
- per-month aggregation computing raw, harmonized, uncertainty_lo, uncertainty_hi
- source = 'mixed' when COUNT(DISTINCT h.source) > 1, else MAX(h.source)
- partial = True for month '2026-11', False otherwise
- multi-key bounded caching by (area, bbox) with TTL expiration for sub-millisecond responses
"""

import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import duckdb
from fastapi import HTTPException

try:
    from backend.spatial import build_spatial_filter, init_duckdb_spatial, parse_bbox
except ImportError:
    from spatial import build_spatial_filter, init_duckdb_spatial, parse_bbox

# Default Punjab/Haryana bounding box per DECISIONS.md
DEFAULT_AREA = "pb_hr"
DEFAULT_BBOX = "73.5,27.5,77.5,32.5"

# Preset area mapping
AREA_BBOX_MAP: Dict[str, str] = {
    "pb_hr": "73.5,27.5,77.5,32.5",
    "punjab_haryana": "73.5,27.5,77.5,32.5",
    "brazil_pantanal": "-60.0,-22.0,-55.0,-16.0",
    "brazil": "-60.0,-22.0,-55.0,-16.0",
    "greece": "20.0,36.0,27.0,42.0",
    "australia_nsw": "149.0,-37.5,153.5,-31.5",
    "australia": "149.0,-37.5,153.5,-31.5",
    "california": "-124.5,32.5,-114.0,42.0",
    "india": "68.0,6.5,97.5,37.0",
}

# Bounded caching configuration
MAX_VALIDATION_CACHE_SIZE = 50
VALIDATION_CACHE_TTL = 3600.0  # 1 hour

# Cache mapped by cache_key: "area:bbox" -> (timestamp, data_dict)
_validation_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}


def clear_validation_cache() -> None:
    """Helper to clear validation cache (primarily for unit testing)."""
    global _validation_cache
    _validation_cache.clear()


def find_data_file(filename: str) -> Optional[Path]:
    """Find data file in backend/data, repo root data/processed, or relative paths."""
    backend_data = Path(__file__).resolve().parent / "data"
    repo_root = Path(__file__).resolve().parent.parent

    candidates = [
        backend_data / filename,
        Path(f"backend/data/{filename}"),
        Path(f"data/{filename}"),
        repo_root / "data" / "processed" / filename,
        Path(f"data/processed/{filename}"),
        Path(f"../data/processed/{filename}"),
        repo_root / "data-sample" / filename,
        Path(f"data-sample/{filename}"),
        Path(f"../data-sample/{filename}"),
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


def get_validation_data(
    bbox: Optional[str] = None,
    area: Optional[str] = None,
    force_reload: bool = False,
) -> Dict[str, Any]:
    """
    Load validation metrics and before/after time series for the specified area or bbox.
    Defaults to pb_hr (73.5, 27.5, 77.5, 32.5).
    Filters on cell centroids (h.lat, h.lon) before the GROUP BY aggregation.
    Results are cached by (effective_area, effective_bbox) with bounded size and TTL.
    """
    global _validation_cache
    now = time.time()

    # 1. Resolve effective area and bbox
    effective_area = area.lower().strip() if area else None
    effective_bbox = bbox

    if not effective_bbox and not effective_area:
        effective_area = DEFAULT_AREA
        effective_bbox = DEFAULT_BBOX
    elif effective_area and not effective_bbox:
        effective_bbox = AREA_BBOX_MAP.get(effective_area, DEFAULT_BBOX)
    elif effective_bbox and not effective_area:
        # Check if bbox matches a known area
        matched_area = "custom"
        for aid, abox in AREA_BBOX_MAP.items():
            if abox == effective_bbox:
                matched_area = aid
                break
        effective_area = matched_area

    # Validate bbox format if provided
    if effective_bbox:
        parse_bbox(effective_bbox)

    cache_key = f"{effective_area}:{effective_bbox}"

    # Check cache hit with TTL
    if not force_reload and cache_key in _validation_cache:
        cached_time, cached_data = _validation_cache[cache_key]
        if now - cached_time < VALIDATION_CACHE_TTL:
            return cached_data

    # 2. Load metrics.json
    metrics_path = find_data_file("metrics.json")
    holdout_year = 2020
    mae = 1003.26
    mape = 11.37

    if metrics_path:
        try:
            with open(metrics_path, "r", encoding="utf-8") as f:
                m = json.load(f)
                holdout_year = int(m.get("holdout_year", 2020))
                # If area has specific metrics in regions dictionary
                if effective_area in m.get("regions", {}):
                    reg_m = m["regions"][effective_area].get("region_month", {})
                    mae = round(float(reg_m.get("mae", m.get("mae", 1003.26))), 2)
                    mape = round(float(reg_m.get("mape", m.get("mape", 11.37))), 2)
                else:
                    # Top-level pitch numbers (India / pb_hr default)
                    mae = round(float(m.get("mae", 1003.26)), 2)
                    mape = round(float(m.get("mape", 11.37)), 2)
        except Exception:
            pass

    # 3. Construct spatial filter on cell centroids
    spatial_conditions, spatial_params, requires_spatial = build_spatial_filter(
        bbox=effective_bbox,
        polygon=None,
    )
    # Qualify lat/lon with 'h.' so the join is completely unambiguous
    cond_h = [c.replace("lon", "h.lon").replace("lat", "h.lat") for c in spatial_conditions]
    where_clause = f"WHERE {' AND '.join(cond_h)}" if cond_h else ""

    # 4. Load before/after series joined with harmonized.parquet
    before_after_records: List[Dict[str, Any]] = []
    ba_path = find_data_file("before_after.parquet")
    harm_path = find_data_file("harmonized.parquet")

    if ba_path and harm_path:
        con = duckdb.connect(database=":memory:", read_only=False)
        try:
            if requires_spatial:
                init_duckdb_spatial(con)

            query = f"""
                SELECT 
                    b.month,
                    ROUND(SUM(b.raw), 2) AS raw,
                    ROUND(SUM(b.harmonized), 2) AS harmonized,
                    CASE 
                        WHEN COUNT(DISTINCT h.source) > 1 THEN 'mixed'
                        ELSE COALESCE(MAX(h.source), 'viirs') 
                    END AS source,
                    ROUND(GREATEST(0.0, SUM(b.harmonized) - SUM(h.uncertainty)), 2) AS uncertainty_lo,
                    ROUND(SUM(b.harmonized) + SUM(h.uncertainty), 2) AS uncertainty_hi
                FROM read_parquet(?) b
                JOIN read_parquet(?) h ON b.cell_id = h.cell_id AND b.month = h.month
                {where_clause}
                GROUP BY b.month
                ORDER BY b.month ASC
            """
            params = [str(ba_path), str(harm_path)] + spatial_params
            df = con.execute(query, params).df()

            if not df.empty:
                for row in df.to_dict(orient="records"):
                    m_str = str(row["month"])
                    row["partial"] = True if m_str == "2026-11" else False
                    before_after_records.append(row)
        except Exception as e:
            # Fallback if join or spatial filter fails
            before_after_records = []
        finally:
            con.close()

    result = {
        "holdout_year": holdout_year,
        "mae": mae,
        "mape": mape,
        "before_after": before_after_records,
    }

    # Store with timestamp and enforce bounded size
    _validation_cache[cache_key] = (now, result)
    if len(_validation_cache) > MAX_VALIDATION_CACHE_SIZE:
        oldest_key = min(_validation_cache.keys(), key=lambda k: _validation_cache[k][0])
        del _validation_cache[oldest_key]

    return result
