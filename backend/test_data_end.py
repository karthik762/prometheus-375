"""
Months past the end of harmonized.parquet:
/anomaly and /calendar?start → 400 "Data runs to <last>"; /calendar?end → clamped.

Run: python backend/test_data_end.py   (or pytest backend/test_data_end.py)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

from backend.main import app, last_data_month

client = TestClient(app)
BBOX = "73.5,27.5,77.5,32.5"


def _next_month(m: str) -> str:
    y, mm = map(int, m.split("-"))
    return f"{y + mm // 12}-{mm % 12 + 1:02d}"


def test_health_reports_data_end():
    last = last_data_month()
    assert last is not None
    assert client.get("/health").json()["data_end"] == last


def test_anomaly_past_end_is_400():
    last = last_data_month()
    resp = client.get("/anomaly", params={"month": _next_month(last), "bbox": BBOX})
    assert resp.status_code == 400
    assert resp.json()["detail"] == f"Data runs to {last}"


def test_anomaly_last_month_ok():
    resp = client.get("/anomaly", params={"month": last_data_month(), "bbox": BBOX})
    assert resp.status_code == 200


def test_calendar_start_past_end_is_400():
    last = last_data_month()
    resp = client.get("/calendar", params={"start": _next_month(last), "bbox": BBOX})
    assert resp.status_code == 400
    assert resp.json()["detail"] == f"Data runs to {last}"


def test_calendar_end_is_clamped():
    last = last_data_month()
    far = "2099-12"
    clamped = client.get("/calendar", params={"start": "2020-01", "end": far, "bbox": BBOX})
    exact = client.get("/calendar", params={"start": "2020-01", "end": last, "bbox": BBOX})
    assert clamped.status_code == 200
    assert clamped.json() == exact.json()
    assert clamped.json()[-1]["month"] <= last


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"PASS {name}")
