"""
Anomaly and onset metrics computation for Prometheus 375.
Implements dual-mode logic per AGENTS.md and DECISIONS.md (Sat 14 Nov):
1. Punjab/Haryana preset: precomputed lookup from data/processed/anomaly_india.parquet
   (area_id='pb_hr', including day-matched 2026-11) + onset_india.parquet
   (onset_shift_days with fallback to onset_shift_min_days).
2. Other presets (brazil, greece, australia, california): compute anomaly stats on the fly
   from harmonized.parquet and join onset_shift_days from onset_<region>.parquet.
3. Custom drawn polygons: compute on the fly from harmonized.parquet via DuckDB spatial filter
   with onset_shift_days = None.
"""

import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import duckdb
from fastapi import HTTPException
import numpy as np

try:
    from backend.spatial import build_spatial_filter, init_duckdb_spatial, parse_bbox, parse_polygon
except ImportError:
    from spatial import build_spatial_filter, init_duckdb_spatial, parse_bbox, parse_polygon

# Punjab / Haryana preset bounding box per DECISIONS.md (pb_hr)
PB_HR_BBOX = (73.5, 27.5, 77.5, 32.5)

# Presets mapping per DECISIONS.md and main.py
PRESETS_MAP: Dict[str, Dict[str, Any]] = {
    "punjab_haryana": {
        "region": "india",
        "area_id": "pb_hr",
        "bbox": (73.5, 27.5, 77.5, 32.5),
    },
    "brazil_pantanal": {
        "region": "brazil",
        "area_id": "brazil",
        "bbox": (-60.0, -22.0, -55.0, -16.0),
    },
    "greece": {
        "region": "greece",
        "area_id": "greece",
        "bbox": (20.0, 36.0, 27.0, 42.0),
    },
    "australia_nsw": {
        "region": "australia",
        "area_id": "australia",
        "bbox": (149.0, -37.5, 153.5, -31.5),
    },
    "california": {
        "region": "california",
        "area_id": "california",
        "bbox": (-124.5, 32.5, -114.0, 42.0),
    },
}


def validate_month_format(month: str) -> None:
    """Ensure month is in YYYY-MM format."""
    if not re.match(r"^\d{4}-(0[1-9]|1[0-2])$", month):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid month format '{month}'. Expected YYYY-MM (e.g. 2024-11).",
        )


def match_preset_region(
    bbox: Tuple[float, float, float, float],
    tolerance: float = 0.5,
) -> Optional[Dict[str, Any]]:
    """Match bounding box to one of the predefined presets."""
    for preset_id, info in PRESETS_MAP.items():
        p_bbox = info["bbox"]
        if (
            abs(bbox[0] - p_bbox[0]) <= tolerance
            and abs(bbox[1] - p_bbox[1]) <= tolerance
            and abs(bbox[2] - p_bbox[2]) <= tolerance
            and abs(bbox[3] - p_bbox[3]) <= tolerance
        ):
            return {"preset_id": preset_id, **info}
    return None


def is_pb_hr_preset_match(bbox: Tuple[float, float, float, float], tolerance: float = 0.5) -> bool:
    """Check if a bounding box matches Punjab/Haryana pb_hr preset within tolerance."""
    return (
        abs(bbox[0] - PB_HR_BBOX[0]) <= tolerance
        and abs(bbox[1] - PB_HR_BBOX[1]) <= tolerance
        and abs(bbox[2] - PB_HR_BBOX[2]) <= tolerance
        and abs(bbox[3] - PB_HR_BBOX[3]) <= tolerance
    )


def find_precomputed_file(prefix: str, region: str = "india") -> Optional[Path]:
    """
    Find precomputed parquet file in data/processed, backend/data, or repo data.
    Works seamlessly both in local development and inside Render container deployment.
    """
    backend_data = Path(__file__).resolve().parent / "data"
    repo_root = Path(__file__).resolve().parent.parent

    candidates = [
        # 1. backend/data/ (Render deployment structure)
        backend_data / f"{prefix}_{region}.parquet",
        Path(f"backend/data/{prefix}_{region}.parquet"),
        Path(f"data/{prefix}_{region}.parquet"),

        # 2. repo_root/data/processed/ (standard repo structure)
        repo_root / "data" / "processed" / f"{prefix}_{region}.parquet",
        Path(f"data/processed/{prefix}_{region}.parquet"),
        Path(f"../data/processed/{prefix}_{region}.parquet"),

        # 3. specific pb_hr fallback if files are named pb_hr
        backend_data / f"{prefix}_pb_hr.parquet",
        repo_root / "data" / "processed" / f"{prefix}_pb_hr.parquet",
        Path(f"data/processed/{prefix}_pb_hr.parquet"),
        Path(f"../data/processed/{prefix}_pb_hr.parquet"),
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


def get_preset_onset_shift(region: str, area_id: str, year: int) -> Optional[float]:
    """
    Look up onset_shift_days from onset_<region>.parquet.
    Per DECISIONS.md, if onset has not been reached yet (e.g. Punjab 2026),
    falls back to onset_shift_min_days.
    """
    onset_path = find_precomputed_file("onset", region=region)
    if not onset_path:
        return None

    con = duckdb.connect(database=":memory:", read_only=False)
    try:
        q_onset = """
            SELECT onset_shift_days, onset_shift_min_days
            FROM read_parquet(?)
            WHERE area_id = ? AND season_year = ?
            LIMIT 1
        """
        res_o = con.execute(q_onset, [str(onset_path), area_id, year]).fetchone()
        if res_o:
            shift, min_shift = res_o
            if shift is not None and not (isinstance(shift, float) and np.isnan(shift)):
                return round(float(shift), 1)
            elif min_shift is not None and not (isinstance(min_shift, float) and np.isnan(min_shift)):
                return round(float(min_shift), 1)
    except Exception:
        pass
    finally:
        con.close()
    return None


def read_precomputed_anomaly(
    month: str,
    area_id: str = "pb_hr",
    region: str = "india",
    anomaly_path: Optional[Path] = None,
    onset_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    """
    Read precomputed anomaly and onset metrics from parquet if available.
    Supports day-matched 2026-11 baseline and onset fallback per DECISIONS.md.
    """
    if not anomaly_path:
        anomaly_path = find_precomputed_file("anomaly", region=region)
    if not anomaly_path:
        return None

    con = duckdb.connect(database=":memory:", read_only=False)
    try:
        q_anomaly = """
            SELECT current, median, p10, p90, z_score, percentile
            FROM read_parquet(?)
            WHERE area_id = ? AND month = ?
            LIMIT 1
        """
        res_a = con.execute(q_anomaly, [str(anomaly_path), area_id, month]).fetchone()
        if not res_a:
            return None

        current, median, p10, p90, z_score, percentile = res_a

        year = int(month.split("-")[0])
        onset_shift_days = get_preset_onset_shift(region=region, area_id=area_id, year=year)

        return {
            "current": round(float(current), 2),
            "median": round(float(median), 2),
            "p10": round(float(p10), 2),
            "p90": round(float(p90), 2),
            "z_score": round(float(z_score), 2),
            "percentile": round(float(percentile), 1),
            "onset_shift_days": onset_shift_days,
        }
    except Exception:
        return None
    finally:
        con.close()


def compute_on_the_fly_anomaly(
    month: str,
    bbox: Optional[str] = None,
    polygon: Optional[str] = None,
    parquet_path: Optional[str] = None,
    preset_info: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    On-the-fly spatial aggregation over harmonized parquet for custom polygons,
    arbitrary bboxes, or non-India presets.
    Computes current count and climatological baseline across all matching calendar months.
    If preset_info is provided, joins onset_shift_days from onset_<region>.parquet.
    """
    if not parquet_path or not os.path.exists(parquet_path):
        candidates = [
            "data/processed/harmonized.parquet",
            "../data/processed/harmonized.parquet",
            str(Path(__file__).resolve().parent.parent / "data" / "processed" / "harmonized.parquet"),
            str(Path(__file__).resolve().parent / "data" / "harmonized.parquet"),
            "backend/data/harmonized.parquet",
            "../data-sample/harmonized_sample.parquet",
            "data-sample/harmonized_sample.parquet",
        ]
        for c in candidates:
            if os.path.exists(c):
                parquet_path = c
                break

    if not parquet_path or not os.path.exists(parquet_path):
        raise HTTPException(
            status_code=503,
            detail="Harmonized parquet data not available for anomaly calculation.",
        )

    # If neither bbox nor polygon is specified, default to Punjab/Haryana bbox
    effective_bbox = bbox
    effective_polygon = polygon
    if not effective_bbox and not effective_polygon:
        effective_bbox = f"{PB_HR_BBOX[0]},{PB_HR_BBOX[1]},{PB_HR_BBOX[2]},{PB_HR_BBOX[3]}"

    spatial_conditions, spatial_params, requires_spatial = build_spatial_filter(
        bbox=effective_bbox,
        polygon=effective_polygon,
    )

    where_clause = f"WHERE {' AND '.join(spatial_conditions)}" if spatial_conditions else ""
    query = f"""
        SELECT month, ROUND(SUM(harmonized_count), 2) AS count
        FROM read_parquet(?)
        {where_clause}
        GROUP BY month
        ORDER BY month ASC
    """

    con = duckdb.connect(database=":memory:", read_only=False)
    try:
        if requires_spatial:
            init_duckdb_spatial(con)
        params = [parquet_path] + spatial_params
        df = con.execute(query, params).df()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DuckDB spatial aggregation failed: {e}")
    finally:
        con.close()

    month_counts: Dict[str, float] = {}
    if not df.empty:
        month_counts = dict(zip(df["month"], df["count"]))

    current = float(month_counts.get(month, 0.0))
    target_mm = month.split("-")[1]

    # Prior years for the same calendar month
    prior_counts = [
        c for m, c in month_counts.items()
        if m.endswith(f"-{target_mm}") and m < month
    ]

    # If no prior years available (e.g. first year in dataset), compare against other years
    if not prior_counts:
        prior_counts = [
            c for m, c in month_counts.items()
            if m.endswith(f"-{target_mm}") and m != month
        ]

    # If still empty (only 1 data point for this month), use current as baseline
    if not prior_counts:
        prior_counts = [current]

    prior_arr = np.array(prior_counts, dtype=float)
    median = float(np.median(prior_arr))
    p10 = float(np.percentile(prior_arr, 10))
    p90 = float(np.percentile(prior_arr, 90))
    mean_val = float(np.mean(prior_arr))
    std_val = float(np.std(prior_arr, ddof=1)) if len(prior_counts) > 1 else 0.0

    z_score = float((current - mean_val) / max(std_val, 1.0))
    # Clamp extreme z-scores in very sparse areas
    z_score = max(-10.0, min(10.0, z_score))

    percentile = float(
        np.mean(prior_arr < current) * 100.0 + np.mean(prior_arr == current) * 50.0
    )

    # Join onset_shift_days if this query matches a known preset region
    onset_shift_days: Optional[float] = None
    year = int(month.split("-")[0])
    if preset_info:
        onset_shift_days = get_preset_onset_shift(
            region=preset_info["region"],
            area_id=preset_info["area_id"],
            year=year,
        )

    return {
        "current": round(current, 2),
        "median": round(median, 2),
        "p10": round(p10, 2),
        "p90": round(p90, 2),
        "z_score": round(z_score, 2),
        "percentile": round(percentile, 1),
        "onset_shift_days": onset_shift_days,
    }


def get_anomaly_metrics(
    month: str,
    bbox: Optional[str] = None,
    polygon: Optional[str] = None,
    parquet_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Main entry point for GET /anomaly:
    1. Validates month format YYYY-MM.
    2. Identifies if the query matches a preset region.
       - Punjab/Haryana (pb_hr): Reads precomputed anomaly_india.parquet + onset_india.parquet.
       - Other presets (brazil, greece, australia, california): Computes anomaly stats on the fly
         from harmonized.parquet and joins onset_shift_days from onset_<region>.parquet.
       - Custom drawn polygons / custom bboxes: Computes on the fly from harmonized.parquet
         via DuckDB spatial filter with onset_shift_days = None.
    """
    validate_month_format(month)

    # Check for preset match
    matched_preset: Optional[Dict[str, Any]] = None

    if bbox:
        parsed_b = parse_bbox(bbox)
        matched_preset = match_preset_region(parsed_b)
    elif polygon:
        try:
            _, poly_bounds = parse_polygon(polygon)
            matched_preset = match_preset_region(poly_bounds)
        except Exception:
            matched_preset = None
    else:
        # Default to Punjab/Haryana preset
        matched_preset = {"preset_id": "punjab_haryana", **PRESETS_MAP["punjab_haryana"]}

    # Case 1: Punjab / Haryana preset (pb_hr) -> Precomputed table read
    if matched_preset and matched_preset["area_id"] == "pb_hr":
        precomputed = read_precomputed_anomaly(
            month=month,
            area_id="pb_hr",
            region="india",
        )
        if precomputed:
            return precomputed

    # Case 2: Other preset or custom polygon -> On-the-fly calculation
    return compute_on_the_fly_anomaly(
        month=month,
        bbox=bbox,
        polygon=polygon,
        parquet_path=parquet_path,
        preset_info=matched_preset,
    )
