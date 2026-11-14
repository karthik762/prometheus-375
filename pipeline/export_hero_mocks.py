"""Export one compact hero-chart JSON per region for the frontend.

Writes frontend/src/mocks/hero_<region>.json for pb_hr (Punjab + Haryana, India),
brazil, california, australia, greece:

  {region, label, satellites: [{name, start, end|null}],
   years: [{year, raw, harmonized, lo, hi, source, partial?}],
   (pb_hr only) nov_mtd_2026, nov_mtd_median, pct}

Annual totals per region (sum over the region's 0.25 deg cells):
  raw         sum of before_after.raw         (all satellites' hotspots, un-averaged)
  harmonized  sum of harmonized.harmonized_count
  lo / hi     harmonized -/+ sum(uncertainty), lo floored at 0 (same as backend /calendar)
  source      the source most months of that year carry ('viirs' | 'modis_converted')
  partial     true for 2000 (Nov-Dec only) and 2026 (Jan 1 - Nov 13)

2026-11 is cut to Nov 1-13 (the last day every still-delivering satellite has data;
Terra runs one day longer). Harmonized Nov MTD = the day-matched `current` from
anomaly_<region>.parquet (07_anomaly), the same number the now-vs-normal card shows;
raw Nov MTD = clean hotspots with acq_date <= Nov 13; uncertainty is scaled by
MTD / full-row harmonized.

Inputs (all gitignored): data/processed/{harmonized,before_after,harmonized_<r>,
anomaly_<r>}.parquet and data/interim/clean_<r>.parquet.

Usage:  python pipeline/export_hero_mocks.py
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

import duckdb

REPO_ROOT = Path(__file__).resolve().parents[1]
PROCESSED = REPO_ROOT / "data" / "processed"
INTERIM = REPO_ROOT / "data" / "interim"
OUT_DIR = REPO_ROOT / "frontend" / "src" / "mocks"

MAX_BYTES = 20_000
CELL_DEG = 0.25
PB_HR = {"lat": (27.5, 32.5), "lon": (73.5, 77.5)}  # same box as 04_fit / daily_counts
PARTIAL_MONTH = "2026-11"

# Expected pb_hr month-to-date figures (Nov 1-13 2026); fail loudly if the data disagrees.
EXPECT_PB_HR = {"nov_mtd_2026": 2913, "nov_mtd_median": 24037, "pct": 12}

SATS_BASE = [
    {"name": "Terra", "start": "2000-11", "end": None},
    {"name": "Aqua", "start": "2002-07", "end": None},
    {"name": "S-NPP", "start": "2012-01", "end": "2026-11-02"},
]
SATS_INDIA = SATS_BASE + [
    {"name": "NOAA-20", "start": "2018-04", "end": None},
    {"name": "NOAA-21", "start": "2023-03", "end": None},
]

# hero id -> (source region file, label, area_id in anomaly parquet, in pb_hr box?)
HEROES = {
    "pb_hr": ("india", "Punjab & Haryana, India", "pb_hr", True),
    "brazil": ("brazil", "Brazil", "brazil", False),
    "california": ("california", "California, USA", "california", False),
    "australia": ("australia", "Australia", "australia", False),
    "greece": ("greece", "Greece", "greece", False),
}


def q(path: Path) -> str:
    assert path.exists(), f"missing input: {path}"
    return "'" + str(path).replace("\\", "/").replace("'", "''") + "'"


def box_pred(lat: str, lon: str) -> str:
    (a, b), (c, d) = PB_HR["lat"], PB_HR["lon"]
    return f"{lat} BETWEEN {a} AND {b} AND {lon} BETWEEN {c} AND {d}"


def r1(x: float) -> float:
    return round(float(x), 1)


def build(con: duckdb.DuckDBPyConnection, hero: str) -> tuple[dict, dict]:
    region, label, area_id, in_box = HEROES[hero]
    H, BA = PROCESSED / "harmonized.parquet", PROCESSED / "before_after.parquet"
    HR = PROCESSED / f"harmonized_{region}.parquet"
    AN = PROCESSED / f"anomaly_{region}.parquet"
    CL = INTERIM / f"clean_{region}.parquet"

    # Cells of this hero: the region's cells, optionally restricted to the pb_hr box.
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE cells AS
        SELECT DISTINCT cell_id, lat, lon FROM read_parquet({q(HR)})
        {"WHERE " + box_pred("lat", "lon") if in_box else ""}
    """)
    n_cells = con.execute("SELECT count(*) FROM cells").fetchone()[0]
    assert n_cells > 0, f"[{hero}] no cells"

    monthly = con.execute(f"""
        SELECT h.month,
               sum(h.harmonized_count) AS harm,
               sum(h.uncertainty) AS unc,
               sum(b.raw) AS raw,
               mode(h.source) AS source,
               count(*) AS n,
               count(b.raw) AS n_ba
        FROM read_parquet({q(H)}) h
        JOIN cells USING (cell_id)
        LEFT JOIN read_parquet({q(BA)}) b USING (cell_id, month)
        GROUP BY h.month ORDER BY h.month
    """).fetchall()
    for month, *_, n, n_ba in monthly:
        assert n == n_cells, f"[{hero}] {month}: {n} cell rows, expected {n_cells}"
        assert n_ba == n_cells, f"[{hero}] {month}: {n_cells - n_ba} cells missing in before_after"
    months = {m: dict(harm=h, unc=u, raw=r, source=s) for m, h, u, r, s, _, _ in monthly}
    assert min(months) == "2000-11" and max(months) == PARTIAL_MONTH, \
        f"[{hero}] month range {min(months)}..{max(months)}"

    # --- Nov 2026: cut to the month-to-date window --------------------------------
    an = con.execute(f"""
        SELECT current, median, mtd_days FROM read_parquet({q(AN)})
        WHERE area_id = ? AND month = ? AND month_to_date
    """, [area_id, PARTIAL_MONTH]).fetchall()
    assert len(an) == 1, f"[{hero}] expected 1 MTD anomaly row for {area_id} {PARTIAL_MONTH}, got {len(an)}"
    mtd_cur, mtd_med, mtd_days = an[0]
    mtd_end = dt.date(2026, 11, mtd_days)
    clat = f"floor(lat / {CELL_DEG}) * {CELL_DEG} + {CELL_DEG / 2}"
    clon = f"floor(lon / {CELL_DEG}) * {CELL_DEG} + {CELL_DEG / 2}"
    raw_mtd, raw_full = con.execute(f"""
        SELECT count(*) FILTER (WHERE acq_date <= DATE '{mtd_end}'), count(*)
        FROM read_parquet({q(CL)})
        WHERE acq_date >= DATE '2026-11-01' AND acq_date < DATE '2026-12-01'
        {"AND " + box_pred(clat, clon) if in_box else ""}
    """).fetchone()
    nov = months[PARTIAL_MONTH]
    assert raw_full == nov["raw"], \
        f"[{hero}] clean Nov 2026 raw {raw_full:,} != before_after {nov['raw']:,.0f} (cell mapping drift)"
    # MTD is <= full month only when the extra Terra day isn't outweighed by the averaging method;
    # sanity-check it is within 10 % of the monthly row instead.
    assert abs(mtd_cur - nov["harm"]) <= 0.10 * max(nov["harm"], 1), \
        f"[{hero}] Nov MTD {mtd_cur:,.1f} far from monthly {nov['harm']:,.1f}"
    scale = mtd_cur / nov["harm"] if nov["harm"] else 0.0
    months[PARTIAL_MONTH] = dict(harm=mtd_cur, unc=nov["unc"] * scale, raw=float(raw_mtd),
                                 source=nov["source"])

    # --- annual totals -------------------------------------------------------------
    years = []
    for y in range(2000, 2027):
        ms = [v for m, v in months.items() if m.startswith(f"{y}-")]
        assert ms, f"[{hero}] no months for {y}"
        harm = sum(v["harm"] for v in ms)
        unc = sum(v["unc"] for v in ms)
        srcs = [v["source"] for v in ms]
        row = dict(year=y, raw=r1(sum(v["raw"] for v in ms)), harmonized=r1(harm),
                   lo=r1(max(0.0, harm - unc)), hi=r1(harm + unc),
                   source=max(set(srcs), key=srcs.count))
        if y in (2000, 2026):
            row["partial"] = True
        years.append(row)

    out = dict(region=hero, label=label,
               satellites=SATS_INDIA if region == "india" else SATS_BASE,
               years=years)
    pct = 100.0 * mtd_cur / mtd_med
    if hero == "pb_hr":
        got = {"nov_mtd_2026": round(mtd_cur), "nov_mtd_median": round(mtd_med), "pct": round(pct)}
        if got != EXPECT_PB_HR:
            sys.exit(f"ASSERT FAILED [pb_hr] expected {EXPECT_PB_HR}, data gives {got} "
                     f"(raw: current={mtd_cur:.3f}, median={mtd_med:.3f}, pct={pct:.2f})")
        out.update(got)
    info = dict(cells=n_cells, mtd_end=mtd_end, mtd=mtd_cur, med=mtd_med, pct=pct)
    return out, info


def main() -> None:
    con = duckdb.connect()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for hero in HEROES:
        data, info = build(con, hero)
        path = OUT_DIR / f"hero_{hero}.json"
        text = json.dumps(data, separators=(",", ":"))
        size = len(text.encode("utf-8"))
        assert size < MAX_BYTES, f"[{hero}] {path.name} is {size:,} bytes (limit {MAX_BYTES:,})"
        path.write_text(text + "\n", encoding="utf-8")
        ys = {r["year"]: r for r in data["years"]}
        peak = max((r for r in data["years"] if not r.get("partial")), key=lambda r: r["harmonized"])
        rows.append((path.name, info["cells"], len(data["satellites"]), ys[2025]["harmonized"],
                     ys[2026]["harmonized"], ys[2026]["raw"], f"{peak['year']}",
                     info["mtd"], info["med"], info["pct"], size))

    hdr = ("file", "cells", "sats", "2025 harm", "2026* harm", "2026* raw", "peak yr",
           "Nov MTD", "Nov median", "pct", "bytes")
    fmt = "{:<24}{:>7}{:>6}{:>12}{:>12}{:>12}{:>9}{:>10}{:>12}{:>6}{:>8}"
    print(fmt.format(*hdr))
    print("-" * 118)
    for r in rows:
        print(fmt.format(r[0], r[1], r[2], f"{r[3]:,.0f}", f"{r[4]:,.0f}", f"{r[5]:,.0f}", r[6],
                         f"{r[7]:,.0f}", f"{r[8]:,.0f}", f"{r[9]:.0f}%", f"{r[10]:,}"))
    print(f"* 2026 = Jan 1 - Nov {info['mtd_end'].day} (partial). pb_hr MTD asserts passed: {EXPECT_PB_HR}")


if __name__ == "__main__":
    main()
