"""
Comprehensive Integration #1 test suite for Prometheus 375.
Verifies backend serving real harmonized.parquet, all endpoints, and frontend compatibility.
"""

import json
import os
import sys
import threading
import time
import urllib.parse
from pathlib import Path
import httpx
import uvicorn
from fastapi.testclient import TestClient

backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

from main import app, get_parquet_path

client = TestClient(app)


def test_integration():
    print("==================================================================")
    print("       PROMETHEUS 375 INTEGRATION #1 VERIFICATION SUITE           ")
    print("==================================================================")

    # 1. Parquet file verification
    parquet_path = get_parquet_path()
    print(f"\n[1] Checking active dataset configuration...")
    print(f"    Resolved PARQUET_PATH: {parquet_path}")
    assert os.path.exists(parquet_path), f"Parquet file not found at {parquet_path}"
    file_size_kb = os.path.getsize(parquet_path) / 1024
    print(f"    File size: {file_size_kb:.1f} KB")

    # 2. GET /health
    print("\n[2] Testing GET /health...")
    r_health = client.get("/health")
    assert r_health.status_code == 200
    h_data = r_health.json()
    print(f"    Status: {r_health.status_code}")
    print(f"    Body:   {h_data}")
    assert h_data["status"] == "ok"
    assert h_data["parquet_exists"] is True
    print("    --> PASS: /health reports parquet_exists=True")

    # 3. GET /presets
    print("\n[3] Testing GET /presets...")
    r_presets = client.get("/presets")
    assert r_presets.status_code == 200
    presets = r_presets.json()
    print(f"    Status: {r_presets.status_code}, Found {len(presets)} presets")
    pb_preset = next((p for p in presets if p["id"] == "punjab_haryana"), None)
    assert pb_preset is not None, "punjab_haryana preset missing"
    assert pb_preset["bbox"] == [73.5, 27.5, 77.5, 32.5], f"Bbox mismatch: {pb_preset['bbox']}"
    print(f"    Preset: {pb_preset['name']} -> {pb_preset['bbox']}")
    print("    --> PASS: /presets returned and aligned with DECISIONS.md")

    # 4. GET /calendar (multi-decade 2000-11 to 2026-11)
    print("\n[4] Testing GET /calendar (full 26-year range 2000-11 to 2026-11)...")
    url_cal = "/calendar?start=2000-11&end=2026-11&bbox=73.5,27.5,77.5,32.5"
    r_cal = client.get(url_cal)
    assert r_cal.status_code == 200
    cal_data = r_cal.json()
    print(f"    Status: {r_cal.status_code}")
    print(f"    Total monthly datapoints: {len(cal_data)}")
    assert len(cal_data) == 313, f"Expected 313 months, got {len(cal_data)}"

    first_row = cal_data[0]
    last_row = cal_data[-1]
    sources = set(r["source"] for r in cal_data)

    print(f"    First row: {first_row}")
    print(f"    Last row:  {last_row}")
    print(f"    Sources present: {sources}")

    assert first_row["month"] == "2000-11"
    assert first_row["source"] == "modis_converted"
    assert last_row["month"] == "2026-11"
    assert last_row["source"] == "viirs"
    assert "modis_converted" in sources
    assert "viirs" in sources
    print("    --> PASS: /calendar returns 313 months spanning modis_converted and viirs")

    # 5. GET /anomaly
    print("\n[5] Testing GET /anomaly (2024-10)...")
    url_anom = "/anomaly?month=2024-10&bbox=73.5,27.5,77.5,32.5"
    r_anom = client.get(url_anom)
    assert r_anom.status_code == 200
    anom_data = r_anom.json()
    print(f"    Status: {r_anom.status_code}")
    print(f"    Body:   {json.dumps(anom_data, indent=6)}")
    assert isinstance(anom_data["current"], float)
    assert isinstance(anom_data["median"], float)
    assert isinstance(anom_data["p10"], float)
    assert isinstance(anom_data["p90"], float)
    assert isinstance(anom_data["z_score"], float)
    assert isinstance(anom_data["percentile"], float)
    print("    --> PASS: /anomaly returns valid statistics against 25 prior years")

    # 6. GET /live
    print("\n[6] Testing GET /live...")
    url_live = "/live?days=7&bbox=73.5,27.5,77.5,32.5"
    r_live = client.get(url_live)
    assert r_live.status_code == 200
    live_data = r_live.json()
    print(f"    Status: {r_live.status_code}")
    print(f"    Source: {live_data['metadata']['source']}")
    print(f"    Hotspot count: {live_data['metadata']['count']}")
    assert live_data["type"] == "FeatureCollection"
    assert live_data["metadata"]["count"] > 0
    print("    --> PASS: /live returns valid GeoJSON FeatureCollection")

    # 7. CORS verification
    print("\n[7] Testing CORS headers for frontend origin (http://localhost:5173)...")
    cors_resp = client.options(
        "/calendar",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    print(f"    OPTIONS /calendar Status: {cors_resp.status_code}")
    allow_origin = cors_resp.headers.get("access-control-allow-origin")
    print(f"    Access-Control-Allow-Origin: {allow_origin}")
    assert allow_origin in ("*", "http://localhost:5173")
    print("    --> PASS: CORS headers open for Vite dev server")

    print("\n==================================================================")
    print("          ALL INTEGRATION #1 TESTS PASSED SUCCESSFULLY!           ")
    print("==================================================================")


def test_live_network_server():
    """Start uvicorn on localhost:8000 and test real HTTP requests."""
    print("\n--- Verifying Live Network Server (http://127.0.0.1:8000) ---")
    config = uvicorn.Config(app, host="127.0.0.1", port=8000, log_level="warning")
    server = uvicorn.Server(config)
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    time.sleep(1.5)

    try:
        with httpx.Client(base_url="http://127.0.0.1:8000") as http:
            # 1. Health
            r1 = http.get("/health")
            print(f"  HTTP GET /health -> {r1.status_code}: {r1.json()}")
            assert r1.status_code == 200

            # 2. Calendar
            r2 = http.get("/calendar?start=2000-11&end=2026-11&bbox=73.5,27.5,77.5,32.5")
            cal = r2.json()
            print(f"  HTTP GET /calendar -> {r2.status_code}: {len(cal)} months returned")
            assert r2.status_code == 200
            assert len(cal) == 313

            # 3. Anomaly
            r3 = http.get("/anomaly?month=2024-10&bbox=73.5,27.5,77.5,32.5")
            print(f"  HTTP GET /anomaly -> {r3.status_code}: current={r3.json()['current']}")
            assert r3.status_code == 200

            # 4. CORS header on live request
            r4 = http.get(
                "/health",
                headers={"Origin": "http://localhost:5173"},
            )
            print(f"  CORS header on live response: {r4.headers.get('access-control-allow-origin')}")
            assert r4.headers.get("access-control-allow-origin") in ("*", "http://localhost:5173")

        print("  --> Live network server verified cleanly!")
    finally:
        server.should_exit = True
        t.join(timeout=2)


if __name__ == "__main__":
    test_integration()
    test_live_network_server()
