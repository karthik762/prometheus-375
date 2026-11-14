"""
Verification test suite for updated GET /validation endpoint:
1. Default call (defaults to pb_hr / 73.5,27.5,77.5,32.5)
2. Explicit bbox call
3. Explicit area call (multi-key caching separation)
4. partial == True for 2026-11, False for all others
5. source calculation including 'mixed' handling
6. 400 Bad Request on invalid bbox
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
import duckdb
from backend.main import app

client = TestClient(app)


def test_default_validation():
    """Verify default GET /validation defaults to pb_hr and includes partial flag."""
    resp = client.get("/validation")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()

    assert data["holdout_year"] == 2020
    assert data["mae"] > 0
    assert data["mape"] > 0
    assert len(data["before_after"]) == 313, f"Expected 313 months, got {len(data['before_after'])}"

    # First row (2000-11)
    first_row = data["before_after"][0]
    assert first_row["month"] == "2000-11"
    assert first_row["raw"] == 65.0
    assert first_row["harmonized"] == 618.58
    assert first_row["source"] == "modis_converted"
    assert first_row["uncertainty_lo"] == 580.95
    assert first_row["uncertainty_hi"] == 656.21
    assert first_row["partial"] is False

    # Last row (2026-11)
    last_row = data["before_after"][-1]
    assert last_row["month"] == "2026-11"
    assert last_row["raw"] == 10789.0
    assert last_row["harmonized"] == 2927.0
    assert last_row["source"] == "viirs"
    assert last_row["partial"] is True

    # Check partial flag distribution
    partials = [r["month"] for r in data["before_after"] if r.get("partial") is True]
    assert partials == ["2026-11"], f"Only 2026-11 should have partial: True, got {partials}"

    print(f"PASS test_default_validation: {len(data['before_after'])} months, 2026-11 partial=True")


def test_explicit_bbox_validation():
    """Verify explicit bbox returns correct filtered data."""
    resp = client.get("/validation?bbox=73.5,27.5,77.5,32.5")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["before_after"]) == 313
    assert data["before_after"][0]["month"] == "2000-11"
    assert data["before_after"][0]["raw"] == 65.0
    print("PASS test_explicit_bbox_validation: matches pb_hr data")


def test_area_query_and_caching():
    """Verify area=brazil returns Brazil filtered data and doesn't pollute pb_hr cache."""
    # 1. Fetch Brazil
    resp_br = client.get("/validation?area=brazil")
    assert resp_br.status_code == 200
    data_br = resp_br.json()
    assert len(data_br["before_after"]) > 0
    br_first = data_br["before_after"][0]
    # Brazil 2000-11 numbers are distinct from Punjab/Haryana
    assert br_first["raw"] != 65.0
    print(f"PASS test_area_query_and_caching (Brazil): row_0 raw={br_first['raw']} != 65.0")

    # 2. Fetch default pb_hr again from cache
    resp_pb = client.get("/validation")
    assert resp_pb.status_code == 200
    data_pb = resp_pb.json()
    assert data_pb["before_after"][0]["raw"] == 65.0
    print("PASS test_area_query_and_caching (pb_hr cache intact): row_0 raw=65.0")


def test_mixed_source_sql_logic():
    """Verify CASE WHEN COUNT(DISTINCT h.source) > 1 THEN 'mixed' logic via DuckDB."""
    con = duckdb.connect()
    # Create a small in-memory table with 2 distinct sources for month 2020-01, 1 source for 2020-02
    con.execute("""
        CREATE TABLE mock_b (cell_id VARCHAR, month VARCHAR, raw DOUBLE, harmonized DOUBLE);
        CREATE TABLE mock_h (cell_id VARCHAR, month VARCHAR, source VARCHAR, uncertainty DOUBLE, lat DOUBLE, lon DOUBLE);
        
        INSERT INTO mock_b VALUES ('c1', '2020-01', 10, 20), ('c2', '2020-01', 15, 30), ('c1', '2020-02', 5, 10);
        INSERT INTO mock_h VALUES ('c1', '2020-01', 'modis_converted', 2, 28, 75), ('c2', '2020-01', 'viirs', 3, 29, 76), ('c1', '2020-02', 'viirs', 1, 28, 75);
    """)

    res = con.execute("""
        SELECT 
            b.month,
            CASE 
                WHEN COUNT(DISTINCT h.source) > 1 THEN 'mixed'
                ELSE COALESCE(MAX(h.source), 'viirs') 
            END AS source
        FROM mock_b b
        JOIN mock_h h ON b.cell_id = h.cell_id AND b.month = h.month
        GROUP BY b.month
        ORDER BY b.month ASC
    """).fetchall()

    assert res == [('2020-01', 'mixed'), ('2020-02', 'viirs')]
    print("PASS test_mixed_source_sql_logic: 2020-01='mixed', 2020-02='viirs'")


def test_validation_input_errors():
    """Verify invalid bbox returns 400 Bad Request."""
    resp = client.get("/validation?bbox=not,a,valid,bbox")
    assert resp.status_code == 400
    print("PASS test_validation_input_errors: 400 on invalid bbox")


if __name__ == "__main__":
    test_default_validation()
    test_explicit_bbox_validation()
    test_area_query_and_caching()
    test_mixed_source_sql_logic()
    test_validation_input_errors()
    print("\n=======================================================")
    print("ALL GET /validation UPDATE VERIFICATION TESTS PASSED!!")
    print("=======================================================")
