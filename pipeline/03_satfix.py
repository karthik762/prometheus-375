"""D3 - Per-satellite averaging within each sensor family.

Reads data/interim/grid_<region>.parquet (from 02_grid.py) and writes
data/interim/satfix_<region>.parquet with one row per cell x month x family:

  cell_id, lat, lon, month (YYYY-MM), family ('modis'|'viirs'), mean_count, n_sats

Why: raw totals jump every time a satellite joins (Aqua 2002, NOAA-20 2018,
NOAA-21 2023). Averaging per satellite keeps the family series on a
"one satellite" scale, so the sensor mix no longer creates fake trends.

Rules:
  * Active satellites per region come from the rows in the grid file, not from
    launch dates. Outside India the grid has no NOAA-20/21 rows, so VIIRS = SNPP.
  * Partial months are dropped before averaging: SNPP 2026-11 (stopped Nov 2) and
    each satellite's first month when it began mid-month (Aqua 2002-07 starts
    Jul 4, SNPP 2012-01 starts Jan 20). NOAA-20 2018-04 and NOAA-21 2023-03 are
    kept: their data starts on the 1st, so those months are complete.
  * mean_count = mean of n_hotspots over the active satellites of that family for
    that cell-month (02_grid zero-fills, so a satellite with no fires counts as 0).
    n_sats = number of satellites averaged.

India only: overlap check of SNPP / NOAA-20 / NOAA-21 national monthly totals
(2018-05..2026-10) -> data/interim/satfix_overlap_india.json, plus a sanity print
of raw vs averaged VIIRS totals around 2018-04 and 2023-03.

Usage:
  python pipeline/03_satfix.py                  # all regions with a grid file
  python pipeline/03_satfix.py --region india
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import duckdb

REPO_ROOT = Path(__file__).resolve().parents[1]
INTERIM = REPO_ROOT / "data" / "interim"

SAT_ORDER = ["Terra", "Aqua", "SNPP", "NOAA20", "NOAA21"]
# (satellite, month) -> reason. Only dropped where the grid actually has rows.
PARTIAL_MONTHS = {
    ("SNPP", "2026-11"): "SNPP stopped delivering 2026-11-02",
    ("Aqua", "2002-07"): "Aqua began mid-month",
    ("SNPP", "2012-01"): "SNPP began mid-month",
    # NOAA-20 (2018-04) and NOAA-21 (2023-03) are NOT dropped: FIRMS data starts
    # on the 1st (2018-04-01, 2023-03-01), so their first months are complete.
}

OVERLAP_START, OVERLAP_END = "2018-05", "2026-10"
RATIO_OK = (0.7, 1.4)
MIN_YEARS_FOR_R = 3
SANITY_WINDOWS = [("2017-12", "2018-08", "NOAA-20 joins 2018-04"),
                  ("2022-11", "2023-07", "NOAA-21 joins 2023-03")]


def q(path: Path) -> str:
    return "'" + str(path).replace("\\", "/").replace("'", "''") + "'"


def available_regions() -> list[str]:
    return sorted(p.stem.removeprefix("grid_") for p in INTERIM.glob("grid_*.parquet"))


def sat_key(sat: str) -> int:
    return SAT_ORDER.index(sat) if sat in SAT_ORDER else len(SAT_ORDER)


def satfix_region(con: duckdb.DuckDBPyConnection, region: str) -> None:
    t0 = time.time()
    src = INTERIM / f"grid_{region}.parquet"
    out = INTERIM / f"satfix_{region}.parquet"

    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE g AS
        SELECT cell_id, lat, lon, month, lower(sensor_family) AS family,
               satellite, n_hotspots
        FROM read_parquet({q(src)})
    """)

    # --- active satellites, from the rows present ---------------------------
    active = con.execute("""
        SELECT family, satellite, min(month), max(month), count(DISTINCT month)
        FROM g GROUP BY ALL
    """).fetchall()
    active.sort(key=lambda r: sat_key(r[1]))
    print(f"\n=== {region.upper()} ===")
    print("  active satellites (from grid rows):")
    for fam, sat, mn, mx, nm in active:
        print(f"    {fam:<6}{sat:<8}{mn}..{mx}  ({nm} months)")
    fams = {fam: [s for f, s, *_ in active if f == fam] for fam in ("modis", "viirs")}
    for fam, sats in fams.items():
        print(f"  {fam.upper()} = {' + '.join(sats) if sats else '(none)'}")

    # --- drop partial months ------------------------------------------------
    con.execute("CREATE OR REPLACE TEMP TABLE drops (satellite VARCHAR, month VARCHAR, reason VARCHAR)")
    con.executemany("INSERT INTO drops VALUES (?, ?, ?)",
                    [(s, m, r) for (s, m), r in PARTIAL_MONTHS.items()])
    dropped = con.execute("""
        SELECT d.satellite, d.month, d.reason, count(*) AS rows, sum(g.n_hotspots)::BIGINT AS hs
        FROM g JOIN drops d USING (satellite, month)
        GROUP BY ALL
    """).fetchall()
    dropped.sort(key=lambda r: (r[1], sat_key(r[0])))
    print("  dropped partial months:")
    if dropped:
        for sat, m, why, rows, hs in dropped:
            print(f"    {sat:<8}{m}  rows={rows:>9,}  hotspots={hs:>9,}  ({why})")
    else:
        print("    (none present in this grid)")

    con.execute("""
        CREATE OR REPLACE TEMP TABLE kept AS
        SELECT g.* FROM g ANTI JOIN drops d USING (satellite, month)
    """)

    # --- average per satellite ---------------------------------------------
    con.execute("""
        CREATE OR REPLACE TEMP TABLE satfix AS
        SELECT cell_id, any_value(lat) AS lat, any_value(lon) AS lon, month, family,
               avg(n_hotspots)::DOUBLE AS mean_count,
               count(*)::INTEGER AS n_sats
        FROM kept GROUP BY cell_id, month, family
        ORDER BY cell_id, month, family
    """)

    # --- checks -------------------------------------------------------------
    n_rows = con.execute("SELECT count(*) FROM satfix").fetchone()[0]
    n_bad = con.execute("""
        SELECT count(*) FILTER (WHERE mean_count IS NULL OR isnan(mean_count)),
               count(*) FILTER (WHERE n_sats < 1)
        FROM satfix
    """).fetchone()
    assert n_bad[0] == 0, f"[{region}] {n_bad[0]:,} NaN/NULL mean_count"
    assert n_bad[1] == 0, f"[{region}] {n_bad[1]:,} rows with n_sats < 1"
    groups_kept = con.execute(
        "SELECT count(*) FROM (SELECT DISTINCT cell_id, month, family FROM kept)").fetchone()[0]
    groups_grid = con.execute(
        "SELECT count(*) FROM (SELECT DISTINCT cell_id, month, family FROM g)").fetchone()[0]
    assert n_rows == groups_kept, \
        f"[{region}] satfix rows {n_rows:,} != (cell, month, family) groups in grid {groups_kept:,}"
    # Groups that vanish entirely = months where every satellite of the family was dropped.
    gone = con.execute("""
        SELECT family, month, count(*) FROM (
            SELECT DISTINCT cell_id, month, family FROM g
            EXCEPT SELECT DISTINCT cell_id, month, family FROM kept)
        GROUP BY ALL ORDER BY month
    """).fetchall()
    assert groups_grid - groups_kept == sum(r[2] for r in gone)
    # n_sats must equal the satellites active in that region-month (zero-fill is complete).
    mismatch = con.execute("""
        WITH act AS (SELECT month, family, count(DISTINCT satellite) AS k FROM kept GROUP BY ALL)
        SELECT count(*) FROM satfix s JOIN act a USING (month, family) WHERE s.n_sats <> a.k
    """).fetchone()[0]
    assert mismatch == 0, f"[{region}] {mismatch:,} rows where n_sats != active satellites that month"
    # Hotspots are conserved: sum(mean_count * n_sats) == sum(n_hotspots) kept.
    hs_kept, hs_back = con.execute("""
        SELECT (SELECT sum(n_hotspots) FROM kept), (SELECT sum(mean_count * n_sats) FROM satfix)
    """).fetchone()
    assert abs(hs_kept - hs_back) < 1e-6 * max(1, hs_kept), f"[{region}] hotspot sum {hs_kept} != {hs_back}"

    con.execute(f"COPY (SELECT cell_id, lat, lon, month, family, mean_count, n_sats FROM satfix) "
                f"TO {q(out)} (FORMAT PARQUET, COMPRESSION ZSTD)")

    print(f"  checks OK: rows={n_rows:,} == groups in grid after drops "
          f"(grid had {groups_grid:,}; {groups_grid - groups_kept:,} lost to drops"
          + (": " + ", ".join(f"{f} {m} x{n:,}" for f, m, n in gone) if gone else "") + ")")
    for fam, mn, mx, dist in con.execute("""
        SELECT family, min(month), max(month), string_agg(DISTINCT n_sats::VARCHAR, ',' ORDER BY n_sats::VARCHAR)
        FROM satfix GROUP BY 1 ORDER BY 1
    """).fetchall():
        print(f"    {fam:<6}{mn}..{mx}  n_sats in {{{dist}}}")
    print(f"  -> {out.relative_to(REPO_ROOT)}  ({time.time() - t0:.0f}s)")

    if region == "india":
        overlap_india(con)
        sanity_india(con)


def overlap_india(con: duckdb.DuckDBPyConnection) -> None:
    """National monthly totals of SNPP, NOAA-20, NOAA-21 over the overlap period."""
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE ov AS
        SELECT month, CAST(right(month, 2) AS INTEGER) AS moy,
               sum(n_hotspots) FILTER (WHERE satellite = 'SNPP')::DOUBLE   AS snpp,
               sum(n_hotspots) FILTER (WHERE satellite = 'NOAA20')::DOUBLE AS n20,
               sum(n_hotspots) FILTER (WHERE satellite = 'NOAA21')::DOUBLE AS n21
        FROM kept
        WHERE family = 'viirs' AND month BETWEEN '{OVERLAP_START}' AND '{OVERLAP_END}'
        GROUP BY month
    """)
    lo, hi = RATIO_OK

    def pair(num: str) -> dict:
        # Only months where both satellites are active and the denominator is non-zero.
        base = f"FROM ov WHERE {num} IS NOT NULL AND n20 IS NOT NULL AND n20 > 0"
        rows = con.execute(f"""
            SELECT moy, count(*) AS n, median({num} / n20) AS med,
                   min({num} / n20), max({num} / n20),
                   CASE WHEN count(*) >= {MIN_YEARS_FOR_R} THEN corr({num}, n20) END AS r
            {base} GROUP BY moy ORDER BY moy
        """).fetchall()
        overall = con.execute(f"""
            SELECT count(*), median({num} / n20), corr({num}, n20), min(month), max(month) {base}
        """).fetchone()
        outliers = con.execute(f"""
            SELECT month, round({num} / n20, 3) {base}
              AND ({num} / n20 < {lo} OR {num} / n20 > {hi}) ORDER BY month
        """).fetchall()
        by_moy = [{"month_of_year": m, "n_months": n, "median_ratio": med,
                   "min_ratio": rmin, "max_ratio": rmax,
                   "pearson_r": None if r is None or r != r else r,
                   "flag": not (lo <= med <= hi)}
                  for m, n, med, rmin, rmax, r in rows]
        return {
            "months_used": f"{overall[3]}..{overall[4]}",
            "overall": {"n_months": overall[0], "median_ratio": overall[1], "pearson_r": overall[2],
                        "flag": overall[1] is not None and not (lo <= overall[1] <= hi)},
            "by_month_of_year": by_moy,
            "flagged_month_of_year": [d["month_of_year"] for d in by_moy if d["flag"]],
            "monthly_ratios_outside_range": [{"month": m, "ratio": r} for m, r in outliers],
        }

    result = {
        "region": "india",
        "period": f"{OVERLAP_START}..{OVERLAP_END}",
        "metric": "national monthly hotspot totals (type 0, confidence-filtered, partial months dropped)",
        "ok_range": list(RATIO_OK),
        "pearson_r_min_years": MIN_YEARS_FOR_R,
        "SNPP/NOAA20": pair("snpp"),
        "NOAA21/NOAA20": pair("n21"),
    }
    out = INTERIM / "satfix_overlap_india.json"
    out.write_text(json.dumps(result, indent=2))

    print(f"\n  overlap check, India {OVERLAP_START}..{OVERLAP_END} (ok range {lo}-{hi}):")
    for name in ("SNPP/NOAA20", "NOAA21/NOAA20"):
        p = result[name]
        o = p["overall"]
        print(f"    {name}  months {p['months_used']}  overall median={o['median_ratio']:.3f}  "
              f"r={o['pearson_r']:.3f}  n={o['n_months']}" + ("  ** FLAG **" if o["flag"] else ""))
        print(f"      {'moy':>4}{'n':>4}{'median':>9}{'min':>8}{'max':>8}{'r':>8}")
        for d in p["by_month_of_year"]:
            r = "   n/a" if d["pearson_r"] is None else f"{d['pearson_r']:8.3f}"
            print(f"      {d['month_of_year']:>4}{d['n_months']:>4}{d['median_ratio']:>9.3f}"
                  f"{d['min_ratio']:>8.3f}{d['max_ratio']:>8.3f}{r:>8}"
                  + ("  ** FLAG **" if d["flag"] else ""))
        bad = p["monthly_ratios_outside_range"]
        if bad:
            print(f"      {len(bad)} individual months outside range: "
                  + ", ".join(f"{b['month']}={b['ratio']}" for b in bad))
    print(f"  -> {out.relative_to(REPO_ROOT)}")


def sanity_india(con: duckdb.DuckDBPyConnection) -> None:
    """Raw VIIRS total should step up as satellites join; the averaged one should not."""
    print("\n  sanity: India national VIIRS totals, raw (all satellites, before drops) vs averaged")
    for start, end, label in SANITY_WINDOWS:
        rows = con.execute(f"""
            WITH raw AS (SELECT month, sum(n_hotspots)::BIGINT AS raw,
                                string_agg(DISTINCT satellite, '+' ORDER BY satellite) AS sats
                         FROM g WHERE family = 'viirs' AND month BETWEEN '{start}' AND '{end}'
                         GROUP BY month),
                 avg AS (SELECT month, sum(mean_count) AS avg, max(n_sats) AS n_sats
                         FROM satfix WHERE family = 'viirs' AND month BETWEEN '{start}' AND '{end}'
                         GROUP BY month)
            SELECT month, raw, avg, n_sats, sats FROM raw LEFT JOIN avg USING (month) ORDER BY month
        """).fetchall()
        print(f"    -- {label} --")
        print(f"    {'month':<9}{'raw':>10}{'averaged':>11}{'n_sats':>8}{'raw/avg':>9}  sats in grid")
        for m, raw, avg, k, sats in rows:
            ratio = f"{raw / avg:9.2f}" if avg else "      n/a"
            print(f"    {m:<9}{raw:>10,}{avg:>11,.0f}{k:>8}{ratio}  {sats}")
    print("    (raw/avg should step ~1 -> ~2 -> ~3 as satellites join; averaged has no step)")


def main() -> None:
    regions = available_regions()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--region", choices=regions + ["all"], default="all",
                    help="region to process (default: all with a grid_<region>.parquet)")
    args = ap.parse_args()
    if not regions:
        sys.exit(f"ERROR: no grid_*.parquet in {INTERIM}; run 02_grid.py first")

    con = duckdb.connect()
    con.execute(f"SET temp_directory = {q(INTERIM / '.duckdb_tmp')}")
    for region in (regions if args.region == "all" else [args.region]):
        satfix_region(con, region)


if __name__ == "__main__":
    main()
