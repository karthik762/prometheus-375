import json
import os
import sys
import time
import urllib.parse
from pathlib import Path
from fastapi.testclient import TestClient

backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

from main import app
import firms_live

client = TestClient(app)


def run_tests():
    print("==================================================")
    print("      PROMETHEUS 375 BACKEND API TEST SUITE       ")
    print("      (Tasks B1, B2, B3 & B4 Verified)           ")
    print("==================================================")

    # 1. Health check
    print("\n[1] Testing GET /health...")
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.json()["parquet_exists"] is True
    print("    --> PASS: API healthy and Parquet available")

    # 2. Presets aligned with DECISIONS.md
    print("\n[2] Testing GET /presets (DECISIONS.md alignment)...")
    res = client.get("/presets")
    assert res.status_code == 200
    presets = res.json()
    assert len(presets) >= 5
    pb_preset = next(p for p in presets if p["id"] == "punjab_haryana")
    print(f"    Punjab/Haryana preset bbox: {pb_preset['bbox']}")
    assert pb_preset["bbox"] == [73.5, 27.5, 77.5, 32.5]
    print("    --> PASS: Presets returned and Punjab/Haryana matches pb_hr bbox")

    # 3. Calendar with bbox
    print("\n[3] Testing GET /calendar with bbox...")
    res_bbox = client.get("/calendar?start=2024-01&end=2026-07&bbox=73.5,27.5,77.5,32.5")
    assert res_bbox.status_code == 200
    assert len(res_bbox.json()) == 31
    print("    --> PASS: Bbox calendar query successful")

    # 4. Live FIRMS NRT API: Live fetch (NOAA-20 + NOAA-21)
    print("\n[4] Testing GET /live (Live FIRMS API fetch for Punjab/Haryana)...")
    firms_live._cache.clear()
    res_live = client.get("/live?days=7&bbox=73.5,27.5,77.5,32.5")
    assert res_live.status_code == 200
    fc = res_live.json()
    print(f"    Source: {fc['metadata']['source']}, Hotspots: {fc['metadata']['count']}")
    assert fc["metadata"]["count"] > 0
    print("    --> PASS: Live hotspots fetched and formatted per contract")

    # 5. Anomaly: Punjab/Haryana Preset Bbox for 2024-11 (Peak stubble burn)
    print("\n[5] Testing GET /anomaly for Punjab/Haryana preset (2024-11)...")
    url_a1 = "/anomaly?month=2024-11&bbox=73.5,27.5,77.5,32.5"
    res_a1 = client.get(url_a1)
    print(f"    Status: {res_a1.status_code}")
    data_a1 = res_a1.json()
    print(f"    Response: {json.dumps(data_a1, indent=6)}")
    assert res_a1.status_code == 200
    assert isinstance(data_a1["current"], float)
    assert isinstance(data_a1["median"], float)
    assert isinstance(data_a1["p10"], float)
    assert isinstance(data_a1["p90"], float)
    assert isinstance(data_a1["z_score"], float)
    assert isinstance(data_a1["percentile"], float)
    assert data_a1["current"] == 8173.0
    assert data_a1["median"] == 4077.0
    assert data_a1["percentile"] == 100.0
    print("    --> PASS: Anomaly metrics adhere to frozen contract schema")

    # 6. Anomaly: Punjab/Haryana for 2024-10
    print("\n[6] Testing GET /anomaly for Punjab/Haryana preset (2024-10)...")
    url_a2 = "/anomaly?month=2024-10&bbox=73.5,27.5,77.5,32.5"
    res_a2 = client.get(url_a2)
    assert res_a2.status_code == 200
    data_a2 = res_a2.json()
    print(f"    Response: current={data_a2['current']}, median={data_a2['median']}, z={data_a2['z_score']}")
    assert data_a2["current"] == 3276.0
    print("    --> PASS: 2024-10 anomaly returned accurately")

    # 7. Anomaly: Custom drawn polygon (on-the-fly DuckDB spatial aggregation)
    print("\n[7] Testing GET /anomaly with custom drawn GeoJSON polygon...")
    custom_poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [74.5, 29.0],
                [76.5, 29.0],
                [76.5, 31.0],
                [74.5, 31.0],
                [74.5, 29.0],
            ]
        ],
    }
    encoded_poly = urllib.parse.quote(json.dumps(custom_poly))
    url_a3 = f"/anomaly?month=2024-11&polygon={encoded_poly}"
    res_a3 = client.get(url_a3)
    print(f"    Status: {res_a3.status_code}")
    data_a3 = res_a3.json()
    print(f"    Custom polygon 2024-11 anomaly: {json.dumps(data_a3, indent=6)}")
    assert res_a3.status_code == 200
    assert data_a3["current"] == 5045.0
    assert data_a3["onset_shift_days"] is None  # Custom polygon has no preset onset
    print("    --> PASS: On-the-fly custom polygon spatial anomaly computed cleanly")

    # 8. Anomaly: Input validation (Invalid month format)
    print("\n[8] Testing GET /anomaly with invalid month format...")
    res_inv_m = client.get("/anomaly?month=2024-13&bbox=73.5,27.5,77.5,32.5")
    assert res_inv_m.status_code == 400
    print("    --> PASS: 400 Bad Request returned on invalid month format")

    # 9. Anomaly: Input validation (Invalid bbox)
    print("\n[9] Testing GET /anomaly with invalid bbox...")
    res_inv_b = client.get("/anomaly?month=2024-11&bbox=invalid_bbox")
    assert res_inv_b.status_code == 400
    print("    --> PASS: 400 Bad Request returned on invalid bbox")

    print("\n==================================================")
    print("   ALL B1, B2, B3 & B4 TESTS PASSED (100% OK)     ")
    print("==================================================")


if __name__ == "__main__":
    run_tests()
