"""
Anomaly and onset metrics computation for Prometheus 375.
Implements dual-mode logic:
1. Preset precomputed lookup from data/processed/anomaly_* and onset_* (if available)
2. On-the-fly spatial aggregation and climatological baseline computation via DuckDB
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


def validate_month_format(month: str) -> None:
    """Ensure month is in YYYY-MM format."""
    if not re.match(r"^\d{4}-(0[1-9]|1[0-2])$", month):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid month format '{month}'. Expected YYYY-MM (e.g. 2024-11).",
        )


def is_pb_hr_preset_match(bbox: Tuple[float, float, float, float], tolerance: float = 0.25) -> bool:
    """Check if a bounding box matches Punjab/Haryana pb_hr preset within tolerance."""
    return (
        abs(bbox[0] - PB_HR_BBOX[0]) <= tolerance
        and abs(bbox[1] - PB_HR_BBOX[1]) <= tolerance
        and abs(bbox[2] - PB_HR_BBOX[2]) <= tolerance
        and abs(bbox[3] - PB_HR_BBOX[3]) <= tolerance
    )


def find_precomputed_file(prefix: str, region: str = "india") -> Optional[Path]:
    """Find precomputed parquet file in data/processed or backend/data."""
    candidates = [
        Path(f"data/processed/{prefix}_{region}.parquet"),
        Path(f"../data/processed/{prefix}_{region}.parquet"),
        Path(f"data/processed/{prefix}_pb_hr.parquet"),
        Path(f"../data/processed/{prefix}_pb_hr.parquet"),
        Path(f"backend/data/{prefix}_{region}.parquet"),
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


def read_precomputed_anomaly(
    month: str,
    area_id: str = "pb_hr",
    anomaly_path: Optional[Path] = None,
    onset_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    """Read precomputed anomaly and onset metrics from parquet if available."""
    if not anomaly_path:
        anomaly_path = find_precomputed_file("anomaly", region="india")
    if not anomaly_path:
        return None

    con = duckdb.connect(database=":memory:", read_only=True)
    try:
        # 1. Fetch anomaly row
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

        # 2. Fetch onset shift days if onset file exists
        onset_shift_days: Optional[float] = None
        if not onset_path:
            onset_path = find_precomputed_file("onset", region="india")

        if onset_path:
            year = int(month.split("-")[0])
            q_onset = """
                SELECT onset_shift_days, onset_shift_min_days
                FROM read_parquet(?)
                WHERE area_id = ? AND season_year = ?
                LIMIT 1
            """
            res_o = con.execute(q_onset, [str(onset_path), area_id, year]).fetchone()
            if res_o:
                shift, min_shift = res_o
                if shift is not None:
                    onset_shift_days = float(shift)
                elif min_shift is not None:
                    onset_shift_days = float(min_shift)

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
) -> Dict[str, Any]:
    """
    On-the-fly spatial aggregation over harmonized parquet for custom polygons or arbitrary bboxes.
    Computes current count and climatological baseline across all matching calendar months.
    """
    if not parquet_path or not os.path.exists(parquet_path):
        candidates = [
            "data/processed/harmonized.parquet",
            "../data/processed/harmonized.parquet",
            str(Path(__file__).resolve().parent.parent / "data" / "processed" / "harmonized.parquet"),
            "data/processed/harmonized_india.parquet",
            "../data/processed/harmonized_india.parquet",
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
            detail="Harmonized parquet data not available for on-the-fly anomaly calculation.",
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

    # If no prior years available (e.g., first year in dataset), compare against other years
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
    percentile = float(
        np.mean(prior_arr < current) * 100.0 + np.mean(prior_arr == current) * 50.0
    )

    # Check if this matches pb_hr preset to potentially join onset_shift_days
    onset_shift_days: Optional[float] = None
    if effective_bbox:
        try:
            parsed_b = parse_bbox(effective_bbox)
            if is_pb_hr_preset_match(parsed_b):
                onset_path = find_precomputed_file("onset", region="india")
                if onset_path:
                    year = int(month.split("-")[0])
                    con_o = duckdb.connect(database=":memory:", read_only=True)
                    try:
                        q_o = """
                            SELECT onset_shift_days, onset_shift_min_days
                            FROM read_parquet(?)
                            WHERE area_id = 'pb_hr' AND season_year = ?
                            LIMIT 1
                        """
                        res_o = con_o.execute(q_o, [str(onset_path), year]).fetchone()
                        if res_o:
                            s, ms = res_o
                            onset_shift_days = float(s) if s is not None else (float(ms) if ms is not None else None)
                    except Exception:
                        pass
                    finally:
                        con_o.close()
        except Exception:
            pass

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
    2. Checks if the query matches a precomputed preset (e.g. pb_hr).
    3. Reads precomputed metrics if available, else computes on-the-fly.
    """
    validate_month_format(month)

    # Check if query matches Punjab/Haryana preset bbox
    matched_pb_hr = False
    if bbox:
        parsed_b = parse_bbox(bbox)
        if is_pb_hr_preset_match(parsed_b):
            matched_pb_hr = True
    elif polygon:
        _, poly_bounds = parse_polygon(polygon)
        if is_pb_hr_preset_match(poly_bounds):
            matched_pb_hr = True
    else:
        # Default is Punjab/Haryana
        matched_pb_hr = True

    # Attempt Mode A: Precomputed table read if matched
    if matched_pb_hr:
        precomputed = read_precomputed_anomaly(month, area_id="pb_hr")
        if precomputed:
            return precomputed

    # Mode B: On-the-fly calculation
    return compute_on_the_fly_anomaly(
        month=month,
        bbox=bbox,
        polygon=polygon,
        parquet_path=parquet_path,
    )
