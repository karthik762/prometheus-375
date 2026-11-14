import json
import sys
import urllib.parse
from pathlib import Path
from fastapi.testclient import TestClient

backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

from main import app

client = TestClient(app)


def run_tests():
    print("==================================================")
    print("      PROMETHEUS 375 BACKEND API TEST SUITE       ")
    print("            (Task B1 & Task B2 Verified)          ")
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

    # 3. Calendar with bbox (Punjab/Haryana)
    print("\n[3] Testing GET /calendar with bbox (Punjab/Haryana 2024-01 to 2026-07)...")
    res_bbox = client.get("/calendar?start=2024-01&end=2026-07&bbox=73.8,27.6,77.6,32.5")
    print(f"    Status: {res_bbox.status_code}")
    data_bbox = res_bbox.json()
    print(f"    Total monthly datapoints: {len(data_bbox)}")
    assert res_bbox.status_code == 200
    assert len(data_bbox) == 31
    print("    --> PASS: Bbox query successful")

    # 4. Calendar with GeoJSON Polygon (Raw Polygon)
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
    print(f"    Status: {res_poly.status_code}")
    data_poly = res_poly.json()
    print(f"    Total monthly datapoints: {len(data_poly)}")
    assert res_poly.status_code == 200
    assert len(data_poly) == 31
    # Bbox polygon and bbox bounding box should match
    assert data_poly[0]["count"] == data_bbox[0]["count"]
    print(f"    First month count check: bbox={data_bbox[0]['count']} vs polygon={data_poly[0]['count']}")
    print("    --> PASS: GeoJSON Polygon query matches bbox query")

    # 5. Calendar with GeoJSON Feature & FeatureCollection
    print("\n[5] Testing GET /calendar with GeoJSON FeatureCollection...")
    fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Punjab Subregion"},
                "geometry": {
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
                },
            }
        ],
    }
    encoded_fc = urllib.parse.quote(json.dumps(fc))
    res_fc = client.get(f"/calendar?start=2024-11&end=2024-11&polygon={encoded_fc}")
    print(f"    Status: {res_fc.status_code}")
    data_fc = res_fc.json()
    print(f"    Sub-region Nov 2024 count: {data_fc[0]['count']} (vs full region 8173.0)")
    assert res_fc.status_code == 200
    assert len(data_fc) == 1
    assert data_fc[0]["count"] == 5045.0
    print("    --> PASS: FeatureCollection parsed, filtered, and centroid containment verified")

    # 6. Invalid bbox parameter handling
    print("\n[6] Testing GET /calendar with invalid bbox...")
    res_inv_bbox = client.get("/calendar?bbox=10,20,30")
    print(f"    Status: {res_inv_bbox.status_code}")
    print(f"    Detail: {res_inv_bbox.json().get('detail')}")
    assert res_inv_bbox.status_code == 400
    print("    --> PASS: Invalid bbox correctly returns 400 Bad Request")

    # 7. Invalid polygon GeoJSON handling
    print("\n[7] Testing GET /calendar with malformed GeoJSON polygon...")
    res_inv_poly = client.get("/calendar?polygon=not_valid_json")
    print(f"    Status: {res_inv_poly.status_code}")
    print(f"    Detail: {res_inv_poly.json().get('detail')}")
    assert res_inv_poly.status_code == 400
    print("    --> PASS: Invalid GeoJSON returns 400 Bad Request")

    # 8. Unsupported GeoJSON type handling
    print("\n[8] Testing GET /calendar with unsupported GeoJSON geometry type...")
    point_geom = urllib.parse.quote(json.dumps({"type": "Point", "coordinates": [75.0, 30.0]}))
    res_point = client.get(f"/calendar?polygon={point_geom}")
    print(f"    Status: {res_point.status_code}")
    print(f"    Detail: {res_point.json().get('detail')}")
    assert res_point.status_code == 400
    print("    --> PASS: Unsupported geometry type returns 400 Bad Request")

    print("\n==================================================")
    print("       ALL B1 & B2 TESTS PASSED SUCCESSFULLY      ")
    print("==================================================")


if __name__ == "__main__":
    run_tests()
