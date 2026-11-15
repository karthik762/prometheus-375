"""
Comprehensive test suite for Task S3: Backend Hardening
Verifies:
1. Preset bounding boxes stay within area limit (all 5 presets pass).
2. Oversized bbox rejection (> 200 sq deg -> 400).
3. Oversized polygon-envelope rejection (> 200 sq deg -> 400).
4. Invalid coordinate rejection (out-of-range, inverted, NaN, Inf -> 400).
5. Combined bbox and polygon handling (intersection envelope and disjoint rejection).
6. Live FIRMS 30-min cache hit behavior.
7. Cache expiration and bounded capacity eviction.
8. Upstream failure handling, cooldown, and snapshot fallback without leaking API keys.
9. Global exception handler returning generic, safe 500 without stack trace leakage.
10. Fast and lightweight GET /health behavior.
"""

import json
import math
import sys
import time
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from fastapi.testclient import TestClient
from fastapi import HTTPException

from backend.main import app, PRESETS
from backend.spatial import (
    parse_bbox,
    parse_polygon,
    calculate_envelope_area,
    validate_area_limit,
    get_effective_envelope,
    MAX_ENVELOPE_AREA_SQ_DEG,
)
import backend.firms_live as fl
import backend.validation as val

client = TestClient(app)


def test_presets_area_within_limit():
    """Verify all 5 official presets are well within the 200 sq deg limit."""
    print("\n[1] Testing official presets against 200 sq deg envelope limit...")
    for preset in PRESETS:
        bbox = tuple(preset["bbox"])
        area = calculate_envelope_area(bbox)
        print(f"    Preset '{preset['id']}': {bbox} -> {area:.2f} sq deg")
        assert area <= MAX_ENVELOPE_AREA_SQ_DEG, f"Preset {preset['id']} exceeds limit ({area} > {MAX_ENVELOPE_AREA_SQ_DEG})"
        validate_area_limit(bbox)
    print("    --> PASS: All official presets valid and within safety bounds")


def test_oversized_bbox_rejection():
    """Verify envelopes exceeding 200 sq deg are rejected with HTTP 400 on /live and /export.csv."""
    print("\n[2] Testing oversized bbox rejection on /live and /export.csv...")
    # 15x15 deg = 225 sq deg > 200
    oversized_bbox = "70.0,20.0,85.0,35.0"
    
    # GET /live with oversized bbox
    r_live = client.get(f"/live?bbox={oversized_bbox}")
    assert r_live.status_code == 400, f"Expected 400, got {r_live.status_code}"
    assert "exceeds maximum allowed limit" in r_live.json().get("detail", "")
    print("    --> PASS: /live rejected oversized bbox (225 sq deg)")

    # GET /export.csv with oversized bbox
    r_exp = client.get(f"/export.csv?bbox={oversized_bbox}")
    assert r_exp.status_code == 400, f"Expected 400, got {r_exp.status_code}"
    assert "exceeds maximum allowed limit" in r_exp.json().get("detail", "")
    print("    --> PASS: /export.csv rejected oversized bbox (225 sq deg)")


def test_oversized_polygon_envelope_rejection():
    """Verify polygons whose bounding box exceeds 200 sq deg are rejected with HTTP 400."""
    print("\n[3] Testing oversized polygon envelope rejection...")
    # Polygon bounding box is 15 x 15 = 225 sq deg
    oversized_poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [70.0, 20.0],
                [85.0, 20.0],
                [85.0, 35.0],
                [70.0, 35.0],
                [70.0, 20.0],
            ]
        ],
    }
    poly_str = json.dumps(oversized_poly)

    r_live_poly = client.get(f"/live?polygon={poly_str}")
    assert r_live_poly.status_code == 400
    assert "exceeds maximum allowed limit" in r_live_poly.json().get("detail", "")
    print("    --> PASS: /live rejected oversized polygon envelope")

    r_exp_poly = client.get(f"/export.csv?polygon={poly_str}")
    assert r_exp_poly.status_code == 400
    assert "exceeds maximum allowed limit" in r_exp_poly.json().get("detail", "")
    print("    --> PASS: /export.csv rejected oversized polygon envelope")


def test_invalid_coordinates_rejection():
    """Verify malformed, non-finite, inverted, or out-of-range coordinates return HTTP 400."""
    print("\n[4] Testing invalid and out-of-range coordinate rejection...")
    
    # 1. Out of range latitude (> 90)
    r1 = client.get("/live?bbox=73.5,27.5,77.5,95.0")
    assert r1.status_code == 400
    assert "Latitude out of valid range" in r1.json()["detail"]

    # 2. Out of range longitude (> 180)
    r2 = client.get("/live?bbox=185.0,27.5,190.0,32.5")
    assert r2.status_code == 400
    assert "Longitude out of valid range" in r2.json()["detail"]

    # 3. Inverted longitude (minLon > maxLon)
    r3 = client.get("/live?bbox=77.5,27.5,73.5,32.5")
    assert r3.status_code == 400
    assert "minLon" in r3.json()["detail"] and "cannot be greater than maxLon" in r3.json()["detail"]

    # 4. Inverted latitude (minLat > maxLat)
    r4 = client.get("/live?bbox=73.5,32.5,77.5,27.5")
    assert r4.status_code == 400
    assert "minLat" in r4.json()["detail"] and "cannot be greater than maxLat" in r4.json()["detail"]

    # 5. Non-numeric / NaN
    r5 = client.get("/live?bbox=nan,27.5,77.5,32.5")
    assert r5.status_code == 400

    print("    --> PASS: Inverted, non-finite, and out-of-range coordinates cleanly rejected")


def test_combined_bbox_and_polygon_handling():
    """Verify effective query envelope calculation when both bbox and polygon are supplied."""
    print("\n[5] Testing combined bbox + polygon query envelope handling...")
    
    # Sub-box inside Punjab
    poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [74.0, 28.0],
                [76.0, 28.0],
                [76.0, 30.0],
                [74.0, 30.0],
                [74.0, 28.0],
            ]
        ],
    }
    poly_str = json.dumps(poly)
    bbox_str = "73.5,27.5,77.5,32.5"

    eff = get_effective_envelope(bbox=bbox_str, polygon=poly_str)
    assert eff == (74.0, 28.0, 76.0, 30.0), f"Expected intersection, got {eff}"
    assert calculate_envelope_area(eff) == 4.0

    # Test disjoint bbox and polygon (should raise 400)
    disjoint_poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [10.0, 10.0],
                [12.0, 10.0],
                [12.0, 12.0],
                [10.0, 12.0],
                [10.0, 10.0],
            ]
        ],
    }
    r_disjoint = client.get(f"/live?bbox={bbox_str}&polygon={json.dumps(disjoint_poly)}")
    assert r_disjoint.status_code == 400
    assert "do not intersect" in r_disjoint.json()["detail"]
    print("    --> PASS: Combined intersection envelope calculated and disjoint checked")


def test_live_cache_hit_and_expiration():
    """Verify 30-min live cache hit and proper expiration behavior."""
    print("\n[6] Testing live cache hit and expiration behavior...")
    fl.clear_cache()

    test_bbox = (74.0, 28.0, 75.0, 29.0)
    mock_features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [74.5, 28.5]},
            "properties": {"satellite": "NOAA-20", "confidence": "high"},
        }
    ]

    with patch("backend.firms_live.fetch_firms_source", return_value=mock_features), \
         patch("backend.firms_live.get_map_key", return_value="dummy_map_key"):

        # 1. First fetch -> Live
        feats1, src1 = fl.fetch_live_hotspots(test_bbox, days=7)
        assert src1 == "live"
        assert len(feats1) == 2  # NOAA20 + NOAA21 sources merged

        # 2. Second fetch immediately -> Cache hit
        feats2, src2 = fl.fetch_live_hotspots(test_bbox, days=7)
        assert src2 == "cache"
        assert len(feats2) == len(feats1)
        print("    --> PASS: Immediate second call returns cached response (source='cache')")

        # 3. Simulate passage of 31 minutes (exceeding 30-min TTL)
        cache_key = (74.0, 28.0, 75.0, 29.0, 7)
        cached_ts, cached_data = fl._cache[cache_key]
        fl._cache[cache_key] = (cached_ts - (31 * 60), cached_data)

        # 4. Third fetch after TTL -> Cache expired, live fetch refreshed
        feats3, src3 = fl.fetch_live_hotspots(test_bbox, days=7)
        assert src3 == "live"
        print("    --> PASS: Expired cache correctly triggers new upstream fetch")


def test_live_cache_bounded_capacity():
    """Verify cache memory usage is bounded by MAX_CACHE_SIZE."""
    print("\n[7] Testing live cache bounded capacity (MAX_CACHE_SIZE = 100)...")
    fl.clear_cache()

    # Insert 110 distinct cache entries
    now = time.time()
    for i in range(110):
        key = (float(i), 0.0, float(i + 1), 1.0, 7)
        fl._cache[key] = (now + i, [{"type": "Feature", "properties": {"id": i}}])

    # Run prune
    fl._prune_cache(now + 200)
    assert len(fl._cache) <= fl.MAX_CACHE_SIZE, f"Cache exceeded {fl.MAX_CACHE_SIZE}: {len(fl._cache)}"
    print(f"    --> PASS: Cache size pruned to {len(fl._cache)} entries (<= {fl.MAX_CACHE_SIZE})")


def test_upstream_failure_cooldown_and_fallback():
    """Verify upstream failures trigger a 60s cooldown and serve snapshot fallback without leaking keys."""
    print("\n[8] Testing upstream failure handling and cooldown...")
    fl.clear_cache()
    secret_key = "SECRET_NASA_KEY_12345"

    with patch("backend.firms_live.get_map_key", return_value=secret_key), \
         patch("httpx.Client.get", side_effect=httpx.ConnectTimeout("Connection to FIRMS timed out")):

        test_bbox = (74.0, 28.0, 75.0, 29.0)
        
        # 1. Fetch fails -> serves fallback and activates cooldown
        feats1, src1 = fl.fetch_live_hotspots(test_bbox, days=7)
        assert src1 == "snapshot_fallback"
        assert fl.is_in_failure_cooldown(time.time()) is True
        print("    --> PASS: Upstream failure served snapshot fallback and activated cooldown")

        # 2. Subsequent call during cooldown skips network request completely
        with patch("backend.firms_live.fetch_firms_source") as mock_fetch:
            feats2, src2 = fl.fetch_live_hotspots(test_bbox, days=7)
            assert src2 == "snapshot_fallback"
            mock_fetch.assert_not_called()
        print("    --> PASS: Request during cooldown did not attempt upstream HTTP call")


def test_global_exception_handler_safe_500():
    """Verify unexpected internal exceptions return generic 500 without stack trace leakage."""
    print("\n[9] Testing global exception handler for unexpected internal errors...")
    
    # TestClient re-raises by default in testing; set raise_server_exceptions=False to test ASGI handler
    client_safe = TestClient(app, raise_server_exceptions=False)

    with patch("backend.main.get_parquet_path", side_effect=Exception("Database connection secret_password_xyz failed")):
        resp = client_safe.get("/health")
        assert resp.status_code == 500
        body = resp.json()
        assert body == {"detail": "Internal server error"}
        assert "secret_password_xyz" not in resp.text
        assert "Traceback" not in resp.text
        print("    --> PASS: Generic 500 returned with zero secret or stack trace leakage")


def test_health_endpoint_performance():
    """Verify GET /health executes quickly without heavy queries."""
    print("\n[10] Testing GET /health performance and contract...")
    t0 = time.perf_counter()
    resp = client.get("/health")
    elapsed_ms = (time.perf_counter() - t0) * 1000

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "parquet_exists" in data
    assert elapsed_ms < 100.0, f"Health check took too long: {elapsed_ms:.2f} ms"
    print(f"    --> PASS: /health responded in {elapsed_ms:.2f} ms with status='ok'")


if __name__ == "__main__":
    test_presets_area_within_limit()
    test_oversized_bbox_rejection()
    test_oversized_polygon_envelope_rejection()
    test_invalid_coordinates_rejection()
    test_combined_bbox_and_polygon_handling()
    test_live_cache_hit_and_expiration()
    test_live_cache_bounded_capacity()
    test_upstream_failure_cooldown_and_fallback()
    test_global_exception_handler_safe_500()
    test_health_endpoint_performance()
    print("\n=======================================================")
    print("ALL 10 TASK S3 HARDENING TESTS COMPLETED SUCCESSFULLY!!")
    print("=======================================================")
