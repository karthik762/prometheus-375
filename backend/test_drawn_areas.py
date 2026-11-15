"""
Drawn-area tests: no_data outside coverage, polygon parity with the old ST_Within
filter, and polygon latency (cell-key filter + LRU cache).

Run: python backend/test_drawn_areas.py   (or pytest backend/test_drawn_areas.py)
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import duckdb
from fastapi.testclient import TestClient

from backend.main import app, get_parquet_path
from backend.spatial import build_spatial_filter, init_duckdb_spatial, parse_polygon

client = TestClient(app)


def _poly(coords):
    return json.dumps({"type": "Polygon", "coordinates": [coords + [coords[0]]]})


POLYS = {
    "punjab": _poly([[74.0, 29.0], [76.8, 29.2], [77.0, 31.5], [75.2, 32.2], [73.9, 31.0]]),
    "california": _poly([[-122.5, 36.5], [-119.0, 36.0], [-118.5, 39.5], [-121.8, 40.5]]),
    # Nevada sits inside the California FIRMS download rectangle (-124.5..-114 lon),
    # so it HAS harmonized cells -> data, not no_data.
    "nevada": _poly([[-119.5, 37.5], [-115.0, 37.5], [-115.0, 41.0], [-119.0, 41.5]]),
    "india_large": _poly([[69, 20], [87, 21], [88, 27], [78, 34], [71, 30]]),
    # Truly outside all 5 regions
    "utah_colorado": _poly([[-113.0, 37.5], [-106.0, 37.5], [-106.0, 41.0], [-113.0, 41.0]]),
    "france": _poly([[0.0, 44.0], [5.0, 44.0], [5.0, 48.0], [0.0, 48.0]]),
}


def test_has_data_polygons():
    for name in ("punjab", "california", "nevada", "india_large"):
        r = client.get("/calendar", params={"polygon": POLYS[name], "start": "2015-01", "end": "2025-12"})
        assert r.status_code == 200, (name, r.text)
        assert r.headers["x-no-data"] == "false", name
        assert len(r.json()) > 0, name
        a = client.get("/anomaly", params={"polygon": POLYS[name], "month": "2025-11"})
        assert a.status_code == 200, (name, a.text)
        body = a.json()
        assert body["no_data"] is False, name
        assert body["current"] is not None and body["median"] is not None, name
    print("PASS has-data polygons (punjab, california, nevada, india_large)")


def test_no_data_polygons_and_bbox():
    for name in ("utah_colorado", "france"):
        r = client.get("/calendar", params={"polygon": POLYS[name]})
        assert r.status_code == 200
        assert r.json() == []  # list shape unchanged
        assert r.headers["x-no-data"] == "true", name
        a = client.get("/anomaly", params={"polygon": POLYS[name], "month": "2025-11"}).json()
        assert a["no_data"] is True, name
        for k in ("current", "median", "p10", "p90", "z_score", "percentile", "onset_shift_days"):
            assert a[k] is None, (name, k)
    r = client.get("/calendar", params={"bbox": "0,44,5,48"})
    assert r.headers["x-no-data"] == "true" and r.json() == []
    assert client.get("/anomaly", params={"bbox": "0,44,5,48", "month": "2025-11"}).json()["no_data"] is True
    print("PASS no_data outside coverage (polygon + bbox)")


def test_header_exposed_for_cors():
    r = client.get("/calendar", params={"bbox": "0,44,5,48"}, headers={"Origin": "https://example.com"})
    assert "x-no-data" in r.headers.get("access-control-expose-headers", "").lower()
    print("PASS X-No-Data exposed via CORS")


def test_bad_input_still_400():
    assert client.get("/anomaly", params={"polygon": POLYS["france"], "month": "2025-13"}).status_code == 400
    assert client.get("/calendar", params={"polygon": "{not json"}).status_code == 400
    print("PASS invalid inputs still 400")


def test_parity_with_st_within():
    """Cell-key polygon filter gives exactly the same cells as DuckDB ST_Within."""
    path = get_parquet_path()
    for name in ("punjab", "california", "india_large"):
        geom, b = parse_polygon(POLYS[name])
        con = duckdb.connect()
        init_duckdb_spatial(con)
        old = set(r[0] for r in con.execute(
            "SELECT DISTINCT cell_id FROM read_parquet(?) WHERE lon BETWEEN ? AND ? AND lat BETWEEN ? AND ? "
            "AND ST_Within(ST_Point(lon, lat), ST_GeomFromGeoJSON(?))",
            [path, b[0], b[2], b[1], b[3], geom]).fetchall())
        conds, params, _ = build_spatial_filter(polygon=POLYS[name], parquet_path=path)
        new = set(r[0] for r in con.execute(
            f"SELECT DISTINCT cell_id FROM read_parquet(?) WHERE {' AND '.join(conds)}", [path] + params).fetchall())
        con.close()
        assert old == new, (name, len(old), len(new))
    print("PASS polygon cells identical to ST_Within")


def test_polygon_latency():
    p = POLYS["india_large"]
    t0 = time.perf_counter()
    client.get("/calendar", params={"polygon": p, "start": "2001-01", "end": "2024-12"})
    client.get("/anomaly", params={"polygon": p, "month": "2024-10"})
    cold = time.perf_counter() - t0
    t0 = time.perf_counter()
    client.get("/calendar", params={"polygon": p, "start": "2001-01", "end": "2024-12"})
    client.get("/anomaly", params={"polygon": p, "month": "2024-10"})
    warm = time.perf_counter() - t0
    assert cold < 2.0, cold
    assert warm < 0.2, warm
    print(f"PASS polygon latency: calendar+anomaly cold {cold*1000:.0f} ms, cached {warm*1000:.0f} ms")


if __name__ == "__main__":
    test_has_data_polygons()
    test_no_data_polygons_and_bbox()
    test_header_exposed_for_cors()
    test_bad_input_still_400()
    test_parity_with_st_within()
    test_polygon_latency()
    print("ALL DRAWN-AREA TESTS PASSED")
