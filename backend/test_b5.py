"""
Comprehensive test suite for Task B5:
- /export.csv
- /export_analytics.csv
- /validation
- DECISIONS.md aligned /anomaly with onset_shift_days and day-matched baselines
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_validation_endpoint():
    """Verify /validation returns 2020 holdout metrics and full before/after series."""
    resp = client.get("/validation")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()

    assert "holdout_year" in data
    assert data["holdout_year"] == 2020
    assert "mae" in data and data["mae"] > 0
    assert "mape" in data and data["mape"] > 0
    assert "before_after" in data
    assert len(data["before_after"]) > 0

    first_item = data["before_after"][0]
    assert "month" in first_item
    assert "raw" in first_item
    assert "harmonized" in first_item
    assert "source" in first_item
    assert "uncertainty_lo" in first_item
    assert "uncertainty_hi" in first_item
    print(f"PASS test_validation_endpoint: holdout={data['holdout_year']}, mae={data['mae']}, mape={data['mape']}, count={len(data['before_after'])}")


def test_export_csv_endpoint():
    """Verify /export.csv returns CSV with cell-level columns and grid_resolution_deg."""
    # Test with Punjab/Haryana bbox and bounded date range
    resp = client.get("/export.csv?start=2024-10&end=2024-11&bbox=73.5,27.5,77.5,32.5")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    assert "text/csv" in resp.headers.get("content-type", "")
    assert "prometheus375_export.csv" in resp.headers.get("content-disposition", "")

    lines = resp.text.strip().split("\n")
    header = lines[0].strip()
    assert header == "cell_id,lat,lon,month,harmonized_count,source,uncertainty,grid_resolution_deg"
    assert len(lines) > 1, "Expected data rows in export"
    print(f"PASS test_export_csv_endpoint: rows={len(lines) - 1}")


def test_export_analytics_csv_endpoint():
    """Verify /export_analytics.csv returns monthly burning series + climatological baseline."""
    resp = client.get("/export_analytics.csv?start=2024-01&end=2024-12&bbox=73.5,27.5,77.5,32.5")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    assert "text/csv" in resp.headers.get("content-type", "")
    assert "prometheus375_analytics.csv" in resp.headers.get("content-disposition", "")

    lines = resp.text.strip().split("\n")
    header = lines[0].strip()
    assert header == "month,count,source,uncertainty_lo,uncertainty_hi,median,p10,p90,z_score,percentile"
    assert len(lines) == 13, f"Expected 12 month rows + 1 header, got {len(lines)}"
    print(f"PASS test_export_analytics_csv_endpoint: 12 months exported")


def test_anomaly_pb_hr_aligned():
    """Verify Punjab/Haryana preset aligns with DECISIONS.md (pb_hr zone & onset fallback)."""
    # 1. 2026-11 day-matched baseline
    resp_nov = client.get("/anomaly?month=2026-11&bbox=73.5,27.5,77.5,32.5")
    assert resp_nov.status_code == 200
    d_nov = resp_nov.json()
    assert d_nov["percentile"] == 11.5
    assert d_nov["onset_shift_days"] is None  # onset not reached yet
    assert d_nov["onset_shift_min_days"] == 28.5
    print(f"PASS test_anomaly_pb_hr_aligned 2026-11: pct={d_nov['percentile']}, onset={d_nov['onset_shift_days']}")

    # 2. 2026-10
    resp_oct = client.get("/anomaly?month=2026-10&bbox=73.5,27.5,77.5,32.5")
    assert resp_oct.status_code == 200
    d_oct = resp_oct.json()
    assert d_oct["current"] == 1517.0
    assert d_oct["percentile"] == 0.0
    print(f"PASS test_anomaly_pb_hr_aligned 2026-10: current={d_oct['current']}, pct={d_oct['percentile']}")


def test_anomaly_other_presets_and_custom():
    """Verify other presets join onset_<region> while custom polygons return onset_shift_days=None."""
    # Brazil Pantanal
    resp_br = client.get("/anomaly?month=2026-08&bbox=-60.0,-22.0,-55.0,-16.0")
    assert resp_br.status_code == 200
    d_br = resp_br.json()
    assert d_br["onset_shift_days"] == 11.0
    print(f"PASS test_anomaly_other_presets (Brazil): onset={d_br['onset_shift_days']}")

    # Custom drawn polygon
    poly = '{"type":"Polygon","coordinates":[[[75.0,29.0],[75.5,29.0],[75.5,29.5],[75.0,29.5],[75.0,29.0]]]}'
    resp_poly = client.get(f"/anomaly?month=2024-11&polygon={poly}")
    assert resp_poly.status_code == 200
    d_poly = resp_poly.json()
    assert d_poly["onset_shift_days"] is None
    print(f"PASS test_anomaly_custom_poly: onset_shift_days={d_poly['onset_shift_days']}")


def test_input_validation_errors():
    """Verify invalid parameters return 400 Bad Request."""
    # Bad month
    r1 = client.get("/anomaly?month=invalid")
    assert r1.status_code == 400

    # Bad bbox format
    r2 = client.get("/export.csv?bbox=not,a,valid,bbox,shape")
    assert r2.status_code == 400

    # Bad polygon
    r3 = client.get("/export_analytics.csv?polygon=not-valid-geojson")
    assert r3.status_code == 400
    print("PASS test_input_validation_errors: 400 returned for malformed inputs")


if __name__ == "__main__":
    test_validation_endpoint()
    test_export_csv_endpoint()
    test_export_analytics_csv_endpoint()
    test_anomaly_pb_hr_aligned()
    test_anomaly_other_presets_and_custom()
    test_input_validation_errors()
    print("\n=========================================")
    print("ALL TASK B5 TESTS COMPLETED SUCCESSFULLY!")
    print("=========================================")
