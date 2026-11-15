"""
CSV export generators for Prometheus 375.
Implements:
1. GET /export.csv: Raw cell-level hotspot data with grid_resolution_deg
2. GET /export_analytics.csv: Aggregated monthly burning series + climatological anomalies
"""

import io
import os
import re
from typing import Any, Dict, List, Optional

import duckdb
from fastapi import HTTPException, Response
import numpy as np
import pandas as pd

try:
    from backend.spatial import (
        build_spatial_filter,
        get_effective_envelope,
        init_duckdb_spatial,
        validate_area_limit,
    )
except ImportError:
    from spatial import (
        build_spatial_filter,
        get_effective_envelope,
        init_duckdb_spatial,
        validate_area_limit,
    )


def validate_month_param(param_name: str, value: Optional[str]) -> None:
    """Validate optional YYYY-MM query parameter."""
    if value and not re.match(r"^\d{4}-(0[1-9]|1[0-2])$", value):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {param_name} format '{value}'. Expected YYYY-MM (e.g. 2024-11).",
        )


def export_csv(
    start: Optional[str] = None,
    end: Optional[str] = None,
    bbox: Optional[str] = None,
    polygon: Optional[str] = None,
    parquet_path: Optional[str] = None,
) -> Response:
    """
    Export cell-level harmonized hotspot data as CSV.
    Columns: cell_id, lat, lon, month, harmonized_count, source, uncertainty, grid_resolution_deg
    """
    validate_month_param("start", start)
    validate_month_param("end", end)

    # Enforce maximum 200 sq deg area envelope safety limit
    envelope = get_effective_envelope(bbox=bbox, polygon=polygon)
    if envelope:
        validate_area_limit(envelope)

    if not parquet_path or not os.path.exists(parquet_path):
        raise HTTPException(
            status_code=503,
            detail=f"Harmonized parquet data not found at '{parquet_path}'",
        )

    conditions: List[str] = []
    params: List = [parquet_path]

    if start:
        conditions.append("month >= ?")
        params.append(start)
    if end:
        conditions.append("month <= ?")
        params.append(end)

    spatial_conditions, spatial_params, requires_spatial = build_spatial_filter(
        bbox=bbox,
        polygon=polygon,
    )
    if spatial_conditions:
        conditions.extend(spatial_conditions)
        params.extend(spatial_params)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    query = f"""
        SELECT 
            cell_id,
            ROUND(lat, 4) AS lat,
            ROUND(lon, 4) AS lon,
            month,
            ROUND(harmonized_count, 2) AS harmonized_count,
            source,
            ROUND(uncertainty, 2) AS uncertainty,
            0.25 AS grid_resolution_deg
        FROM read_parquet(?)
        {where_clause}
        ORDER BY month ASC, lat ASC, lon ASC
    """

    con = duckdb.connect(database=":memory:", read_only=False)
    try:
        if requires_spatial:
            init_duckdb_spatial(con)
        df = con.execute(query, params).df()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export query failed: {e}")
    finally:
        con.close()

    if df.empty:
        csv_content = "cell_id,lat,lon,month,harmonized_count,source,uncertainty,grid_resolution_deg\n"
    else:
        csv_content = df.to_csv(index=False)

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="prometheus375_export.csv"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


def export_analytics_csv(
    start: Optional[str] = None,
    end: Optional[str] = None,
    bbox: Optional[str] = None,
    polygon: Optional[str] = None,
    parquet_path: Optional[str] = None,
) -> Response:
    """
    Export monthly aggregated burning series and climatological anomalies as CSV.
    Columns: month, count, source, uncertainty_lo, uncertainty_hi, median, p10, p90, z_score, percentile
    """
    validate_month_param("start", start)
    validate_month_param("end", end)

    if not parquet_path or not os.path.exists(parquet_path):
        raise HTTPException(
            status_code=503,
            detail=f"Harmonized parquet data not found at '{parquet_path}'",
        )

    # 1. Spatially aggregate all available months for consistent climatological baseline calculation
    spatial_conditions, spatial_params, requires_spatial = build_spatial_filter(
        bbox=bbox,
        polygon=polygon,
    )
    where_spatial = f"WHERE {' AND '.join(spatial_conditions)}" if spatial_conditions else ""

    query = f"""
        SELECT 
            month,
            ROUND(SUM(harmonized_count), 2) AS count,
            COALESCE(MAX(source), 'viirs') AS source,
            ROUND(GREATEST(0.0, SUM(harmonized_count) - SUM(uncertainty)), 2) AS uncertainty_lo,
            ROUND(SUM(harmonized_count) + SUM(uncertainty), 2) AS uncertainty_hi
        FROM read_parquet(?)
        {where_spatial}
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
        raise HTTPException(status_code=500, detail=f"Analytics query failed: {e}")
    finally:
        con.close()

    if df.empty:
        empty_csv = "month,count,source,uncertainty_lo,uncertainty_hi,median,p10,p90,z_score,percentile\n"
        return Response(
            content=empty_csv,
            media_type="text/csv",
            headers={
                "Content-Disposition": 'attachment; filename="prometheus375_analytics.csv"',
                "Access-Control-Expose-Headers": "Content-Disposition",
            },
        )

    month_counts = dict(zip(df["month"], df["count"]))
    analytics_rows: List[Dict[str, Any]] = []

    for _, row in df.iterrows():
        m = str(row["month"])
        c = float(row["count"])
        source = str(row["source"])
        u_lo = float(row["uncertainty_lo"])
        u_hi = float(row["uncertainty_hi"])
        target_mm = m.split("-")[1]

        # Prior years for the same calendar month
        prior = [val for ym, val in month_counts.items() if ym.endswith(f"-{target_mm}") and ym < m]
        if not prior:
            prior = [val for ym, val in month_counts.items() if ym.endswith(f"-{target_mm}") and ym != m]
        if not prior:
            prior = [c]

        prior_arr = np.array(prior, dtype=float)
        median = float(np.median(prior_arr))
        p10 = float(np.percentile(prior_arr, 10))
        p90 = float(np.percentile(prior_arr, 90))
        mean_val = float(np.mean(prior_arr))
        std_val = float(np.std(prior_arr, ddof=1)) if len(prior) > 1 else 0.0

        z_score = float((c - mean_val) / max(std_val, 1.0))
        if len(prior) >= 10 and std_val >= 1:
            z_score = max(-10.0, min(10.0, z_score))
            z_score_val = round(z_score, 2)
        else:
            z_score_val = None
        percentile = float(
            np.mean(prior_arr < c) * 100.0 + np.mean(prior_arr == c) * 50.0
        )

        analytics_rows.append({
            "month": m,
            "count": round(c, 2),
            "source": source,
            "uncertainty_lo": round(u_lo, 2),
            "uncertainty_hi": round(u_hi, 2),
            "median": round(median, 2),
            "p10": round(p10, 2),
            "p90": round(p90, 2),
            "z_score": z_score_val,
            "percentile": round(percentile, 1),
        })

    out_df = pd.DataFrame(analytics_rows)

    # Filter by start/end if specified
    if start:
        out_df = out_df[out_df["month"] >= start]
    if end:
        out_df = out_df[out_df["month"] <= end]

    csv_content = out_df.to_csv(index=False)

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="prometheus375_analytics.csv"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )
