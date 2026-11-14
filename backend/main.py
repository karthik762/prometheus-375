import os
from pathlib import Path
from typing import List, Optional
import duckdb
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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
)


def get_parquet_path() -> str:
    """Resolve PARQUET_PATH from env or sensible defaults."""
    env_path = os.getenv("PARQUET_PATH")
    if env_path:
        return env_path

    # Check common relative locations
    default_candidates = [
        "../data-sample/harmonized_sample.parquet",
        "data-sample/harmonized_sample.parquet",
        str(Path(__file__).resolve().parent.parent / "data-sample" / "harmonized_sample.parquet"),
    ]
    for candidate in default_candidates:
        if os.path.exists(candidate):
            return candidate

    return "../data-sample/harmonized_sample.parquet"


# --- Pydantic Models matching contract ---

class HealthResponse(BaseModel):
    status: str
    parquet_exists: bool


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


# Presets per project scope
PRESETS: List[dict] = [
    {
        "id": "punjab_haryana",
        "name": "Punjab & Haryana (India)",
        "bbox": [73.8, 27.6, 77.6, 32.5],
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
    return {
        "status": "ok",
        "parquet_exists": os.path.exists(parquet_path),
    }


@app.get("/presets", response_model=List[Preset])
def presets():
    """Return preset region bounding boxes."""
    return PRESETS


@app.get("/calendar", response_model=List[CalendarEntry])
def calendar(
    start: Optional[str] = Query(None, description="Start month in YYYY-MM format"),
    end: Optional[str] = Query(None, description="End month in YYYY-MM format"),
    bbox: Optional[str] = Query(None, description="Bounding box as minLon,minLat,maxLon,maxLat"),
    polygon: Optional[str] = Query(None, description="GeoJSON polygon string (reserved for B2)"),
):
    """
    Return burning-activity calendar aggregated monthly for the specified area and date range.
    """
    parquet_path = get_parquet_path()
    if not os.path.exists(parquet_path):
        raise HTTPException(
            status_code=503,
            detail=f"Harmonized parquet data not found at '{parquet_path}'",
        )

    # Build SQL filter conditions and parameters
    conditions = []
    params = [parquet_path]

    if start:
        conditions.append("month >= ?")
        params.append(start)

    if end:
        conditions.append("month <= ?")
        params.append(end)

    if bbox:
        try:
            parts = [float(p.strip()) for p in bbox.split(",")]
            if len(parts) != 4:
                raise ValueError("bbox must contain exactly 4 comma-separated numbers")
            min_lon, min_lat, max_lon, max_lat = parts
            conditions.append("lon >= ? AND lon <= ? AND lat >= ? AND lat <= ?")
            params.extend([min_lon, max_lon, min_lat, max_lat])
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid bbox parameter format. Expected minLon,minLat,maxLon,maxLat: {e}",
            )

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
        df = con.execute(query, params).df()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DuckDB query execution failed: {e}")
    finally:
        con.close()

    if df.empty:
        return []

    records = df.to_dict(orient="records")
    return records


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
