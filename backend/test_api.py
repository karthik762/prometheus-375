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

    # 5. Anomaly: Punjab/Haryana Preset Bbox for 2026-11 (Peak stubble burn, day-matched per DECISIONS.md)
    print("\n[5] Testing GET /anomaly for Punjab/Haryana preset (2026-11)...")
    url_a1 = "/anomaly?month=2026-11&bbox=73.5,27.5,77.5,32.5"
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
    assert data_a1["percentile"] == 11.5
    assert data_a1["onset_shift_days"] is None  # onset not reached yet
    assert data_a1["onset_shift_min_days"] == 28.5
    print("    --> PASS: Anomaly metrics adhere to frozen contract schema & DECISIONS.md")

    # 6. Anomaly: Punjab/Haryana for 2026-10
    print("\n[6] Testing GET /anomaly for Punjab/Haryana preset (2026-10)...")
    url_a2 = "/anomaly?month=2026-10&bbox=73.5,27.5,77.5,32.5"
    res_a2 = client.get(url_a2)
    assert res_a2.status_code == 200
    data_a2 = res_a2.json()
    print(f"    Response: current={data_a2['current']}, median={data_a2['median']}, z={data_a2['z_score']}")
    assert data_a2["current"] == 1517.0
    assert data_a2["percentile"] == 0.0
    print("    --> PASS: 2026-10 anomaly returned accurately")

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
    assert data_a3["current"] > 0
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

    # 10. Task B5: GET /export.csv
    print("\n[10] Testing GET /export.csv...")
    res_exp = client.get("/export.csv?start=2024-10&end=2024-11&bbox=73.5,27.5,77.5,32.5")
    assert res_exp.status_code == 200
    assert "text/csv" in res_exp.headers.get("content-type", "")
    assert "prometheus375_export.csv" in res_exp.headers.get("content-disposition", "")
    exp_header = res_exp.text.strip().split("\n")[0].strip()
    assert exp_header == "cell_id,lat,lon,month,harmonized_count,source,uncertainty,grid_resolution_deg"
    print("    --> PASS: /export.csv returned valid CSV with grid_resolution_deg")

    # 11. Task B5: GET /export_analytics.csv
    print("\n[11] Testing GET /export_analytics.csv...")
    res_an = client.get("/export_analytics.csv?start=2024-01&end=2024-12&bbox=73.5,27.5,77.5,32.5")
    assert res_an.status_code == 200
    assert "text/csv" in res_an.headers.get("content-type", "")
    assert "prometheus375_analytics.csv" in res_an.headers.get("content-disposition", "")
    an_header = res_an.text.strip().split("\n")[0].strip()
    assert an_header == "month,count,source,uncertainty_lo,uncertainty_hi,median,p10,p90,z_score,percentile"
    print("    --> PASS: /export_analytics.csv returned valid monthly baseline CSV")

    # 12. Task B5: GET /validation
    print("\n[12] Testing GET /validation...")
    res_val = client.get("/validation")
    assert res_val.status_code == 200
    val_data = res_val.json()
    assert val_data["holdout_year"] == 2020
    assert val_data["mae"] > 0
    assert val_data["mape"] > 0
    assert len(val_data["before_after"]) > 0
    assert "raw" in val_data["before_after"][0]
    assert "harmonized" in val_data["before_after"][0]
    assert "source" in val_data["before_after"][0]
    assert "uncertainty_lo" in val_data["before_after"][0]
    print(f"    Holdout: {val_data['holdout_year']}, MAE: {val_data['mae']}, MAPE: {val_data['mape']}%")
    print("    --> PASS: /validation returned 2020 metrics and before/after series")

    print("\n==================================================")
    print("   ALL B1, B2, B3, B4 & B5 TESTS PASSED (100% OK) ")
    print("==================================================")


if __name__ == "__main__":
    run_tests()
