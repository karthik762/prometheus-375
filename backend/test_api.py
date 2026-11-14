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
    print("         (Tasks B1, B2 & B3 Verified)             ")
    print("==================================================")

    # 1. Health check
    print("\n[1] Testing GET /health...")
    res = client.get("/health")
    print(f"    Status: {res.status_code}")
    print(f"    Body:   {res.json()}")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.json()["parquet_exists"] is True
    print("    --> PASS: API healthy and Parquet available")

    # 2. Presets
    print("\n[2] Testing GET /presets...")
    res = client.get("/presets")
    print(f"    Status: {res.status_code}")
    presets = res.json()
    assert res.status_code == 200
    assert len(presets) >= 5
    print(f"    --> PASS: {len(presets)} presets returned")

    # 3. Calendar with bbox
    print("\n[3] Testing GET /calendar with bbox...")
    res_bbox = client.get("/calendar?start=2024-01&end=2026-07&bbox=73.8,27.6,77.6,32.5")
    assert res_bbox.status_code == 200
    assert len(res_bbox.json()) == 31
    print("    --> PASS: Bbox calendar query successful")

    # 4. Calendar with GeoJSON Polygon
    print("\n[4] Testing GET /calendar with GeoJSON Polygon...")
    punjab_poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [73.8, 27.6],
                [77.6, 27.6],
                [77.6, 32.5],
                [73.8, 32.5],
                [73.8, 27.6],
            ]
        ],
    }
    encoded_poly = urllib.parse.quote(json.dumps(punjab_poly))
    res_poly = client.get(f"/calendar?start=2024-01&end=2026-07&polygon={encoded_poly}")
    assert res_poly.status_code == 200
    assert len(res_poly.json()) == 31
    print("    --> PASS: GeoJSON Polygon query successful")

    # 5. Live FIRMS NRT API: Live fetch (NOAA-20 + NOAA-21)
    print("\n[5] Testing GET /live (Live FIRMS API fetch for Punjab/Haryana)...")
    # Clear cache to ensure a fresh test
    firms_live._cache.clear()
    t0 = time.time()
    res_live1 = client.get("/live?days=7&bbox=73.8,27.6,77.6,32.5")
    t_live1 = time.time() - t0
    print(f"    Status: {res_live1.status_code} (took {t_live1:.2f}s)")
    fc1 = res_live1.json()
    assert res_live1.status_code == 200
    assert fc1["type"] == "FeatureCollection"
    print(f"    Source: {fc1['metadata']['source']}")
    print(f"    Hotspots returned: {fc1['metadata']['count']}")
    assert fc1["metadata"]["count"] > 0
    sample_feat = fc1["features"][0]
    print(f"    Sample feature: satellite={sample_feat['properties']['satellite']}, "
          f"acq_date={sample_feat['properties']['acq_date']}, "
          f"confidence={sample_feat['properties']['confidence']}, "
          f"coordinates={sample_feat['geometry']['coordinates']}")
    assert sample_feat["properties"]["satellite"] in ("NOAA-20", "NOAA-21")
    assert sample_feat["properties"]["confidence"] in ("nominal", "high")
    print("    --> PASS: Live hotspots fetched and formatted per contract")

    # 6. Live FIRMS NRT API: 30-min in-memory cache hit
    print("\n[6] Testing GET /live cache hit on repeated call...")
    t0 = time.time()
    res_live2 = client.get("/live?days=7&bbox=73.8,27.6,77.6,32.5")
    t_live2 = time.time() - t0
    fc2 = res_live2.json()
    print(f"    Status: {res_live2.status_code} (took {t_live2:.4f}s)")
    print(f"    Source: {fc2['metadata']['source']}")
    assert res_live2.status_code == 200
    assert fc2["metadata"]["source"] == "cache"
    assert fc2["metadata"]["count"] == fc1["metadata"]["count"]
    print(f"    --> PASS: In-memory cache hit confirmed ({t_live2:.4f}s)")

    # 7. Live FIRMS NRT API: Polygon containment filtering
    print("\n[7] Testing GET /live with polygon filtering...")
    sub_poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [75.0, 30.0],
                [76.0, 30.0],
                [76.0, 31.0],
                [75.0, 31.0],
                [75.0, 30.0],
            ]
        ],
    }
    encoded_sub_poly = urllib.parse.quote(json.dumps(sub_poly))
    res_sub = client.get(f"/live?days=7&polygon={encoded_sub_poly}")
    assert res_sub.status_code == 200
    fc_sub = res_sub.json()
    print(f"    Sub-polygon hotspot count: {fc_sub['metadata']['count']} (vs full {fc1['metadata']['count']})")
    assert 0 < fc_sub["metadata"]["count"] <= fc1["metadata"]["count"]
    print("    --> PASS: Polygon spatial containment filtering verified")

    # 8. Live FIRMS NRT API: Snapshot fallback resilience
    print("\n[8] Testing GET /live fallback behavior when offline/invalid key...")
    # Temporarily override key and clear cache to simulate failure
    original_key = os.environ.get("FIRMS_MAP_KEY")
    os.environ["FIRMS_MAP_KEY"] = "invalid_key_for_testing"
    firms_live._cache.clear()
    try:
        res_fallback = client.get("/live?days=7&bbox=73.8,27.6,77.6,32.5")
        print(f"    Status: {res_fallback.status_code}")
        fc_fb = res_fallback.json()
        print(f"    Source: {fc_fb['metadata']['source']}")
        print(f"    Fallback count: {fc_fb['metadata']['count']}")
        assert res_fallback.status_code == 200
        assert fc_fb["metadata"]["source"] == "snapshot_fallback"
        assert fc_fb["metadata"]["count"] >= 15
        print("    --> PASS: Offline snapshot fallback served without error")
    finally:
        if original_key is not None:
            os.environ["FIRMS_MAP_KEY"] = original_key
        else:
            os.environ.pop("FIRMS_MAP_KEY", None)
        firms_live._cache.clear()

    # 9. Invalid bbox on /live
    print("\n[9] Testing GET /live with invalid bbox...")
    res_inv = client.get("/live?bbox=invalid")
    assert res_inv.status_code == 400
    print("    --> PASS: 400 Bad Request returned on invalid bbox")

    print("\n==================================================")
    print("     ALL B1, B2 & B3 TESTS PASSED SUCCESSFULLY    ")
    print("==================================================")


if __name__ == "__main__":
    run_tests()
