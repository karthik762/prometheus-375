"""D6a - Monthly anomalies vs the same calendar month of all prior years.

Reads data/processed/harmonized_<region>.parquet (05_series) and, for the
month-to-date row, data/interim/clean_<region>.parquet + cell_zone/fit (04_fit).
Writes data/processed/anomaly_<region>.parquet, one row per area x month:

  area_id, month (YYYY-MM), current, median, p10, p90, z_score, percentile,
  n_prior_years, modis_share, month_to_date, mtd_days

Areas: the whole region (area_id = region name) and, for India, pb_hr
(Punjab + Haryana, cell centre lat 27.5-32.5, lon 73.5-77.5, as in 04_fit).

Full months: current = sum of harmonized_count over the area's cells. The
baseline is the same calendar month in every earlier year (from 2000-11 on):
  median, p10, p90  numpy percentiles (linear) of the prior-year values
  z_score           (current - mean) / max(sample std, 1.0); the floor of one
                    hotspot keeps fire-free months from dividing by ~0
  percentile        % of prior years below current, ties count half
  modis_share       fraction of the month's count that is modis_converted
                    (fraction of rows when the count is 0)
Stats need >= 1 prior year (z_score >= 2); they are asserted non-NaN when
n_prior_years >= 5.

Month to date (2026-11, month_to_date = True): data stops mid-month, so the
full-month row is replaced by a day-matched one. N = last day every
still-delivering satellite has data (pooled over regions, SNPP excluded since it
retired 2026-11-02). For each year, Nov 1..N is summed from daily
satellite-averaged counts (daily_counts.py: per-satellite average over satellites
active that day, MODIS x D4 ratio for Nov per zone). A year uses VIIRS if a VIIRS
satellite is active on every one of those days, otherwise converted MODIS. No
scaling to a full month.

Check: the same daily method over a full November reproduces the 05_series
monthly total for every year 2000..2025 (asserted).

Usage:
  python pipeline/07_anomaly.py                  # all regions with a harmonized file
  python pipeline/07_anomaly.py --region india
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
import time
from pathlib import Path

import duckdb
import numpy as np

from daily_counts import (
    PRESET_AREAS,
    PROCESSED,
    REPO_ROOT,
    INTERIM,
    areas,
    build_daily,
    data_end,
    preset_inputs,
    q,
    sat_windows,
)

MTD_MONTH = "2026-11"
MIN_PRIOR = 5
Z_STD_FLOOR = 1.0
FEATURE_AREA = "pb_hr"


def available_regions() -> list[str]:
    return sorted(p.stem.removeprefix("harmonized_") for p in PROCESSED.glob("harmonized_*.parquet")
                  if p.stem != "harmonized_nonzero")


def stats(cur: float, prior: np.ndarray) -> dict:
    n = len(prior)
    nan = float("nan")
    if n == 0:
        return dict(median=nan, p10=nan, p90=nan, z_score=nan, percentile=nan, n_prior_years=0)
    p10, med, p90 = np.percentile(prior, [10, 50, 90])
    z = (cur - prior.mean()) / \
        max(prior.std(ddof=1), Z_STD_FLOOR) if n >= 2 else nan
    pct = 100.0 * (np.sum(prior < cur) + 0.5 * np.sum(prior == cur)) / n
    return dict(median=float(med), p10=float(p10), p90=float(p90), z_score=float(z),
                percentile=float(pct), n_prior_years=n)


def anomaly_region(
    con: duckdb.DuckDBPyConnection,
    region: str,
    windows: dict,
    end: dt.date,
    preset_id: str | None = None,
    preset_clean_path: Path | None = None,
) -> None:
    t0 = time.time()
    harm = PROCESSED / f"harmonized_{region}.parquet"
    out = (PROCESSED / f"anomaly_preset_{preset_id}.parquet" if preset_id
           else PROCESSED / f"anomaly_{region}.parquet")
    if preset_id and out.exists():
        raise FileExistsError(
            f"Refusing to overwrite preset anomaly output: {out}")
    assert end.strftime(
        "%Y-%m") == MTD_MONTH, f"data ends {end}, expected inside {MTD_MONTH}"

    # --- monthly area totals from 05_series ----------------------------------
    area_sql = " UNION ALL ".join(
        f"SELECT '{a}' AS area_id, * FROM h WHERE {pred}"
        for a, pred in areas(region, preset_id))
    monthly = con.execute(f"""
        WITH h AS (SELECT *, lat AS clat, lon AS clon FROM read_parquet({q(harm)})),
             a AS ({area_sql})
        SELECT area_id, month, sum(harmonized_count) AS total,
               coalesce(sum(harmonized_count) FILTER (WHERE source = 'modis_converted'), 0) AS mc,
               avg((source = 'modis_converted')::INTEGER) AS row_share
        FROM a GROUP BY ALL ORDER BY area_id, month
    """).fetchall()

    # --- month-to-date and full-November check via daily counts --------------
    build_daily(con, region, windows, end,
                clean_path=preset_clean_path, preset_id=preset_id)
    nov = con.execute(f"""
        SELECT area_id, year(d) AS y, (day(d) <= {end.day}) AS in_mtd,
               min(n_viirs) AS min_nv, sum(viirs) AS v, sum(modis_conv) AS m, count(*) AS days
        FROM daily WHERE month(d) = 11
        GROUP BY GROUPING SETS ((area_id, y, in_mtd), (area_id, y))
    """).fetchall()
    full_nov, mtd = {}, {}
    for area, y, in_mtd, min_nv, v, m, days in nov:
        val, src = (v, "viirs") if min_nv and min_nv > 0 else (
            m, "modis_converted")
        if in_mtd is None:
            full_nov[(area, y)] = (val, src, days)
        elif in_mtd:
            assert days == end.day, f"[{region}] {area} {y}: {days} MTD days, expected {end.day}"
            mtd[(area, y)] = (val, src)

    totals = {(a, m): t for a, m, t, *_ in monthly}
    n_checked = 0
    for (area, y), (val, src, days) in full_nov.items():
        if y >= int(MTD_MONTH[:4]):
            continue
        ref = totals[(area, f"{y}-11")]
        assert days == 30
        assert abs(val - ref) <= 1e-6 * max(1.0, abs(ref)), \
            f"[{region}] {area} {y}-11: daily method {val:,.3f} != monthly {ref:,.3f}"
        n_checked += 1

    # --- stats ----------------------------------------------------------------
    rows = []
    by_area: dict[str, dict[str, float]] = {}
    for area, month, total, mc, row_share in monthly:
        by_area.setdefault(area, {})[month] = total
    meta = {(a, m): (t, mc, rs) for a, m, t, mc, rs in monthly}
    for area, series in by_area.items():
        for month, cur in series.items():
            y, moy = int(month[:4]), month[5:]
            if month == MTD_MONTH:
                cur, src = mtd[(area, y)]
                prior = np.array([mtd[(area, py)][0]
                                 for py in range(y - 30, y) if (area, py) in mtd])
                share = 1.0 if src == "modis_converted" else 0.0
                rows.append(dict(area_id=area, month=month, current=float(cur), **stats(cur, prior),
                                 modis_share=share, month_to_date=True, mtd_days=end.day))
                continue
            prior = np.array(
                [series[f"{py}-{moy}"] for py in range(y - 30, y) if f"{py}-{moy}" in series])
            t, mc, rs = meta[(area, month)]
            share = mc / t if t > 0 else rs
            rows.append(dict(area_id=area, month=month, current=float(cur), **stats(cur, prior),
                             modis_share=float(share), month_to_date=False, mtd_days=None))

    # --- asserts --------------------------------------------------------------
    for r in rows:
        tag = f"[{region}] {r['area_id']} {r['month']}"
        if r["n_prior_years"] >= MIN_PRIOR:
            for k in ("median", "p10", "p90", "z_score", "percentile", "current", "modis_share"):
                assert np.isfinite(
                    r[k]), f"{tag}: {k} is {r[k]} with {r['n_prior_years']} prior years"
        if r["n_prior_years"] >= 1:
            assert r["p10"] <= r["median"] + 1e-9 and r["median"] <= r["p90"] + 1e-9, \
                f"{tag}: p10 {r['p10']} <= median {r['median']} <= p90 {r['p90']} fails"
        assert r["current"] >= 0 and 0 <= r["modis_share"] <= 1, tag
    keys = {(r["area_id"], r["month"]) for r in rows}
    assert len(keys) == len(rows), f"[{region}] duplicate (area_id, month)"
    assert sum(r["month_to_date"]
               for r in rows) == len(areas(region, preset_id))

    con.execute("""
        CREATE OR REPLACE TEMP TABLE anom (area_id VARCHAR, month VARCHAR, current DOUBLE,
            median DOUBLE, p10 DOUBLE, p90 DOUBLE, z_score DOUBLE, percentile DOUBLE,
            n_prior_years INTEGER, modis_share DOUBLE, month_to_date BOOLEAN, mtd_days INTEGER)
    """)
    cols = ["area_id", "month", "current", "median", "p10", "p90", "z_score", "percentile",
            "n_prior_years", "modis_share", "month_to_date", "mtd_days"]
    con.executemany(f"INSERT INTO anom VALUES ({', '.join('?' * len(cols))})",
                    [[None if isinstance(r[c], float) and np.isnan(r[c]) else r[c] for c in cols]
                     for r in rows])
    con.execute(f"COPY (SELECT * FROM anom ORDER BY area_id, month) TO {q(out)} "
                f"(FORMAT PARQUET, COMPRESSION ZSTD)")

    print(f"\n=== {region.upper()} ===  areas={', '.join(a for a, _ in areas(region, preset_id))}  rows={len(rows):,}"
          f"  -> {out.relative_to(REPO_ROOT)}  ({time.time() - t0:.0f}s)")
    print(
        f"  daily method == 05_series monthly total for {n_checked} full Novembers (2000..2025)")
    for r in sorted((r for r in rows if r["month_to_date"]), key=lambda r: r["area_id"] != FEATURE_AREA):
        src = "modis_converted" if r["modis_share"] == 1 else "viirs"
        print(f"  {r['area_id']:<10} {MTD_MONTH} MTD (Nov 1-{end.day}, {src}): current {r['current']:,.0f}"
              f"  median {r['median']:,.0f}  p10 {r['p10']:,.0f}  p90 {r['p90']:,.0f}"
              f"  percentile {r['percentile']:.0f}  z {r['z_score']:+.2f}  (n={r['n_prior_years']})")
    if region == "india":
        print(f"  {FEATURE_AREA} month-to-date baseline, Nov 1-{end.day} by year:")
        line = []
        for y in range(2000, int(MTD_MONTH[:4]) + 1):
            if (FEATURE_AREA, y) in mtd:
                v, s = mtd[(FEATURE_AREA, y)]
                line.append(
                    f"{y}:{v:,.0f}{'m' if s == 'modis_converted' else ''}")
        for i in range(0, len(line), 7):
            print("    " + "  ".join(line[i:i + 7]))
        print("    (m = converted MODIS year)")


def main() -> None:
    regions = available_regions()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    selection = ap.add_mutually_exclusive_group()
    selection.add_argument("--region", choices=regions + ["all"],
                           help="whole region(s) to process (default: all)")
    selection.add_argument("--preset", choices=sorted(PRESET_AREAS),
                           help="generate a preset-area sidecar output")
    ap.add_argument("--preset-input-dir", type=Path,
                    help="folder containing clean_<preset>.parquet extracts")
    ap.add_argument("--satellite-windows", type=Path,
                    help="CSV containing the global satellite windows in section A")
    args = ap.parse_args()
    if args.preset:
        if not args.preset_input_dir or not args.satellite_windows:
            ap.error("--preset requires --preset-input-dir and --satellite-windows")
        if not args.satellite_windows.is_file():
            ap.error(
                f"satellite windows file not found: {args.satellite_windows}")
        try:
            region, clean_path = preset_inputs(
                args.preset, args.preset_input_dir)
        except (FileNotFoundError, ValueError) as exc:
            ap.error(str(exc))
        if region not in regions:
            ap.error(
                f"no harmonized_<region>.parquet is available for {region}")
        runs = [(region, args.preset, clean_path)]
        windows_csv = args.satellite_windows
    else:
        if args.preset_input_dir or args.satellite_windows:
            ap.error("--preset-input-dir and --satellite-windows require --preset")
        if not regions:
            sys.exit(
                f"ERROR: no harmonized_*.parquet in {PROCESSED}; run 05_series.py first")
        selected = regions if args.region in (None, "all") else [args.region]
        runs = [(region, None, None) for region in selected]
        windows_csv = None

    if not regions:
        sys.exit(
            f"ERROR: no harmonized_*.parquet in {PROCESSED}; run 05_series.py first")

    con = duckdb.connect()
    con.execute(f"SET temp_directory = {q(INTERIM / '.duckdb_tmp')}")
    con.execute("SET enable_progress_bar = false")
    windows = sat_windows(con, windows_csv)
    end = data_end(windows)
    print("satellite windows (pooled clean files): " + ", ".join(
        f"{s} {a}..{b}" for s, (_, a, b) in sorted(windows.items(), key=lambda kv: kv[1][1])))
    print(
        f"month-to-date end N = {end} (last day all non-retired satellites have data)")
    for region, preset_id, clean_path in runs:
        anomaly_region(con, region, windows, end, preset_id, clean_path)


if __name__ == "__main__":
    main()
