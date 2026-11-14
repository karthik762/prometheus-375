"""D2 - Grid cleaned hotspots to 0.25 deg cells x month x satellite.

Reads data/interim/clean_<region>.parquet (from 01_clean.py) and writes
data/interim/grid_<region>.parquet with one row per cell x month x satellite:

  region, cell_id, lat, lon, month (YYYY-MM), sensor_family, satellite,
  n_hotspots, n_days, frp_sum

Cells (contract format, matches data-sample):
  centre = floor(x / 0.25) * 0.25 + 0.125   for lat and lon
  cell_id = f"{lat:.3f}_{lon:.3f}"           e.g. "28.625_73.875"

Zero-filling (D3/D4 need explicit zeros for ratios and medians):
  every cell with >= 1 hotspot from ANY satellite gets a row for every month
  each satellite was operating (window below), n_hotspots = 0 where none.
  Cells that never burned get no rows. A satellite is only filled for a region
  if that region's clean file contains it (no download -> no fake zeros).

Checks: sum(n_hotspots) per satellite == clean row count per satellite;
(cell_id, month, satellite) is unique; no hotspot falls outside its window.

Usage:
  python pipeline/02_grid.py                    # all regions with a clean file
  python pipeline/02_grid.py --region india
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import duckdb

REPO_ROOT = Path(__file__).resolve().parents[1]
INTERIM = REPO_ROOT / "data" / "interim"

CELL_DEG = 0.25
LAST_MONTH = "2026-11"
# satellite -> (sensor_family, first operating month, last month)
SAT_WINDOWS = {
    "Terra":  ("MODIS", "2000-11", LAST_MONTH),
    "Aqua":   ("MODIS", "2002-07", LAST_MONTH),
    "SNPP":   ("VIIRS", "2012-01", LAST_MONTH),
    "NOAA20": ("VIIRS", "2018-04", LAST_MONTH),
    "NOAA21": ("VIIRS", "2023-03", LAST_MONTH),
}
SAT_ORDER = list(SAT_WINDOWS)


def q(path: Path) -> str:
    return "'" + str(path).replace("\\", "/").replace("'", "''") + "'"


def available_regions() -> list[str]:
    return sorted(p.stem.removeprefix("clean_") for p in INTERIM.glob("clean_*.parquet"))


def grid_region(con: duckdb.DuckDBPyConnection, region: str) -> dict:
    t0 = time.time()
    src = INTERIM / f"clean_{region}.parquet"
    out = INTERIM / f"grid_{region}.parquet"

    con.execute("CREATE OR REPLACE TEMP TABLE sat_windows "
                "(satellite VARCHAR, sensor_family VARCHAR, first_month DATE, last_month DATE)")
    con.executemany("INSERT INTO sat_windows VALUES (?, ?, ?, ?)",
                    [(s, f, f"{a}-01", f"{b}-01") for s, (f, a, b) in SAT_WINDOWS.items()])

    # Hotspots with their cell centre and month start.
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE pts AS
        SELECT floor(lat / {CELL_DEG}) * {CELL_DEG} + {CELL_DEG / 2} AS clat,
               floor(lon / {CELL_DEG}) * {CELL_DEG} + {CELL_DEG / 2} AS clon,
               date_trunc('month', acq_date)::DATE AS m,
               acq_date, frp, sensor_family, satellite
        FROM read_parquet({q(src)})
    """)

    clean_counts = dict(con.execute(
        "SELECT satellite, count(*) FROM pts GROUP BY 1").fetchall())
    unknown = set(clean_counts) - set(SAT_WINDOWS)
    if unknown:
        sys.exit(f"ERROR [{region}]: unknown satellites in clean file: {unknown}")
    bad = con.execute("""
        SELECT p.satellite, count(*), min(p.m), max(p.m)
        FROM pts p JOIN sat_windows w USING (satellite)
        WHERE p.m < w.first_month OR p.m > w.last_month OR p.sensor_family <> w.sensor_family
        GROUP BY 1
    """).fetchall()
    if bad:
        sys.exit(f"ERROR [{region}]: hotspots outside satellite window / wrong family: {bad}")

    # Observed aggregates.
    con.execute("""
        CREATE OR REPLACE TEMP TABLE obs AS
        SELECT clat, clon, m, satellite,
               count(*) AS n_hotspots,
               count(DISTINCT acq_date) AS n_days,
               coalesce(sum(frp), 0) AS frp_sum
        FROM pts GROUP BY ALL
    """)

    # Zero-filled frame: burned cells x (satellites present in region) x their months.
    con.execute("""
        CREATE OR REPLACE TEMP TABLE frame AS
        WITH cells AS (SELECT DISTINCT clat, clon FROM obs),
             sats AS (SELECT w.* FROM sat_windows w
                      WHERE w.satellite IN (SELECT DISTINCT satellite FROM pts)),
             months AS (
                SELECT satellite, sensor_family,
                       unnest(generate_series(first_month, last_month, INTERVAL 1 MONTH))::DATE AS m
                FROM sats)
        SELECT c.clat, c.clon, mo.m, mo.satellite, mo.sensor_family
        FROM cells c CROSS JOIN months mo
    """)

    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE grid AS
        SELECT '{region}' AS region,
               printf('%.3f_%.3f', f.clat, f.clon) AS cell_id,
               f.clat AS lat, f.clon AS lon,
               strftime(f.m, '%Y-%m') AS month,
               f.sensor_family, f.satellite,
               coalesce(o.n_hotspots, 0)::BIGINT AS n_hotspots,
               coalesce(o.n_days, 0)::BIGINT AS n_days,
               coalesce(o.frp_sum, 0)::DOUBLE AS frp_sum
        FROM frame f
        LEFT JOIN obs o USING (clat, clon, m, satellite)
        ORDER BY cell_id, month,
                 CASE f.satellite {' '.join(f"WHEN '{s}' THEN {i}" for i, s in enumerate(SAT_ORDER))} END
    """)

    # --- checks --------------------------------------------------------------
    grid_counts = dict(con.execute(
        "SELECT satellite, sum(n_hotspots)::BIGINT FROM grid GROUP BY 1").fetchall())
    for sat, n in clean_counts.items():
        assert grid_counts.get(sat, 0) == n, \
            f"[{region}] {sat}: grid sum {grid_counts.get(sat, 0):,} != clean rows {n:,}"
    obs_rows = con.execute("SELECT count(*) FROM obs").fetchone()[0]
    nonzero = con.execute("SELECT count(*) FROM grid WHERE n_hotspots > 0").fetchone()[0]
    assert nonzero == obs_rows, f"[{region}] {obs_rows:,} observed groups but {nonzero:,} non-zero rows"
    dupes = con.execute("""
        SELECT count(*) FROM (SELECT cell_id, month, satellite FROM grid
                              GROUP BY ALL HAVING count(*) > 1)
    """).fetchone()[0]
    assert dupes == 0, f"[{region}] {dupes} duplicate (cell_id, month, satellite) keys"

    con.execute(f"COPY grid TO {q(out)} (FORMAT PARQUET, COMPRESSION ZSTD)")

    n_cells, n_rows = con.execute(
        "SELECT count(DISTINCT cell_id), count(*) FROM grid").fetchone()
    per_sat = con.execute("""
        SELECT satellite, count(*) AS rows, sum(n_hotspots)::BIGINT AS hotspots,
               count(*) FILTER (WHERE n_hotspots > 0) AS nonzero_rows,
               min(month), max(month)
        FROM grid GROUP BY 1
    """).fetchall()
    per_sat.sort(key=lambda r: SAT_ORDER.index(r[0]))

    print(f"\n=== {region.upper()} ===  cells={n_cells:,}  rows={n_rows:,}  "
          f"-> {out.name}  ({time.time() - t0:.0f}s)")
    print(f"  {'satellite':<8}{'rows':>12}{'nonzero':>10}{'hotspots':>13}{'clean':>13}"
          f"  {'months':<17} check")
    for sat, rows, hs, nz, mn, mx in per_sat:
        ok = "OK" if hs == clean_counts[sat] else "MISMATCH"
        print(f"  {sat:<8}{rows:>12,}{nz:>10,}{hs:>13,}{clean_counts[sat]:>13,}"
              f"  {mn}..{mx}  {ok}")
    missing = [s for s in SAT_ORDER if s not in clean_counts]
    if missing:
        print(f"  (not in clean file, not filled: {', '.join(missing)})")
    return {"region": region, "cells": n_cells, "rows": n_rows}


def main() -> None:
    regions = available_regions()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--region", choices=regions + ["all"], default="all",
                    help="region to grid (default: all with a clean_<region>.parquet)")
    ap.add_argument("--threads", type=int, default=None, help="DuckDB threads")
    args = ap.parse_args()
    if not regions:
        sys.exit(f"ERROR: no clean_*.parquet in {INTERIM}; run 01_clean.py first")

    con = duckdb.connect()
    con.execute(f"SET temp_directory = {q(INTERIM / '.duckdb_tmp')}")
    if args.threads:
        con.execute(f"SET threads = {args.threads}")

    for region in (regions if args.region == "all" else [args.region]):
        grid_region(con, region)


if __name__ == "__main__":
    main()
