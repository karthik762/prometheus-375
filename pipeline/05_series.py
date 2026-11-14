"""D5a - Build the harmonized monthly series (the contract parquet).

Reads data/interim/satfix_<region>.parquet, fit_<region>.parquet and
cell_zone_<region>.parquet (from 03_satfix.py / 04_fit.py) and writes

  data/processed/harmonized_<region>.parquet
  data/processed/harmonized.parquet            all regions combined

with exactly the contract columns:

  cell_id:str, lat:float, lon:float, month:str (YYYY-MM),
  harmonized_count:float, source:str ('viirs'|'modis_converted'), uncertainty:float

Rule per cell-month:
  * VIIRS family present that month -> harmonized_count = viirs mean_count,
    source = 'viirs', uncertainty = 0.
  * otherwise (2000-11..2012-01 everywhere, plus 2026-11 outside India where SNPP
    is the only VIIRS and its last month is partial) ->
    harmonized_count = modis mean_count * ratio(zone, moy),
    source = 'modis_converted',
    uncertainty = modis mean_count * (ratio_hi - ratio_lo) / 2   (± counts).

Zero rows are kept (anomaly medians need them). If the combined file is over
100 MB, a second file harmonized_nonzero.parquet without rows where
harmonized_count == 0 and uncertainty == 0 is also written.

Usage:
  python pipeline/05_series.py                  # all regions with a fit file
  python pipeline/05_series.py --region india
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import duckdb

REPO_ROOT = Path(__file__).resolve().parents[1]
INTERIM = REPO_ROOT / "data" / "interim"
PROCESSED = REPO_ROOT / "data" / "processed"

FIRST_MONTH, LAST_MONTH = "2000-11", "2026-11"
SIZE_LIMIT_MB = 100.0
CONTRACT_COLS = ("cell_id, lat::DOUBLE AS lat, lon::DOUBLE AS lon, month, "
                 "harmonized_count::DOUBLE AS harmonized_count, source, "
                 "uncertainty::DOUBLE AS uncertainty")


def q(path: Path) -> str:
    return "'" + str(path).replace("\\", "/").replace("'", "''") + "'"


def available_regions() -> list[str]:
    return sorted(p.stem.removeprefix("fit_") for p in INTERIM.glob("fit_*.parquet")
                  if not p.stem.startswith("fit_report"))


def n_months(first: str, last: str) -> int:
    (y0, m0), (y1, m1) = (map(int, first.split("-")), map(int, last.split("-")))
    return (y1 - y0) * 12 + (m1 - m0) + 1


def mb(path: Path) -> float:
    return path.stat().st_size / 1e6


def check(con: duckdb.DuckDBPyConnection, table: str, label: str) -> None:
    """Contract asserts on a harmonized table."""
    nan, neg, unc_neg, bad_src, nulls = con.execute(f"""
        SELECT count(*) FILTER (WHERE isnan(harmonized_count) OR isnan(uncertainty)
                                   OR isnan(lat) OR isnan(lon)),
               count(*) FILTER (WHERE harmonized_count < 0),
               count(*) FILTER (WHERE uncertainty < 0),
               count(*) FILTER (WHERE source NOT IN ('viirs', 'modis_converted')),
               count(*) FILTER (WHERE cell_id IS NULL OR month IS NULL OR source IS NULL
                                   OR harmonized_count IS NULL OR uncertainty IS NULL
                                   OR lat IS NULL OR lon IS NULL)
        FROM {table}
    """).fetchone()
    assert nulls == 0, f"[{label}] {nulls:,} rows with NULLs"
    assert nan == 0, f"[{label}] {nan:,} rows with NaN"
    assert neg == 0, f"[{label}] {neg:,} negative harmonized_count"
    assert unc_neg == 0, f"[{label}] {unc_neg:,} negative uncertainty"
    assert bad_src == 0, f"[{label}] {bad_src:,} rows with an unknown source"
    dupes = con.execute(f"""
        SELECT count(*) FROM (SELECT cell_id, month FROM {table} GROUP BY ALL HAVING count(*) > 1)
    """).fetchone()[0]
    assert dupes == 0, f"[{label}] {dupes:,} duplicate (cell_id, month) keys"
    expect = n_months(FIRST_MONTH, LAST_MONTH)
    gaps = con.execute(f"""
        SELECT count(*) FROM (
            SELECT cell_id FROM {table} GROUP BY cell_id
            HAVING count(*) <> {expect} OR min(month) <> '{FIRST_MONTH}' OR max(month) <> '{LAST_MONTH}')
    """).fetchone()[0]
    assert gaps == 0, (f"[{label}] {gaps:,} cells without exactly {expect} months "
                       f"{FIRST_MONTH}..{LAST_MONTH}")
    bad_fmt = con.execute(f"""
        SELECT count(*) FROM {table} WHERE NOT regexp_full_match(month, '\\d{{4}}-\\d{{2}}')
    """).fetchone()[0]
    assert bad_fmt == 0, f"[{label}] {bad_fmt:,} months not formatted YYYY-MM"
    viirs_unc = con.execute(
        f"SELECT count(*) FROM {table} WHERE source = 'viirs' AND uncertainty <> 0").fetchone()[0]
    assert viirs_unc == 0, f"[{label}] {viirs_unc:,} viirs rows with non-zero uncertainty"


def series_region(con: duckdb.DuckDBPyConnection, region: str) -> Path:
    t0 = time.time()
    sf, fit, cz = (INTERIM / f"{p}_{region}.parquet" for p in ("satfix", "fit", "cell_zone"))
    out = PROCESSED / f"harmonized_{region}.parquet"

    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE h AS
        WITH s AS (SELECT * FROM read_parquet({q(sf)})),
             m AS (SELECT * FROM s WHERE family = 'modis'),
             v AS (SELECT * FROM s WHERE family = 'viirs'),
             f AS (SELECT zone_id, moy, ratio, ratio_lo, ratio_hi FROM read_parquet({q(fit)})),
             z AS (SELECT cell_id, zone_id FROM read_parquet({q(cz)}))
        SELECT m.cell_id, m.lat, m.lon, m.month,
               CASE WHEN v.cell_id IS NOT NULL THEN v.mean_count
                    ELSE m.mean_count * f.ratio END AS harmonized_count,
               CASE WHEN v.cell_id IS NOT NULL THEN 'viirs' ELSE 'modis_converted' END AS source,
               CASE WHEN v.cell_id IS NOT NULL THEN 0.0
                    ELSE m.mean_count * (f.ratio_hi - f.ratio_lo) / 2 END AS uncertainty,
               z.zone_id, f.ratio AS _ratio
        FROM m
        LEFT JOIN v USING (cell_id, month)
        LEFT JOIN z USING (cell_id)
        LEFT JOIN f ON f.zone_id = z.zone_id AND f.moy = CAST(right(m.month, 2) AS INTEGER)
    """)

    # --- region-specific asserts --------------------------------------------
    no_zone, no_ratio = con.execute("""
        SELECT count(*) FILTER (WHERE zone_id IS NULL),
               count(*) FILTER (WHERE source = 'modis_converted' AND _ratio IS NULL)
        FROM h
    """).fetchone()
    assert no_zone == 0, f"[{region}] {no_zone:,} rows whose cell has no zone in cell_zone"
    assert no_ratio == 0, f"[{region}] {no_ratio:,} modis_converted rows without a fit ratio"
    v_only = con.execute(f"""
        SELECT count(*) FROM read_parquet({q(sf)}) v WHERE family = 'viirs' AND NOT EXISTS (
            SELECT 1 FROM read_parquet({q(sf)}) m
            WHERE m.family = 'modis' AND m.cell_id = v.cell_id AND m.month = v.month)
    """).fetchone()[0]
    assert v_only == 0, f"[{region}] {v_only:,} VIIRS cell-months with no MODIS row (would be lost)"
    check(con, "h", region)

    con.execute(f"COPY (SELECT {CONTRACT_COLS} FROM h ORDER BY cell_id, month) "
                f"TO {q(out)} (FORMAT PARQUET, COMPRESSION ZSTD)")

    n_rows, n_cells, n_zero = con.execute(
        "SELECT count(*), count(DISTINCT cell_id), count(*) FILTER (WHERE harmonized_count = 0) FROM h"
    ).fetchone()
    print(f"\n=== {region.upper()} ===  cells={n_cells:,}  rows={n_rows:,}  "
          f"zero rows={n_zero:,} ({100 * n_zero / n_rows:.0f}%)  "
          f"-> {out.relative_to(REPO_ROOT)}  {mb(out):.1f} MB  ({time.time() - t0:.0f}s)")
    for src, mn, mx, nm, tot, unc in con.execute("""
        SELECT source, min(month), max(month), count(DISTINCT month),
               sum(harmonized_count), sum(uncertainty)
        FROM h GROUP BY 1 ORDER BY 1
    """).fetchall():
        print(f"  {src:<16}{mn}..{mx}  months={nm:<4} total={tot:>13,.0f}  sum(+-)={unc:>11,.0f}")
    odd = con.execute(f"""
        SELECT DISTINCT month FROM h WHERE source = 'modis_converted' AND month >= '2012-02' ORDER BY 1
    """).fetchall()
    if odd:
        print(f"  modis_converted after 2012-01: {', '.join(r[0] for r in odd)}")
    return out


def main() -> None:
    regions = available_regions()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--region", choices=regions + ["all"], default="all",
                    help="region to process (default: all with a fit_<region>.parquet)")
    args = ap.parse_args()
    if not regions:
        sys.exit(f"ERROR: no fit_*.parquet in {INTERIM}; run 04_fit.py first")
    PROCESSED.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()
    con.execute(f"SET temp_directory = {q(INTERIM / '.duckdb_tmp')}")
    con.execute("SET enable_progress_bar = false")
    for region in (regions if args.region == "all" else [args.region]):
        series_region(con, region)

    # Combined file always covers every region that has a harmonized file, so a
    # single-region rerun refreshes the combined output too.
    parts = sorted(PROCESSED.glob("harmonized_*.parquet"))
    parts = [p for p in parts if p.stem != "harmonized_nonzero"]
    combined = PROCESSED / "harmonized.parquet"
    files = "[" + ", ".join(q(p) for p in parts) + "]"
    con.execute(f"CREATE OR REPLACE TEMP TABLE allh AS SELECT * FROM read_parquet({files})")
    check(con, "allh", "combined")
    con.execute(f"COPY (SELECT * FROM allh ORDER BY cell_id, month) TO {q(combined)} "
                f"(FORMAT PARQUET, COMPRESSION ZSTD)")
    n_rows = con.execute("SELECT count(*) FROM allh").fetchone()[0]
    print(f"\n=== COMBINED ({', '.join(p.stem.removeprefix('harmonized_') for p in parts)}) ===  "
          f"rows={n_rows:,}  -> {combined.relative_to(REPO_ROOT)}  {mb(combined):.1f} MB")
    schema = con.execute(f"DESCRIBE SELECT * FROM read_parquet({q(combined)})").fetchall()
    print("  schema: " + ", ".join(f"{c}:{t}" for c, t, *_ in schema))

    nonzero = PROCESSED / "harmonized_nonzero.parquet"
    if mb(combined) > SIZE_LIMIT_MB:
        con.execute(f"COPY (SELECT * FROM allh WHERE NOT (harmonized_count = 0 AND uncertainty = 0) "
                    f"ORDER BY cell_id, month) TO {q(nonzero)} (FORMAT PARQUET, COMPRESSION ZSTD)")
        nz = con.execute(f"SELECT count(*) FROM read_parquet({q(nonzero)})").fetchone()[0]
        print(f"  combined is over {SIZE_LIMIT_MB:.0f} MB -> also wrote {nonzero.relative_to(REPO_ROOT)} "
              f"without all-zero rows: rows={nz:,}  {mb(nonzero):.1f} MB")
        print("  NOTE: the nonzero file has gaps; backend must treat missing cell-months as 0.")
    else:
        if nonzero.exists():
            nonzero.unlink()
        print(f"  under {SIZE_LIMIT_MB:.0f} MB -> no nonzero version needed")


if __name__ == "__main__":
    main()
