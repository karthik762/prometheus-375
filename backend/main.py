import copy
import logging
import os
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional
import duckdb
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger("prometheus375")

try:
    from backend.spatial import area_has_data, build_spatial_filter, init_duckdb_spatial, timing_logger
    from backend.firms_live import get_live_hotspots_geojson
    from backend.anomaly import get_anomaly_metrics, validate_month_format
    from backend.exports import export_csv, export_analytics_csv
    from backend.validation import get_validation_data
except ImportError:
    from spatial import area_has_data, build_spatial_filter, init_duckdb_spatial, timing_logger
    from firms_live import get_live_hotspots_geojson
    from anomaly import get_anomaly_metrics, validate_month_format
    from exports import export_csv, export_analytics_csv
    from validation import get_validation_data

load_dotenv()

app = FastAPI(
    title="Prometheus 375 Backend",
    description="Harmonized MODIS + VIIRS active-fire hotspot calendar API",
    version="0.1.0",
)

# CORS middleware allowing all origins so frontend connects smoothly
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Lets the browser read the /calendar outside-coverage flag
    expose_headers=["X-No-Data"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Global exception handler ensuring unexpected errors return safe 500 responses
    without leaking stack traces, internal paths, or API keys to clients.
    Preserves intentional HTTPException status codes and messages.
    """
    if isinstance(exc, HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=getattr(exc, "headers", None),
        )
    logger.exception("Unhandled error processing %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


def get_parquet_path() -> str:
    """Resolve PARQUET_PATH from env or sensible defaults."""
    env_path = os.getenv("PARQUET_PATH")
    if env_path and os.path.exists(env_path):
        return env_path

    # Check common relative locations in priority order
    default_candidates = [
        "data/processed/harmonized.parquet",
        "../data/processed/harmonized.parquet",
        str(Path(__file__).resolve().parent.parent / "data" / "processed" / "harmonized.parquet"),
        str(Path(__file__).resolve().parent / "data" / "harmonized.parquet"),
        "backend/data/harmonized.parquet",
        "data/harmonized.parquet",
        "../data/harmonized.parquet",
        "../data-sample/harmonized_sample.parquet",
        "data-sample/harmonized_sample.parquet",
        str(Path(__file__).resolve().parent.parent / "data-sample" / "harmonized_sample.parquet"),
    ]
    for candidate in default_candidates:
        if os.path.exists(candidate):
            return candidate

    return "data/processed/harmonized.parquet"


# --- Pydantic Models matching contract ---

class HealthResponse(BaseModel):
    status: str
    parquet_exists: bool
    # Last YYYY-MM in harmonized.parquet (frontend uses it as the date-input max)
    data_end: Optional[str] = None


class Preset(BaseModel):
    id: str
    name: str
    bbox: List[float]  # [minLon, minLat, maxLon, maxLat]


class CalendarEntry(BaseModel):
    month: str
    count: float
    source: str
    uncertainty_lo: float
    uncertainty_hi: float


class AnomalyResponse(BaseModel):
    # Numeric fields are null only when no_data is true (area outside data coverage)
    current: Optional[float]
    median: Optional[float]
    p10: Optional[float]
    p90: Optional[float]
    z_score: Optional[float]
    percentile: Optional[float]
    onset_shift_days: Optional[float] = None
    month_to_date: Optional[bool] = None
    mtd_days: Optional[int] = None
    # Onset not reached yet: lower bound on the delay (DECISIONS 2026-11-14 15:35)
    onset_shift_min_days: Optional[float] = None
    # True when the bbox/polygon contains zero harmonized grid cells (outside coverage)
    no_data: Optional[bool] = None


class BeforeAfterEntry(BaseModel):
    month: str
    raw: float
    harmonized: float
    source: Optional[str] = "viirs"
    uncertainty_lo: Optional[float] = None
    uncertainty_hi: Optional[float] = None
    partial: bool = False


class ValidationResponse(BaseModel):
    holdout_year: int
    mae: float
    mape: float
    before_after: List[BeforeAfterEntry]


# Presets per project scope & DECISIONS.md (pb_hr 27.5-32.5N, 73.5-77.5E)
PRESETS: List[dict] = [
    {
        "id": "punjab_haryana",
        "name": "Punjab & Haryana (India)",
        "bbox": [73.5, 27.5, 77.5, 32.5],
    },
    {
        "id": "brazil_pantanal",
        "name": "Brazil (Pantanal)",
        "bbox": [-60.0, -22.0, -55.0, -16.0],
    },
    {
        "id": "greece",
        "name": "Greece",
        "bbox": [20.0, 36.0, 27.0, 42.0],
    },
    {
        "id": "australia_nsw",
        "name": "Australia (SE New South Wales)",
        "bbox": [149.0, -37.5, 153.5, -31.5],
    },
    {
        "id": "california",
        "name": "California (USA)",
        "bbox": [-124.5, 32.5, -114.0, 42.0],
    },
]


@app.get("/health", response_model=HealthResponse)
def health():
    """Health check endpoint indicating service status and data file availability."""
    parquet_path = get_parquet_path()
    try:
        data_end = last_data_month(parquet_path)
    except Exception:
        data_end = None
    return {
        "status": "ok",
        "parquet_exists": os.path.exists(parquet_path),
        "data_end": data_end,
    }


@app.get("/presets", response_model=List[Preset])
def presets():
    """Return preset region bounding boxes aligned with DECISIONS.md."""
    return PRESETS


def _parquet_version(parquet_path: str) -> float:
    return os.path.getmtime(parquet_path)


@lru_cache(maxsize=8)
def _last_month_cached(parquet_path: str, version: float) -> Optional[str]:
    """Latest YYYY-MM in the parquet. Reads row-group stats (no scan); DuckDB fallback."""
    try:
        import pyarrow.parquet as pq
        md = pq.ParquetFile(parquet_path).metadata
        idx = md.schema.names.index("month")
        maxes = []
        for r in range(md.num_row_groups):
            stats = md.row_group(r).column(idx).statistics
            if stats is None or not stats.has_min_max:
                raise ValueError("missing month stats")
            mx = stats.max
            maxes.append(mx.decode() if isinstance(mx, bytes) else str(mx))
        if maxes:
            return max(maxes)
    except Exception:
        pass
    con = duckdb.connect(database=":memory:")
    try:
        row = con.execute("SELECT MAX(month) FROM read_parquet(?)", [parquet_path]).fetchone()
    finally:
        con.close()
    return row[0] if row else None


def last_data_month(parquet_path: Optional[str] = None) -> Optional[str]:
    """Last month present in harmonized.parquet, or None when the file is missing."""
    parquet_path = parquet_path or get_parquet_path()
    if not os.path.exists(parquet_path):
        return None
    return _last_month_cached(parquet_path, _parquet_version(parquet_path))


def _reject_past_data_end(month: str, last: Optional[str]) -> None:
    if last and month > last:
        raise HTTPException(status_code=400, detail=f"Data runs to {last}")


@lru_cache(maxsize=128)
def _calendar_cached(
    start: Optional[str],
    end: Optional[str],
    bbox: Optional[str],
    polygon: Optional[str],
    parquet_path: str,
    version: float,
) -> tuple:
    """(no_data, rows) for one (area, dates, data version). Errors are not cached."""
    t0 = time.perf_counter()
    if not area_has_data(parquet_path, bbox=bbox, polygon=polygon):
        timing_logger.info("/calendar no_data in %.0f ms", (time.perf_counter() - t0) * 1000)
        return True, []

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
        parquet_path=parquet_path,
    )
    if spatial_conditions:
        conditions.extend(spatial_conditions)
        params.extend(spatial_params)
    t_filter = time.perf_counter()

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    query = f"""
        SELECT
            month,
            ROUND(SUM(harmonized_count), 2) AS count,
            COALESCE(MAX(source), 'viirs') AS source,
            ROUND(GREATEST(0.0, SUM(harmonized_count) - SUM(uncertainty)), 2) AS uncertainty_lo,
            ROUND(SUM(harmonized_count) + SUM(uncertainty), 2) AS uncertainty_hi
        FROM read_parquet(?)
        {where_clause}
        GROUP BY month
        ORDER BY month ASC
    """

    con = duckdb.connect(database=":memory:", read_only=False)
    try:
        if requires_spatial:
            init_duckdb_spatial(con)
        df = con.execute(query, params).df()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DuckDB query execution failed: {e}")
    finally:
        con.close()
    timing_logger.info(
        "/calendar: coverage+spatial filter %.0f ms | aggregation %.0f ms | %d rows",
        (t_filter - t0) * 1000, (time.perf_counter() - t_filter) * 1000, len(df),
    )

    return False, ([] if df.empty else df.to_dict(orient="records"))


@app.get("/calendar", response_model=List[CalendarEntry])
def calendar(
    response: Response,
    start: Optional[str] = Query(None, description="Start month in YYYY-MM format"),
    end: Optional[str] = Query(None, description="End month in YYYY-MM format"),
    bbox: Optional[str] = Query(None, description="Bounding box as minLon,minLat,maxLon,maxLat"),
    polygon: Optional[str] = Query(None, description="GeoJSON polygon string (Polygon, MultiPolygon, Feature, FeatureCollection)"),
):
    """
    Return burning-activity calendar aggregated monthly for the specified area and date range.
    Supports both bbox and GeoJSON polygon filtering on 0.25° cell centroids.
    If the area contains zero harmonized cells (outside data coverage) the body is []
    and the response carries the header X-No-Data: true (additive; list shape unchanged).
    Results are LRU-cached (128) per (area, dates, parquet version).
    """
    parquet_path = get_parquet_path()
    if not os.path.exists(parquet_path):
        raise HTTPException(
            status_code=503,
            detail=f"Harmonized parquet data not found at '{parquet_path}'",
        )

    # start past the data end → 400; end past it → clamp to the last data month
    last = last_data_month(parquet_path)
    if start:
        validate_month_format(start)
        _reject_past_data_end(start, last)
    if end:
        validate_month_format(end)
        if last and end > last:
            end = last

    t0 = time.perf_counter()
    no_data, rows = _calendar_cached(start, end, bbox, polygon, parquet_path, _parquet_version(parquet_path))
    timing_logger.info("/calendar total %.0f ms (polygon=%s)", (time.perf_counter() - t0) * 1000, bool(polygon))
    response.headers["X-No-Data"] = "true" if no_data else "false"
    return copy.deepcopy(rows)


@app.get("/live")
def live(
    days: int = Query(7, ge=1, le=10, description="Number of days of NRT data (1 to 10)"),
    bbox: Optional[str] = Query(None, description="Bounding box as minLon,minLat,maxLon,maxLat"),
    polygon: Optional[str] = Query(None, description="GeoJSON polygon string"),
) -> Dict[str, Any]:
    """
    Return near-real-time (NRT) active-fire hotspots from VIIRS NOAA-20 and NOAA-21.
    Includes 30-min in-memory caching and offline snapshot fallback.
    """
    return get_live_hotspots_geojson(days=days, bbox=bbox, polygon=polygon)


@app.get("/anomaly", response_model=AnomalyResponse)
def anomaly(
    month: str = Query(..., description="Target month in YYYY-MM format"),
    bbox: Optional[str] = Query(None, description="Bounding box as minLon,minLat,maxLon,maxLat"),
    polygon: Optional[str] = Query(None, description="GeoJSON polygon string"),
):
    """
    Return burning-activity anomaly metrics (current vs climatological baseline)
    and season onset shift for the specified month and area.
    """
    parquet_path = get_parquet_path()
    validate_month_format(month)
    _reject_past_data_end(month, last_data_month(parquet_path))
    t0 = time.perf_counter()
    if os.path.exists(parquet_path):
        result = _anomaly_cached(month, bbox, polygon, parquet_path, _parquet_version(parquet_path))
    else:
        result = get_anomaly_metrics(month=month, bbox=bbox, polygon=polygon, parquet_path=parquet_path)
    timing_logger.info("/anomaly total %.0f ms (polygon=%s)", (time.perf_counter() - t0) * 1000, bool(polygon))
    return copy.deepcopy(result)


_NO_DATA_ANOMALY: Dict[str, Any] = {
    "current": None,
    "median": None,
    "p10": None,
    "p90": None,
    "z_score": None,
    "percentile": None,
    "onset_shift_days": None,
    "onset_shift_min_days": None,
    "month_to_date": None,
    "mtd_days": None,
    "no_data": True,
}


@lru_cache(maxsize=128)
def _anomaly_cached(
    month: str,
    bbox: Optional[str],
    polygon: Optional[str],
    parquet_path: str,
    version: float,
) -> Dict[str, Any]:
    """Anomaly per (month, area, data version). Errors (HTTPException) are not cached."""
    # Validate inputs first so bad requests still get their 400s
    validate_month_format(month)
    if not area_has_data(parquet_path, bbox=bbox, polygon=polygon):
        return dict(_NO_DATA_ANOMALY)
    result = get_anomaly_metrics(month=month, bbox=bbox, polygon=polygon, parquet_path=parquet_path)
    return {**result, "no_data": False}


@app.get("/export.csv")
def export_hotspots(
    start: Optional[str] = Query(None, description="Start month in YYYY-MM format"),
    end: Optional[str] = Query(None, description="End month in YYYY-MM format"),
    bbox: Optional[str] = Query(None, description="Bounding box as minLon,minLat,maxLon,maxLat"),
    polygon: Optional[str] = Query(None, description="GeoJSON polygon string"),
):
    """
    Export cell-level harmonized fire hotspot CSV for specified bounds and date range.
    """
    parquet_path = get_parquet_path()
    return export_csv(
        start=start,
        end=end,
        bbox=bbox,
        polygon=polygon,
        parquet_path=parquet_path,
    )


@app.get("/export_analytics.csv")
def export_analytics(
    start: Optional[str] = Query(None, description="Start month in YYYY-MM format"),
    end: Optional[str] = Query(None, description="End month in YYYY-MM format"),
    bbox: Optional[str] = Query(None, description="Bounding box as minLon,minLat,maxLon,maxLat"),
    polygon: Optional[str] = Query(None, description="GeoJSON polygon string"),
):
    """
    Export aggregated monthly burning activity series and climatological anomalies as CSV.
    """
    parquet_path = get_parquet_path()
    return export_analytics_csv(
        start=start,
        end=end,
        bbox=bbox,
        polygon=polygon,
        parquet_path=parquet_path,
    )


@app.get("/validation", response_model=ValidationResponse)
def validation(
    bbox: Optional[str] = Query(None, description="Bounding box as minLon,minLat,maxLon,maxLat"),
    area: Optional[str] = Query(None, description="Area preset identifier (e.g. pb_hr, punjab_haryana, brazil, etc.)"),
):
    """
    Return 2020 holdout validation metrics (MAE, MAPE) and harmonized before/after series
    filtered for the specified region (defaults to pb_hr: 73.5, 27.5, 77.5, 32.5).
    """
    return get_validation_data(bbox=bbox, area=area)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
