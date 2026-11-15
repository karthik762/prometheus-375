"""
Non-India presets, latest (partial) month: S-NPP stopped 2 Nov 2026, so 2026-11 must be
day-matched (month_to_date + mtd_days, like Punjab) or no_data with reason "sensor gap" -
never Nov 1-13 against full past Novembers.

Run: python backend/test_preset_mtd.py   (or pytest backend/test_preset_mtd.py)
"""

import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

import backend.anomaly as anomaly_mod
from backend.main import _anomaly_cached, app

client = TestClient(app)

PRESET_BBOXES = {
    "brazil_pantanal": "-60.0,-22.0,-55.0,-16.0",
    "greece": "20.0,36.0,27.0,42.0",
    "australia_nsw": "149.0,-37.5,153.5,-31.5",
    "california": "-124.5,32.5,-114.0,42.0",
}
PB_HR = "73.5,27.5,77.5,32.5"


def _get(month, bbox):
    r = client.get("/anomaly", params={"month": month, "bbox": bbox})
    assert r.status_code == 200, r.text
    return r.json()


def test_brazil_nov_2026_is_mtd_or_no_data():
    d = _get("2026-11", PRESET_BBOXES["brazil_pantanal"])
    if d["no_data"]:
        assert d["reason"] == "sensor gap"
        assert d["percentile"] is None
    else:
        assert d["month_to_date"] is True
        assert d["mtd_days"] == 13


def test_all_non_india_presets_nov_2026_day_matched():
    for pid, bbox in PRESET_BBOXES.items():
        d = _get("2026-11", bbox)
        assert d["month_to_date"] is True or (d["no_data"] and d["reason"] == "sensor gap"), (pid, d)
        if not d["no_data"]:
            # day-matched median is far below a full-November median
            assert d["mtd_days"] == 13, (pid, d)
            assert d["percentile"] is not None


def test_brazil_nov_2026_values():
    d = _get("2026-11", PRESET_BBOXES["brazil_pantanal"])
    assert d["no_data"] is False and d["reason"] is None
    assert round(d["current"]) == 486
    assert round(d["median"]) == 1163  # Nov 1-13 median, not full-Nov 8k+
    assert round(d["percentile"]) == 12


def test_full_month_unchanged():
    # Oct 2026 is a complete S-NPP month: still a normal full-month comparison
    d = _get("2026-10", PRESET_BBOXES["brazil_pantanal"])
    assert d["no_data"] is False and d["month_to_date"] is False
    assert round(d["current"]) == 125
    assert round(d["median"]) == 8428


def test_punjab_unchanged():
    d = _get("2026-11", PB_HR)
    assert round(d["current"]) == 2913
    assert round(d["median"]) == 24037
    assert d["month_to_date"] is True and d["mtd_days"] == 13
    assert d["no_data"] is False


def test_sensor_gap_when_no_day_matched_baseline():
    _anomaly_cached.cache_clear()
    try:
        with mock.patch.object(anomaly_mod, "read_preset_mtd_anomaly", return_value=None):
            d = _get("2026-11", PRESET_BBOXES["greece"])
        assert d["no_data"] is True
        assert d["reason"] == "sensor gap"
        assert d["percentile"] is None and d["current"] is None
    finally:
        _anomaly_cached.cache_clear()


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
